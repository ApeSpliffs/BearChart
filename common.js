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
    ['showcase.html', 'Showcases'],
    ['admin.html', 'Admin'],
    ['about.html', 'Method'],
    ['roadmap.html', 'Roadmap'],
    ['plans.html', 'Membership'],
    ['account.html', 'Account']
  ];

  // ---- wishlist ------------------------------------------------------------
  // Kept in this browser for everyone, and also saved to the member's account
  // when signed in, so it follows them between devices. The account copy is
  // also what a future "Most Wanted" report would count - only ever in
  // aggregate, never one person's list.

  var WL_KEY = 'bearchart.wishlist';
  var wlListeners = [];
  var wlSynced = false;

  function wlLoad() {
    try {
      var v = JSON.parse(localStorage.getItem(WL_KEY) || '[]');
      return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }) : [];
    } catch (e) { return []; }
  }
  function wlSave(list) {
    try { localStorage.setItem(WL_KEY, JSON.stringify(list)); } catch (e) { /* storage blocked */ }
  }
  function wlNotify() {
    var list = wlLoad();
    wlListeners.forEach(function (fn) { try { fn(list); } catch (e) { /* listener failed */ } });
  }
  function wlClient() {
    var A = root.BearChartAuth;
    if (!A || !A.configured || !A.configured()) return null;
    var s = A.state();
    return s && s.signedIn ? A.getClient() : null;
  }
  // Merge this browser's list with the account's once per sign-in. Nothing is
  // ever deleted by a merge: a bear on either list ends up on both.
  function wlSync() {
    var c = wlClient();
    if (!c || wlSynced) return;
    wlSynced = true;
    c.from('wishlists').select('item_id').then(function (r) {
      if (r.error) { wlSynced = false; return; }
      var remote = (r.data || []).map(function (x) { return x.item_id; });
      var local = wlLoad();
      var merged = local.slice();
      remote.forEach(function (id) { if (merged.indexOf(id) === -1) merged.push(id); });
      wlSave(merged);
      wlNotify();
      var push = local.filter(function (id) { return remote.indexOf(id) === -1; });
      if (push.length) {
        c.from('wishlists').upsert(push.map(function (id) { return { item_id: id }; }),
          { onConflict: 'user_id,item_id', ignoreDuplicates: true }).then(function () {});
      }
    });
  }
  function wlToggle(id) {
    var list = wlLoad();
    var at = list.indexOf(id);
    var on = at === -1;
    if (on) list.unshift(id); else list.splice(at, 1);
    wlSave(list);
    var c = wlClient();
    if (c) {
      (on ? c.from('wishlists').upsert({ item_id: id }, { onConflict: 'user_id,item_id', ignoreDuplicates: true })
          : c.from('wishlists').delete().eq('item_id', id)).then(function () {});
    }
    if (root.bcTrack) root.bcTrack(on ? 'wishlist_add' : 'wishlist_remove', { item: id });
    wlNotify();
    return on;
  }
  var wishlist = {
    list: wlLoad,
    has: function (id) { return wlLoad().indexOf(id) !== -1; },
    toggle: wlToggle,
    onChange: function (fn) { wlListeners.push(fn); },
    sync: wlSync
  };

  // ---- free-account pages ----------------------------------------------------
  // The price guide is open to everyone. These tools need a free account. The
  // page still renders underneath (the data is in data.js for anyone who looks),
  // so this is an invitation, not a lock - which is also why it costs nothing to
  // get wrong for a moment while the account service loads.
  var MEMBERS_ONLY = {
    'deals.html': 'the deal finder',
    'checklists.html': 'checklists',
    'collection.html': 'your collection and wishlist'
  };

  function storedSession() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i) || '';
        if (/^sb-.*-auth-token$/.test(k) && localStorage.getItem(k)) return true;
      }
    } catch (e) { /* storage blocked */ }
    return false;
  }

  function membersGate(current) {
    var what = MEMBERS_ONLY[current];
    var A = root.BearChartAuth;
    if (!what || !A || !A.configured || !A.configured() || membersGate._bound) return;
    membersGate._bound = true;
    function paint(signedIn) {
      document.body.classList.toggle('members-gate', !signedIn);
      var card = document.getElementById('members-gate-card');
      if (signedIn) { if (card) card.parentNode.removeChild(card); return; }
      if (card) return;
      card = document.createElement('div');
      card.id = 'members-gate-card';
      card.className = 'members-gate-card';
      card.setAttribute('role', 'region');
      card.setAttribute('aria-label', 'Free account needed');
      card.innerHTML =
        '<p class="welcome-kicker">Free for members</p>' +
        '<h2>Make a free account to use ' + esc(what) + '</h2>' +
        '<p>It takes a minute and costs nothing. The price guide stays open to everyone, no account needed.</p>' +
        '<div class="welcome-actions">' +
          '<a class="btn btn-primary" href="' + rel('account.html') + '">Sign in or create a free account</a>' +
          '<a class="btn" href="' + rel('index.html') + '">Back to the price guide</a>' +
        '</div>';
      document.body.appendChild(card);
      if (root.bcTrack) root.bcTrack('members_gate_shown', { page: current });
    }
    paint(storedSession());
    A.onChange(function (s) { paint(!!(s && s.signedIn)); });
  }

  // ---- member cloud: collection sync, value history, saved reports ----------
  // Pro and Power members' collections and value history are kept on their
  // account so they follow them between devices and are never lost with a
  // browser. Everything still works from this browser's storage first; the
  // account copy is merged in the background. The database refuses all of
  // this without a live membership, so the checks here only decide what to
  // try - they are not what keeps it paid.

  var CLOUD = {
    coll: 'bearchart.collection',
    snaps: 'bearchart.snapshots',
    flows: 'bearchart.flows',
    meta: 'bearchart.cloud'
  };
  var cloudListeners = [];
  var cloudState = { uid: null, entitled: null, syncing: false, lastSync: null, error: null };
  var cloudTimer = null;

  function cloudRead(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function cloudWrite(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function cloudId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  // Order-independent fingerprint of an entry, for "changed since last sync".
  function cloudHash(entry) {
    var keys = Object.keys(entry).filter(function (k) { return k !== 'uid'; }).sort();
    return JSON.stringify(keys.map(function (k) { return [k, entry[k]]; }));
  }
  function cloudNotify() {
    cloudListeners.forEach(function (fn) { try { fn(cloudState); } catch (e) { /* listener */ } });
  }
  function cloudClient() {
    var A = root.BearChartAuth;
    if (!A || !A.configured || !A.configured()) return null;
    var s = A.state();
    return s && s.signedIn && s.user ? { c: A.getClient(), uid: s.user.id } : null;
  }

  function cloudEntitled(cc) {
    if (cloudState.uid === cc.uid && cloudState.entitled !== null) return Promise.resolve(cloudState.entitled);
    return Promise.resolve().then(function () {
      return cc.c.rpc('has_entitlement', { feature: 'collection_sync' });
    }).then(function (r) {
      cloudState.uid = cc.uid;
      cloudState.entitled = !!(r && !r.error && r.data === true);
      return cloudState.entitled;
    }, function () { return false; });
  }

  function syncCollection(cc) {
    var local = cloudRead(CLOUD.coll, []);
    if (!Array.isArray(local)) return Promise.resolve();
    var meta = cloudRead(CLOUD.meta, {});
    // A different member signed in on this browser: treat it as a first sync,
    // which only ever adds - nothing is deleted on either side.
    var known = meta.uid === cc.uid ? (meta.entries || {}) : {};
    local.forEach(function (e) { if (e && !e.uid) e.uid = cloudId(); });

    return cc.c.from('collection_entries').select('id,entry').then(function (r) {
      if (r.error) throw r.error;
      var remote = {};
      (r.data || []).forEach(function (row) { remote[row.id] = row.entry; });

      var merged = [], ups = [], dels = [];
      local.forEach(function (e) {
        if (!e || !e.item_id) return;
        var h = cloudHash(e);
        if (remote[e.uid]) {
          if (known[e.uid] && known[e.uid] !== h) { merged.push(e); ups.push(e); }      // edited here
          else if (!known[e.uid] && cloudHash(remote[e.uid]) !== h) { merged.push(e); ups.push(e); }
          else merged.push(Object.assign({}, remote[e.uid], { uid: e.uid }));           // take account copy
        } else if (known[e.uid]) {
          // Synced before and now gone from the account: removed on another device.
        } else {
          merged.push(e); ups.push(e);                                                     // new here
        }
      });
      Object.keys(remote).forEach(function (id) {
        if (local.some(function (e) { return e && e.uid === id; })) return;
        if (known[id]) dels.push(id);                                                    // removed here
        else merged.push(Object.assign({}, remote[id], { uid: id }));                    // added elsewhere
      });

      var jobs = [];
      if (ups.length) {
        jobs.push(cc.c.from('collection_entries').upsert(ups.map(function (e) {
          var entry = Object.assign({}, e); delete entry.uid;
          return { id: e.uid, entry: entry, updated_at: new Date().toISOString() };
        }), { onConflict: 'user_id,id' }).then(function (x) { if (x && x.error) throw x.error; }));
      }
      if (dels.length) {
        jobs.push(cc.c.from('collection_entries').delete().in('id', dels)
          .then(function (x) { if (x && x.error) throw x.error; }));
      }
      return Promise.all(jobs).then(function () {
        var entries = {};
        merged.forEach(function (e) { entries[e.uid] = cloudHash(e); });
        cloudWrite(CLOUD.coll, merged);
        cloudWrite(CLOUD.meta, { uid: cc.uid, entries: entries });
        return JSON.stringify(merged) !== JSON.stringify(local);
      });
    });
  }

  function syncHistory(cc) {
    var snaps = cloudRead(CLOUD.snaps, []);
    var flows = cloudRead(CLOUD.flows, []);
    if (!Array.isArray(snaps) || !Array.isArray(flows)) return Promise.resolve(false);
    return cc.c.from('value_history').select('day,snap,flows').then(function (r) {
      if (r.error) throw r.error;
      var remote = {};
      (r.data || []).forEach(function (row) { remote[row.day] = row; });
      var have = {};
      snaps.forEach(function (s) { if (s && s.d) have[s.d] = s; });
      var ups = snaps.filter(function (s) {
        return s && s.d && (!remote[s.d] || JSON.stringify(remote[s.d].snap) !== JSON.stringify(s));
      }).map(function (s) {
        return { day: s.d, snap: s, flows: flows.filter(function (f) { return f && f.d === s.d; }),
                 updated_at: new Date().toISOString() };
      });
      var changed = false;
      Object.keys(remote).forEach(function (d) {
        if (have[d]) return;
        snaps.push(remote[d].snap);
        (remote[d].flows || []).forEach(function (f) { flows.push(f); });
        changed = true;
      });
      if (changed) {
        snaps.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
        flows.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
        cloudWrite(CLOUD.snaps, snaps);
        cloudWrite(CLOUD.flows, flows);
      }
      if (!ups.length) return changed;
      return cc.c.from('value_history').upsert(ups, { onConflict: 'user_id,day' })
        .then(function (x) { if (x && x.error) throw x.error; return changed; });
    });
  }

  function cloudSync() {
    var cc = cloudClient();
    if (!cc || cloudState.syncing) return Promise.resolve(false);
    return cloudEntitled(cc).then(function (ok) {
      if (!ok) { cloudNotify(); return false; }
      cloudState.syncing = true; cloudState.error = null; cloudNotify();
      var changed = false;
      return syncCollection(cc)
        .then(function (c) { changed = changed || c; return syncHistory(cc); })
        .then(function (h) {
          changed = changed || h;
          cloudState.lastSync = new Date();
        })
        .catch(function (err) {
          // The local copy is never touched when the account cannot be reached.
          cloudState.error = (err && err.message) || 'Could not reach your account.';
        })
        .then(function () {
          cloudState.syncing = false;
          cloudState.changed = changed;
          cloudNotify();
          return changed;
        });
    }).catch(function () { cloudState.syncing = false; return false; });
  }

  // Called after every local change; batches a burst of edits into one sync.
  function cloudSoon() {
    if (cloudTimer) clearTimeout(cloudTimer);
    cloudTimer = setTimeout(function () { cloudTimer = null; cloudSync(); }, 1200);
  }

  function saveReport(kind, filename, body) {
    var cc = cloudClient();
    if (!cc) return Promise.resolve(false);
    return Promise.resolve().then(function () {
      return cc.c.rpc('has_entitlement', { feature: 'insurance_archive' });
    }).then(function (r) {
      if (!r || r.error || r.data !== true) return false;
      return cc.c.from('saved_reports').insert({ kind: kind, filename: filename, body: body })
        .then(function (x) { return !(x && x.error); });
    }).catch(function () { return false; });
  }

  function listReports() {
    var cc = cloudClient();
    if (!cc) return Promise.resolve(null);
    return Promise.resolve().then(function () {
      return cc.c.from('saved_reports').select('id,kind,filename,created_at')
        .order('created_at', { ascending: false }).limit(50);
    }).then(function (r) { return r && !r.error ? (r.data || []) : null; }, function () { return null; });
  }

  function getReport(id) {
    var cc = cloudClient();
    if (!cc) return Promise.resolve(null);
    return cc.c.from('saved_reports').select('filename,body,kind').eq('id', id).maybeSingle()
      .then(function (r) { return r && !r.error ? r.data : null; }, function () { return null; });
  }

  var cloud = {
    sync: cloudSync,
    soon: cloudSoon,
    state: function () { return cloudState; },
    onChange: function (fn) { cloudListeners.push(fn); },
    saveReport: saveReport,
    listReports: listReports,
    getReport: getReport
  };

  function renderChrome(current) {
    var A = root.BearChartAuth;
    if (A && !renderChrome._bound) {
      renderChrome._bound = true;
      A.onChange(function () { renderChrome(current); });
      A.onChange(function (s) { if (s && s.signedIn) wlSync(); else wlSynced = false; });
      A.onChange(function (s) {
        if (s && s.signedIn) cloudSync();
        else { cloudState.uid = null; cloudState.entitled = null; cloudNotify(); }
      });
      A.init();
    }
    membersGate(current);
    var head = document.getElementById('masthead');
    if (head) {
      head.innerHTML =
        '<div class="wrap">' +
          '<a class="brand" href="' + rel('index.html') + '">' +
            '<h1>BearChart</h1>' +
            '<div class="sub">Build-A-Bear Price Guide</div>' +
          '</a>' +
          '<nav class="nav">' + NAV.filter(function (n) {
            // Admin tools (and the roadmap, for now) are not destinations: only
            // admins see them in the menu. The pages still work by address.
            if (['admin.html', 'roadmap.html'].indexOf(n[0]) === -1 || current === n[0]) return true;
            var A = root.BearChartAuth;
            return !!(A && A.configured && A.configured() && A.state().isAdmin);
          }).map(function (n) {
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
        '<p class="fine legal-links"><a href="' + rel('privacy.html') + '">Privacy</a>' +
        '<a href="' + rel('terms.html') + '">Terms</a>' +
        '<a href="' + rel('about.html') + '">How prices work</a></p>' +
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
    r2: r2, stamp: stamp, renderChrome: renderChrome, wishlist: wishlist, cloud: cloud
  };
})(window);

/* Visit statistics (PostHog). Counts pages and a few key clicks so we can see
   what people use. No advertising cookies: the random visitor id lives in
   localStorage, Do Not Track is honoured, and nothing runs in tests, from a
   file:// path or on a local dev server. Disclosed on privacy.html. */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  window.bcTrack = function (name, props) {
    try { if (window.posthog && window.posthog.capture) window.posthog.capture(name, props || {}); }
    catch (e) { /* statistics must never break the page */ }
  };
  if (/jsdom/i.test(navigator.userAgent || '')) return;
  if (location.protocol === 'file:') return;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
  var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
  if (dnt === '1' || dnt === 'yes') return;

  var KEY = 'phc_xYXLmfqEVM324GUuzn474TPp8fGd7N65yRvbToCNZCMt';
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
  window.posthog.init(KEY, {
    api_host: 'https://us.i.posthog.com',
    persistence: 'localStorage',
    person_profiles: 'identified_only',
    respect_dnt: true,
    disable_session_recording: true,
    capture_pageview: true,
    capture_pageleave: true
  });
  // The same PostHog project also hears from other sites; tag every event.
  window.posthog.register({ site: 'bearchart' });
})();

/* Welcome pop-up: invites first-time visitors to make a free account and
   points at the Power perk. Shown once, never to signed-in members, never on
   the sign-in or membership pages themselves, and never inside tests. */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (/jsdom/i.test(navigator.userAgent || '')) return;

  var KEY = 'bc_welcome_seen';
  var page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  if (page === 'account.html' || page === 'plans.html' || page === 'admin.html') return;
  // These pages already ask visitors to sign in.
  if (page === 'deals.html' || page === 'checklists.html' || page === 'collection.html') return;

  function seenRecently() {
    try {
      var at = Number(localStorage.getItem(KEY) || 0);
      return at && (Date.now() - at) < 14 * 24 * 3600 * 1000;
    } catch (e) { return true; } // no storage: don't nag on every page
  }
  function markSeen() {
    try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* blocked */ }
  }
  function rel(p) {
    return window.BC && BC.rel ? BC.rel(p) : p;
  }
  function signedIn() {
    var A = window.BearChartAuth;
    if (!A || !A.state) return false;
    var s = A.state();
    return !!(s && s.signedIn);
  }
  function authReady() {
    var A = window.BearChartAuth;
    return !!(A && A.configured && A.configured());
  }

  if (seenRecently()) return;

  var shown = false;
  var followed = false;
  var lastFocus = null;
  function track(name, props) {
    if (window.bcTrack) window.bcTrack(name, props);
  }

  function close() {
    var el = document.getElementById('welcome-pop');
    if (el) el.parentNode.removeChild(el);
    document.removeEventListener('keydown', onKey);
    if (!followed) track('welcome_popup_dismissed');
    markSeen();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function show() {
    if (shown || seenRecently() || signedIn() || !authReady()) return;
    shown = true;
    lastFocus = document.activeElement;
    var wrap = document.createElement('div');
    wrap.id = 'welcome-pop';
    wrap.className = 'welcome-backdrop';
    wrap.innerHTML =
      '<div class="welcome-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-title">' +
        '<button type="button" class="welcome-x" aria-label="Close">&times;</button>' +
        '<p class="welcome-kicker">Free for collectors</p>' +
        '<h2 id="welcome-title">Join BearChart</h2>' +
        '<p class="welcome-lead">A free account lets you add the first photo of a bear ' +
          'we are missing and send in sold prices you have seen.</p>' +
        '<div class="welcome-perk">' +
          '<span class="welcome-badge">Power</span>' +
          '<p><strong>10% off one bear every month</strong> at Jay\'s Retro Exchange, ' +
          'plus a monthly email with what your collection is worth and everything in Pro.' +
          '<span class="fine">Memberships open soon. Make an account now and you will hear first.</span></p>' +
        '</div>' +
        '<div class="welcome-actions">' +
          '<a class="btn btn-primary" id="welcome-join" href="' + rel('account.html') + '">Create a free account</a>' +
          '<a class="btn" id="welcome-plans" href="' + rel('plans.html') + '">See Power membership</a>' +
        '</div>' +
        '<button type="button" class="link-btn welcome-later">Not now</button>' +
      '</div>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (e) {
      if (e.target === wrap || e.target.classList.contains('welcome-x') ||
          e.target.classList.contains('welcome-later')) {
        close();
      }
    });
    // Following a link counts as having seen it, too.
    ['welcome-join', 'welcome-plans'].forEach(function (id) {
      document.getElementById(id).addEventListener('click', function () {
        followed = true;
        track(id === 'welcome-join' ? 'welcome_popup_join_clicked' : 'welcome_popup_plans_clicked');
        markSeen();
      });
    });
    track('welcome_popup_shown');
    document.addEventListener('keydown', onKey);
    document.getElementById('welcome-join').focus();
  }

  // Give the page a moment first: nobody wants a pop-up before they have seen
  // what the site is. Auth needs that moment too, to know who is signed in.
  window.setTimeout(show, 6000);
})();
