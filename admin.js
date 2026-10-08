/* BearChart admin. Drafts items and sales locally and exports them as JSON or SQL.
   The forms and validation are the same shape the Supabase-backed admin will use. */
(function () {
  'use strict';

  var D = BC.data, CFG = BC.config;
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'bearchart.draft';

  BC.renderChrome('admin.html');

  // Access notice. The real protection is the row-level security in
  // supabase_schema.sql, which the server enforces however the API is called -
  // hiding a form in the browser protects nothing on its own.
  function renderAccess() {
    var el = $('access-notice');
    if (!el) return;
    var A = window.BearChartAuth;
    if (!A || !A.configured()) {
      el.className = 'notice';
      el.innerHTML = '<strong>No account system is switched on.</strong> This page is ' +
        'not protected, and does not need to be: with no backend it only writes to ' +
        'this browser and exports files. Once Supabase is connected, writes are ' +
        'admin-only and enforced by the database.';
      return;
    }
    var st = A.state();
    if (!st.signedIn) {
      el.className = 'notice warn';
      el.innerHTML = '<strong>You are not signed in.</strong> You can draft entries ' +
        'here, but nothing can be written to the database. ' +
        '<a href="account.html">Sign in</a>.';
    } else if (!st.isAdmin) {
      el.className = 'notice warn';
      el.innerHTML = '<strong>Signed in as ' + BC.esc(st.email) + ', which is not an ' +
        'admin account.</strong> Drafts stay in this browser; the database will refuse ' +
        'writes from this account, whatever this page shows.';
    } else {
      el.className = 'notice';
      el.innerHTML = '<strong>Signed in as an admin (' + BC.esc(st.email) + ').</strong> ' +
        'Writes to the database are permitted for this account.';
    }
  }

  if (window.BearChartAuth) window.BearChartAuth.onChange(renderAccess);

  var draft = loadDraft();

  function loadDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || '{}');
      return { items: d.items || [], sales: d.sales || [], images: d.images || [] };
    } catch (e) { return { items: [], sales: [], images: [] }; }
  }
  function saveDraft() {
    try { localStorage.setItem(KEY, JSON.stringify(draft)); } catch (e) { /* storage blocked */ }
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  // --- form population ------------------------------------------------------

  function allItems() {
    return D.items.concat(draft.items);
  }

  // Read live, so a bear you have just drafted is immediately available to
  // attach a sale or a photo to.
  BC.itemChooser($('s-item'), allItems);
  BC.itemChooser($('p-item'), allItems);

  function refreshItemPickers() {
    $('s-item').refill();
    $('p-item').refill();
  }
  $('s-cond').innerHTML = CFG.condition_order.map(function (c) {
    return '<option value="' + c + '"' + (c === 'Good' ? ' selected' : '') + '>' + c + '</option>';
  }).join('');
  $('s-comp').innerHTML = Object.keys(CFG.completeness_multipliers).map(function (k) {
    return '<option value="' + k + '"' + (k === 'unknown' ? ' selected' : '') + '>' +
           BC.esc(CFG.completeness_labels[k] || k) + '</option>';
  }).join('');
  $('s-evidence').innerHTML = CFG.market_evidence_types.map(function (t) {
    return '<option value="' + t + '"' + (t === 'completed_sale' ? ' selected' : '') + '>' +
           t.replace(/_/g, ' ') + '</option>';
  }).join('');

  var ITEM_FLAGS = [
    ['licensed', 'Licensed'], ['limited_edition', 'Limited edition'],
    ['employee_exclusive', 'Employee exclusive'], ['store_exclusive', 'Store exclusive'],
    ['event_exclusive', 'Event / zoo exclusive'],
    ['international_exclusive', 'International exclusive'],
    ['online_exclusive', 'Online exclusive'], ['vault_release', 'Vault release'],
    ['mini_bean', 'Mini Bean'], ['retired', 'Retired'], ['is_lot', 'Multi-item lot']
  ];
  $('i-flags').innerHTML = ITEM_FLAGS.map(function (f) {
    return '<label><input type="checkbox" value="' + f[0] + '"><span>' + f[1] + '</span></label>';
  }).join('');

  // --- adding ---------------------------------------------------------------

  $('s-add').addEventListener('click', function () {
    var msg = $('s-msg');
    var price = parseFloat($('s-price').value);
    var evidence = $('s-evidence').value;
    var sample = parseInt($('s-sample').value, 10);
    sample = (sample > 1) ? sample : null;

    if (!$('s-item').value) { msg.textContent = 'Pick an item.'; return; }
    if (!(price > 0)) { msg.textContent = 'Enter a sold price above zero.'; return; }
    // An average across several sales is not one verified transaction.
    if (sample && evidence === 'completed_sale') {
      msg.textContent = 'An average across ' + sample + ' sales is not a single ' +
        'completed sale. Record it as a collector report.';
      return;
    }
    // Section 33: a claim of a verified completed sale has to carry its provenance.
    if (evidence === 'completed_sale' && (!$('s-date').value || !$('s-market').value.trim() ||
        !$('s-listing').value.trim())) {
      msg.textContent = 'A completed sale needs a date, a marketplace and a listing id. ' +
        'Without all three, record it as a collector report instead.';
      return;
    }

    draft.sales.push({
      id: 'draft-sale-' + (draft.sales.length + 1),
      item_id: $('s-item').value,
      sale_date: $('s-date').value || null,
      sold_price: price,
      price_high: null,
      ranged: false,
      currency: 'USD',
      condition: $('s-cond').value,
      completeness: $('s-comp').value,
      marketplace: $('s-market').value.trim() || null,
      source_url: $('s-url').value.trim() || null,
      listing_id: $('s-listing').value.trim() || null,
      evidence_type: evidence,
      shipping_included: null,
      sample_size: sample,
      notes: $('s-notes').value.trim() || null
    });
    saveDraft();
    ['s-price', 's-listing', 's-url', 's-notes', 's-sample'].forEach(function (f) {
      $(f).value = '';
    });
    msg.textContent = 'Added to the pending list.';
    render();
  });

  $('i-add').addEventListener('click', function () {
    var msg = $('i-msg');
    var name = $('i-name').value.trim();
    if (!name) { msg.textContent = 'Enter a canonical name.'; return; }
    var id = slug(name);
    if (D.items.some(function (i) { return i.id === id; }) ||
        draft.items.some(function (i) { return i.id === id; })) {
      msg.textContent = 'An item with that name already exists.';
      return;
    }

    var item = {
      id: id,
      canonical_name: name,
      aliases: $('i-aliases').value.split('\n').map(function (s) { return s.trim(); })
        .filter(Boolean),
      category: $('i-cat').value.trim() || 'Stuffed Animal',
      species: $('i-species').value.trim() || null,
      release_year: parseInt($('i-year').value, 10) || null,
      release_month: null, version: null, variant: null,
      franchise: $('i-franchise').value.trim() || null,
      edition_size: null, original_release: true, rarity: null, sound: null, scent: null,
      notes: null, image_url: null, image_credit: null, image_source: null,
      release_status: $('i-status').value || null,
      expected_release: null, announced_msrp: null, announcement_source: null
    };
    ITEM_FLAGS.forEach(function (f) { item[f[0]] = false; });
    Array.prototype.forEach.call($('i-flags').querySelectorAll('input:checked'), function (c) {
      item[c.value] = true;
    });

    draft.items.push(item);
    saveDraft();
    $('i-name').value = ''; $('i-species').value = ''; $('i-year').value = '';
    $('i-franchise').value = ''; $('i-aliases').value = '';
    Array.prototype.forEach.call($('i-flags').querySelectorAll('input'), function (c) {
      c.checked = false;
    });
    refreshItemPickers();
    msg.textContent = 'Added "' + name + '" to the pending list.';
    render();
  });

  $('clear-draft').addEventListener('click', function () {
    if (!draft.items.length && !draft.sales.length && !draft.images.length) return;
    if (!confirm('Discard all pending entries?')) return;
    draft = { items: [], sales: [], images: [] };
    saveDraft();
    render();
  });


  // --- photos ---------------------------------------------------------------

  function previewPhoto() {
    var url = $('p-url').value.trim();
    var item = BC.itemById($('p-item').value) ||
      draft.items.find(function (x) { return x.id === $('p-item').value; });
    if (!url) {
      $('p-preview').innerHTML = item
        ? '<p class="fine">Current:</p>' + BC.imageHtml(item, 'hero')
        : '';
      return;
    }
    $('p-preview').innerHTML = '<p class="fine">Preview:</p>' +
      BC.imageHtml({ id: 'preview', canonical_name: item ? item.canonical_name : 'Preview',
                     image_url: url }, 'hero');
  }

  $('p-url').addEventListener('input', previewPhoto);
  $('p-item').addEventListener('change', previewPhoto);

  $('p-add').addEventListener('click', function () {
    var msg = $('p-msg');
    var url = $('p-url').value.trim();
    if (!$('p-item').value) { msg.textContent = 'Pick an item.'; return; }
    if (!url) { msg.textContent = 'Enter an image URL.'; return; }

    // Section 34 applies to pictures as much as to prices: use imagery you have
    // the right to use. Official product photography is not that.
    if (/(^|\.)buildabear\.com/i.test(url)) {
      msg.textContent = 'That is official Build-A-Bear imagery. Use your own photograph ' +
        'or an image you hold the rights to.';
      return;
    }

    draft.images = draft.images.filter(function (x) { return x.item_id !== $('p-item').value; });
    draft.images.push({
      item_id: $('p-item').value,
      image_url: url,
      image_credit: $('p-credit').value.trim() || null,
      image_source: $('p-source').value.trim() || null
    });
    saveDraft();
    $('p-url').value = ''; $('p-source').value = '';
    msg.textContent = 'Photo queued. Export to make it permanent.';
    previewPhoto();
    render();
  });

  // --- exports --------------------------------------------------------------

  $('export-json').addEventListener('click', function () {
    BC.download('bearchart-draft-' + BC.stamp() + '.json',
      JSON.stringify(draft, null, 2), 'application/json');
  });

  function sqlStr(v) {
    if (v == null || v === '') return 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return String(v);
    return "'" + String(v).replace(/'/g, "''") + "'";
  }

  $('export-sql').addEventListener('click', function () {
    var lines = ['-- BearChart pending entries, generated ' + BC.stamp(),
      '-- Run against the schema in supabase_schema.sql.', ''];

    draft.items.forEach(function (i) {
      lines.push('insert into items (slug, canonical_name, aliases, category, species, ' +
        'release_year, licensed, franchise, limited_edition, employee_exclusive, ' +
        'store_exclusive, event_exclusive, vault_release, mini_bean, retired, is_lot)');
      lines.push('values (' + [
        sqlStr(i.id), sqlStr(i.canonical_name),
        i.aliases.length ? 'array[' + i.aliases.map(sqlStr).join(', ') + ']' : 'null',
        sqlStr(i.category), sqlStr(i.species), i.release_year || 'null',
        sqlStr(!!i.licensed), sqlStr(i.franchise), sqlStr(!!i.limited_edition),
        sqlStr(!!i.employee_exclusive), sqlStr(!!i.store_exclusive),
        sqlStr(!!i.event_exclusive), sqlStr(!!i.vault_release), sqlStr(!!i.mini_bean),
        sqlStr(!!i.retired), sqlStr(!!i.is_lot)
      ].join(', ') + ');');
      lines.push('');
    });

    draft.sales.forEach(function (s) {
      lines.push('insert into sales (item_id, sale_date, sold_price, condition, ' +
        'completeness, marketplace, listing_id, source_url, evidence_type, ' +
        'sample_size, notes)');
      lines.push('select id, ' + [
        sqlStr(s.sale_date), s.sold_price, sqlStr(s.condition), sqlStr(s.completeness),
        sqlStr(s.marketplace), sqlStr(s.listing_id), sqlStr(s.source_url),
        sqlStr(s.evidence_type), s.sample_size == null ? 'null' : s.sample_size,
        sqlStr(s.notes)
      ].join(', ') + ' from items where slug = ' + sqlStr(s.item_id) + ';');
      lines.push('');
    });

    draft.images.forEach(function (im) {
      lines.push('update items set image_url = ' + sqlStr(im.image_url) +
        ', image_credit = ' + sqlStr(im.image_credit) +
        ', image_source = ' + sqlStr(im.image_source) +
        ' where slug = ' + sqlStr(im.item_id) + ';');
      lines.push('');
    });

    BC.download('bearchart-draft-' + BC.stamp() + '.sql', lines.join('\n'), 'text/plain');
  });

  // --- rendering ------------------------------------------------------------

  function renderStats() {
    var missing = D.items.filter(function (i) { return !BC.valuationFor(i.id).has_value; });
    var lowConf = D.items.filter(function (i) {
      var v = BC.valuationFor(i.id);
      return v.has_value && (v.confidence === 'LOW' || v.confidence === 'VERY LOW');
    });
    var strong = D.sales.filter(function (s) { return s.evidence_type === 'completed_sale'; });

    $('admin-stats').innerHTML = [
      [D.items.length, 'Total items'],
      [D.sales.length, 'Total sold observations'],
      [strong.length, 'Fully sourced sales'],
      [missing.length, 'Items missing sales'],
      [lowConf.length, 'Low-confidence items'],
      [D.items.filter(function (i) { return BC.hasImage(i); }).length + ' / ' + D.items.length,
        'Items with a photo'],
      [D.items.filter(function (i) { return i.needs_review; }).length,
        'Questions to settle'],
      [draft.items.length + draft.sales.length + draft.images.length, 'Pending entries']
    ].map(function (c) {
      return '<div class="stat"><div class="v">' + c[0] + '</div><div class="k">' +
             BC.esc(c[1]) + '</div></div>';
    }).join('');
  }

  function renderDraft() {
    var body = $('draft-body');
    if (!draft.items.length && !draft.sales.length && !draft.images.length) {
      body.innerHTML = '<div class="empty"><p>Nothing pending.</p></div>';
      return;
    }
    var html = '';
    if (draft.items.length) {
      html += '<h3>Items (' + draft.items.length + ')</h3><div class="table-scroll"><table>' +
        '<thead><tr><th>Name</th><th>Category</th><th>Year</th><th>Franchise</th></tr></thead><tbody>' +
        draft.items.map(function (i) {
          return '<tr><td>' + BC.esc(i.canonical_name) + '</td><td>' + BC.esc(i.category) +
                 '</td><td>' + (i.release_year || '&mdash;') + '</td><td>' +
                 BC.esc(i.franchise || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    if (draft.sales.length) {
      html += '<h3 style="margin-top:18px">Sales (' + draft.sales.length + ')</h3>' +
        '<div class="table-scroll"><table><thead><tr><th>Item</th><th class="num">Price</th>' +
        '<th>Date</th><th>Condition</th><th>Evidence</th></tr></thead><tbody>' +
        draft.sales.map(function (s) {
          var i = BC.itemById(s.item_id) ||
            draft.items.find(function (x) { return x.id === s.item_id; });
          return '<tr><td>' + BC.esc(i ? i.canonical_name : s.item_id) +
                 '</td><td class="num price">' + BC.exact(s.sold_price) + '</td><td>' +
                 BC.esc(s.sale_date || '—') + '</td><td>' + BC.esc(s.condition) +
                 '</td><td class="fine">' + BC.esc(s.evidence_type.replace(/_/g, ' ')) +
                 '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    if (draft.images.length) {
      html += '<h3 style="margin-top:18px">Photos (' + draft.images.length + ')</h3>' +
        '<div class="table-scroll"><table><thead><tr><th>Item</th><th>Image</th>' +
        '<th>Credit</th></tr></thead><tbody>' +
        draft.images.map(function (im) {
          var i = BC.itemById(im.item_id) ||
            draft.items.find(function (x) { return x.id === im.item_id; });
          return '<tr><td>' + BC.esc(i ? i.canonical_name : im.item_id) +
                 '</td><td class="mono">' + BC.esc(im.image_url) + '</td><td>' +
                 BC.esc(im.image_credit || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    body.innerHTML = html;
  }

  function renderQuality() {
    var missing = D.items.filter(function (i) { return !BC.valuationFor(i.id).has_value; });
    var single = D.items.filter(function (i) {
      return BC.valuationFor(i.id).comparable_count === 1;
    });
    var unsourced = D.items.filter(function (i) {
      var v = BC.valuationFor(i.id);
      return v.has_value && v.strong_evidence_count === 0;
    });

    function list(title, note, items) {
      return '<h3 style="margin-top:16px">' + title + ' (' + items.length + ')</h3>' +
        '<p class="fine">' + note + '</p><div class="tags">' +
        items.slice(0, 40).map(function (i) {
          return '<a class="tag" href="' + BC.itemUrl(i.id) + '" style="text-transform:none;' +
                 'letter-spacing:0;font-size:12px;text-decoration:none">' +
                 BC.esc(i.canonical_name) + '</a>';
        }).join('') +
        (items.length > 40 ? '<span class="fine"> +' + (items.length - 40) + ' more</span>' : '') +
        '</div>';
    }

    $('quality').innerHTML =
      list('Items with no sold data', 'Catalogued but unpriceable until a comp exists.', missing) +
      list('Items resting on a single sale', 'One sale is an anecdote. Find a second.', single) +
      list('Items with no fully sourced sale', 'Priced from collector reports rather than ' +
        'verified completed sales. Add date, marketplace and listing id.', unsourced) +
      list('Items with no photo', 'Showing a generated monogram until a photo is attached.',
        D.items.filter(function (i) { return !BC.hasImage(i); })) +
      list('Identification questions to settle',
        'The catalogue was largely built from seller-written listing titles, which ' +
        'cannot always tell two products apart. Each of these needs eyes on the actual ' +
        'bear - a tush tag usually decides it. Run "npm run audit" for the full report.',
        D.items.filter(function (i) { return i.needs_review; }));
  }

  function renderNewBears() {
    var box = $('new-bears');
    if (!box) return;
    var rows = window.BEARCHART_NEW || [];
    if (!rows.length) {
      box.innerHTML = '<p class="fine">No new bears in the last 90 days. The next check runs on Monday.</p>';
      return;
    }
    var byName = {};
    D.items.forEach(function (i) { byName[i.canonical_name.toLowerCase()] = i; });
    box.innerHTML = '<div class="table-scroll"><table><thead><tr><th>Added</th><th>Bear</th>' +
      '<th>Year</th><th>Type</th></tr></thead><tbody>' + rows.map(function (r) {
        var it = byName[String(r.name || '').toLowerCase()];
        var name = it ? '<a href="' + BC.itemUrl(it.id) + '">' + BC.esc(r.name) + '</a>' : BC.esc(r.name);
        return '<tr><td>' + BC.esc(r.added_on || '') + '</td><td>' + name + '</td><td>' +
          BC.esc(r.year ? String(r.year) : '\u2014') + '</td><td>' + BC.esc(r.species || '\u2014') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderRecent() {
    var recent = D.sales.filter(function (s) { return s.sale_date; })
      .sort(function (a, b) { return b.sale_date.localeCompare(a.sale_date); })
      .slice(0, 10);
    $('recent').innerHTML = '<div class="table-scroll"><table><thead><tr><th>Date</th>' +
      '<th>Item</th><th class="num">Price</th><th>Marketplace</th><th>Listing</th>' +
      '</tr></thead><tbody>' + recent.map(function (s) {
        var i = BC.itemById(s.item_id);
        return '<tr><td>' + BC.esc(s.sale_date) + '</td><td><a href="' + BC.itemUrl(s.item_id) +
               '">' + BC.esc(i ? i.canonical_name : s.item_id) + '</a></td>' +
               '<td class="num price">' + BC.exact(s.sold_price) + '</td><td>' +
               BC.esc(s.marketplace || '—') + '</td><td class="mono">' +
               BC.esc(s.listing_id || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderSources() {
    $('sources').innerHTML = '<dl class="kv">' + D.sources.map(function (s) {
      return '<dt><a href="' + BC.esc(s.url) + '" target="_blank" rel="noopener">' +
             BC.esc(s.name) + '</a></dt><dd>' + BC.esc(s.role) + '</dd>';
    }).join('') + '</dl>';
  }

  // --- reader submissions ----------------------------------------------------

  var queue = { comps: [], reports: [], error: null, loaded: false };

  function supa() {
    var A = window.BearChartAuth;
    return A && A.configured() ? A.getClient() : null;
  }

  function loadQueue() {
    var c = supa();
    if (!c) {
      queue.error = 'Not connected to the database.';
      queue.loaded = true;
      renderQueue();
      return;
    }
    queue.error = null;
    Promise.all([
      c.from('comp_submissions').select('*').order('created_at', { ascending: false }).limit(200),
      c.from('item_reports').select('*').order('created_at', { ascending: false }).limit(200)
    ]).then(function (res) {
      var bad = res.filter(function (r) { return r && r.error; })[0];
      if (bad) {
        // The commonest cause by far, and worth naming rather than showing a
        // Postgres string to somebody who has simply not run the migration.
        queue.error = /does not exist|schema cache/i.test(bad.error.message)
          ? 'The submissions tables are not in the database yet. Apply ' +
            'supabase_migration_02_submissions.sql.'
          : bad.error.message;
      } else {
        queue.comps = res[0].data || [];
        queue.reports = res[1].data || [];
      }
      queue.loaded = true;
      renderQueue();
    }).catch(function (err) {
      queue.error = err.message;
      queue.loaded = true;
      renderQueue();
    });
  }

  function setStatus(table, id, status) {
    var c = supa();
    if (!c) return;
    var patch = { status: status, reviewed_at: new Date().toISOString() };
    c.from(table).update(patch).eq('id', id).then(function (res) {
      if (res && res.error) { window.alert(res.error.message); return; }
      loadQueue();
    });
  }

  function compRow(s) {
    var item = BC.itemById(s.item_slug);
    var pending = s.status === 'pending';
    return '<tr>' +
      '<td>' + (item
        ? '<a href="' + BC.itemUrl(item.id) + '">' + BC.esc(item.canonical_name) + '</a>'
        : BC.esc(s.item_slug)) + '</td>' +
      '<td class="num">' + BC.esc(BC.exact(s.sold_price)) + '</td>' +
      '<td>' + BC.esc(s.sale_date || 'undated') + '</td>' +
      '<td>' + BC.esc(s.marketplace || '-') + '</td>' +
      '<td>' + (s.listing_url
        ? '<a href="' + BC.esc(s.listing_url) + '" target="_blank" rel="noopener">listing</a>'
        : '<span class="fine">none</span>') + '</td>' +
      '<td><span class="tag">' + BC.esc(s.status) + '</span></td>' +
      '<td>' + (pending
        ? '<button type="button" data-accept="' + BC.esc(s.id) + '">Accept</button> ' +
          '<button type="button" data-reject="' + BC.esc(s.id) + '">Reject</button>'
        : '<span class="fine">reviewed</span>') + '</td>' +
      '</tr>';
  }

  function reportRow(r) {
    var item = BC.itemById(r.item_slug);
    var S = window.BearChartSubmissions;
    return '<tr>' +
      '<td>' + (item
        ? '<a href="' + BC.itemUrl(item.id) + '">' + BC.esc(item.canonical_name) + '</a>'
        : BC.esc(r.item_slug)) + '</td>' +
      '<td>' + BC.esc(S ? S.reasonLabel(r.reason) : r.reason) + '</td>' +
      '<td>' + BC.esc(r.note || '') + '</td>' +
      '<td><span class="tag">' + BC.esc(r.status) + '</span></td>' +
      '<td>' + (r.status === 'open'
        ? '<button type="button" data-fixed="' + BC.esc(r.id) + '">Fixed</button> ' +
          '<button type="button" data-declined="' + BC.esc(r.id) + '">Decline</button>'
        : '<span class="fine">closed</span>') + '</td>' +
      '</tr>';
  }

  function renderQueue() {
    var el = $('queue-body');
    if (!el) return;
    if (!queue.loaded) { el.innerHTML = '<p class="fine">Loading…</p>'; return; }
    if (queue.error) {
      el.innerHTML = '<div class="notice warn">' + BC.esc(queue.error) + '</div>';
      return;
    }

    var pendingComps = queue.comps.filter(function (s) { return s.status === 'pending'; });
    var openReports = queue.reports.filter(function (r) { return r.status === 'open'; });

    var html = '<h3>Submitted sales (' + pendingComps.length + ' pending)</h3>';
    html += queue.comps.length
      ? '<div class="table-scroll"><table><thead><tr><th>Item</th><th class="num">Price</th>' +
        '<th>Date</th><th>Where</th><th>Proof</th><th>Status</th><th></th></tr></thead><tbody>' +
        queue.comps.map(compRow).join('') + '</tbody></table></div>'
      : '<p class="fine">Nothing submitted yet.</p>';

    html += '<h3 style="margin-top:22px">Problem reports (' + openReports.length + ' open)</h3>';
    html += queue.reports.length
      ? '<div class="table-scroll"><table><thead><tr><th>Item</th><th>Problem</th>' +
        '<th>Note</th><th>Status</th><th></th></tr></thead><tbody>' +
        queue.reports.map(reportRow).join('') + '</tbody></table></div>'
      : '<p class="fine">No reports.</p>';

    el.innerHTML = html;
  }

  if ($('queue-body')) {
    $('queue-body').addEventListener('click', function (e) {
      var d = e.target.dataset || {};
      if (d.accept) setStatus('comp_submissions', d.accept, 'accepted');
      else if (d.reject) setStatus('comp_submissions', d.reject, 'rejected');
      else if (d.fixed) setStatus('item_reports', d.fixed, 'fixed');
      else if (d.declined) setStatus('item_reports', d.declined, 'declined');
    });
    $('queue-refresh').addEventListener('click', loadQueue);
    $('queue-csv').addEventListener('click', function () {
      // Straight into the shape tools/import_sales.py already reads, so an
      // accepted submission goes through the same tested path as every other
      // comp rather than a second one written for it.
      var rows = queue.comps.filter(function (s) { return s.status === 'accepted'; });
      if (!rows.length) { window.alert('No accepted submissions to export.'); return; }
      var head = ['item_name', 'sold_price', 'sale_date', 'marketplace',
                  'listing_id', 'condition', 'completeness', 'evidence_type', 'source_url'];
      var csv = [head.join(',')].concat(rows.map(function (s) {
        var item = BC.itemById(s.item_slug);
        return [item ? item.canonical_name : s.item_slug, s.sold_price, s.sale_date || '',
                s.marketplace || '', s.listing_id || '', s.condition || '',
                s.completeness || '', s.claimed_type || 'collector_report',
                s.listing_url || ''
        ].map(function (v) {
          v = String(v == null ? '' : v);
          return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
        }).join(',');
      })).join('\r\n');
      BC.download('bearchart-submissions-' + BC.stamp() + '.csv', csv);
    });
  }

  // --- member photos ----------------------------------------------------------
  // Photos members sent for bears with none. They sit in a private bucket until
  // approved here; approving copies the file into the public bucket and records
  // it in item_photos, which the item pages and cards read at run time.

  var photoQueue = { rows: [], error: null, loaded: false };

  function loadPhotoQueue() {
    if (!$('photo-queue-body')) return;
    var c = supa();
    if (!c) {
      photoQueue = { rows: [], error: 'Not connected to the database. Sign in as an admin.',
        loaded: true };
      renderPhotoQueue();
      return;
    }
    c.from('photo_submissions').select('*').eq('status', 'pending')
      .order('created_at', { ascending: true }).limit(100)
      .then(function (res) {
        if (res.error) throw res.error;
        // A private bucket: previews need short-lived signed links.
        return Promise.all((res.data || []).map(function (r) {
          return c.storage.from('photo-submissions').createSignedUrl(r.storage_path, 3600)
            .then(function (s) { r.preview = s && s.data ? s.data.signedUrl : null; return r; })
            .catch(function () { return r; });
        }));
      })
      .then(function (rows) {
        photoQueue = { rows: rows, error: null, loaded: true };
        renderPhotoQueue();
      })
      .catch(function (err) {
        var msg = (err && err.message) || 'Could not load photos.';
        photoQueue = { rows: [], loaded: true,
          error: /does not exist|schema cache/i.test(msg)
            ? 'The photo tables are not in the database yet. Apply supabase_migration_03_photos.sql.'
            : msg };
        renderPhotoQueue();
      });
  }

  function renderPhotoQueue() {
    var el = $('photo-queue-body');
    if (!el) return;
    if (!photoQueue.loaded) { el.innerHTML = '<p class="fine">Loading\u2026</p>'; return; }
    if (photoQueue.error) {
      el.innerHTML = '<div class="notice warn">' + BC.esc(photoQueue.error) + '</div>';
      return;
    }
    if (!photoQueue.rows.length) {
      el.innerHTML = '<p class="fine">No photos waiting for review.</p>';
      return;
    }
    el.innerHTML = '<div class="photo-review">' + photoQueue.rows.map(function (r) {
      var item = BC.itemById(r.item_slug);
      return '<div class="photo-card">' +
        (r.preview
          ? '<img src="' + BC.esc(r.preview) + '" alt="Photo submitted for ' +
            BC.esc(item ? item.canonical_name : r.item_slug) + '">'
          : '<div class="empty"><p>No preview</p></div>') +
        '<p><strong>' + (item
          ? '<a href="' + BC.itemUrl(item.id) + '" target="_blank" rel="noopener">' +
            BC.esc(item.canonical_name) + '</a>'
          : BC.esc(r.item_slug)) + '</strong></p>' +
        '<p class="fine">Sent ' + BC.esc(String(r.created_at || '').slice(0, 10)) + '</p>' +
        '<p class="photo-actions">' +
        '<button type="button" class="primary" data-approve="' + BC.esc(r.id) + '">Approve</button> ' +
        '<button type="button" data-reject-photo="' + BC.esc(r.id) + '">Reject</button></p>' +
        '</div>';
    }).join('') + '</div>';
  }

  function approvePhoto(row) {
    var c = supa();
    var target = row.item_slug + '.jpg';
    return c.storage.from('photo-submissions').download(row.storage_path)
      .then(function (res) {
        if (res.error) throw res.error;
        return c.storage.from('bear-photos')
          .upload(target, res.data, { contentType: 'image/jpeg', upsert: true });
      })
      .then(function (res) {
        if (res.error) throw res.error;
        var pub = c.storage.from('bear-photos').getPublicUrl(target).data.publicUrl;
        return c.from('item_photos').upsert({
          item_slug: row.item_slug,
          // Versioned, so a replaced photo is never served stale from a cache.
          image_url: pub + '?v=' + Date.now(),
          credit: 'Photo by a BearChart member',
          submission_id: row.id,
          approved_at: new Date().toISOString()
        });
      })
      .then(function (res) {
        if (res.error) throw res.error;
        return c.from('photo_submissions')
          .update({ status: 'approved', reviewed_at: new Date().toISOString() })
          .eq('id', row.id);
      })
      .then(function (res) { if (res && res.error) throw res.error; });
  }

  function rejectPhoto(row) {
    var c = supa();
    return c.from('photo_submissions')
      .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
      .eq('id', row.id)
      .then(function (res) {
        if (res.error) throw res.error;
        // The file is not kept once it has been turned down.
        return c.storage.from('photo-submissions').remove([row.storage_path]);
      });
  }

  if ($('photo-queue-body')) {
    $('photo-queue-body').addEventListener('click', function (e) {
      var d = e.target.dataset || {};
      var id = d.approve || d.rejectPhoto;
      if (!id) return;
      var row = photoQueue.rows.filter(function (r) { return r.id === id; })[0];
      if (!row) return;
      e.target.disabled = true;
      (d.approve ? approvePhoto(row) : rejectPhoto(row)).then(loadPhotoQueue)
        .catch(function (err) {
          e.target.disabled = false;
          window.alert('Could not update that photo: ' + ((err && err.message) || err));
        });
    });
    $('photo-queue-refresh').addEventListener('click', loadPhotoQueue);
  }

  function render() {
    renderAccess();
    renderStats();
    renderDraft();
    renderQuality();
    renderRecent();
    renderNewBears();
    renderSources();
    renderQueue();
  }

  render();
  loadQueue();
  loadPhotoQueue();
  // The account client loads after this script; reload the photo queue once
  // it is there, so an admin does not see "not connected" on a cold load.
  if (window.BearChartAuth && window.BearChartAuth.onChange) {
    var photoQueueSeen = false;
    window.BearChartAuth.onChange(function (s) {
      if (s && s.signedIn && !photoQueueSeen) { photoQueueSeen = true; loadPhotoQueue(); }
    });
  }
})();
