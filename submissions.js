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

  root.BearChartSubmissions = {
    configured: configured,
    signedIn: signedIn,
    submitComp: submitComp,
    reportItem: reportItem,
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
