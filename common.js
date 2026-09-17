/* Shared helpers for every BearChart page. Loaded after data.js and engine.js. */
(function (root) {
  'use strict';

  var DATA = root.BEARCHART_DATA;
  if (!DATA) throw new Error('BearChart: data.js did not load.');

  var CFG = DATA.config;
  var E = root.BearChartEngine;

  // --- indexes -------------------------------------------------------------

  var salesByItem = {};
  DATA.sales.forEach(function (s) {
    (salesByItem[s.item_id] = salesByItem[s.item_id] || []).push(s);
  });

  var itemsById = {};
  DATA.items.forEach(function (i) { itemsById[i.id] = i; });

  var valuationCache = {};

  function salesFor(id) { return salesByItem[id] || []; }

  // Asking prices, indexed separately from sales. They are shown for context and
  // never priced from.
  var activeByItem = {};
  (DATA.active_listings || []).forEach(function (l) {
    (activeByItem[l.item_id] = activeByItem[l.item_id] || []).push(l);
  });
  function activeFor(id) { return activeByItem[id] || []; }
  function itemById(id) { return itemsById[id] || null; }

  function valuationFor(id) {
    if (!valuationCache[id]) {
      valuationCache[id] = E.valuate(itemById(id), salesFor(id), CFG);
    }
    return valuationCache[id];
  }

  /**
   * Make a <select> usable against a catalogue of thousands.
   *
   * A native dropdown of 2,048 bears is a scroll bar, not a control: you
   * cannot find "Vanilla Fudge Bunny" in it without already knowing where it
   * sits alphabetically. This puts a search box above the select and keeps the
   * select itself short, so it stays a plain <select> that existing code reads
   * `.value` from - the picker changes how you find an item, not how the page
   * uses the one you picked.
   *
   * Returns a refresh function: call it with no arguments after the catalogue
   * changes (the admin page adds draft items) to rebuild without losing what
   * the user has typed.
   *
   * @param {HTMLSelectElement} select  the element to drive
   * @param {Array|Function} items      catalogue, or a function returning one
   * @param {Function} [label]          item -> option text
   */
  function itemChooser(select, items, label) {
    var LIMIT = 40;
    var text = label || function (i) { return i.canonical_name; };
    var source = typeof items === 'function' ? items : function () { return items; };

    var search = document.createElement('input');
    search.type = 'search';
    search.className = 'item-search';
    search.placeholder = 'Search the catalogue…';
    search.setAttribute('aria-label', 'Search the catalogue');
    select.parentNode.insertBefore(search, select);

    var note = document.createElement('span');
    note.className = 'fine chooser-note';
    select.parentNode.insertBefore(note, select.nextSibling);

    function fill(q) {
      var sorted = source().slice().sort(function (a, b) {
        return a.canonical_name.localeCompare(b.canonical_name);
      });
      var needle = String(q === undefined ? search.value : q).trim().toLowerCase();
      var hits = needle
        ? sorted.filter(function (i) {
            if (i.canonical_name.toLowerCase().indexOf(needle) !== -1) return true;
            return (i.aliases || []).some(function (a) {
              return a.toLowerCase().indexOf(needle) !== -1;
            });
          })
        : sorted;

      select.innerHTML = hits.slice(0, LIMIT).map(function (i) {
        return '<option value="' + esc(i.id) + '">' + esc(text(i)) + '</option>';
      }).join('');

      if (!hits.length) {
        note.textContent = 'Nothing matches “' + needle + '”.';
      } else if (hits.length > LIMIT) {
        note.textContent = 'Showing ' + LIMIT + ' of ' + hits.length +
                           ' matches — keep typing to narrow it down.';
      } else {
        note.textContent = '';
      }
    }

    var debounce;
    search.addEventListener('input', function () {
      clearTimeout(debounce);
      var v = search.value;
      debounce = setTimeout(function () { fill(v); }, 100);
    });

    fill('');

    // The chooser is also reachable from the element it drives, so anything
    // holding the <select> can refresh it (the admin page does, after drafting
    // a new item) without having to keep the returned function around.
    select.refill = fill;
    return fill;
  }

  /**
   * The evidence behind a number, drawn.
   *
   * BearChart's whole argument is that a price comes with its footing, and
   * until now that footing was a grey pill reading "LOW". This plots it: the
   * published range as a band, the median as a line, and every recorded sale
   * as a dot where it actually sits.
   *
   * It is built for one or two observations, because that is what the database
   * has - no item in it has three. A single dot inside a wide band reads as
   * "we know exactly one thing, and here is how much that leaves open", which
   * is both the truth and a better argument than apologising for it.
   *
   * Dots are the NORMALISED price - what entered the median after adjusting
   * for condition and completeness - because plotting what a seller received
   * against an adjusted median would be comparing two different things. The
   * caption says so.
   */
  function evidenceStrip(v) {
    if (!v || !v.has_value || !v.points || !v.points.length) return '';

    var W = 600, H = 104, PAD = 52, AXIS = 62;
    var vals = v.points.map(function (p) { return p.norm; })
      .concat([v.range_low, v.range_high, v.fair_market])
      .filter(function (n) { return typeof n === 'number' && isFinite(n); });
    if (!vals.length) return '';

    var lo = Math.min.apply(null, vals);
    var hi = Math.max.apply(null, vals);
    if (hi - lo < 0.005) {
      // One comp, or several identical ones: everything lands on the same
      // price. Give the axis a span so the drawing is a point in a context
      // rather than a stack of shapes on one pixel.
      var spread = Math.max(hi * 0.2, 1);
      lo -= spread; hi += spread;
    } else {
      var margin = (hi - lo) * 0.14;
      lo -= margin; hi += margin;
    }
    var x = function (n) { return PAD + ((n - lo) / (hi - lo)) * (W - PAD * 2); };

    var band = '';
    if (typeof v.range_low === 'number' && typeof v.range_high === 'number') {
      var bx = x(v.range_low), bw = Math.max(x(v.range_high) - bx, 2);
      band = '<rect class="ev-band" x="' + bx.toFixed(1) + '" y="' + (AXIS - 19) +
             '" width="' + bw.toFixed(1) + '" height="38" rx="6"/>';
    }

    var med = typeof v.fair_market === 'number'
      ? '<line class="ev-median" x1="' + x(v.fair_market).toFixed(1) + '" y1="' + (AXIS - 24) +
        '" x2="' + x(v.fair_market).toFixed(1) + '" y2="' + (AXIS + 24) + '"/>'
      : '';

    var dots = v.points.map(function (p) {
      var cls = 'ev-dot' + (p.first_party ? ' ev-dot-own' : '');
      var title = exact(p.raw) + (p.condition ? ' · ' + p.condition : '') +
                  (p.norm !== p.raw ? ' → ' + exact(p.norm) + ' adjusted' : '');
      return '<circle class="' + cls + '" cx="' + x(p.norm).toFixed(1) +
             '" cy="' + AXIS + '" r="7"><title>' + esc(title) + '</title></circle>';
    }).join('');

    // Label the ends of the RANGE, not the ends of the axis. The axis ends are
    // padding chosen to leave the drawing some air; printing them would put a
    // precise-looking figure under a price at which nothing happened, which is
    // the one thing this guide will not do anywhere else either.
    var ends = '';
    if (typeof v.range_low === 'number' && typeof v.range_high === 'number') {
      var lx = Math.min(Math.max(x(v.range_low), 22), W - 22);
      var hx = Math.min(Math.max(x(v.range_high), 22), W - 22);
      var same = Math.abs(hx - lx) < 40;
      ends +=
        '<text class="ev-tick" x="' + lx.toFixed(1) + '" y="' + (AXIS + 40) +
        '" text-anchor="middle">' + esc(money(v.range_low)) + '</text>' +
        (same ? ''    // one comp: both ends are the same price, so say it once
              : '<text class="ev-tick" x="' + hx.toFixed(1) + '" y="' + (AXIS + 40) +
                '" text-anchor="middle">' + esc(money(v.range_high)) + '</text>');
    }
    ends += '<text class="ev-label" x="' + x(v.fair_market).toFixed(1) + '" y="' +
      (AXIS - 32) + '" text-anchor="middle">' + esc(money(v.fair_market)) + '</text>';

    var n = v.points.length;
    var alt = n === 1
      ? 'One recorded sale at ' + money(v.points[0].norm) + ', inside a published ' +
        'range of ' + money(v.range_low) + ' to ' + money(v.range_high) + '.'
      : n + ' recorded sales between ' + money(Math.min.apply(null,
          v.points.map(function (p) { return p.norm; }))) + ' and ' +
        money(Math.max.apply(null, v.points.map(function (p) { return p.norm; }))) +
        ', median ' + money(v.fair_market) + '.';

    return '<figure class="evidence">' +
      '<svg class="ev-strip" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="' + esc(alt) + '" preserveAspectRatio="xMidYMid meet">' +
        '<line class="ev-axis" x1="' + PAD + '" y1="' + AXIS + '" x2="' + (W - PAD) +
        '" y2="' + AXIS + '"/>' + band + med + dots + ends +
      '</svg>' +
      '<figcaption class="ev-key">' +
        '<span class="ev-k-dot"></span> ' +
        (n === 1 ? 'the one recorded sale' : n + ' recorded sales') +
        ', adjusted to Good condition with no extras ' +
        '<span class="ev-k-band"></span> published range ' +
        '<span class="ev-k-med"></span> median' +
      '</figcaption>' +
      '</figure>';
  }

  // --- formatting ----------------------------------------------------------

  function fmt(n, dp) {
    return '$' + Number(n).toLocaleString('en-US', {
      minimumFractionDigits: dp, maximumFractionDigits: dp
    });
  }

  /**
   * Estimates round to whole dollars once they pass $100 - false precision on a
   * derived number is noise. Recorded sale prices use exact() instead, because
   * a comp that sold for $204.49 did not sell for $204.
   */
  function money(n) {
    if (n == null || isNaN(n)) return '--';
    return fmt(n, Math.abs(n) < 100 ? 2 : 0);
  }

  /** A price exactly as it was recorded. Used for every observed sold price. */
  function exact(n) {
    if (n == null || isNaN(n)) return '--';
    return fmt(n, Number(n) % 1 === 0 ? 0 : 2);
  }

  /** Both ends of a range share one precision, chosen by the larger value. */
  function range(lo, hi) {
    if (lo == null || hi == null) return '--';
    var dp = Math.max(Math.abs(lo), Math.abs(hi)) < 100 ? 2 : 0;
    if (Math.abs(lo - hi) < 0.005) return fmt(lo, dp);
    return fmt(lo, dp) + ' - ' + fmt(hi, dp);
  }

  function confClass(c) { return 'conf conf-' + String(c).toLowerCase().replace(/\s+/g, '-'); }

  function era(item) {
    var y = item.release_year;
    if (!y) return 'Year unknown';
    if (y < 2000) return 'Vintage (1997-1999)';
    if (y < 2010) return 'Early 2000s';
    if (y < 2020) return '2010s';
    return 'Modern';
  }

  function isVintage(item) { return item.release_year != null && item.release_year < 2000; }

  function conditionLabel(c) { return c || 'Unknown'; }

  function completenessLabel(c) {
    return CFG.completeness_labels[c] || c || 'Not recorded';
  }

  function dateLabel(d) { return d || 'Date not recorded'; }

  /** Badge list for an item, in a stable order. */
  function tagsFor(item) {
    var t = [];
    if (item.release_status === 'upcoming') t.push({ text: 'Upcoming', cls: 'upcoming' });
    if (item.release_status === 'current') t.push({ text: 'At Retail Now', cls: 'current' });
    if (isVintage(item)) t.push({ text: 'Vintage', cls: 'vintage' });
    if (item.mini_bean) t.push({ text: 'Mini Bean', cls: '' });
    if (item.licensed) t.push({ text: item.franchise || 'Licensed', cls: 'licensed' });
    if (item.limited_edition) t.push({ text: 'Limited Edition', cls: 'limited' });
    if (item.employee_exclusive) t.push({ text: 'Employee Exclusive', cls: 'exclusive' });
    if (item.store_exclusive) t.push({ text: 'Store Exclusive', cls: 'exclusive' });
    if (item.event_exclusive) t.push({ text: 'Event Exclusive', cls: 'exclusive' });
    if (item.international_exclusive) t.push({ text: 'International Exclusive', cls: 'exclusive' });
    if (item.online_exclusive) t.push({ text: 'Online Exclusive', cls: 'exclusive' });
    if (item.vault_release) t.push({ text: 'Vault', cls: '' });
    if (item.retired) t.push({ text: 'Retired', cls: '' });
    if (item.is_lot) t.push({ text: 'Lot', cls: '' });
    return t;
  }

  function tagsHtml(item) {
    var t = tagsFor(item);
    if (!t.length) return '';
    return '<div class="tags">' + t.map(function (x) {
      return '<span class="tag ' + x.cls + '">' + esc(x.text) + '</span>';
    }).join('') + '</div>';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Where "here" is, relative to the site root.
   *
   * Generated item pages live one directory down (item/<slug>.html) so that
   * every bear has a real, crawlable URL of its own. The site also has to keep
   * working opened straight off disk and served from a subdirectory, which
   * rules out root-relative "/item/x.html" links. So internal links get a
   * prefix worked out from where the current page actually sits.
   */
  var PREFIX = /(^|\/)item\/[^/]*$/.test(root.location ? root.location.pathname : '')
    ? '../' : '';

  function rel(path) { return PREFIX + path; }

  function itemUrl(id) {
    return rel('item/' + encodeURIComponent(id) + '.html');
  }

  var BUSINESS = DATA.business || {};

  /**
   * Wrap an outbound eBay link with an affiliate campaign id, if one is set.
   *
   * Affiliate money must never touch a valuation, so this only ever rewrites a
   * URL - it cannot reorder, filter or weight what gets shown.
   */
  function affiliate(url) {
    if (!url || !BUSINESS.ebay_campaign_id) return url;
    if (!/^https?:\/\/(www\.)?ebay\./i.test(url)) return url;
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    return url + sep + 'mkcid=1&mkrid=711-53200-19255-0&campid=' +
           encodeURIComponent(BUSINESS.ebay_campaign_id) + '&toolid=10001';
  }

  function businessEnabled() {
    return !!(BUSINESS.enabled && (BUSINESS.contact_email || BUSINESS.contact_url));
  }

  function shopEnabled() {
    return !!(BUSINESS.enabled && BUSINESS.shop_url);
  }

  /**
   * A promo for the shop that runs this guide.
   *
   * Labelled as exactly that. The site's argument is that its numbers are not
   * for sale, so the operator's own shop appearing on the page has to announce
   * itself - an unlabelled ad from the person publishing the valuations is the
   * single fastest way to lose a reader who works it out for themselves.
   *
   * @param {string} [variant] 'compact' for the sidebar, full card otherwise.
   */
  function shopPromo(variant) {
    if (!shopEnabled()) return '';
    var b = BUSINESS;
    var compact = variant === 'compact';
    return '<aside class="promo' + (compact ? ' promo-compact' : '') + '">' +
      '<p class="promo-eyebrow">' + esc(b.shop_eyebrow || b.name) + '</p>' +
      '<h3 class="promo-title">' + esc(b.shop_headline || b.name) + '</h3>' +
      '<p class="promo-blurb">' + esc(b.shop_blurb || '') + '</p>' +
      '<p class="promo-act"><a class="btn btn-primary" href="' + esc(b.shop_url) +
      '" target="_blank" rel="noopener">' + esc(b.shop_cta || 'Visit the shop') +
      '</a></p>' +
      (b.shop_disclosure
        ? '<p class="promo-note">' + esc(b.shop_disclosure) + '</p>'
        : '') +
      '</aside>';
  }

  // --- images --------------------------------------------------------------

  /* No item ships with a photograph. Official Build-A-Bear product imagery is
     copyrighted, so nothing is hotlinked or bundled; items you photograph
     yourself (or images you hold the rights to) are attached through the admin
     tools. Until then every item draws a generated monogram tile, so a missing
     photo reads as "not added yet" rather than as a broken page. */

  function hashCode(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function initials(item) {
    var words = String(item.canonical_name).replace(/[^A-Za-z0-9 ]/g, ' ')
      .split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  /**
   * A species illustration for an item that has no photograph.
   *
   * Drawn, never photographed, and labelled as such. The hue is derived from the
   * item id so a given item always looks the same, and the drawing is chosen from
   * what the catalogue records about the item - a bear record gets a bear.
   */
  /**
   * Colour for an item's illustration.
   *
   * Nothing in the catalogue has a photograph yet, so these drawings ARE the
   * look of the site - two thousand of them at a time. Drawn from one narrow
   * band of browns they turned a shelf of toys into a sepia spreadsheet, so
   * each kind of friend gets its own hue, jittered per item so two bunnies are
   * never quite the same pink. The species tells you something before you have
   * read a word, which is most of what a picture is for.
   */
  var ICON_HUES = {
    bear: [34, 62], dog: [26, 58], cat: [12, 60], bunny: [338, 55],
    mouse: [292, 40], dino: [138, 48], dragon: [166, 46], unicorn: [276, 52],
    bird: [200, 58], penguin: [214, 40], frog: [96, 50], axolotl: [330, 62],
    pig: [350, 52], cow: [228, 34], elephant: [208, 32], monkey: [22, 52],
    butterfly: [266, 54], spider: [282, 42], fish: [186, 52],
    character: [220, 58], vehicle: [6, 56], shirt: [174, 46],
    shoe: [246, 44], hat: [312, 48], bag: [68, 44], props: [44, 60],
    furniture: [30, 38], paw: [38, 44]
  };

  function placeholderImage(item, opts) {
    var icons = root.BearChartIcons;
    var key = icons ? icons.iconKeyFor(item) : 'paw';
    var base = ICON_HUES[key] || ICON_HUES.paw;
    var h = hashCode(item.id);
    // Same family, never the same swatch twice.
    var hue = (base[0] + (h % 17) - 8 + 360) % 360;
    var sat = base[1];
    var tilt = (h >> 3) % 7;

    var bg1 = 'hsl(' + hue + ', ' + Math.round(sat * 0.55) + '%, ' + (93 - tilt * 0.4) + '%)';
    var bg2 = 'hsl(' + ((hue + 24) % 360) + ', ' + Math.round(sat * 0.5) + '%, ' + (86 - tilt * 0.5) + '%)';
    var fg = 'hsl(' + hue + ', ' + Math.round(sat * 0.8) + '%, 38%)';
    var ac = 'hsl(' + hue + ', ' + Math.round(sat * 0.6) + '%, 76%)';

    var art = icons
      ? icons.draw(key, fg, ac)
      : '<text x="200" y="170" text-anchor="middle" font-size="86" fill="' + fg +
        '" font-family="Georgia, serif">' + esc(initials(item)) + '</text>';

    // Every drawing says it is a drawing. A price guide that let its
    // illustrations read as photographs of the actual item would be lying
    // about the one thing a buyer is looking at, so this is not negotiable -
    // there is a test holding it in place.
    //
    // It is set quietly on a card, where it repeats down a grid of sixty, and
    // plainly on an item page, where somebody is actually deciding what they
    // are looking at.
    var loud = !!(opts && opts.caption);
    var caption = '<text x="200" y="' + (loud ? 286 : 290) + '" text-anchor="middle" ' +
      'font-size="' + (loud ? 13 : 11) + '" fill="' + fg + '" ' +
      'font-family="system-ui, sans-serif" opacity="' + (loud ? '.55' : '.34') + '" ' +
      'letter-spacing="1.5">ILLUSTRATION &#183; NO PHOTO YET</text>';

    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">' +
      '<stop offset="0" stop-color="' + bg1 + '"/>' +
      '<stop offset="1" stop-color="' + bg2 + '"/></linearGradient></defs>' +
      '<rect width="400" height="300" fill="url(#g)"/>' + art + caption +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function hasImage(item) { return !!(item.image_url && String(item.image_url).trim()); }

  /**
   * Markup for an item's picture. A real photo that fails to load falls back to
   * the monogram rather than leaving a broken frame.
   */
  function imageHtml(item, cls) {
    var placeholder = placeholderImage(item, { caption: cls === 'hero' });
    if (!hasImage(item)) {
      return '<img class="' + (cls || 'thumb') + ' is-placeholder" src="' + placeholder +
             '" alt="" aria-hidden="true" loading="lazy">';
    }
    return '<img class="' + (cls || 'thumb') + '" src="' + esc(item.image_url) +
           '" alt="' + esc(item.canonical_name) + '" loading="lazy" ' +
           'onerror="this.onerror=null;this.src=\'' + placeholder +
           '\';this.classList.add(\'is-placeholder\');this.alt=\'\';">';
  }

  /** Credit line for a photo, so image provenance is recorded like sale provenance. */
  function imageCredit(item) {
    if (!hasImage(item)) return '';
    var bits = [];
    if (item.image_credit) bits.push(esc(item.image_credit));
    if (item.image_source) {
      bits.push('<a href="' + esc(item.image_source) + '" target="_blank" rel="noopener">source</a>');
    }
    return bits.length ? '<p class="fine img-credit">Photo: ' + bits.join(' &middot; ') + '</p>' : '';
  }

  // --- search --------------------------------------------------------------

  /** Free-text match across the fields section 19 asks for. */
  function matches(item, query) {
    if (!query) return true;
    var hay = [
      item.canonical_name, (item.aliases || []).join(' '), item.franchise,
      item.species, item.category, item.release_year, item.version,
      item.variant, item.notes, item.rarity
    ].filter(Boolean).join(' ').toLowerCase();
    return query.toLowerCase().split(/\s+/).filter(Boolean)
      .every(function (term) { return hay.indexOf(term) !== -1; });
  }

  // --- CSV -----------------------------------------------------------------

  function csvCell(v) {
    if (v == null) return '';
    var s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/csv') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  /** One row per item, with its valuation - the export section 1.26 asks for. */
  function itemsCsv(items) {
    var head = ['id', 'canonical_name', 'aliases', 'category', 'species', 'release_year',
      'era', 'version', 'licensed', 'franchise', 'limited_edition', 'employee_exclusive',
      'vault_release', 'mini_bean', 'retired', 'comparable_sales', 'confidence',
      'fair_market_value', 'range_low', 'range_high', 'median_sold', 'buy_low', 'buy_high',
      'trade_low', 'trade_high', 'ask_low', 'ask_high', 'image_url', 'notes'];
    var rows = [head];
    items.forEach(function (i) {
      var v = valuationFor(i.id);
      rows.push([i.id, i.canonical_name, (i.aliases || []).join(' | '), i.category, i.species,
        i.release_year, era(i), i.version, i.licensed, i.franchise, i.limited_edition,
        i.employee_exclusive, i.vault_release, i.mini_bean, i.retired,
        v.comparable_count, v.confidence,
        r2(v.fair_market), r2(v.range_low), r2(v.range_high), r2(v.median_raw),
        r2(v.buy_low), r2(v.buy_high), r2(v.trade_low), r2(v.trade_high),
        r2(v.ask_low), r2(v.ask_high), i.image_url, i.notes]);
    });
    return toCsv(rows);
  }

  /** One row per sold observation, provenance intact. */
  function salesCsv(items) {
    var allowed = {};
    items.forEach(function (i) { allowed[i.id] = i; });
    var head = ['sale_id', 'item_id', 'canonical_name', 'sale_date', 'sold_price',
      'price_high', 'ranged', 'currency', 'condition', 'completeness', 'marketplace',
      'listing_id', 'evidence_type', 'source_url', 'notes'];
    var rows = [head];
    DATA.sales.forEach(function (s) {
      var i = allowed[s.item_id];
      if (!i) return;
      rows.push([s.id, s.item_id, i.canonical_name, s.sale_date, s.sold_price, s.price_high,
        s.ranged, s.currency, s.condition, s.completeness, s.marketplace, s.listing_id,
        s.evidence_type, s.source_url, s.notes]);
    });
    return toCsv(rows);
  }

  function r2(n) { return n == null ? '' : Math.round(n * 100) / 100; }

  function stamp() { return new Date().toISOString().slice(0, 10); }

  // --- chrome --------------------------------------------------------------

  var NAV = [
    ['index.html', 'Price Guide'],
    ['deals.html', 'Deals'],
    ['checklists.html', 'Checklists'],
    ['collection.html', 'My Collection'],
    ['admin.html', 'Admin'],
    ['about.html', 'Method'],
    ['roadmap.html', 'Roadmap'],
    ['plans.html', 'Membership'],
    ['account.html', 'Account']
  ];

  function renderChrome(current) {
    var A = root.BearChartAuth;
    if (A && !renderChrome._bound) {
      renderChrome._bound = true;
      A.onChange(function () { renderChrome(current); });
      A.init();
    }
    var head = document.getElementById('masthead');
    if (head) {
      head.innerHTML =
        '<div class="wrap">' +
          '<a class="brand" href="' + rel('index.html') + '">' +
            '<h1>BearChart</h1>' +
            '<div class="sub">Build-A-Bear Price Guide</div>' +
            '<div class="tagline">Collector &bull; Buy &bull; Sell &bull; Trade</div>' +
          '</a>' +
          '<nav class="nav">' + NAV.map(function (n) {
            var label = n[1];
            // The account link doubles as the session indicator.
            if (n[0] === 'account.html') {
              // Always shown. Hiding this when accounts are switched off made the
              // whole feature - and the instructions for turning it on -
              // impossible to find.
              var A = root.BearChartAuth;
              if (!A || !A.configured()) {
                label = 'Account';
              } else {
                var st = A.state();
                label = st.signedIn
                  ? (st.isAdmin ? 'Admin account' : 'My account')
                  : 'Sign in';
              }
            }
            return '<a href="' + rel(n[0]) + '"' +
                   (n[0] === current ? ' aria-current="page"' : '') +
                   '>' + esc(label) + '</a>';
          }).join('') + '</nav>' +
        '</div>';
    }
    var bar = document.getElementById('disclaimer-bar');
    if (bar) {
      bar.innerHTML = '<div class="wrap">' + esc(DATA.meta.disclaimer) + '</div>';
    }
    var foot = document.getElementById('site-footer');
    if (foot) {
      foot.innerHTML = '<div class="wrap">' +
        '<p><strong>BearChart</strong> &mdash; ' + esc(DATA.meta.disclaimer) + '</p>' +
        '<p>Values are derived from completed/sold transactions only. Active asking ' +
        'prices are never treated as market value. Where no sold data exists, BearChart ' +
        'publishes no price.</p>' +
        '<p>Built as a collector and reseller research tool for ' +
        (shopEnabled()
          ? '<a href="' + esc(BUSINESS.shop_url) + '" target="_blank" rel="noopener">' +
            esc(BUSINESS.name) + '</a>'
          : esc(BUSINESS.name)) + '.</p>' +
        '<p class="fine">Database: ' + DATA.items.length + ' items, ' + DATA.sales.length +
        ' sold observations. Schema v' + DATA.meta.schema_version + '.</p>' +
        '</div>';
    }
  }

  /**
   * Register the service worker.
   *
   * This is what makes BearChart work with no signal - which is the moment it
   * is actually needed, standing in a shop holding a bear. Everything is
   * guarded: no service worker support, opened from a file:// path, or
   * registration refused all fall back to an ordinary website rather than
   * breaking one.
   */
  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (root.location && root.location.protocol === 'file:') return;
    root.addEventListener('load', function () {
      // No explicit scope. A worker's default scope is the directory it is
      // served from, which for /sw.js is the whole site - exactly what is
      // wanted. Passing one computed from the current page gave "/index.html"
      // when registered from the home page: a scope of one single file, so
      // every other page silently had no offline support while the cache sat
      // there full.
      navigator.serviceWorker.register(rel('sw.js'))
        .catch(function () { /* an uninstalled guide still works */ });
    });
  }
  registerWorker();

  root.BC = {
    data: DATA, config: CFG, engine: E,
    salesFor: salesFor, activeFor: activeFor, itemById: itemById,
    itemChooser: itemChooser, rel: rel, evidenceStrip: evidenceStrip,
    valuationFor: valuationFor,
    money: money, exact: exact, range: range, confClass: confClass, era: era, isVintage: isVintage,
    conditionLabel: conditionLabel, completenessLabel: completenessLabel, dateLabel: dateLabel,
    tagsFor: tagsFor, tagsHtml: tagsHtml, esc: esc, itemUrl: itemUrl, matches: matches,
    business: BUSINESS, affiliate: affiliate, businessEnabled: businessEnabled,
    shopEnabled: shopEnabled, shopPromo: shopPromo,
    hasImage: hasImage, imageHtml: imageHtml, imageCredit: imageCredit,
    placeholderImage: placeholderImage,
    toCsv: toCsv, download: download, itemsCsv: itemsCsv, salesCsv: salesCsv,
    r2: r2, stamp: stamp, renderChrome: renderChrome
  };
})(window);
