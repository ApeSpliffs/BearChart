/* BearChart collector submissions.
 *
 * Two ways for a reader to put something back: a sold price they know about,
 * and a problem they have spotted on a page.
 *
 * Neither writes to the price guide. A submitted sale lands in a review queue
 * with status 'pending' and reaches a valuation only when a reviewer accepts
 * it and it is exported through the same importer every other comp goes
 * through. That is not caution for its own sake - the operator of this site
 * buys and sells the items it values, so a queue that fed straight into prices
 * would be an open invitation to talk a bear up before selling it.
 */
(function (root) {
  'use strict';

  var REASONS = [
    ['duplicate', 'This is a duplicate of another item'],
    ['wrong_year', 'The release year is wrong'],
    ['wrong_name', 'The name is wrong or misspelt'],
    ['wrong_species', 'The animal is wrong'],
    ['wrong_image', 'The picture is wrong'],
    ['bad_value', 'The value looks wrong'],
    ['not_a_real_item', 'This is not a real product'],
    ['other', 'Something else']
  ];

  function client() {
    var A = root.BearChartAuth;
    return A && A.configured() ? A.getClient() : null;
  }

  /**
   * Is this site set up to receive submissions?
   *
   * Deliberately asks whether accounts are CONFIGURED, not whether the client
   * library has finished loading. Keying it on the live client meant the forms
   * silently disappeared whenever the CDN was slow, blocked, or the visitor
   * was offline - the feature vanishing without explanation rather than saying
   * it cannot reach the server right now.
   */
  function configured() {
    var A = root.BearChartAuth;
    return !!(A && A.configured());
  }

  function signedIn() {
    var A = root.BearChartAuth;
    return !!(A && A.state().signedIn);
  }

  /** Turn a Postgres error into something a person can act on. */
  function explain(err) {
    var msg = (err && err.message) || 'Something went wrong.';
    if (/function .*(submit_comp|report_item)/i.test(msg) ||
        /schema cache/i.test(msg) || /does not exist/i.test(msg)) {
      return 'Submissions are not switched on for this site yet.';
    }
    if (/sign in/i.test(msg)) return 'Please sign in first.';
    if (/already have a pending/i.test(msg)) {
      return 'You already have a submission waiting for review on this item.';
    }
    if (/unknown item/i.test(msg)) return 'That item is not in the catalogue.';
    return msg;
  }

  function call(fn, entry) {
    var c = client();
    if (!c) {
      return Promise.resolve({
        ok: false,
        message: configured()
          ? 'Cannot reach the server right now. This needs a connection — try ' +
            'again when you are back online.'
          : 'Accounts are not switched on for this site.'
      });
    }
    return c.rpc(fn, { entry: entry }).then(function (res) {
      if (res && res.error) return { ok: false, message: explain(res.error) };
      return { ok: true, id: res && res.data };
    }).catch(function (err) {
      return { ok: false, message: explain(err) };
    });
  }

  /**
   * Submit a sold price. Requires an account: a reviewer needs somebody to ask
   * when a listing id does not check out, and an anonymous price is not
   * evidence, it is a rumour.
   */
  function submitComp(entry) {
    if (!signedIn()) {
      return Promise.resolve({ ok: false, message: 'Sign in to submit a sale.' });
    }
    var price = Number(entry.sold_price);
    if (!isFinite(price) || price <= 0) {
      return Promise.resolve({ ok: false, message: 'Enter the price it sold for.' });
    }
    if (!entry.marketplace) {
      return Promise.resolve({ ok: false, message: 'Where did it sell?' });
    }
    return call('submit_comp', {
      item_slug: entry.item_slug,
      sold_price: price.toFixed(2),
      sale_date: entry.sale_date || '',
      marketplace: entry.marketplace,
      listing_id: entry.listing_id || '',
      listing_url: entry.listing_url || '',
      condition: entry.condition || '',
      completeness: entry.completeness || '',
      claimed_type: entry.claimed_type || 'collector_report',
      note: entry.note || ''
    });
  }

  /** Report a problem. No account needed - see the note in the migration. */
  function reportItem(entry) {
    var known = REASONS.some(function (r) { return r[0] === entry.reason; });
    if (!known) {
      return Promise.resolve({ ok: false, message: 'Pick what is wrong.' });
    }
    return call('report_item', {
      item_slug: entry.item_slug,
      reason: entry.reason,
      note: entry.note || '',
      page_url: (root.location && root.location.href) || ''
    });
  }

  // ---- member photos --------------------------------------------------------
  // A signed-in member can send a photo for a bear that has none. It goes to a
  // private bucket and a review queue; only an approved copy is ever public.
  // The database enforces all of that (supabase_migration_03_photos.sql) -
  // these functions only make it pleasant to use.

  var PHOTO_CREDIT = 'Photo by a BearChart member';
  var PHOTO_MAX_SIDE = 1400;

  function authCfg() {
    return ((root.BEARCHART_DATA || {}).config || {}).auth || {};
  }

  /**
   * Approved member photos, read straight from the REST endpoint so a page
   * does not have to wait for the account library to load. Offline, blocked,
   * or under a test harness it quietly returns nothing.
   */
  function memberPhotos() {
    var cfg = authCfg();
    if (cfg.enabled === false || !cfg.supabase_url || !cfg.supabase_anon_key) {
      return Promise.resolve({});
    }
    if (typeof root.fetch !== 'function') return Promise.resolve({});
    if (root.navigator && /jsdom/i.test(root.navigator.userAgent || '')) {
      return Promise.resolve({});
    }
    var url = String(cfg.supabase_url).replace(/\/$/, '') +
      '/rest/v1/item_photos?select=item_slug,image_url,credit';
    return root.fetch(url, {
      headers: { apikey: cfg.supabase_anon_key, Authorization: 'Bearer ' + cfg.supabase_anon_key }
    }).then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var map = {};
        (rows || []).forEach(function (r) { if (r && r.item_slug) map[r.item_slug] = r; });
        return map;
      })
      .catch(function () { return {}; });
  }

  /** Put approved photos onto catalogue items that have none. Resolves to how many changed. */
  function applyMemberPhotos(items) {
    return memberPhotos().then(function (map) {
      var changed = 0;
      (items || []).forEach(function (item) {
        var p = map[item.id];
        if (!p || (item.image_url && String(item.image_url).trim())) return;
        if (!/^https:\/\//.test(p.image_url || '')) return;
        item.image_url = p.image_url;
        item.image_credit = p.credit || PHOTO_CREDIT;
        item.image_source = null;
        item.member_photo = true;
        changed++;
      });
      return changed;
    });
  }

  /** Shrink a phone photo before upload: smaller, faster, and EXIF-free. */
  function shrinkPhoto(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || '')) {
        reject(new Error('Choose a photo file (JPEG, PNG or WebP).'));
        return;
      }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('That photo could not be read. Try a JPEG or PNG.'));
        }, 'image/jpeg', 0.86);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('That file could not be opened as a photo. Try a JPEG or PNG.'));
      };
      img.src = url;
    });
  }

  function photoName() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  function explainPhoto(err) {
    var msg = (err && err.message) || 'Something went wrong.';
    if (/already has a photo/i.test(msg)) return 'This bear already has a photo.';
    if (/pending photo/i.test(msg)) return 'Your photo of this bear is already waiting for review.';
    if (/daily photo limit/i.test(msg)) return 'That is the most photos you can send today. Try again tomorrow.';
    if (/sign in/i.test(msg)) return 'Please sign in first.';
    if (/too large|exceeded|payload/i.test(msg)) return 'That photo is too big. Try a smaller one.';
    if (/bucket not found|does not exist|schema cache|submit_photo/i.test(msg)) {
      return 'Photo uploads are not switched on for this site yet.';
    }
    return msg;
  }

  /** Upload a photo of a bear for review. Resolves to {ok, message}. */
  function submitPhoto(itemSlug, file) {
    if (!signedIn()) return Promise.resolve({ ok: false, message: 'Sign in to add a photo.' });
    var c = client();
    if (!c) {
      return Promise.resolve({ ok: false, message: 'Cannot reach the server right now. ' +
        'Try again when you are back online.' });
    }
    var path = null;
    return shrinkPhoto(file).then(function (blob) {
      return c.auth.getUser().then(function (res) {
        var user = res && res.data && res.data.user;
        if (!user) throw new Error('sign in');
        path = user.id + '/' + photoName() + '.jpg';
        return c.storage.from('photo-submissions')
          .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      });
    }).then(function (up) {
      if (up && up.error) { path = null; throw up.error; }
      return c.rpc('submit_photo', { item: itemSlug, path: path });
    }).then(function (res) {
      if (res && res.error) throw res.error;
      return { ok: true, id: res && res.data };
    }).catch(function (err) {
      // Do not leave an orphaned upload behind if it could not be registered.
      if (path) { try { c.storage.from('photo-submissions').remove([path]); } catch (e) { /* ignore */ } }
      return { ok: false, message: explainPhoto(err) };
    });
  }

  root.BearChartSubmissions = {
    configured: configured,
    signedIn: signedIn,
    submitComp: submitComp,
    reportItem: reportItem,
    submitPhoto: submitPhoto,
    applyMemberPhotos: applyMemberPhotos,
    memberPhotos: memberPhotos,
    photoCredit: PHOTO_CREDIT,
    reasons: REASONS,
    reasonLabel: function (key) {
      var hit = REASONS.filter(function (r) { return r[0] === key; })[0];
      return hit ? hit[1] : key;
    }
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.BearChartSubmissions;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
