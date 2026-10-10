/* BearChart roadmap: what is built, what is planned, and what is not possible.
   Status is derived from the codebase where it can be, so this page cannot
   quietly claim something is shipped after it has been removed. */
(function () {
  'use strict';

  var D = BC.data, E = BC.engine;
  var $ = function (id) { return document.getElementById(id); };

  BC.renderChrome('roadmap.html');

  // Features are marked shipped by a live capability check rather than a hand
  // edit, so this page stays honest without anyone maintaining it.
  var CAPS = {
    lowerBound: typeof E.lowerBound === 'function',
    madOutliers: typeof E.madOutliers === 'function',
    snapshots: typeof E.collectionSnapshot === 'function',
    twr: typeof E.windowStats === 'function',
    deals: typeof E.findDeals === 'function',
    auth: !!(D.config.auth),
    activeListings: !!(D.active_listings || []).length,
    firstParty: D.sales.some(function (s) { return s.first_party; })
  };

  var PHASES = {
    p2: [
      ['shipped', 'Condition and completeness multipliers',
       'Every comp is normalised to one baseline before comparison, so a NWT sale ' +
       'never quietly sets the price of a played-with copy.', CAPS.madOutliers],
      ['shipped', 'Robust outlier rejection',
       'Median absolute deviation with a modified z-score, applied only once there ' +
       'are five or more comps. Tukey fences were replaced because quartiles of six ' +
       'skewed prices are mostly noise.', CAPS.madOutliers],
      ['shipped', 'Conservative valuation floor',
       'A bootstrapped lower bound alongside the median. The thinner the evidence, ' +
       'the further the floor sits below the middle.', CAPS.lowerBound],
      ['shipped', 'Portfolio history',
       'Daily snapshots of what a collection is worth, with market movement ' +
       'separated from what you bought and sold.', CAPS.snapshots && CAPS.twr],
      ['next', 'Insurance and audit export',
       'A schedule an adjuster will accept: replacement cost and actual cash value ' +
       'per line, the evidence trail behind each figure, and the confidence stated ' +
       'plainly. A valuation without its evidence is worth less in a claim than a ' +
       'shoebox of receipts.'],
      ['next', 'Empirically estimated multipliers',
       'Replace the fixed 1.25-for-NWT style constants with premiums measured from ' +
       'the data, shrunk toward a category prior so two sales cannot imply a 3x ' +
       'premium.'],
      ['blocked', 'Continuous sold-price ingestion',
       'Needs an API that is closed to non-partners. Sold comps arrive by import ' +
       'or by hand until that changes.']
    ],
    p3: [
      ['shipped', 'Deal finder',
       'Live asking prices judged against the conservative floor, after your fees ' +
       'and shipping. A gross discount is not profit.', CAPS.deals],
      ['shipped', 'Ask-versus-sold spread',
       'What sellers want against what things actually fetch, shown on every item ' +
       'page that has both.', CAPS.deals],
      ['next', 'Scheduled polling',
       'A shared query pool on a heat schedule. One person watching an item and a ' +
       'thousand people watching it cost the same quota, which is the only way this ' +
       'works at more than three users.'],
      ['next', 'Alert delivery',
       'Push and email digests, with quiet hours and a volume ceiling. One ' +
       'noisy night trains someone to mute the app permanently.'],
      ['next', 'Outfit assembly',
       'Group clothing, shoes and accessories onto a specific bear and value the ' +
       'whole. Comps are already normalised to bare, so the parts add up without ' +
       'double-counting.'],
      ['constrained', 'Sub-60-second detection',
       'Possible, but not across the whole catalogue. A default API key affords ' +
       'roughly three continuously-polled queries for the entire site, so only the ' +
       'most-watched items get a 60-second slot.']
    ],
    p4: [
      ['shipped', 'Accounts',
       'Real sessions against a server, or none at all. No pretend sign-in flag in ' +
       'the browser.', CAPS.auth],
      ['shipped', 'Collector checklists',
       'Sets derived from the catalogue itself, so they grow as it does.', true],
      ['next', 'Public showcases',
       'Private by default, values hidden by default, with a band option that shows ' +
       'an item sits in the $100-250 range without publishing a figure. A public ' +
       'page itemising a valuable collection is a targeting document, so the ' +
       'defaults have to assume an accidental publish.'],
      ['next', 'Affiliate tracking',
       'Click and conversion attribution. The identifier decorates an outbound link ' +
       'and nothing else - it may never influence a valuation or a ranking.'],
      ['next', 'Most Wanted trend reports',
       'Quarterly demand signal from wishlist data, published only above a minimum ' +
       'number of users so a report cannot identify one person, and lagged so the ' +
       'report does not move the market it measures.']
    ]
  };

  var NEVER = [
    ['Scraping marketplaces',
     'Against their terms, and against section 34 of the original brief. The ' +
     'catalogue was built from permitted sources and stays that way.'],
    ['Estimating a price with no comps',
     '574 of 642 items have no sold data. They say so. An estimate with nothing ' +
     'behind it is a guess wearing a number.'],
    ['Turning retail into resale',
     'Current shop price caps what the secondary market bears; it is not the same ' +
     'figure and never becomes one.'],
    ['Stock photography',
     'A stock teddy on a 2001 Kennel Pals Calico Cat is a picture of a different ' +
     'object. Identification is the point, so a wrong photo is worse than none.'],
    ['Calling any of this an appraisal',
     'A regulated word in several places. Valuation report or inventory schedule ' +
     'carries the same weight without the exposure.']
  ];

  var LABEL = {
    shipped: ['Built', 'ship'],
    next: ['Planned', 'plan'],
    constrained: ['Limited', 'limited'],
    blocked: ['Not possible', 'blocked']
  };

  function row(entry) {
    var state = entry[0];
    // A "shipped" claim is only rendered as built if the capability is actually
    // present; otherwise it drops back to planned rather than lying.
    if (state === 'shipped' && entry.length > 3 && !entry[3]) state = 'next';
    var meta = LABEL[state];
    return '<div class="road-row">' +
      '<span class="road-tag ' + meta[1] + '">' + meta[0] + '</span>' +
      '<div><strong>' + BC.esc(entry[1]) + '</strong>' +
      '<p class="fine">' + BC.esc(entry[2]) + '</p></div></div>';
  }

  Object.keys(PHASES).forEach(function (id) {
    $(id).innerHTML = PHASES[id].map(row).join('');
  });

  $('never').innerHTML = NEVER.map(function (n) {
    return '<div class="road-row">' +
      '<span class="road-tag blocked">Never</span>' +
      '<div><strong>' + BC.esc(n[0]) + '</strong>' +
      '<p class="fine">' + BC.esc(n[1]) + '</p></div></div>';
  }).join('');

  // Progress is counted, not asserted.
  var all = [].concat(PHASES.p2, PHASES.p3, PHASES.p4);
  var built = all.filter(function (e) {
    return e[0] === 'shipped' && (e.length <= 3 || e[3]);
  }).length;
  var blocked = all.filter(function (e) {
    return e[0] === 'blocked' || e[0] === 'constrained';
  }).length;

  $('phase-stats').innerHTML = [
    [built + ' / ' + all.length, 'Capabilities built'],
    [all.length - built - blocked, 'Planned next'],
    [blocked, 'Limited by data access'],
    [BC.catalogueStats().items, 'Items catalogued'],
    [BC.catalogueStats().sold_transactions, 'Sold transactions recorded']
  ].map(function (c) {
    return '<div class="stat"><div class="v">' + BC.esc(c[0]) + '</div><div class="k">' +
           BC.esc(c[1]) + '</div></div>';
  }).join('');
})();
