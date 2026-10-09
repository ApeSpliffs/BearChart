/*
 * BearChart valuation engine.
 *
 * Pure functions, no DOM. Loaded as a plain script in the browser
 * (sets globalThis.BearChartEngine) and required directly by the Node tests,
 * so the same code that prices the page is the code under test. It ports
 * unchanged to a Next.js/Supabase backend later.
 *
 * Governing rules, from BuildaBear1.md sections 3, 17 and 33:
 *   - Sold observations only. Active listings never enter a valuation.
 *   - Median, never a single outlier.
 *   - Confidence is a function of how many comparable sales exist.
 *   - Nothing is invented: no comps means no value, not a guess.
 */
(function (root) {
  'use strict';

  // ---- statistics ---------------------------------------------------------

  function sortNums(xs) {
    return xs.slice().sort(function (a, b) { return a - b; });
  }

  /** Linear-interpolated percentile. p is 0..1. Expects a sorted array. */
  function percentile(sorted, p) {
    if (!sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    var idx = (sorted.length - 1) * p;
    var lo = Math.floor(idx);
    var hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  function median(xs) {
    return percentile(sortNums(xs), 0.5);
  }

  /**
   * Outlier rejection by median absolute deviation.
   *
   * Tukey fences assume enough mass in the quartiles to mean something. Secondary
   * market prices are small-n, right-skewed and fat-tailed, so with six comps the
   * quartiles are mostly noise and the fences reject whichever comp is least like
   * the other two. MAD with a modified z-score is robust at these sample sizes and
   * degrades gracefully instead of quietly deleting real sales.
   *
   *   z = 0.6745 * (x - median) / MAD        (0.6745 = 0.75 quantile of N(0,1),
   *                                           putting MAD on a sigma-equivalent scale)
   *   reject |z| > 3.5                       (Iglewicz & Hoaglin)
   *
   * Expects CONDITION-NORMALISED prices. Run on raw prices, every NWT sale looks
   * like an outlier against used comps.
   */
  function madOutliers(values, minPoints) {
    var min = minPoints || 5;
    var none = function (note) {
      return { kept: values.slice(), rejected: [], note: note };
    };

    // Below five points there is no distribution to speak of.
    if (values.length < min) return none('too_few_to_filter');

    var med = median(values);
    var mad = median(values.map(function (x) { return Math.abs(x - med); }));

    // Identical prices give MAD 0, which makes every deviation infinitely far.
    if (mad === 0) return none('zero_dispersion');

    var kept = [], rejected = [];
    values.forEach(function (x) {
      var z = 0.6745 * (x - med) / mad;
      (Math.abs(z) > 3.5 ? rejected : kept).push({ value: x, z: z });
    });

    // Never discard the whole sample to satisfy a filter.
    if (kept.length < 3) return none('filter_abandoned');
    return { kept: kept, rejected: rejected, note: null };
  }

  // ---- bootstrap ----------------------------------------------------------

  /** Deterministic PRNG, so a valuation does not wobble between page loads. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedFrom(str) {
    var h = 2166136261;
    for (var i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /**
   * A conservative lower bound on what an item is worth.
   *
   * The point estimate is the wrong thing to compare an asking price against: with
   * three comps it carries the same authority as with thirty, so a "deal" rule
   * built on it fires constantly on exactly the rare items whose data is thinnest.
   * A lower bound scales its own caution with the evidence - wide uncertainty
   * demands a deeper discount before anything is called a bargain, with no
   * special-casing of rare items, because rarity expresses itself as variance.
   *
   * Three regimes, because they are honestly different situations:
   *   n >= 5  bootstrap the median and take a low percentile of its distribution
   *   n 2..4  the lowest observed value - the real floor the data supports
   *   n == 1  no dispersion information at all, so a fixed haircut stands in
   */
  function lowerBound(values, config, seedKey) {
    if (!values || !values.length) return null;
    var c = (config && config.bootstrap) || {};
    var pct = c.percentile != null ? c.percentile : 0.25;
    var iters = c.iterations || 2000;
    var haircut = c.single_comp_haircut != null ? c.single_comp_haircut : 0.75;

    if (values.length === 1) {
      return { value: values[0] * haircut, basis: 'single_comp_haircut', n: 1 };
    }
    if (values.length < 5) {
      return { value: Math.min.apply(null, values), basis: 'observed_floor',
               n: values.length };
    }

    var rand = mulberry32(seedFrom(seedKey || 'bearchart'));
    var medians = [];
    for (var i = 0; i < iters; i++) {
      var sample = [];
      for (var j = 0; j < values.length; j++) {
        sample.push(values[Math.floor(rand() * values.length)]);
      }
      medians.push(median(sample));
    }
    return {
      value: percentile(sortNums(medians), pct),
      basis: 'bootstrap_p' + Math.round(pct * 100),
      n: values.length
    };
  }

  // ---- normalisation ------------------------------------------------------

  function conditionMultiplier(config, condition) {
    var m = config.condition_multipliers;
    return (condition && m[condition] != null) ? m[condition] : m.Unknown;
  }

  function completenessMultiplier(config, completeness) {
    var m = config.completeness_multipliers;
    return (completeness && m[completeness] != null) ? m[completeness] : m.unknown;
  }

  /** The price a sale implies for the same item in baseline trim (Good, bare). */
  function normalisedPrice(sale, config) {
    var price = effectivePrice(sale);
    if (price == null) return null;
    var mult = conditionMultiplier(config, sale.condition) *
               completenessMultiplier(config, sale.completeness);
    return mult > 0 ? price / mult : null;
  }

  /** A ranged research note contributes its midpoint, and is flagged as such. */
  function effectivePrice(sale) {
    if (sale.sold_price == null) return null;
    if (sale.ranged && sale.price_high != null) {
      return (sale.sold_price + sale.price_high) / 2;
    }
    return sale.sold_price;
  }

  function isMarketEvidence(sale, config) {
    return config.market_evidence_types.indexOf(sale.evidence_type) !== -1;
  }

  /**
   * How many real transactions a row represents.
   *
   * Normally one. But a research tool like Terapeak reports an AVERAGE across a
   * period rather than a list of sales - "avg $54 across 12 sold". That single
   * row is genuine evidence of twelve transactions, and confidence is defined by
   * how many comparable sales exist, so it counts as twelve there. It still
   * contributes one number to the median, because one average is all it gives
   * us; the spread inside it is unknown and is not invented.
   */
  function sampleSize(sale) {
    var n = sale.sample_size;
    return (typeof n === 'number' && n > 0) ? Math.floor(n) : 1;
  }

  /**
   * Provenance alone decides strength. A sale by the operator gets no bonus:
   * Jay's Retro Exchange runs this site, so its own sales are a conflict of
   * interest to be capped (see valuate), not the best evidence there is.
   */
  function isStrongEvidence(sale, config) {
    return config.strong_evidence_types.indexOf(sale.evidence_type) !== -1;
  }

  /** Sold by the operator: imported from its own records, or a known seller id. */
  function isOperator(sale) {
    return !!(sale && (sale.first_party || sale.seller_is_operator));
  }

  /**
   * Operator points kept behind a value: at most config.operator_cap of all
   * points, i.e. floor(third * cap / (1 - cap)). The most recent are kept
   * (date desc, then id asc, so the choice is deterministic). Without a
   * configured cap, none are kept - the safe direction.
   */
  function capOperator(points, config) {
    var cap = typeof config.operator_cap === 'number' ? config.operator_cap : 0;
    var third = points.filter(function (p) { return !isOperator(p.sale); });
    var op = points.filter(function (p) { return isOperator(p.sale); });
    var maxOp = cap > 0 && cap < 1 ? Math.floor(third.length * cap / (1 - cap) + 1e-9) : 0;
    op.sort(function (a, b) {
      var da = a.sale.sale_date || '', db = b.sale.sale_date || '';
      if (da !== db) return da < db ? 1 : -1;
      var ia = String(a.sale.id || ''), ib = String(b.sale.id || '');
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    });
    var keepOp = op.slice(0, maxOp);
    var kept = {};
    keepOp.forEach(function (p) { kept[p.sale.id] = true; });
    return {
      third: third.length,
      points: points.filter(function (p) { return !isOperator(p.sale) || kept[p.sale.id]; }),
      excluded: op.slice(maxOp).map(function (p) {
        return { sale_id: p.sale.id, reason: 'operator_cap' };
      })
    };
  }

  // ---- confidence ---------------------------------------------------------

  function confidenceFor(count, config) {
    var c = config.confidence;
    if (count >= c.high_min) return 'HIGH';
    if (count >= c.medium_min) return 'MEDIUM';
    if (count >= c.low_min) return 'LOW';
    return 'VERY LOW';
  }

  // ---- valuation ----------------------------------------------------------

  /**
   * Value one item from its sales.
   * Returns a result object that always carries its own reasoning, so the UI
   * can explain why the number is what it is rather than just asserting it.
   */
  /** 'YYYY-MM-DD' moved by a number of days, still 'YYYY-MM-DD'. */
  function shiftDate(iso, days) {
    var d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d.getTime())) return null;
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Prefer what a bear sells for now.
   *
   * The window is the twelve months (config.recency.window_days) up to
   * config.recency.as_of - the date the data was built, stated in the data
   * rather than read from the clock, so the same data always gives the same
   * answer. When an item has enough sales in the window (min_recent, counting
   * transactions), older sales are left out of the value: a hyped release that
   * crashed, or a retired bear that climbed, should not be priced by what it
   * did three years ago. Below the threshold every sale is used, because thin
   * recent data is worse than old data. With NO sale in the window the value
   * is still published from every sale, but it is marked stale.
   *
   * Legacy config without as_of anchors on the item's own latest sale, as
   * before, and never reports stale.
   */
  function recencyWindow(usable, config) {
    var rc = config.recency || {};
    var windowDays = rc.window_days || 365;
    var minRecent = rc.min_recent || 10;
    var latest = '';
    usable.forEach(function (s) { if (s.sale_date && s.sale_date > latest) latest = s.sale_date; });
    var anchored = !!rc.as_of;
    var asOf = rc.as_of || latest;
    var since = asOf ? shiftDate(asOf, -windowDays) : null;
    var recent = since ? usable.filter(function (s) {
      return s.sale_date && s.sale_date >= since && s.sale_date <= asOf;
    }) : [];
    var n = recent.reduce(function (a, s) { return a + sampleSize(s); }, 0);
    return {
      anchored: anchored, as_of: asOf || null, since: since, latest: latest || null,
      recent: recent, transactions: n, min_recent: minRecent,
      use_recent: !!since && n >= minRecent && recent.length < usable.length
    };
  }

  /** Back-compat: the recent subset when the window applies, else null. */
  function recentOnly(usable, config) {
    var w = recencyWindow(usable, config);
    if (!w.use_recent) return null;
    return { sales: w.recent, since: w.since, dropped: usable.length - w.recent.length };
  }

  function valuate(item, sales, config) {
    var why = [];
    var usable = (sales || []).filter(function (s) {
      return !s.excluded && isMarketEvidence(s, config) && effectivePrice(s) != null;
    });
    var soldTransactions = usable.reduce(function (a, s) { return a + sampleSize(s); }, 0);
    var win = usable.length ? recencyWindow(usable, config) : null;
    var recency = win && win.use_recent
      ? { sales: win.recent, since: win.since, dropped: usable.length - win.recent.length }
      : null;
    if (recency) usable = recency.sales;
    // Stale: a value is published from older sales because none fall in the
    // window. Only reported when the data states its as_of date.
    var stale = !!(win && win.anchored && win.transactions === 0);
    var staleReason = stale ? (win.latest ? 'no_sales_in_window' : 'undated_only') : null;

    var result = {
      item_id: item.id,
      comparable_count: 0,
      // Every recorded sold transaction behind this item (averages expanded),
      // all-time, before the recency window, outliers and the operator cap.
      // catalogueStats sums this; it is the "sold transactions recorded" figure.
      sold_transactions: soldTransactions,
      total_observations: (sales || []).length,
      stale: stale,
      stale_reason: staleReason,
      last_sale_date: win ? win.latest : null,
      window: win && win.since
        ? { as_of: win.as_of, since: win.since,
            basis: win.transactions >= win.min_recent ? 'recent' : 'all_time' }
        : null,
      confidence: 'VERY LOW',
      has_value: false,
      fair_market: null,
      range_low: null,
      range_high: null,
      median_raw: null,
      buy_low: null, buy_high: null,
      trade_low: null, trade_high: null,
      sell_low: null, sell_high: null,
      ask_low: null, ask_high: null,
      strong_evidence_count: 0,
      ranged_count: 0,
      lower_bound: null,
      lower_bound_basis: null,
      outlier_note: null,
      first_party_count: 0,
      operator_count: 0,
      operator_excluded: [],
      aggregate_count: 0,
      observation_count: 0,
      excluded_outliers: [],
      by_condition: {},
      points: [],
      why: why,
      caveats: []
    };

    if (!usable.length) {
      why.push('No sold observations are recorded for this item yet, so BearChart ' +
               'does not publish a value. An estimate without evidence would be a guess.');
      result.caveats.push('no-data');
      return result;
    }

    if (item.is_lot) {
      result.caveats.push('lot');
      why.push('This record is a multi-item lot. Its sale price covers several ' +
               'pieces, so it is not a valid comparable for any single item.');
    }

    // Normalise every comp to the same baseline before comparing them.
    var points = usable.map(function (s) {
      return { sale: s, raw: effectivePrice(s), norm: normalisedPrice(s, config) };
    }).filter(function (p) { return p.norm != null; });

    var norms = points.map(function (p) { return p.norm; });
    var verdict = madOutliers(norms, 5);
    var rejectedSet = {};
    verdict.rejected.forEach(function (r) { rejectedSet[r.value] = r.z; });

    var kept = points;
    if (verdict.rejected.length) {
      kept = points.filter(function (p) {
        var out = Object.prototype.hasOwnProperty.call(rejectedSet, p.norm);
        if (out) {
          result.excluded_outliers.push({
            sale_id: p.sale.id, price: p.raw,
            z: Math.round(rejectedSet[p.norm] * 10) / 10
          });
        }
        return !out;
      });
      why.push('Excluded ' + result.excluded_outliers.length + ' outlying sale' +
               (result.excluded_outliers.length === 1 ? '' : 's') +
               ' more than 3.5 median absolute deviations from the middle.');
    }
    result.outlier_note = verdict.note;
    if (!kept.length) kept = points; // never throw away every comp

    // Jay's Retro Exchange runs BearChart. Its own sales are capped, never
    // boosted, and on their own they publish nothing.
    var capped = capOperator(kept, config);
    if (!capped.third) {
      result.operator_count = kept.length;
      result.operator_excluded = kept.map(function (p) {
        return { sale_id: p.sale.id, reason: 'operator_only' };
      });
      result.excluded_outliers = [];
      why.length = 0;
      why.push('The only sales recorded are by Jay\'s Retro Exchange, which runs this ' +
               'site, so no value is published from them.');
      result.caveats.push('operator-only');
      return result;
    }
    kept = capped.points;
    result.operator_excluded = capped.excluded;

    var keptNorms = sortNums(kept.map(function (p) { return p.norm; }));
    var n = kept.reduce(function (a, p) { return a + sampleSize(p.sale); }, 0);

    // The individual observations behind the number, normalised to the same
    // baseline the median is taken of. Exposed so a page can SHOW its
    // evidence rather than only state a count: with one or two comps, a
    // picture of where they sit inside the published range says more about
    // how much is known than the word "LOW" does.
    //
    // norm is what actually entered the median (condition and completeness
    // adjusted); raw is the figure the seller received. Plotting raw against
    // an adjusted median would compare two different things.
    result.points = kept.map(function (p) {
      return {
        sale_id: p.sale.id,
        raw: p.raw,
        norm: p.norm,
        condition: p.sale.condition || null,
        completeness: p.sale.completeness || null,
        evidence_type: p.sale.evidence_type || null,
        first_party: !!p.sale.first_party,
        operator: isOperator(p.sale),
        sale_date: p.sale.sale_date || null
      };
    });

    result.comparable_count = n;
    result.observation_count = kept.length;
    result.aggregate_count = kept.filter(function (p) {
      return sampleSize(p.sale) > 1;
    }).length;
    result.confidence = confidenceFor(n, config);
    result.has_value = true;
    result.median_raw = median(kept.map(function (p) { return p.raw; }));
    result.strong_evidence_count = kept.filter(function (p) {
      return isStrongEvidence(p.sale, config);
    }).length;
    result.ranged_count = kept.filter(function (p) { return p.sale.ranged; }).length;
    result.first_party_count = kept.filter(function (p) { return !!p.sale.first_party; }).length;
    result.operator_count = kept.filter(function (p) { return isOperator(p.sale); }).length;

    var fmv = percentile(keptNorms, 0.5);
    result.fair_market = fmv;

    // The conservative figure. Anything that decides whether to spend money -
    // a deal alert above all - should compare against this, not the median.
    var lb = lowerBound(keptNorms, config, item.id);
    result.lower_bound = lb ? lb.value : null;
    result.lower_bound_basis = lb ? lb.basis : null;

    // With fewer than four comps, quartiles are noise - show the observed span.
    var points_n = keptNorms.length;
    if (points_n >= 4) {
      result.range_low = percentile(keptNorms, 0.25);
      result.range_high = percentile(keptNorms, 0.75);
      why.push('Range is the 25th-75th percentile of ' + points_n +
               ' condition-adjusted price points.');
    } else {
      result.range_low = keptNorms[0];
      result.range_high = keptNorms[keptNorms.length - 1];
      why.push('With only ' + points_n + ' price point' + (points_n === 1 ? '' : 's') +
               ', the range shows the full observed spread rather than a percentile band.');
    }

    var b = config.bands;
    result.buy_low = fmv * b.buy[0];
    result.buy_high = fmv * b.buy[1];
    result.trade_low = fmv * b.trade[0];
    result.trade_high = fmv * b.trade[1];
    result.sell_low = result.range_low;
    result.sell_high = result.range_high;
    result.ask_low = fmv * b.high_ask[0];
    result.ask_high = fmv * b.high_ask[1];

    // Per-condition medians, so a NWT comp never quietly sets a used price.
    kept.forEach(function (p) {
      var c = p.sale.condition || 'Unknown';
      (result.by_condition[c] = result.by_condition[c] || []).push(p.raw);
    });
    Object.keys(result.by_condition).forEach(function (c) {
      var xs = result.by_condition[c];
      result.by_condition[c] = { count: xs.length, median: median(xs) };
    });

    why.unshift('Fair market value is the median of ' + points_n + ' sold observation' +
                (points_n === 1 ? '' : 's') + ', each adjusted to a baseline of Good ' +
                'condition with no extras.');

    if (stale) {
      result.caveats.push('stale');
      why.push(staleReason === 'undated_only'
        ? 'None of these sales is dated, so there is no telling how current this value ' +
          'is. It may be out of date.'
        : 'No sale recorded in the 12 months to ' + win.as_of + '; last sale ' + win.latest +
          '. This value may be out of date.');
    }

    if (recency) {
      result.recent_since = recency.since;
      why.push('Uses the sales from the twelve months to ' + win.as_of + ' (since ' +
               recency.since + '). ' + recency.dropped + ' older sale' +
               (recency.dropped === 1 ? ' is' : 's are') + ' listed below but left out of ' +
               'the value, because prices move.');
    }

    if (result.aggregate_count) {
      result.caveats.push('aggregate');
      why.push(result.aggregate_count + ' of these observation' +
               (result.aggregate_count === 1 ? ' is an average' : 's are averages') +
               ' reported across multiple sales (' + n + ' transactions in total). ' +
               'An average hides the spread inside it, so treat the range as narrower ' +
               'than reality.');
    }

    if (result.operator_count || result.operator_excluded.length) {
      why.push(result.operator_count + ' of these comps ' +
               (result.operator_count === 1 ? 'was' : 'were') + ' sold by Jay\'s Retro ' +
               'Exchange, which runs BearChart; operator sales are capped at ' +
               Math.round((config.operator_cap || 0) * 100) + '% of the comps behind a value' +
               (result.operator_excluded.length
                 ? ', so ' + result.operator_excluded.length + ' more ' +
                   (result.operator_excluded.length === 1 ? 'is' : 'are') + ' listed but left out.'
                 : '.'));
    }
    if (result.strong_evidence_count === 0) {
      result.caveats.push('no-strong-evidence');
      why.push('None of these comps carry full provenance (date, marketplace and ' +
               'listing id), so they are treated as collector reports rather than ' +
               'verified completed sales.');
    }
    if (result.ranged_count) {
      result.caveats.push('ranged');
      why.push(result.ranged_count + ' observation' + (result.ranged_count === 1 ? ' was' : 's were') +
               ' recorded as a price range; the midpoint was used.');
    }
    if (Object.keys(result.by_condition).length > 1) {
      why.push('Comps span more than one condition grade - check the per-condition ' +
               'medians before pricing your own copy.');
    }
    if (item.version || item.variant) {
      result.caveats.push('variant');
      why.push('This item has known versions or variants. Confirm which one you ' +
               'have; versions are priced separately and must not be averaged.');
    }
    if (item.release_status === 'upcoming') {
      result.caveats.push('upcoming');
      why.push('This item has not been released yet. Any sale recorded against it is a ' +
               'pre-order or a scalped early copy, which reflects hype rather than a ' +
               'settled market. Treat the value as provisional until it has been out ' +
               'for a while.');
    }
    if (item.release_status === 'current') {
      result.caveats.push('current-retail');
      why.push('This item is still available at retail, which caps what the secondary ' +
               'market will pay. Check the retail price before paying a premium.');
    }
    if (item.vault_release) {
      result.caveats.push('vault');
      why.push('This is a Vault release. A reissue does not carry the value of an ' +
               'original vintage release.');
    }

    return result;
  }

  /**
   * Per-copy modifiers on top of condition and completeness.
   *
   * Returns the chain as well as the result, because a number the user cannot
   * take apart is a number they cannot argue with - and on a $250 bear the
   * difference between 1.15 and 1.45 is real money.
   */
  function modifierChain(mods, config, condition) {
    var cfg = (config && config.modifiers) || {};
    var mult = cfg.multiplicative || {};
    var add = cfg.additive_usd || {};
    var labels = cfg.labels || {};
    var exclusive = cfg.exclusive_with || {};
    var cap = cfg.max_combined_multiplier || 1.45;

    var factor = 1, additive = 0, applied = [];

    Object.keys(mods || {}).forEach(function (key) {
      if (!mods[key]) return;
      // A modifier the condition already prices is not counted twice: an NWT
      // grade already pays for the hang tag.
      if (condition && exclusive[key] && exclusive[key].indexOf(condition) !== -1) return;
      if (mult[key] != null) {
        factor *= mult[key];
        applied.push({ key: key, label: labels[key] || key,
                       kind: 'multiplicative', value: mult[key] });
      } else if (add[key] != null) {
        additive += add[key];
        applied.push({ key: key, label: labels[key] || key,
                       kind: 'additive', value: add[key] });
      }
    });

    // Only cap gains. A copy missing its tush tag and customised should be
    // allowed all the way down - the floor is what the market says, not a rule.
    var capped = false;
    if (factor > cap) { factor = cap; capped = true; }

    return { factor: factor, additive: additive, applied: applied,
             capped: capped, cap: cap };
  }

  /** Apply the calculator adjustments to a valuation for a specific copy. */
  function adjust(valuation, condition, completeness, config, mods) {
    if (!valuation || !valuation.has_value) return null;
    var mult = conditionMultiplier(config, condition) *
               completenessMultiplier(config, completeness);
    var chain = modifierChain(mods, config, condition);
    mult *= chain.factor;

    var b = config.bands;
    // Detachable components are added at their own market price AFTER the
    // multipliers, so a $7 sound chip stays $7 rather than being scaled by the
    // value of the bear it happens to be inside.
    var fmv = valuation.fair_market * mult + chain.additive;
    return {
      multiplier: mult,
      fair_market: fmv,
      lower_bound: valuation.lower_bound != null
        ? valuation.lower_bound * mult + chain.additive : null,
      lower_bound_basis: valuation.lower_bound_basis,
      modifiers: chain,
      range_low: valuation.range_low * mult + chain.additive,
      range_high: valuation.range_high * mult + chain.additive,
      buy_low: fmv * b.buy[0], buy_high: fmv * b.buy[1],
      trade_low: fmv * b.trade[0], trade_high: fmv * b.trade[1],
      ask_low: fmv * b.high_ask[0], ask_high: fmv * b.high_ask[1],
      confidence: valuation.confidence
    };
  }

  /** Year-over-year series from dated sales only. Undated research cannot chart. */
  function priceHistory(sales, config) {
    var byYear = {};
    (sales || []).forEach(function (s) {
      if (!s.sale_date || !isMarketEvidence(s, config)) return;
      var y = String(s.sale_date).slice(0, 4);
      var p = effectivePrice(s);
      if (p == null) return;
      (byYear[y] = byYear[y] || []).push(p);
    });
    return Object.keys(byYear).sort().map(function (y) {
      return { year: Number(y), median: median(byYear[y]), count: byYear[y].length };
    });
  }

  /**
   * Compare what sellers are ASKING against what the item actually sells for.
   *
   * Active listings never enter a valuation - valuate() will not look at them.
   * This function is the only place they are used, and it only ever compares.
   * A large positive premium means sellers are optimistic; a discount usually
   * means the sold comps are stale and the market has moved.
   */
  function askSpread(valuation, listings) {
    if (!valuation || !valuation.has_value) return null;
    var asks = (listings || [])
      .filter(function (l) {
        return l && l.evidence_type === 'active_listing' && !l.seller_is_operator;
      })
      .map(function (l) { return l.ask_price; })
      .filter(function (p) { return typeof p === 'number' && p > 0; });
    if (!asks.length) return null;

    var sorted = sortNums(asks);
    var medianAsk = percentile(sorted, 0.5);
    return {
      count: asks.length,
      median_ask: medianAsk,
      low_ask: sorted[0],
      high_ask: sorted[sorted.length - 1],
      fair_market: valuation.fair_market,
      premium_pct: ((medianAsk - valuation.fair_market) / valuation.fair_market) * 100,
      reading: medianAsk > valuation.fair_market * 1.15 ? 'asking-above-market'
        : medianAsk < valuation.fair_market * 0.85 ? 'asking-below-market'
        : 'in-line'
    };
  }

  // ---- deal finder --------------------------------------------------------

  var CONFIDENCE_RANK = { 'VERY LOW': 0, LOW: 1, MEDIUM: 2, HIGH: 3 };

  /**
   * The fee schedule for one platform, from config.fees. Every figure lives in
   * the config (tools/domain_vocab.py), never in this file. A config without a
   * schedule charges nothing, rather than a number nobody chose.
   */
  function platformFees(config, platform) {
    var f = (config && config.fees) || {};
    var platforms = f.platforms || {};
    var s = platforms[platform || f.default_platform];
    if (s) return s;
    return { label: 'none', pct: 0, fixed_over: 0, fixed_under: 0, fixed_threshold: 0,
             applies_to: 'item' };
  }

  /** The marketplace's cut of one order: a percentage plus a per-order fixed fee. */
  function sellingFee(orderTotal, sched) {
    var fixed = orderTotal > (sched.fixed_threshold || 0)
      ? (sched.fixed_over || 0) : (sched.fixed_under || 0);
    return orderTotal * (sched.pct || 0) + fixed;
  }

  /**
   * What one copy actually nets you after fees and shipping.
   *
   * A gross discount is not profit. An item worth $60 that you buy for $30 is
   * not a $30 win: the marketplace takes its cut of the $60 (and, on eBay, of
   * the shipping the buyer pays) and you pay to ship it. This is the number
   * that decides whether something is worth buying.
   *
   * opts: {platform, shipping_charged}; both default from config.reseller.
   */
  function netProceeds(itemPrice, config, opts) {
    var r = (config && config.reseller) || {};
    var o = opts || {};
    var s = platformFees(config, o.platform || r.platform);
    var shipIn = o.shipping_charged != null ? o.shipping_charged : (r.shipping_charged || 0);
    var base = s.applies_to === 'item' ? itemPrice : itemPrice + shipIn;
    return itemPrice + shipIn - sellingFee(base, s) - (r.shipping_cost || 0);
  }

  /**
   * What a buyer actually pays for a listing: the ask plus its stated shipping,
   * or plus an assumed figure (config.reseller.assumed_inbound_shipping) when
   * the listing does not state one. A $40 ask with $12 shipping costs $52.
   */
  function buyerTotal(listing, config) {
    var r = (config && config.reseller) || {};
    var ship = listing.ship_price != null ? listing.ship_price
      : (r.assumed_inbound_shipping || 0);
    return listing.ask_price + ship;
  }

  /**
   * Find active listings priced below what the sold data says the item is worth.
   *
   * Two rules keep this honest:
   *   - No sold data, no deal. An item nobody has a comp for cannot be
   *     underpriced, because nobody knows what it is worth.
   *   - The listing's own condition is applied before comparing. A $40 ask on a
   *     played-with copy is not a bargain just because NWT examples fetch $90.
   */
  function findDeals(opts) {
    var config = opts.config;
    var r = config.reseller || {};
    var minRank = CONFIDENCE_RANK[r.min_confidence || 'LOW'];
    var deals = [];

    (opts.listings || []).forEach(function (l) {
      if (!l || l.evidence_type !== 'active_listing') return;
      // Never offer the operator's own listings as bargains on its own guide.
      if (l.seller_is_operator) return;
      var ask = l.ask_price;
      if (!(typeof ask === 'number' && ask > 0)) return;

      var item = opts.itemById(l.item_id);
      var v = opts.valuationFor(l.item_id);
      if (!item || !v || !v.has_value) return;
      if ((CONFIDENCE_RANK[v.confidence] || 0) < minRank) return;
      // A value nobody has confirmed in a year is no basis for spending money.
      if (v.stale && r.exclude_stale !== false) return;

      // Price the listing as the condition it is actually in.
      var adj = adjust(v, l.condition || 'Unknown', 'unknown', config);
      var gross = adj.fair_market;
      if (!(gross > 0)) return;

      // Judge the ask against the conservative floor, not the median. With three
      // comps a median carries the same authority as with thirty, which is what
      // makes a naive rule fire endlessly on the rare items whose data is
      // thinnest. The floor widens as the evidence thins, so a sparse item has to
      // be a genuinely better bargain before it appears here.
      var floor = (adj.lower_bound != null && adj.lower_bound > 0)
        ? adj.lower_bound : gross;

      var net = netProceeds(floor, config);
      var shipAssumed = l.ship_price == null;
      var cost = buyerTotal(l, config);
      var margin = net - cost;
      var discountPct = ((floor - cost) / floor) * 100;

      if (margin < (r.min_net_margin || 0)) return;
      if (discountPct < (r.min_discount_pct || 0)) return;

      var risks = [];
      if (v.confidence === 'LOW') {
        risks.push('Only ' + v.comparable_count + ' comparable sale' +
                   (v.comparable_count === 1 ? '' : 's') + ' behind this value - the ' +
                   'gap may be the data, not the deal. Judged against a floor of ' +
                   Math.round(floor) + ' rather than the ' + Math.round(gross) +
                   ' median for that reason.');
      }
      if (v.caveats.indexOf('no-strong-evidence') !== -1) {
        risks.push('No fully sourced comp for this item; the value rests on collector ' +
                   'reports.');
      }
      if (v.caveats.indexOf('variant') !== -1) {
        risks.push('This item has versions that price differently - confirm which one ' +
                   'the listing actually is.');
      }
      if (v.caveats.indexOf('current-retail') !== -1) {
        risks.push('Still available at retail, which caps resale.');
      }
      if (item.is_lot) {
        risks.push('Catalogued as a multi-item lot.');
      }
      if (v.stale) {
        risks.push('Value is stale (last sale ' + (v.last_sale_date || 'undated') + ').');
      }
      if (!l.condition || l.condition === 'Unknown') {
        risks.push('The listing does not state a condition, so this assumes an ' +
                   'average copy.');
      }
      if (shipAssumed) {
        risks.push('Shipping not stated; assumed $' +
                   (cost - ask).toFixed(2) + '.');
      }

      deals.push({
        listing: l,
        item_id: l.item_id,
        item_name: item.canonical_name,
        ask: ask,
        ship_price: l.ship_price != null ? l.ship_price : null,
        buyer_total: cost,
        ship_assumed: shipAssumed,
        condition: l.condition || 'Unknown',
        gross_value: gross,
        floor_value: floor,
        floor_basis: adj.lower_bound_basis,
        net_proceeds: net,
        margin: margin,
        margin_pct: (margin / cost) * 100,
        discount_pct: discountPct,
        confidence: v.confidence,
        comparable_count: v.comparable_count,
        risks: risks
      });
    });

    return deals.sort(function (a, b) { return b.margin - a.margin; });
  }

  // ---- portfolio history --------------------------------------------------

  /**
   * One day's worth of collection totals.
   *
   * priced and unpriced are kept apart deliberately. A chart that silently mixes
   * them shows a line that rises when an unpriced item happens to get its first
   * comp, which is a fact about the database rather than about the collection.
   */
  function collectionSnapshot(entries, ctx) {
    var date = ctx.date || new Date().toISOString().slice(0, 10);
    var priced = 0, confident = 0, unpriced = 0, items = 0;

    (entries || []).forEach(function (e) {
      var qty = e.qty || 1;
      items += qty;
      var v = ctx.valuationFor(e.item_id);
      if (!v || !v.has_value) { unpriced += qty; return; }
      var adj = adjust(v, e.condition, e.completeness, ctx.config) || v;
      priced += adj.fair_market * qty;
      if (v.confidence === 'HIGH' || v.confidence === 'MEDIUM') {
        confident += adj.fair_market * qty;
      }
    });

    return {
      d: date,
      pv: Math.round(priced * 100) / 100,
      cv: Math.round(confident * 100) / 100,
      uc: unpriced,
      n: items
    };
  }

  /** A compact map of what is held, used only to spot what changed. */
  function holdingsMap(entries) {
    var m = {};
    (entries || []).forEach(function (e) {
      m[e.item_id] = (m[e.item_id] || 0) + (e.qty || 1);
    });
    return m;
  }

  /**
   * What the collector added or removed since the last snapshot.
   *
   * These are EXTERNAL FLOWS, and netting them out is the whole reason this
   * exists. Comparing today's total against the total ninety days ago tells you
   * nothing if two bears were bought in between: the collector who went shopping
   * looks like a brilliant investor and the one who sold a grail looks like they
   * lost money. Neither is a market movement.
   */
  function diffHoldings(prevMap, currMap, valueOf) {
    var flows = [];
    var ids = {};
    Object.keys(prevMap || {}).forEach(function (k) { ids[k] = true; });
    Object.keys(currMap || {}).forEach(function (k) { ids[k] = true; });

    Object.keys(ids).forEach(function (id) {
      var before = (prevMap || {})[id] || 0;
      var after = (currMap || {})[id] || 0;
      if (before === after) return;
      var unit = valueOf(id) || 0;
      flows.push({
        item_id: id,
        dir: after > before ? 'acquire' : 'dispose',
        qty: Math.abs(after - before),
        v: Math.round(unit * Math.abs(after - before) * 100) / 100
      });
    });
    return flows;
  }

  /**
   * Time-weighted return over a chain of snapshots.
   *
   *   rt = (Vt - Vt-1 - Ft) / Vt-1        Ft = net external flow in the period
   *   TWR = product(1 + rt) - 1
   *
   * This answers "did what I own appreciate", which is a different question from
   * "is my collection worth more than it was". Both are worth showing; showing
   * only one gets it misread as the other.
   */
  function timeWeightedReturn(snapshots, flows) {
    var snaps = (snapshots || []).slice().sort(function (a, b) {
      return a.d < b.d ? -1 : a.d > b.d ? 1 : 0;
    });
    if (snaps.length < 2) return null;

    var byDate = {};
    (flows || []).forEach(function (f) {
      byDate[f.d] = (byDate[f.d] || 0) + (f.dir === 'dispose' ? -f.v : f.v);
    });

    var chain = 1, periods = 0;
    for (var i = 1; i < snaps.length; i++) {
      var prev = snaps[i - 1].pv, curr = snaps[i].pv;
      if (!(prev > 0)) continue;
      var flow = 0;
      Object.keys(byDate).forEach(function (d) {
        if (d > snaps[i - 1].d && d <= snaps[i].d) flow += byDate[d];
      });
      chain *= 1 + ((curr - prev - flow) / prev);
      periods++;
    }
    return periods ? { twr_pct: (chain - 1) * 100, periods: periods } : null;
  }

  /** Both readings over a trailing window, plus the honest caveats. */
  function windowStats(snapshots, flows, days) {
    var snaps = (snapshots || []).slice().sort(function (a, b) {
      return a.d < b.d ? -1 : a.d > b.d ? 1 : 0;
    });
    if (!snaps.length) return null;

    var last = snaps[snaps.length - 1];
    var cutoff = new Date(last.d + 'T00:00:00Z');
    cutoff.setUTCDate(cutoff.getUTCDate() - days);
    var cutoffStr = cutoff.toISOString().slice(0, 10);

    var window = snaps.filter(function (s) { return s.d >= cutoffStr; });
    if (window.length < 2) {
      return { days: days, enough: false, span_days: window.length,
               note: 'not_enough_history' };
    }

    var first = window[0];
    var windowFlows = (flows || []).filter(function (f) {
      return f.d > first.d && f.d <= last.d;
    });
    var netFlow = windowFlows.reduce(function (a, f) {
      return a + (f.dir === 'dispose' ? -f.v : f.v);
    }, 0);

    var twr = timeWeightedReturn(window, windowFlows);
    return {
      days: days,
      enough: true,
      span_days: window.length,
      start_value: first.pv,
      end_value: last.pv,
      raw_change: last.pv - first.pv,
      raw_change_pct: first.pv > 0 ? ((last.pv - first.pv) / first.pv) * 100 : null,
      net_flow: netFlow,
      twr_pct: twr ? twr.twr_pct : null,
      unpriced_now: last.uc
    };
  }

  /** Total a collection at conservative / median / high-end. */
  function collectionValue(entries) {
    return entries.reduce(function (acc, e) {
      if (!e || !e.valuation || !e.valuation.has_value) {
        acc.unpriced += 1;
        return acc;
      }
      var qty = e.qty || 1;
      var adj = e.adjusted || e.valuation;
      acc.conservative += (adj.range_low || 0) * qty;
      acc.median += (adj.fair_market || 0) * qty;
      acc.high += (adj.ask_high || 0) * qty;
      acc.priced += qty;
      return acc;
    }, { conservative: 0, median: 0, high: 0, priced: 0, unpriced: 0 });
  }

  var api = {
    percentile: percentile,
    median: median,
    madOutliers: madOutliers,
    lowerBound: lowerBound,
    effectivePrice: effectivePrice,
    normalisedPrice: normalisedPrice,
    conditionMultiplier: conditionMultiplier,
    completenessMultiplier: completenessMultiplier,
    confidenceFor: confidenceFor,
    sampleSize: sampleSize,
    isOperator: isOperator,
    valuate: valuate,
    recentOnly: recentOnly,
    recencyWindow: recencyWindow,
    adjust: adjust,
    modifierChain: modifierChain,
    priceHistory: priceHistory,
    askSpread: askSpread,
    findDeals: findDeals,
    netProceeds: netProceeds,
    buyerTotal: buyerTotal,
    platformFees: platformFees,
    sellingFee: sellingFee,
    collectionValue: collectionValue,
    collectionSnapshot: collectionSnapshot,
    holdingsMap: holdingsMap,
    diffHoldings: diffHoldings,
    timeWeightedReturn: timeWeightedReturn,
    windowStats: windowStats
  };

  root.BearChartEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
