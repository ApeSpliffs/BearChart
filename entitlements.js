/*
 * BearChart membership entitlements.
 *
 * READ THIS BEFORE ADDING A GATE
 * ==============================
 * This file cannot enforce anything. BearChart ships as static files, and
 * data.js - the entire catalogue and every comp - is downloaded by every
 * visitor. A check in this file is a hint to the interface, not a lock: anyone
 * can flip it from a devtools console in about four seconds.
 *
 * That is not a flaw to be patched, it is what a static site is. The conclusion
 * is that only SERVER work can be sold: storing your collection, generating and
 * keeping an evidence-backed schedule, sending a notification, spending API
 * quota. Each of those is refused by the database or an edge function without a
 * live subscription, whatever this file says.
 *
 * So: use can() to decide what to SHOW. Never use it to decide what is safe.
 * An entitlement marked "ux" here is one where enforcement is impossible or
 * pointless, and that is recorded honestly rather than papered over.
 */
(function (root) {
  'use strict';

  var DATA = root.BEARCHART_DATA || {};
  var M = DATA.membership || {};
  var PLANS = M.plans || {};
  var DEFS = M.entitlements || {};

  function configured() {
    return !!(M.enabled && M.provider);
  }

  /** Plans in price order, for display. */
  function plans() {
    return Object.keys(PLANS).map(function (id) {
      var p = PLANS[id];
      return {
        id: id,
        name: p.name,
        price_monthly: p.price_monthly,
        blurb: p.blurb,
        features: p.features || [],
        entitlements: p.entitlements || []
      };
    }).sort(function (a, b) { return a.price_monthly - b.price_monthly; });
  }

  function plan(id) {
    return PLANS[id] ? plans().filter(function (p) { return p.id === id; })[0] : null;
  }

  /**
   * The tier in force right now.
   *
   * With no payment provider configured, nothing is for sale, so everything that
   * can work locally does. Charging for a feature that is not yet purchasable -
   * or gating one while there is no way to buy the ungating - would just be a
   * broken site.
   */
  function currentTier(session) {
    if (!configured()) return 'unlimited_local';
    if (!session || !session.signedIn) return 'free';
    return session.tier || 'free';
  }

  /**
   * Should the interface offer this?
   *
   * Returns true when there is no membership system at all, because in that mode
   * the site is simply free and complete.
   */
  function can(feature, session) {
    var tier = currentTier(session);
    if (tier === 'unlimited_local') return true;
    var p = PLANS[tier];
    if (!p) return false;
    return (p.entitlements || []).indexOf(feature) !== -1;
  }

  /** The cheapest plan that includes a feature, for an upgrade prompt. */
  function requiredPlan(feature) {
    var found = null;
    plans().forEach(function (p) {
      if (!found && (p.entitlements || []).indexOf(feature) !== -1) found = p;
    });
    return found;
  }

  /** Where a feature is actually enforced: "server", "ux", or null if unknown. */
  function enforcedAt(feature) {
    return (DEFS[feature] || {}).enforced || null;
  }

  function label(feature) {
    return (DEFS[feature] || {}).label || feature;
  }

  /**
   * Copy for a locked feature. Says what it costs and, deliberately, that the
   * server is what refuses - so nobody is tempted to treat the hidden button as
   * the security boundary.
   */
  function lockMessage(feature, session) {
    if (can(feature, session)) return null;
    var need = requiredPlan(feature);
    if (!need) return { text: label(feature) + ' is not available.', plan: null };
    if (!session || !session.signedIn) {
      return {
        text: label(feature) + ' needs a ' + need.name + ' membership ($' +
              need.price_monthly + '/month) and an account.',
        plan: need
      };
    }
    return {
      text: label(feature) + ' is part of ' + need.name + ' ($' +
            need.price_monthly + '/month).',
      plan: need
    };
  }

  root.BearChartPlans = {
    configured: configured,
    plans: plans,
    plan: plan,
    currentTier: currentTier,
    can: can,
    requiredPlan: requiredPlan,
    enforcedAt: enforcedAt,
    label: label,
    lockMessage: lockMessage,
    hotSlots: M.hot_slots_total || 0,
    hotSlotNote: M.hot_slot_note || ''
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BearChartPlans;
})(typeof globalThis !== 'undefined' ? globalThis : this);
