/* BearChart collector checklists. Sets are derived from the catalogue itself,
   so a checklist grows automatically as the database does. */
(function () {
  'use strict';

  var D = BC.data;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'bearchart.collection';
  // How many franchise sets show before "Show all" - the long tail of small
  // franchises buried the useful ones.
  var FRANCHISE_PREVIEW = 12;

  BC.renderChrome('checklists.html');

  // ---- the collection, shared with collection.html --------------------------

  function loadOwned() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
  }
  function saveOwned(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      if (BC.cloud) BC.cloud.soon();
      return true;
    }
    catch (e) { return false; }
  }
  var owned = loadOwned();
  function ownedIds() {
    return new Set(owned.map(function (e) { return e.item_id; }));
  }

  // ---- set definitions ------------------------------------------------------

  function bySet(test) {
    return D.items.filter(test);
  }

  function buildSets() {
    var sets = [];

    sets.push({
      id: 'mini-beans', name: 'Mini Beans', group: 'Collections',
      blurb: 'Every Mini Bean, from the 1998 originals to this year\'s releases.',
      items: bySet(function (i) { return i.mini_bean; })
    });

    sets.push({
      id: 'vault', name: 'Vault reissues', group: 'Collections',
      blurb: 'Vault Collection re-releases. The original version is a separate bear.',
      items: bySet(function (i) { return i.vault_release; })
    });

    sets.push({
      id: 'vintage', name: 'Vintage (1997-1999)', group: 'By era',
      blurb: 'The founding years.',
      items: bySet(function (i) { return BC.isVintage(i); })
    });

    ['Early 2000s', '2010s', 'Modern'].forEach(function (era) {
      sets.push({
        id: 'era-' + era.toLowerCase().replace(/\s+/g, '-'), name: era, group: 'By era',
        items: bySet(function (i) { return BC.era(i) === era; })
      });
    });

    sets.push({
      id: 'employee', name: 'Employee exclusives', group: 'Exclusives',
      blurb: 'Given to staff, never sold in stores. The hardest set here to finish.',
      items: bySet(function (i) { return i.employee_exclusive; })
    });
    sets.push({
      id: 'zoo', name: 'Zoo & event exclusives', group: 'Exclusives',
      blurb: 'St. Louis Zoo, SeaWorld, Busch Gardens and other venue releases.',
      items: bySet(function (i) { return i.event_exclusive; })
    });
    sets.push({
      id: 'international', name: 'International exclusives', group: 'Exclusives',
      blurb: 'Released outside the US only.',
      items: bySet(function (i) { return i.international_exclusive; })
    });
    sets.push({
      id: 'online', name: 'Online exclusives', group: 'Exclusives',
      items: bySet(function (i) { return i.online_exclusive; })
    });
    sets.push({
      id: 'store', name: 'Store exclusives', group: 'Exclusives',
      blurb: 'Hot Topic, Walmart and other retail partners.',
      items: bySet(function (i) { return i.store_exclusive; })
    });
    sets.push({
      id: 'limited', name: 'Limited editions', group: 'Exclusives',
      items: bySet(function (i) { return i.limited_edition; })
    });

    // A checklist per franchise, biggest first, once it is worth calling a set.
    var counts = {};
    D.items.forEach(function (i) {
      if (i.franchise) counts[i.franchise] = (counts[i.franchise] || 0) + 1;
    });
    Object.keys(counts).filter(function (f) { return counts[f] >= 4; })
      .sort(function (a, b) { return counts[b] - counts[a]; })
      .forEach(function (f) {
        sets.push({
          id: 'fr-' + f.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name: f, group: 'Franchises',
          items: bySet(function (i) { return i.franchise === f; })
        });
      });

    sets.push({
      id: 'accessories', name: 'Clothing & accessories', group: 'More',
      items: bySet(function (i) { return i.category === 'Clothing & Accessories'; })
    });
    sets.push({
      id: 'current', name: 'In stores now', group: 'More',
      blurb: 'Still on sale new - the easiest gaps to fill.',
      items: bySet(function (i) { return i.release_status === 'current'; })
    });

    return sets.filter(function (s) { return s.items.length > 0; });
  }

  var SETS = buildSets();
  var current = SETS[0];
  var showAllFranchises = false;

  // ---- helpers --------------------------------------------------------------

  function progressFor(set, have) {
    have = have || ownedIds();
    var got = set.items.filter(function (i) { return have.has(i.id); });
    return { got: got.length, total: set.items.length,
      pct: set.items.length ? (got.length / set.items.length) * 100 : 0 };
  }

  function bar(pct) {
    return '<div class="progress"><span style="width:' +
      Math.max(0, Math.min(100, pct)).toFixed(1) + '%"></span></div>';
  }

  /** Tags every item in the set shares say nothing on a row, so they are dropped. */
  function sharedTags(set) {
    var shared = null;
    set.items.forEach(function (i) {
      var t = BC.tagsFor(i).map(function (x) { return x.text; });
      shared = shared === null ? t : shared.filter(function (x) { return t.indexOf(x) !== -1; });
    });
    return shared || [];
  }

  // ---- rendering ------------------------------------------------------------

  function renderSetList() {
    var have = ownedIds();
    var groups = {}, order = [];
    SETS.forEach(function (s) {
      if (!groups[s.group]) { groups[s.group] = []; order.push(s.group); }
      groups[s.group].push(s);
    });

    $('set-list').innerHTML = order.map(function (g) {
      var sets = groups[g];
      var collapsible = g === 'Franchises' && sets.length > FRANCHISE_PREVIEW;
      var collapsed = collapsible && !showAllFranchises;
      return '<div class="set-group' + (collapsed ? ' is-collapsed' : '') + '">' +
        '<h3>' + BC.esc(g) + '</h3><div class="set-chips">' +
        sets.map(function (s, idx) {
          var p = progressFor(s, have);
          var extra = collapsible && idx >= FRANCHISE_PREVIEW && s.id !== current.id;
          return '<button type="button" class="set-chip' +
            (s.id === current.id ? ' is-active' : '') +
            (p.total && p.got === p.total ? ' is-done' : '') +
            (extra ? ' is-extra' : '') +
            '" data-set="' + BC.esc(s.id) + '">' +
            '<span class="set-chip-name">' + BC.esc(s.name) + '</span>' +
            '<span class="set-chip-count">' + p.got + ' / ' + p.total + '</span>' +
            '<span class="set-chip-bar"><span style="width:' + p.pct.toFixed(1) +
            '%"></span></span></button>';
        }).join('') + '</div>' +
        (collapsible
          ? '<button type="button" class="link-btn set-more" data-more="1">' +
            (collapsed ? 'Show all ' + sets.length + ' franchises' : 'Show fewer') +
            '</button>'
          : '') +
        '</div>';
    }).join('');
  }

  function renderOverall() {
    var have = ownedIds();
    var valued = 0;
    have.forEach(function (id) {
      var v = BC.valuationFor(id);
      if (v.has_value) valued += v.fair_market;
    });
    var started = 0, done = 0;
    SETS.forEach(function (s) {
      var p = progressFor(s, have);
      if (p.got) started++;
      if (p.total && p.got === p.total) done++;
    });
    $('overall').innerHTML = [
      [have.size, 'Bears ticked'],
      [started, 'Sets started'],
      [done, 'Sets complete'],
      [valued ? BC.money(valued) : '--', 'Worth about']
    ].map(function (c) {
      return '<div class="stat"><div class="v">' + c[0] + '</div><div class="k">' +
        BC.esc(c[1]) + '</div></div>';
    }).join('');
  }

  function renderSet() {
    var have = ownedIds();
    var p = progressFor(current, have);
    var hideOwned = $('hide-owned').checked;
    var needle = ($('set-search').value || '').trim().toLowerCase();

    $('set-title').textContent = current.name;
    $('set-progress').innerHTML =
      '<p class="set-progress-text"><strong>' + p.got + ' of ' + p.total + '</strong> collected' +
      ' &middot; ' + Math.round(p.pct) + '%</p>' +
      bar(p.pct) +
      (current.blurb ? '<p class="fine set-blurb">' + BC.esc(current.blurb) + '</p>' : '');

    var items = current.items.slice().sort(function (a, b) {
      return (a.release_year || 9999) - (b.release_year || 9999) ||
        a.canonical_name.localeCompare(b.canonical_name);
    });
    if (hideOwned) items = items.filter(function (i) { return !have.has(i.id); });
    if (needle) {
      items = items.filter(function (i) {
        return i.canonical_name.toLowerCase().indexOf(needle) !== -1 ||
          (i.aliases || []).some(function (a) { return a.toLowerCase().indexOf(needle) !== -1; });
      });
    }

    if (!items.length) {
      var msg = needle ? 'No bears in this set match \u201c' + BC.esc(needle) + '\u201d.'
        : hideOwned ? 'Nothing missing here \u2014 set complete!'
        : 'Nothing in this set yet.';
      $('set-body').innerHTML = '<div class="empty"><p><strong>' + msg + '</strong></p></div>';
      return;
    }

    var skip = sharedTags(current);
    $('set-body').innerHTML = '<div class="table-scroll"><table class="check-table"><thead><tr>' +
      '<th class="own-col"><span class="sr-only">Own it</span></th><th>Bear</th>' +
      '<th class="num">Value</th></tr></thead><tbody>' +
      items.map(function (i) {
        var v = BC.valuationFor(i.id);
        var has = have.has(i.id);
        var meta = [i.release_year || 'Year unknown'].concat(
          BC.tagsFor(i).map(function (t) { return t.text; })
            .filter(function (t) { return skip.indexOf(t) === -1; }).slice(0, 2));
        var sales = v.comparable_count || 0;
        return '<tr' + (has ? ' class="owned"' : '') + '>' +
          '<td class="own-col"><input type="checkbox" class="own-box" data-own="' +
          BC.esc(i.id) + '"' + (has ? ' checked' : '') +
          ' aria-label="I own ' + BC.esc(i.canonical_name) + '"></td>' +
          '<td><a class="bear-link" href="' + BC.itemUrl(i.id) + '">' +
          BC.esc(i.canonical_name) + '</a>' +
          '<div class="bear-meta">' + meta.map(BC.esc).join(' &middot; ') + '</div></td>' +
          '<td class="num">' + (v.has_value
            ? '<span class="price">' + BC.money(v.fair_market) + '</span>' +
              '<div class="val-note">' + sales + ' sale' + (sales === 1 ? '' : 's') + '</div>'
            : '<span class="val-note">no data yet</span>') +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderAll() {
    renderOverall();
    renderSetList();
    renderSet();
  }

  function setOwned(id, yes) {
    owned = owned.filter(function (x) { return x.item_id !== id; });
    // Ticking a checklist adds a default entry; refine it in the collection.
    if (yes) owned.push({ item_id: id, condition: 'Good', completeness: 'unknown', qty: 1 });
    if (!saveOwned(owned)) {
      alert('This browser is blocking local storage, so the checklist cannot be saved.');
    }
    renderAll();
  }

  // ---- events ---------------------------------------------------------------

  $('set-list').addEventListener('click', function (e) {
    if (e.target.closest('[data-more]')) {
      showAllFranchises = !showAllFranchises;
      renderSetList();
      return;
    }
    var row = e.target.closest('[data-set]');
    if (!row) return;
    e.preventDefault();
    var next = SETS.find(function (s) { return s.id === row.dataset.set; });
    if (!next) return;
    current = next;
    $('set-search').value = '';
    renderAll();
    // On a phone the list is below the picker; take the reader to it.
    var panel = $('set-panel');
    if (panel && typeof panel.scrollIntoView === 'function' && window.innerWidth < 860) {
      try { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (err) { /* old browser */ }
    }
  });

  $('set-body').addEventListener('change', function (e) {
    var id = e.target.dataset.own;
    if (!id) return;
    setOwned(id, e.target.checked);
  });

  // The whole row is a tap target, not just the small box.
  $('set-body').addEventListener('click', function (e) {
    if (e.target.closest('a, input, button')) return;
    var tr = e.target.closest('tr');
    var box = tr && tr.querySelector('input[data-own]');
    if (!box) return;
    setOwned(box.dataset.own, !box.checked);
  });

  $('hide-owned').addEventListener('change', renderSet);

  var debounce;
  $('set-search').addEventListener('input', function () {
    clearTimeout(debounce);
    debounce = setTimeout(renderSet, 120);
  });

  $('export-set').addEventListener('click', function () {
    var have = ownedIds();
    var rows = [['set', 'item_id', 'canonical_name', 'release_year', 'owned',
      'value', 'confidence']];
    current.items.forEach(function (i) {
      var v = BC.valuationFor(i.id);
      rows.push([current.name, i.id, i.canonical_name, i.release_year,
        have.has(i.id) ? 'yes' : 'no',
        v.has_value ? BC.r2(v.fair_market) : '', v.confidence]);
    });
    BC.download('bearchart-checklist-' + current.id + '-' + BC.stamp() + '.csv',
      BC.toCsv(rows));
  });

  renderAll();
})();
