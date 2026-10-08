/* Member showcases: Power members pick up to 12 bears, add their own photo and
   a note to each, choose a colour, and share the page with other members.
   Browsing needs a free account. Saving goes through save_showcase() and
   photos through the showcase-photos bucket, both of which check the
   membership on the server - this page only decides what to show. */
(function () {
  BC.renderChrome('showcase.html');
  var A = window.BearChartAuth;
  var $ = function (id) { return document.getElementById(id); };
  var esc = BC.esc;
  var handle = '';
  try { handle = (new URLSearchParams(location.search).get('u') || '').toLowerCase(); } catch (e) { /* old browser */ }
  var MAX = 12;
  var NOTE_MAX = 80;
  var BUCKET = 'showcase-photos';
  var THEMES = [
    ['rose', 'Rose'], ['honey', 'Honey'], ['mint', 'Mint'],
    ['sky', 'Sky'], ['plum', 'Plum'], ['night', 'Night']
  ];
  var draft = { bears: [], details: {}, theme: 'rose' };
  var photoUrls = {};   // storage path -> short-lived link
  var canShare = null;  // null until the server has said

  function client() { return A && A.configured && A.configured() ? A.getClient() : null; }
  function signedIn() { return !!(A && A.configured && A.configured() && A.state().signedIn); }

  function valueOf(id) {
    var v = BC.valuationFor(id);
    return v && v.has_value ? v.fair_market : null;
  }
  function totalOf(bears) {
    return (bears || []).reduce(function (a, id) { var v = valueOf(id); return a + (v || 0); }, 0);
  }
  function themeOf(t) {
    return THEMES.some(function (x) { return x[0] === t; }) ? t : 'rose';
  }
  function known(bears) {
    return (bears || []).filter(function (id) { return BC.itemById(id); });
  }

  // Short-lived links for members' own photos (the bucket is private).
  function signPhotos(paths) {
    var c = client();
    var need = paths.filter(function (p) { return p && !photoUrls[p]; });
    if (!c || !need.length) return Promise.resolve();
    return c.storage.from(BUCKET).createSignedUrls(need, 3600).then(function (r) {
      (r && r.data || []).forEach(function (x) { if (x && x.signedUrl) photoUrls[x.path] = x.signedUrl; });
    }).catch(function () { /* fall back to catalogue pictures */ });
  }
  function photoPaths(rows) {
    var out = [];
    rows.forEach(function (sc) {
      var d = sc.details || {};
      Object.keys(d).forEach(function (k) { if (d[k] && d[k].photo) out.push(d[k].photo); });
    });
    return out;
  }
  function picture(id, details, cls) {
    var it = BC.itemById(id);
    var d = (details || {})[id] || {};
    if (d.photo && photoUrls[d.photo]) {
      return '<img class="' + (cls || 'thumb') + '" src="' + esc(photoUrls[d.photo]) +
        '" alt="' + esc(it.canonical_name) + ' - member photo" loading="lazy">';
    }
    return BC.imageHtml(it, cls || 'thumb');
  }

  // --- one showcase ---------------------------------------------------------

  function bearTile(id, details, featured) {
    var it = BC.itemById(id);
    var v = valueOf(id);
    var d = (details || {})[id] || {};
    return '<article class="sc-tile' + (featured ? ' is-featured' : '') + '">' +
      '<a class="sc-pic" href="' + BC.itemUrl(id) + '">' + picture(id, details, featured ? 'hero' : 'thumb') +
        (d.photo ? '<span class="sc-own">Their photo</span>' : '') + '</a>' +
      '<div class="sc-body">' +
        (featured ? '<p class="sc-kicker">Pride of the collection</p>' : '') +
        '<a class="sc-name" href="' + BC.itemUrl(id) + '">' + esc(it.canonical_name) + '</a>' +
        '<span class="fine">' + esc(String(it.release_year || 'Year unknown')) + '</span>' +
        (d.note ? '<p class="sc-note">&ldquo;' + esc(d.note) + '&rdquo;</p>' : '') +
        BC.tagsHtml(it) +
        '<span class="sc-val">' + (v != null ? BC.money(v) : '<span class="fine">No sold data yet</span>') + '</span>' +
      '</div>' +
    '</article>';
  }

  function renderOne(sc) {
    var bears = known(sc.bears);
    var details = sc.details || {};
    var theme = themeOf(sc.theme);
    var top = bears.slice().sort(function (a, b) { return (valueOf(b) || 0) - (valueOf(a) || 0); })[0];
    document.title = sc.display_name + "'s showcase - BearChart";
    $('sc-main').innerHTML =
      '<p class="fine" style="margin:0 0 10px"><a href="' + BC.rel('showcase.html') + '">&larr; All showcases</a></p>' +
      '<section class="sc-hero theme-' + theme + '">' +
        '<div class="sc-avatar" aria-hidden="true">' + esc((sc.display_name || '?').charAt(0).toUpperCase()) + '</div>' +
        '<div>' +
          '<p class="sc-kicker">Power member showcase</p>' +
          '<h2>' + esc(sc.display_name) + '</h2>' +
          '<p class="sc-handle">@' + esc(sc.handle) + '</p>' +
          (sc.bio ? '<p class="sc-bio">' + esc(sc.bio) + '</p>' : '') +
        '</div>' +
        '<div class="sc-stats">' +
          '<div><strong>' + bears.length + '</strong><span>bears</span></div>' +
          '<div><strong>' + BC.money(totalOf(bears)) + '</strong><span>worth about</span></div>' +
          (top && valueOf(top) ? '<div><strong>' + BC.money(valueOf(top)) + '</strong><span>top bear</span></div>' : '') +
        '</div>' +
      '</section>' +
      (bears.length
        ? bearTile(bears[0], details, true) +
          (bears.length > 1 ? '<div class="sc-grid">' + bears.slice(1).map(function (id) { return bearTile(id, details, false); }).join('') + '</div>' : '')
        : '<div class="panel"><p class="fine">No bears picked yet.</p></div>') +
      '<p class="fine" style="margin-top:14px">Values are BearChart\'s current estimates from recorded sold prices. ' +
        'Photos marked &ldquo;Their photo&rdquo; were taken by this member.</p>';
  }

  // --- all showcases --------------------------------------------------------

  function renderList(rows) {
    var sortBy = ($('sc-sort') && $('sc-sort').value) || 'new';
    rows = rows.slice();
    if (sortBy === 'value') rows.sort(function (a, b) { return totalOf(b.bears) - totalOf(a.bears); });
    $('sc-list-body').innerHTML = rows.length ? '<div class="sc-list">' + rows.map(function (sc) {
      var bears = known(sc.bears);
      return '<a class="sc-card theme-' + themeOf(sc.theme) + '" href="' + BC.rel('showcase.html') + '?u=' + encodeURIComponent(sc.handle) + '">' +
        '<div class="sc-thumbs">' + bears.slice(0, 4).map(function (id) { return picture(id, sc.details, 'thumb'); }).join('') + '</div>' +
        '<strong>' + esc(sc.display_name) + '</strong>' +
        '<span class="fine">' + bears.length + ' bear' + (bears.length === 1 ? '' : 's') + ' &middot; worth about ' + BC.money(totalOf(bears)) + '</span>' +
        '</a>';
    }).join('') + '</div>'
      : '<p class="fine">No showcases yet. Power members can be the first to share their top bears.</p>';
  }

  var listRows = [];
  var COLS = 'handle,display_name,bio,bears,details,theme,updated_at';
  function load() {
    var c = client();
    if (!c) {
      $('sc-list-panel').hidden = true;
      $('sc-main').innerHTML = '<div class="panel"><p class="fine">Could not reach the account service. ' +
        'Check your connection and refresh the page.</p></div>';
      return;
    }
    // Showcases are for members: anyone with a free account can browse them,
    // and only Power members can share one.
    if (!signedIn()) {
      $('sc-list-panel').hidden = true;
      $('sc-main').innerHTML = '<div class="panel"><h2>Member showcases</h2>' +
        '<p>See the top bears BearChart members are proudest of, in their own photos, and what they are worth. ' +
        'Showcases are for members &mdash; make a free account to browse them.</p>' +
        '<p class="fine">Power members can also share a showcase of their own.</p>' +
        '<p><a class="btn btn-primary" href="' + BC.rel('account.html') + '">Sign in or create a free account</a> ' +
        '<a class="btn" href="' + BC.rel('plans.html') + '">See Power membership</a></p></div>';
      return;
    }
    $('sc-main').innerHTML = '';
    if (handle) {
      $('sc-list-panel').hidden = true;
      c.from('showcases').select(COLS).eq('handle', handle).maybeSingle().then(function (r) {
        if (r.error || !r.data) {
          $('sc-main').innerHTML = '<div class="panel"><h2>Showcase not found</h2><p class="fine">It may be private or the name may be wrong. ' +
            '<a href="' + BC.rel('showcase.html') + '">See all showcases</a>.</p></div>';
          return;
        }
        signPhotos(photoPaths([r.data])).then(function () { renderOne(r.data); });
      });
      return;
    }
    $('sc-list-panel').hidden = false;
    c.from('showcases').select(COLS)
      .eq('is_public', true).eq('hidden_by_admin', false)
      .order('updated_at', { ascending: false }).limit(60)
      .then(function (r) {
        listRows = r.data || [];
        renderList(listRows);
        signPhotos(photoPaths(listRows)).then(function () { renderList(listRows); });
      });
  }

  // --- your showcase --------------------------------------------------------

  function editorTile(id, i) {
    var it = BC.itemById(id);
    var d = draft.details[id] || {};
    return '<div class="sc-edit-tile">' +
      '<div class="sc-edit-pic">' + picture(id, draft.details, 'thumb') +
        (i === 0 ? '<span class="sc-own">Featured</span>' : '') + '</div>' +
      '<div class="sc-edit-body">' +
        '<strong>' + esc(it.canonical_name) + '</strong>' +
        '<label class="sc-photo-btn btn">' + (d.photo ? 'Change photo' : 'Add your photo') +
          '<input type="file" accept="image/*" data-photo="' + esc(id) + '" hidden></label>' +
        (d.photo ? ' <button type="button" class="link-btn" data-unphoto="' + esc(id) + '">Use the catalogue picture</button>' : '') +
        '<input class="sc-note-in" data-note="' + esc(id) + '" maxlength="' + NOTE_MAX + '" ' +
          'placeholder="A note, e.g. where you found it" value="' + esc(d.note || '') + '">' +
        '<div class="sc-edit-actions">' +
          '<button type="button" class="link-btn" data-move="' + esc(id) + '" data-dir="-1"' + (i === 0 ? ' disabled' : '') + '>&uarr; Up</button>' +
          '<button type="button" class="link-btn" data-move="' + esc(id) + '" data-dir="1"' + (i === draft.bears.length - 1 ? ' disabled' : '') + '>&darr; Down</button>' +
          '<button type="button" class="link-btn" data-remove="' + esc(id) + '">Remove</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function chips() {
    $('sc-picked').innerHTML = draft.bears.length
      ? '<div class="sc-edit-grid">' + draft.bears.map(editorTile).join('') + '</div>'
      : '<p class="fine">No bears picked yet. Search above and press Add.</p>';
    $('sc-count').textContent = draft.bears.length + ' of ' + MAX;
  }

  function themePicker() {
    return '<div class="field"><span class="label">Colour</span><div class="sc-themes" role="radiogroup" aria-label="Showcase colour">' +
      THEMES.map(function (t) {
        return '<button type="button" role="radio" class="sc-swatch theme-' + t[0] + '" data-theme="' + t[0] + '" ' +
          'aria-checked="' + (draft.theme === t[0]) + '" title="' + t[1] + '"><span class="sr-only">' + t[1] + '</span></button>';
      }).join('') + '</div></div>';
  }

  function paintThemes() {
    Array.prototype.forEach.call(document.querySelectorAll('.sc-swatch'), function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-theme') === draft.theme));
    });
  }

  function uploadPhoto(id, file) {
    var c = client();
    var msg = $('sc-msg');
    var S = window.BearChartSubmissions;
    if (!c || !S || !S.shrinkPhoto) { msg.textContent = 'Photo uploads are not available right now.'; return; }
    msg.textContent = 'Uploading photo\u2026';
    var path = null;
    S.shrinkPhoto(file).then(function (blob) {
      var uid = A.state().user && A.state().user.id;
      if (!uid) throw new Error('Please sign in first.');
      path = uid + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + '.jpg';
      return c.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    }).then(function (r) {
      if (r && r.error) throw r.error;
      var old = (draft.details[id] || {}).photo;
      draft.details[id] = Object.assign({}, draft.details[id], { photo: path });
      if (old) c.storage.from(BUCKET).remove([old]).then(function () {}, function () {});
      return signPhotos([path]);
    }).then(function () {
      msg.textContent = 'Photo added. Press Save showcase to keep it.';
      chips();
    }).catch(function (err) {
      var m = String((err && err.message) || err || 'Could not upload that photo.');
      msg.innerHTML = /row-level|policy|unauthori[sz]ed|403/i.test(m)
        ? 'Photos are part of <a href="' + BC.rel('plans.html') + '">Power membership</a>.'
        : /too large|exceed|payload/i.test(m) ? 'That photo is too big. Try a smaller one.' : esc(m);
    });
  }

  function upsell() {
    return '<h2>Share your own showcase</h2>' +
      '<p>Power members get a showcase page with up to ' + MAX + ' of their favourite bears &mdash; ' +
      'in their own photos, with a note on each, a featured bear and their own colour &mdash; ' +
      'shared with every BearChart member.</p>' +
      '<p><a class="btn btn-primary" href="' + BC.rel('plans.html') + '">See Power membership</a></p>';
  }

  function renderEditor() {
    var box = $('sc-edit');
    if (!box) return;
    var c = client();
    if (handle || !c || !signedIn()) { box.hidden = true; return; }
    box.hidden = false;
    if (canShare === false) { box.innerHTML = upsell(); return; }
    if (canShare === null) {
      box.innerHTML = '<p class="fine">Loading your showcase\u2026</p>';
      Promise.all([
        c.rpc('has_entitlement', { feature: 'showcase' }).then(function (r) { return !!(r && r.data); }, function () { return false; }),
        c.rpc('is_admin').then(function (r) { return !!(r && r.data); }, function () { return false; })
      ]).then(function (res) { canShare = res[0] || res[1]; renderEditor(); });
      return;
    }
    box.innerHTML = '<h2>Your showcase</h2>' +
      '<p class="fine">Pick up to ' + MAX + ' bears and add your own photos. The first bear is your featured bear. Your email is never shown.</p>' +
      '<div class="row">' +
        '<div class="field"><label for="sc-handle">Page name</label><input id="sc-handle" maxlength="24" placeholder="e.g. teddyfan"></div>' +
        '<div class="field"><label for="sc-name">Display name</label><input id="sc-name" maxlength="40"></div>' +
      '</div>' +
      '<div class="field"><label for="sc-bio">One-line bio (optional)</label><input id="sc-bio" maxlength="160"></div>' +
      themePicker() +
      '<div class="field"><label for="sc-find">Add a bear</label>' +
        '<div class="sc-add"><input id="sc-find" list="sc-names" placeholder="Type a bear\'s name">' +
        '<button type="button" id="sc-add-btn">Add</button></div>' +
        '<datalist id="sc-names">' + BC.data.items.map(function (i) { return '<option value="' + esc(i.canonical_name) + '">'; }).join('') + '</datalist></div>' +
      '<p class="fine">Picked: <span id="sc-count"></span></p>' +
      '<div id="sc-picked"></div>' +
      '<label class="sc-public"><input type="checkbox" id="sc-public"> Show my showcase to other members</label>' +
      '<p class="fine">Only add photos you took yourself (see the <a href="' + BC.rel('terms.html') + '">terms</a>).</p>' +
      '<p><button type="button" class="primary" id="sc-save">Save showcase</button> <span id="sc-msg" class="fine" role="status"></span></p>';
    chips();
    c.from('showcases').select('handle,display_name,bio,bears,details,theme,is_public,hidden_by_admin')
      .eq('user_id', A.state().user.id).maybeSingle()
      .then(function (r) {
        if (!r.data) return;
        $('sc-handle').value = r.data.handle; $('sc-name').value = r.data.display_name;
        $('sc-bio').value = r.data.bio || ''; $('sc-public').checked = !!r.data.is_public;
        draft.bears = known(r.data.bears);
        draft.details = r.data.details || {};
        draft.theme = themeOf(r.data.theme);
        paintThemes();
        signPhotos(photoPaths([r.data])).then(chips);
        if (r.data.hidden_by_admin) $('sc-msg').textContent = 'Your showcase has been hidden by an admin.';
      });
    box.querySelector('.sc-themes').addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-theme]');
      if (!t) return;
      draft.theme = t.getAttribute('data-theme');
      paintThemes();
    });
    $('sc-add-btn').addEventListener('click', function () {
      var name = $('sc-find').value.trim().toLowerCase();
      var it = BC.data.items.filter(function (i) { return i.canonical_name.toLowerCase() === name; })[0];
      if (!it) { $('sc-msg').textContent = 'Pick a bear from the list.'; return; }
      if (draft.bears.indexOf(it.id) >= 0) { $('sc-msg').textContent = 'Already added.'; return; }
      if (draft.bears.length >= MAX) { $('sc-msg').textContent = 'You can show up to ' + MAX + ' bears.'; return; }
      draft.bears.push(it.id); $('sc-find').value = ''; $('sc-msg').textContent = ''; chips();
    });
    $('sc-picked').addEventListener('click', function (e) {
      var t = e.target;
      var id = t.getAttribute && (t.getAttribute('data-remove') || t.getAttribute('data-move') || t.getAttribute('data-unphoto'));
      if (!id) return;
      if (t.hasAttribute('data-remove')) {
        draft.bears = draft.bears.filter(function (b) { return b !== id; });
      } else if (t.hasAttribute('data-move')) {
        var i = draft.bears.indexOf(id), j = i + Number(t.getAttribute('data-dir'));
        if (j < 0 || j >= draft.bears.length) return;
        draft.bears.splice(i, 1); draft.bears.splice(j, 0, id);
      } else if (t.hasAttribute('data-unphoto')) {
        draft.details[id] = Object.assign({}, draft.details[id]); delete draft.details[id].photo;
      }
      chips();
    });
    $('sc-picked').addEventListener('change', function (e) {
      var id = e.target.getAttribute && e.target.getAttribute('data-photo');
      if (id && e.target.files && e.target.files[0]) uploadPhoto(id, e.target.files[0]);
    });
    $('sc-picked').addEventListener('input', function (e) {
      var id = e.target.getAttribute && e.target.getAttribute('data-note');
      if (!id) return;
      draft.details[id] = Object.assign({}, draft.details[id], { note: e.target.value.slice(0, NOTE_MAX) });
    });
    $('sc-save').addEventListener('click', function () {
      $('sc-msg').textContent = 'Saving\u2026';
      var details = {};
      draft.bears.forEach(function (id) {
        var d = draft.details[id];
        if (d && (d.photo || (d.note && d.note.trim()))) details[id] = { photo: d.photo || null, note: (d.note || '').trim() || null };
      });
      c.rpc('save_showcase', {
        p_handle: $('sc-handle').value, p_name: $('sc-name').value, p_bio: $('sc-bio').value,
        p_bears: draft.bears, p_public: $('sc-public').checked, p_details: details, p_theme: draft.theme
      }).then(function (r) {
        if (r.error) {
          var m = String(r.error.message || 'Could not save.');
          $('sc-msg').innerHTML = /power/i.test(m)
            ? 'Showcases are part of <a href="' + BC.rel('plans.html') + '">Power membership</a>.'
            : esc(m);
          return;
        }
        $('sc-msg').innerHTML = 'Saved. <a href="' + BC.rel('showcase.html') + '?u=' + encodeURIComponent(r.data) + '">View your showcase</a>';
        if (window.bcTrack) window.bcTrack('showcase_saved', { bears: draft.bears.length, photos: Object.keys(details).filter(function (k) { return details[k].photo; }).length });
        load();
      });
    });
  }

  if ($('sc-sort')) $('sc-sort').addEventListener('change', function () { renderList(listRows); });
  // auth.js loads the account service asynchronously. Draw once it is ready,
  // then again only when who is signed in actually changes - not on routine
  // token refreshes, which would throw away an edit in progress.
  var lastUser;
  function currentUser() {
    var s = A && A.configured && A.configured() ? A.state() : null;
    return s && s.signedIn && s.user ? s.user.id : '';
  }
  function draw() {
    var uid = currentUser();
    if (uid === lastUser) return;
    lastUser = uid;
    canShare = null;
    load();
    renderEditor();
  }
  if (A && A.ready && typeof A.ready.then === 'function') A.ready.then(draw, draw);
  else draw();
  if (A && A.onChange) A.onChange(draw);
})();
