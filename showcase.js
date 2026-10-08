/* Member showcases: Power members pick up to 12 bears to show the community.
   Reading is public. Writing goes through save_showcase(), which checks the
   membership on the server - this page only decides what to show. */
(function () {
  BC.renderChrome('showcase.html');
  var A = window.BearChartAuth;
  var $ = function (id) { return document.getElementById(id); };
  var esc = BC.esc;
  var handle = '';
  try { handle = (new URLSearchParams(location.search).get('u') || '').toLowerCase(); } catch (e) { /* old browser */ }
  var draft = { bears: [] };
  var MAX = 12;

  function client() { return A && A.configured && A.configured() ? A.getClient() : null; }

  function valueOf(id) {
    var v = BC.valuationFor(id);
    return v && v.has_value ? v.fair_market : null;
  }
  function totalOf(bears) {
    return (bears || []).reduce(function (a, id) { var v = valueOf(id); return a + (v || 0); }, 0);
  }

  function bearCard(id, removable) {
    var it = BC.itemById(id);
    if (!it) return '';
    var v = valueOf(id);
    return '<div class="sc-bear">' +
      '<a href="' + BC.itemUrl(id) + '">' + BC.imageHtml(it, 'thumb') + '</a>' +
      '<a class="sc-name" href="' + BC.itemUrl(id) + '">' + esc(it.canonical_name) + '</a>' +
      '<span class="fine">' + esc(String(it.release_year || 'Year unknown')) + '</span>' +
      '<span class="sc-val">' + (v != null ? BC.money(v) : 'No sold data yet') + '</span>' +
      (removable ? '<button type="button" class="link-btn" data-remove="' + esc(id) + '">Remove</button>' : '') +
      '</div>';
  }

  function renderOne(sc) {
    var bears = (sc.bears || []).filter(function (id) { return BC.itemById(id); });
    document.title = sc.display_name + "'s showcase - BearChart";
    $('sc-main').innerHTML =
      '<p class="fine" style="margin:0 0 10px"><a href="' + BC.rel('showcase.html') + '">&larr; All showcases</a></p>' +
      '<div class="panel">' +
        '<p class="sc-kicker">Power member showcase</p>' +
        '<h2 style="margin:4px 0 6px">' + esc(sc.display_name) + '</h2>' +
        '<p class="fine" style="margin:0">@' + esc(sc.handle) + '</p>' +
        (sc.bio ? '<p style="margin:12px 0 0">' + esc(sc.bio) + '</p>' : '') +
        '<div class="sc-stats"><div><strong>' + bears.length + '</strong><span>bears</span></div>' +
        '<div><strong>' + BC.money(totalOf(bears)) + '</strong><span>worth about</span></div></div>' +
      '</div>' +
      '<div class="panel">' + (bears.length
        ? '<div class="sc-grid">' + bears.map(function (id) { return bearCard(id, false); }).join('') + '</div>'
        : '<p class="fine">No bears picked yet.</p>') +
      '<p class="fine" style="margin-top:14px">Values are BearChart\'s current estimates from recorded sold prices.</p></div>';
  }

  function renderList(rows) {
    var sortBy = ($('sc-sort') && $('sc-sort').value) || 'new';
    rows = rows.slice();
    if (sortBy === 'value') rows.sort(function (a, b) { return totalOf(b.bears) - totalOf(a.bears); });
    var body = rows.length ? '<div class="sc-list">' + rows.map(function (sc) {
      var bears = (sc.bears || []).filter(function (id) { return BC.itemById(id); });
      return '<a class="sc-card" href="' + BC.rel('showcase.html') + '?u=' + encodeURIComponent(sc.handle) + '">' +
        '<div class="sc-thumbs">' + bears.slice(0, 4).map(function (id) { return BC.imageHtml(BC.itemById(id), 'thumb'); }).join('') + '</div>' +
        '<strong>' + esc(sc.display_name) + '</strong>' +
        '<span class="fine">' + bears.length + ' bear' + (bears.length === 1 ? '' : 's') + ' &middot; worth about ' + BC.money(totalOf(bears)) + '</span>' +
        '</a>';
    }).join('') + '</div>'
      : '<p class="fine">No showcases yet. Power members can be the first to share their top bears.</p>';
    $('sc-list-body').innerHTML = body;
  }

  var listRows = [];
  function load() {
    var c = client();
    if (!c) { $('sc-main').innerHTML = '<div class="panel"><p class="fine">Showcases need accounts, which are not switched on here.</p></div>'; return; }
    if (handle) {
      $('sc-list-panel').hidden = true;
      c.from('showcases').select('handle,display_name,bio,bears,updated_at').eq('handle', handle).maybeSingle()
        .then(function (r) {
          if (r.error || !r.data) {
            $('sc-main').innerHTML = '<div class="panel"><h2>Showcase not found</h2><p class="fine">It may be private or the name may be wrong. ' +
              '<a href="' + BC.rel('showcase.html') + '">See all showcases</a>.</p></div>';
            return;
          }
          renderOne(r.data);
        });
      return;
    }
    c.from('showcases').select('handle,display_name,bio,bears,updated_at')
      .eq('is_public', true).eq('hidden_by_admin', false)
      .order('updated_at', { ascending: false }).limit(60)
      .then(function (r) {
        listRows = r.data || [];
        renderList(listRows);
      });
  }

  // --- your showcase -------------------------------------------------------

  function chips() {
    $('sc-picked').innerHTML = draft.bears.length
      ? '<div class="sc-grid">' + draft.bears.map(function (id) { return bearCard(id, true); }).join('') + '</div>'
      : '<p class="fine">No bears picked yet. Search above and press Add.</p>';
    $('sc-count').textContent = draft.bears.length + ' of ' + MAX;
  }

  function renderEditor() {
    var box = $('sc-edit');
    if (!box || handle) return;
    var c = client();
    if (!c) { box.hidden = true; return; }
    var s = A.state();
    if (!s.signedIn) {
      box.innerHTML = '<h2>Show off your top bears</h2>' +
        '<p>Power members get a public page with up to 12 of their favourite bears and what they are worth.</p>' +
        '<p><a class="btn btn-primary" href="' + BC.rel('account.html') + '">Sign in</a> ' +
        '<a class="btn" href="' + BC.rel('plans.html') + '">See Power membership</a></p>';
      return;
    }
    box.innerHTML = '<h2>Your showcase</h2>' +
      '<p class="fine">Pick up to ' + MAX + ' bears. Your email is never shown. A Power membership is needed to save.</p>' +
      '<div class="row">' +
        '<div class="field"><label for="sc-handle">Page name</label><input id="sc-handle" maxlength="24" placeholder="e.g. teddyfan"></div>' +
        '<div class="field"><label for="sc-name">Display name</label><input id="sc-name" maxlength="40"></div>' +
      '</div>' +
      '<div class="field"><label for="sc-bio">One-line bio (optional)</label><input id="sc-bio" maxlength="160"></div>' +
      '<div class="field"><label for="sc-find">Add a bear</label>' +
        '<div class="sc-add"><input id="sc-find" list="sc-names" placeholder="Type a bear\'s name">' +
        '<button type="button" id="sc-add-btn">Add</button></div>' +
        '<datalist id="sc-names">' + BC.data.items.map(function (i) { return '<option value="' + esc(i.canonical_name) + '">'; }).join('') + '</datalist></div>' +
      '<p class="fine">Picked: <span id="sc-count"></span></p>' +
      '<div id="sc-picked"></div>' +
      '<label class="sc-public"><input type="checkbox" id="sc-public"> Show my showcase publicly</label>' +
      '<p><button type="button" class="primary" id="sc-save">Save showcase</button> <span id="sc-msg" class="fine"></span></p>';
    chips();
    c.from('showcases').select('handle,display_name,bio,bears,is_public,hidden_by_admin').eq('user_id', s.user.id).maybeSingle()
      .then(function (r) {
        if (!r.data) return;
        $('sc-handle').value = r.data.handle; $('sc-name').value = r.data.display_name;
        $('sc-bio').value = r.data.bio || ''; $('sc-public').checked = !!r.data.is_public;
        draft.bears = (r.data.bears || []).filter(function (id) { return BC.itemById(id); });
        chips();
        if (r.data.hidden_by_admin) $('sc-msg').textContent = 'Your showcase has been hidden by an admin.';
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
      var id = e.target && e.target.getAttribute('data-remove');
      if (!id) return;
      draft.bears = draft.bears.filter(function (b) { return b !== id; }); chips();
    });
    $('sc-save').addEventListener('click', function () {
      $('sc-msg').textContent = 'Saving\u2026';
      c.rpc('save_showcase', {
        p_handle: $('sc-handle').value, p_name: $('sc-name').value, p_bio: $('sc-bio').value,
        p_bears: draft.bears, p_public: $('sc-public').checked
      }).then(function (r) {
        if (r.error) {
          var m = String(r.error.message || 'Could not save.');
          $('sc-msg').innerHTML = /power/i.test(m)
            ? 'Showcases are part of <a href="' + BC.rel('plans.html') + '">Power membership</a>.'
            : esc(m);
          return;
        }
        $('sc-msg').innerHTML = 'Saved. <a href="' + BC.rel('showcase.html') + '?u=' + encodeURIComponent(r.data) + '">View your showcase</a>';
        if (window.bcTrack) window.bcTrack('showcase_saved', { bears: draft.bears.length, public: $('sc-public').checked });
        load();
      });
    });
  }

  if ($('sc-sort')) $('sc-sort').addEventListener('change', function () { renderList(listRows); });
  // auth.js loads the account service asynchronously; wait for it before
  // asking for showcases, or the page wrongly reports accounts as switched off.
  function start() { load(); renderEditor(); }
  if (A && A.ready && typeof A.ready.then === 'function') A.ready.then(start, start);
  else start();
  if (A && A.onChange) A.onChange(function () { renderEditor(); });
})();
