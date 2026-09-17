/*
 * Render every item illustration to a single PNG so they can be reviewed by eye.
 *
 *   npm run icons:sheet            -> icon-sheet.png
 *   node tools/icon_sheet.js out.png
 *
 * Drawing icons blind is how you end up with a dragon that looks like a pig.
 * Run this after touching icons.js and actually look at the result.
 *
 * Needs the optional devDependency `sharp`. Nothing else in the project uses it,
 * and the test suite does not require it.
 */
'use strict';

let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('This tool needs sharp:  npm install --save-dev sharp');
  process.exit(1);
}

const I = require('../icons.js');

const out = process.argv[2] || 'icon-sheet.png';
const COLS = 6, W = 260, H = 200;
const keys = I.keys;
const rows = Math.ceil(keys.length / COLS);

const cells = keys.map((k, n) => {
  const x = (n % COLS) * W, y = Math.floor(n / COLS) * H;
  const hue = 18 + (n * 7) % 34;
  return `<g transform="translate(${x},${y})">` +
    `<rect width="${W}" height="${H}" fill="hsl(${hue},30%,90%)" stroke="#ddd"/>` +
    `<g transform="translate(${W / 2 - 110},18) scale(0.55)">` +
    I.draw(k, `hsl(${hue},34%,46%)`, `hsl(${hue},32%,82%)`) +
    `</g><text x="${W / 2}" y="${H - 12}" text-anchor="middle" font-size="15" ` +
    `font-family="sans-serif" fill="#444">${k}</text></g>`;
}).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${COLS * W}" ` +
  `height="${rows * H}" viewBox="0 0 ${COLS * W} ${rows * H}">` +
  `<rect width="100%" height="100%" fill="#fff"/>${cells}</svg>`;

sharp(Buffer.from(svg)).png().toFile(out)
  .then(() => console.log(`wrote ${out} (${keys.length} illustrations)`))
  .catch((e) => { console.error(e.message); process.exit(1); });
