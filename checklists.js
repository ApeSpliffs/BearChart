/* BearChart collector checklists. Sets are derived from the catalogue itself,
   so a checklist grows automatically as the database does. */
(function () {
  'use strict';

  var D = BC.data, E = BC.engine, CFG = BC.config;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'bearchart.collection';

  BC.renderChrome('checklists.html');

  // ---- the collection, shared with collection.html --------------------------

  function loadOwned() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
  }
  function saveOwned(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; }
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
      id: 'mini-beans', name: 'Mini Beans', group: 'Lines',
      blurb: 'Every Mini Bean in the catalogue, across the 2025 and 2026 collector ' +
             'guides and beyond.',
      items: bySet(function (i) { return i.mini_bean; })
    });

    sets.push({
      id: 'vault', name: 'Vault reissues', group: 'Lines',
      blurb: 'Vault Collection releases. These are reissues - an original is a ' +
             'different item and a different market.',
      items: bySet(function (i) { return i.vault_release; })
    });

    sets.push({
      id: 'vintage', name: 'Vintage (1997-1999)', group: 'Eras',
      blurb: 'The founding years.',
      items: bySet(function (i) { return BC.isVintage(i); })
    });

    ['Early 2000s', '2010s', 'Modern'].forEach(function (era) {
      sets.push({
        id: 'era-' + era.toLowerCase().replace(/\s+/g, '-'), name: era, group: 'Eras',
        items: bySet(function (i) { return BC.era(i) === era; })
      });
    });

    sets.push({
      id: 'employee', name: 'Employee exclusives', group: 'Exclusives',
      blurb: 'Never sold to the public. The hardest set here to finish.',
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
      id: 'accessories', name: 'Clothing & accessories', group: 'Other',
      items: bySet(function (i) { return i.category === 'Clothing & Accessories'; })
    });
    sets.push({
      id: 'current', name: 'Out now at retail', group: 'Other',
      blurb: 'Still buyable new - the easiest gaps to close.',
      items: bySet(function (i) { return i.release_status === 'current'; })
    });

    return sets.filter(function (s) { return s.items.length > 0; });
  }

  var SETS = buildSets();
  var current = SETS[0];

  // ---- rendering ------------------------------------------------------------

  function progressFor(set) {
    var have = ownedIds();
    var got = set.items.filter(function (i) { return have.has(i.id); });
    return { got: got.length, total: set.items.length,
             pct: set.items.length ? (got.length / set.items.length) * 100 : 0 };
  }

  function bar(pct) {
    return '<div class="progress"><span style="width:' +
           Math.max(0, Math.min(100, pct)).toFixed(1) + '%"></span></div>';
  }

  function renderSetList() {
    var groups = {};
    SETS.forEach(function (s) { (groups[s.group] = groups[s.group] || []).push(s); });

    $('set-list').innerHTML = Object.keys(groups).map(function (g) {
      return '<div class="filter-group"><h3>' + BC.esc(g) + '</h3><div class="checks">' +
        groups[g].map(function (s) {
          var p = progressFor(s);
          return '<label class="setrow' + (s.id === current.id ? ' is-active' : '') +
            '" data-set="' + BC.esc(s.id) + '">' +
            '<span>' + BC.esc(s.name) + '</span>' +
            '<span class="count">' + p.got + '/' + p.total + '</span></label>';
        }).join('') + '</div></div>';
    }).join('');
  }

  function renderOverall() {
    var have = ownedIds();
    var total = D.items.length;
    var valued = 0;
    have.forEach(function (id) {
      var v = BC.valuationFor(id);
      if (v.has_value) valued += v.fair_market;
    });
    $('overall').innerHTML = [
      [have.size + ' / ' + total, 'Items owned'],
      [Math.round((have.size / total) * 100) + '%', 'Of the catalogue'],
      [SETS.length, 'Checklists'],
      [valued ? BC.money(valued) : '--', 'Value of what you own']
    ].map(function (c) {
      return '<div class="stat"><div class="v">' + c[0] + '</div><div class="k">' +
             BC.esc(c[1]) + '</div></div>';
    }).join('');
  }

  function renderSet() {
    var have = ownedIds();
    var p = progressFor(current);
    var hideOwned = $('hide-owned').checked;

    $('set-title').textContent = current.name;
    $('set-progress').innerHTML =
      '<p class="fine">' + (current.blurb ? BC.esc(current.blurb) + ' ' : '') +
      '<strong>' + p.got + ' of ' + p.total + '</strong> (' + Math.round(p.pct) + '%).</p>' +
      bar(p.pct);

    var items = current.items.slice().sort(function (a, b) {
      return (a.release_year || 9999) - (b.release_year || 9999) ||
             a.canonical_name.localeCompare(b.canonical_name);
    });
    if (hideOwned) items = items.filter(function (i) { return !have.has(i.id); });

    if (!items.length) {
      $('set-body').innerHTML = '<div class="empty"><p><strong>' +
        (hideOwned ? 'Nothing missing here — set complete.' : 'Nothing in this set.') +
        '</strong></p></div>';
      return;
    }

    $('set-body').innerHTML = '<div class="table-scroll"><table><thead><tr>' +
      '<th style="width:34px"></th><th>Item</th><th class="num">Year</th>' +
      '<th class="num">Value</th><th>Confidence</th></tr></thead><tbody>' +
      items.map(function (i) {
        var v = BC.valuationFor(i.id);
        var has = have.has(i.id);
        return '<tr' + (has ? ' class="owned"' : '') + '>' +
          '<td><input type="checkbox" data-own="' + BC.esc(i.id) + '"' +
          (has ? ' checked' : '') + ' aria-label="Own ' + BC.esc(i.canonical_name) + '"></td>' +
          '<td><a href="' + BC.itemUrl(i.id) + '">' + BC.esc(i.canonical_name) + '</a>' +
          (BC.tagsFor(i).length ? BC.tagsHtml(i) : '') + '</td>' +
          '<td class="num">' + (i.release_year || '&mdash;') + '</td>' +
          '<td class="num price">' + (v.has_value ? BC.money(v.fair_market) :
            '<span class="fine">no data</span>') + '</td>' +
          '<td><span class="' + BC.confClass(v.confidence) + '">' + v.confidence +
          '</span></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderAll() {
    renderOverall();
    renderSetList();
    renderSet();
  }

  // ---- events ---------------------------------------------------------------

  $('set-list').addEventListener('click', function (e) {
    var row = e.target.closest('[data-set]');
    if (!row) return;
    e.preventDefault();
    var next = SETS.find(function (s) { return s.id === row.dataset.set; });
    if (next) { current = next; renderAll(); }
  });

  $('set-body').addEventListener('change', function (e) {
    var id = e.target.dataset.own;
    if (!id) return;
    if (e.target.checked) {
      // Ticking a checklist adds a default entry; refine it in the collection.
      owned.push({ item_id: id, condition: 'Good', completeness: 'unknown', qty: 1 });
    } else {
      owned = owned.filter(function (x) { return x.item_id !== id; });
    }
    if (!saveOwned(owned)) {
      alert('This browser is blocking local storage, so the checklist cannot be saved.');
    }
    renderAll();
  });

  $('hide-owned').addEventListener('change', renderSet);

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
