/*
 * Colour contrast of the design tokens (WCAG 2.x relative luminance), light
 * and dark. Pure Node, no DOM: it parses the token blocks out of styles.css,
 * so a token edit that breaks a text pair fails here before anyone squints.
 *
 *   node --test tools/test_contrast.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

/** The declarations inside the first block whose selector matches `selector`. */
function block(selector) {
  const at = CSS.indexOf(selector + ' {');
  assert.ok(at !== -1, 'no block ' + selector);
  const open = CSS.indexOf('{', at);
  const close = CSS.indexOf('}', open);
  return CSS.slice(open + 1, close);
}

function raw(body) {
  const out = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** Light tokens, or dark = light overridden by the dark block, with aliases resolved after. */
function tokens(body, baseBody) {
  const out = Object.assign({}, baseBody ? raw(baseBody) : {}, raw(body));
  // Resolve var() aliases.
  for (let pass = 0; pass < 5; pass++) {
    for (const k of Object.keys(out)) {
      const v = /^var\(--([a-z0-9-]+)\)$/.exec(out[k]);
      if (v && out[v[1]]) out[k] = out[v[1]];
    }
  }
  return out;
}

function rgb(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  assert.ok(m, 'not a hex colour: ' + hex);
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function lum(hex) {
  const [r, g, b] = rgb(hex).map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const LIGHT = tokens(block(':root'));
const DARK_BODY = block(':root[data-theme="dark"]');
const DARK = tokens(DARK_BODY, block(':root'));

// Every token used as text, on every ground it is used on.
const TEXT = ['ink', 'ink-soft', 'ink-faint', 'crimson', 'crimson-deep', 'brand-red-text',
  'berry-text', 'green', 'amber', 'sky-text', 'red', 'slate',
  'conf-high', 'conf-medium', 'conf-low', 'conf-very-low'];
const GROUNDS = ['paper', 'paper-2', 'card'];
// Text that also sits on the brand wash (notices, the upsell, the waitlist).
const ON_WASH = ['ink', 'ink-soft', 'ink-faint', 'crimson', 'crimson-deep'];

for (const [name, T] of [['light', LIGHT], ['dark', DARK]]) {
  test(name + ': every text token passes 4.5:1 on every ground', () => {
    const fails = [];
    for (const fg of TEXT) {
      for (const bg of GROUNDS) {
        const r = ratio(T[fg], T[bg]);
        if (r < 4.5) fails.push(fg + ' on ' + bg + ' = ' + r.toFixed(2));
      }
    }
    for (const fg of ON_WASH) {
      const r = ratio(T[fg], T['brand-red-wash']);
      if (r < 4.5) fails.push(fg + ' on brand-red-wash = ' + r.toFixed(2));
    }
    assert.deepStrictEqual(fails, []);
  });

  test(name + ': button text and the focus ring', () => {
    assert.ok(ratio(T['on-brand'], T['brand-red-deep']) >= 4.5,
      'button text ' + ratio(T['on-brand'], T['brand-red-deep']).toFixed(2));
    for (const bg of GROUNDS) {
      assert.ok(ratio(T['focus-ring'], T[bg]) >= 3, 'focus ring on ' + bg);
    }
  });
}

test('the old faint ink failed, and the new one is what ships', () => {
  assert.ok(ratio('#8a7175', '#fff6f2') < 4.5);
  assert.strictEqual(LIGHT['ink-faint'], '#75595d');
});

test('--accent is defined, and the legacy names still resolve', () => {
  assert.match(block(':root'), /--accent:\s*#/);
  for (const legacy of ['honey', 'honey-deep', 'honey-wash', 'brown', 'brown-deep']) {
    assert.match(LIGHT[legacy], /^#/, legacy);
  }
  assert.strictEqual(LIGHT.honey, LIGHT['brand-red']);
  assert.strictEqual(LIGHT['brown-deep'], LIGHT['crimson-deep']);
});

test('dark mode is the same tokens whether the device or the picker asks for it', () => {
  const media = /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/.exec(CSS);
  assert.ok(media, 'the device-dark block');
  const norm = (b) => b.replace(/\s+/g, ' ').trim();
  assert.strictEqual(norm(media[1]), norm(DARK_BODY));
  assert.match(DARK_BODY, /color-scheme:\s*dark/);
});

test('no outline:none anywhere', () => {
  assert.doesNotMatch(CSS, /outline:\s*none/);
});

/** The declarations of the rule whose selector list starts with `selector`. */
function rule(selector) {
  const at = CSS.indexOf('\n' + selector);
  assert.ok(at !== -1, 'no rule ' + selector);
  return CSS.slice(CSS.indexOf('{', at) + 1, CSS.indexOf('}', at));
}

for (const [name, T] of [['light', LIGHT], ['dark', DARK]]) {
  test(name + ': every stop of every primary-button background, hover included, passes with its text', () => {
    for (const stop of ['btn-top', 'btn-bottom', 'btn-hover']) {
      const r = ratio(T['on-brand'], T[stop]);
      assert.ok(r >= 4.5, stop + ' ' + T[stop] + ' = ' + r.toFixed(2));
    }
    // Filled badges and chips with light text.
    assert.ok(ratio(T['on-brand'], T['brand-red-deep']) >= 4.5, 'plan badge / step');
    assert.ok(ratio(T['paper-2'], T['crimson-deep']) >= 4.5, 'nav pill / Power tag');
  });
}

test('the primary button paints only from the checked stops', () => {
  const base = rule('.btn-primary, button.primary {');
  const hover = rule('.btn-primary:hover, button.primary:hover {');
  const bg = (body) => (/background:\s*([^;]+);/.exec(body) || [])[1];
  assert.strictEqual(bg(base), 'linear-gradient(180deg, var(--btn-top) 0%, var(--btn-bottom) 100%)');
  assert.strictEqual(bg(hover), 'var(--btn-hover)');
  assert.match(base, /color:\s*var\(--on-brand\)/);
});

test('[hidden] beats every display rule', () => {
  assert.match(CSS, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});
