/*
 * BearChart membership entitlements.
 *
 * READ THIS BEFORE ADDING A GATE
 * ==============================
 * This file cannot enforce anything. BearChart ships as static files: every
 * value and every comp is published (the evidence behind a price is free), so
 * a check in this file is a hint to the interface, not a lock - anyone can flip
 * it from a devtools console in about four seconds.
 *
 * That is not a flaw to be patched, it is what a static site is. The conclusion
 * is that only SERVER work can be sold: storing your collection, generating and
 * keeping an evidence-backed schedule, sending a notification, spending API
 * quota. Each of those is refused by the database or an edge function without a
 * live subscription, whatever this file says.
 *
 * So: use can() to decide what to SHOW. Never use it to decide what is safe.
 * The membership config (tools/build_data.py) may not sell an entitlement
 * marked "ux"; tools/test_membership.py fails the build if one is.
 */
(function (root) {
  'use strict';

  // The membership block of site-config.js, through the one data-access module.
  var BD = root.BearChartData;
  var M = (BD && BD.hasConfig() ? BD.config().membership : null) || {};
  var PLANS = M.plans || {};
  var DEFS = M.entitlements || {};
  var ORDER = M.tiers_order || ['guest', 'free', 'pro', 'power'];
  // The plans page's copy (data/h/plans.<hash>.json, BearChartData.loadPlans):
  // the feature catalogue, who each tier is for, the coupon terms. Only the
  // plans page loads it; until useCopy() it falls back to whatever the
  // membership config itself carries (data.json in Node tests).
  var COPY = {
    features: M.features || [],
    who_for: {},
    coupon_terms: M.coupon_terms || '',
    hot_slot_note: M.hot_slot_note || ''
  };
  Object.keys(PLANS).forEach(function (id) { if (PLANS[id].who_for) COPY.who_for[id] = PLANS[id].who_for; });

  /** Install the plans page's copy (from BearChartData.loadPlans()). */
  function useCopy(copy) {
    if (!copy) return;
    if (Array.isArray(copy.features)) COPY.features = copy.features;
    if (copy.who_for) COPY.who_for = copy.who_for;
    if (copy.coupon_terms != null) COPY.coupon_terms = copy.coupon_terms;
    if (copy.hot_slot_note != null) COPY.hot_slot_note = copy.hot_slot_note;
  }

  function configured() {
    return !!(M.enabled && M.provider);
  }

  function rank(tier) {
    var i = ORDER.indexOf(tier);
    return i === -1 ? ORDER.length : i;
  }

  /**
   * Plans in tier order (tiers_order), for display - never by price, because
   * two tiers cost $0. guest is a display tier only: it is never sent to the
   * server and unlocks nothing a free account does not.
   */
  function plans() {
    return Object.keys(PLANS).map(function (id) {
      var p = PLANS[id];
      return {
        id: id,
        name: p.name,
        short: p.short || p.name,
        price_monthly: p.price_monthly,
        // Rendered only when the config sets one. None is set today.
        price_annual: typeof p.price_annual === 'number' ? p.price_annual : null,
        blurb: p.blurb,
        who_for: COPY.who_for[id] || p.who_for || p.audience || null,
        audience: p.audience || null,
        badge: p.badge || null,
        perk: p.perk || null,
        entitlements: p.entitlements || []
      };
    }).sort(function (a, b) {
      return rank(a.id) - rank(b.id) || a.price_monthly - b.price_monthly;
    });
  }

  /** The membership feature catalogue (tools/build_data.py FEATURES). */
  function features() { return COPY.features.slice(); }

  /** 'included' | 'soon' for a feature this tier gets (inherited from below), else null. */
  function featureStatusFor(tierId, featureId) {
    var f = COPY.features.filter(function (x) { return x.id === featureId; })[0];
    if (!f) return null;
    return rank(tierId) >= rank(f.from) ? f.status : null;
  }

  /**
   * What a plan card lists: the features that start at this tier, split into
   * what works today and what is on the way. Higher tiers inherit the rest
   * ("Everything in ..."). "On the way" is never sold and never ticked.
   */
  function featuresFor(tierId) {
    var own = COPY.features.filter(function (f) { return f.from === tierId; });
    return {
      included: own.filter(function (f) { return f.status === 'included'; }),
      soon: own.filter(function (f) { return f.status === 'soon'; })
    };
  }

  /** Every feature still on the way: derived from the catalogue, never a second list. */
  function onTheWay() {
    return COPY.features.filter(function (f) { return f.status === 'soon'; });
  }

  /**
   * A tier's member perk, or null. The ONLY accessor for perk copy: the plans
   * page, the FAQ and the contextual prompt all read it here, so the amounts
   * are written once (tools/build_data.py PLANS).
   */
  function perk(tierId) {
    return (PLANS[tierId] && PLANS[tierId].perk) || null;
  }

  /** The coupon rules that go with the perks. */
  function couponTerms() { return COPY.coupon_terms || ''; }

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
    // No account: the display tier "guest". It has no entitlements, so can()
    // answers exactly as it did for a signed-out "free".
    if (!session || !session.signedIn) return 'guest';
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

  /** "planned" for an entitlement defined but not built (never sold), else null. */
  function status(feature) {
    return (DEFS[feature] || {}).status || null;
  }

  /** Is an entitlement on the way rather than working today? */
  function soon(feature) {
    return COPY.features.some(function (f) { return f.entitlement === feature && f.status === 'soon'; });
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
    useCopy: useCopy,
    perk: perk,
    couponTerms: couponTerms,
    features: features,
    featureStatusFor: featureStatusFor,
    featuresFor: featuresFor,
    onTheWay: onTheWay,
    tiersOrder: function () { return ORDER.slice(); },
    status: status,
    soon: soon,
    plan: plan,
    currentTier: currentTier,
    can: can,
    requiredPlan: requiredPlan,
    enforcedAt: enforcedAt,
    label: label,
    lockMessage: lockMessage,
    hotSlots: M.hot_slots_total || 0,
    hotSlotNote: function () { return COPY.hot_slot_note || ''; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BearChartPlans;
})(typeof globalThis !== 'undefined' ? globalThis : this);
