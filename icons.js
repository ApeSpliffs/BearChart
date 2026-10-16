/*
 * Plush Price Guide item illustrations.
 *
 * No item in this database ships with a photograph — official Build-A-Bear
 * product imagery is copyrighted and there is no lawful bulk source for photos
 * of specific vintage items. Rather than leave 298 empty frames, every item
 * draws a species illustration derived from what the catalogue actually knows
 * about it.
 *
 * These are DRAWINGS, not photos, and the UI labels them as such. An
 * illustration of a bear on a bear record tells the truth; a stock photo of
 * somebody else's teddy on a 2001 Kennel Pals Calico Cat would not.
 *
 * Everything here is plain geometry so it renders identically everywhere, costs
 * no network request, and stays sharp at any size.
 */
(function (root) {
  'use strict';

  // Each icon returns SVG elements drawn around (200, 148) on a 400x300 canvas.
  // fg is the main ink, ac a lighter accent, hl the highlight used for bellies.
  var ICONS = {

    // Added when the catalogue grew past 2,000 items and the wiki's species
    // vocabulary arrived with it. Before these, 43 deer, 33 horses and 23
    // koalas were drawn as a generic paw, an elephant, or - worst - a unicorn,
    // complete with horn.

    horse: function (fg, ac) {
      return '<polygon points="166,96 170,48 192,86" fill="' + fg + '"/>' +
             '<polygon points="234,96 230,48 208,86" fill="' + fg + '"/>' +
             '<ellipse cx="200" cy="146" rx="50" ry="58" fill="' + fg + '"/>' +
             '<ellipse cx="200" cy="196" rx="34" ry="30" fill="' + ac + '"/>' +
             '<ellipse cx="188" cy="196" rx="6" ry="8" fill="' + fg + '"/>' +
             '<ellipse cx="212" cy="196" rx="6" ry="8" fill="' + fg + '"/>' +
             '<circle cx="178" cy="132" r="7" fill="' + ac + '"/>' +
             '<circle cx="222" cy="132" r="7" fill="' + ac + '"/>' +
             '<path d="M168 104 q-26 22 -18 58" stroke="' + ac +
             '" stroke-width="13" fill="none" stroke-linecap="round"/>';
    },

    deer: function (fg, ac) {
      return '<path d="M182 104 L172 58 M172 58 L154 48 M172 58 L180 34" stroke="' + fg +
             '" stroke-width="9" fill="none" stroke-linecap="round"/>' +
             '<path d="M218 104 L228 58 M228 58 L246 48 M228 58 L220 34" stroke="' + fg +
             '" stroke-width="9" fill="none" stroke-linecap="round"/>' +
             '<ellipse cx="156" cy="130" rx="20" ry="12" fill="' + fg +
             '" transform="rotate(-22 156 130)"/>' +
             '<ellipse cx="244" cy="130" rx="20" ry="12" fill="' + fg +
             '" transform="rotate(22 244 130)"/>' +
             '<ellipse cx="200" cy="156" rx="44" ry="52" fill="' + fg + '"/>' +
             '<ellipse cx="200" cy="194" rx="26" ry="23" fill="' + ac + '"/>' +
             '<ellipse cx="200" cy="186" rx="11" ry="8" fill="' + fg + '"/>' +
             '<circle cx="182" cy="142" r="7" fill="' + ac + '"/>' +
             '<circle cx="218" cy="142" r="7" fill="' + ac + '"/>';
    },

    koala: function (fg, ac) {
      return '<circle cx="144" cy="116" r="36" fill="' + fg + '"/>' +
             '<circle cx="256" cy="116" r="36" fill="' + fg + '"/>' +
             '<circle cx="144" cy="116" r="21" fill="' + ac + '"/>' +
             '<circle cx="256" cy="116" r="21" fill="' + ac + '"/>' +
             '<circle cx="200" cy="162" r="60" fill="' + fg + '"/>' +
             '<ellipse cx="200" cy="176" rx="19" ry="27" fill="' + ac + '"/>' +
             '<circle cx="176" cy="142" r="8" fill="' + ac + '"/>' +
             '<circle cx="224" cy="142" r="8" fill="' + ac + '"/>';
    },

    sheep: function (fg, ac) {
      return '<circle cx="158" cy="112" r="34" fill="' + ac + '"/>' +
             '<circle cx="200" cy="96" r="38" fill="' + ac + '"/>' +
             '<circle cx="242" cy="112" r="34" fill="' + ac + '"/>' +
             '<circle cx="140" cy="146" r="26" fill="' + ac + '"/>' +
             '<circle cx="260" cy="146" r="26" fill="' + ac + '"/>' +
             '<ellipse cx="152" cy="156" rx="19" ry="11" fill="' + fg +
             '" transform="rotate(-18 152 156)"/>' +
             '<ellipse cx="248" cy="156" rx="19" ry="11" fill="' + fg +
             '" transform="rotate(18 248 156)"/>' +
             '<ellipse cx="200" cy="172" rx="38" ry="44" fill="' + fg + '"/>' +
             '<circle cx="184" cy="162" r="7" fill="' + ac + '"/>' +
             '<circle cx="216" cy="162" r="7" fill="' + ac + '"/>' +
             '<ellipse cx="200" cy="198" rx="12" ry="8" fill="' + ac + '"/>';
    },

    giraffe: function (fg, ac) {
      return '<rect x="172" y="58" width="9" height="40" rx="4" fill="' + fg + '"/>' +
             '<rect x="219" y="58" width="9" height="40" rx="4" fill="' + fg + '"/>' +
             '<circle cx="176" cy="56" r="11" fill="' + fg + '"/>' +
             '<circle cx="224" cy="56" r="11" fill="' + fg + '"/>' +
             '<ellipse cx="148" cy="124" rx="21" ry="12" fill="' + fg +
             '" transform="rotate(-20 148 124)"/>' +
             '<ellipse cx="252" cy="124" rx="21" ry="12" fill="' + fg +
             '" transform="rotate(20 252 124)"/>' +
             '<ellipse cx="200" cy="152" rx="42" ry="50" fill="' + fg + '"/>' +
             '<circle cx="180" cy="126" r="9" fill="' + ac + '" opacity=".55"/>' +
             '<circle cx="222" cy="122" r="7" fill="' + ac + '" opacity=".55"/>' +
             '<ellipse cx="200" cy="190" rx="27" ry="24" fill="' + ac + '"/>' +
             '<ellipse cx="190" cy="188" rx="5" ry="7" fill="' + fg + '"/>' +
             '<ellipse cx="210" cy="188" rx="5" ry="7" fill="' + fg + '"/>' +
             '<circle cx="181" cy="146" r="7" fill="' + ac + '"/>' +
             '<circle cx="219" cy="146" r="7" fill="' + ac + '"/>';
    },

    bear: function (fg, ac) {
      return '<circle cx="152" cy="98" r="26" fill="' + fg + '"/>' +
             '<circle cx="248" cy="98" r="26" fill="' + fg + '"/>' +
             '<circle cx="152" cy="98" r="13" fill="' + ac + '"/>' +
             '<circle cx="248" cy="98" r="13" fill="' + ac + '"/>' +
             '<circle cx="200" cy="152" r="66" fill="' + fg + '"/>' +
             '<ellipse cx="200" cy="180" rx="32" ry="25" fill="' + ac + '"/>' +
             '<ellipse cx="200" cy="166" rx="12" ry="9" fill="' + fg + '"/>' +
             '<circle cx="176" cy="138" r="7" fill="' + ac + '"/>' +
             '<circle cx="224" cy="138" r="7" fill="' + ac + '"/>';
    },

    cat: function (fg, ac) {
      return '<polygon points="144,116 150,54 196,90" fill="' + fg + '"/>' +
             '<polygon points="256,116 250,54 204,90" fill="' + fg + '"/>' +
             '<polygon points="152,108 156,74 182,96" fill="' + ac + '"/>' +
             '<polygon points="248,108 244,74 218,96" fill="' + ac + '"/>' +
             '<circle cx="200" cy="152" r="62" fill="' + fg + '"/>' +
             '<ellipse cx="200" cy="176" rx="26" ry="18" fill="' + ac + '"/>' +
             '<polygon points="200,164 192,172 208,172" fill="' + fg + '"/>' +
             '<ellipse cx="176" cy="140" rx="7" ry="9" fill="' + ac + '"/>' +
             '<ellipse cx="224" cy="140" rx="7" ry="9" fill="' + ac + '"/>' +
             '<path d="M148 168 L118 160 M148 178 L118 180" stroke="' + ac +
             '" stroke-width="3" stroke-linecap="round" fill="none"/>' +
             '<path d="M252 168 L282 160 M252 178 L282 180" stroke="' + ac +
             '" stroke-width="3" stroke-linecap="round" fill="none"/>';
    },

    dog: function (fg, ac) {
      return '<ellipse cx="140" cy="148" rx="22" ry="46" fill="' + fg + '"/>' +
             '<ellipse cx="260" cy="148" rx="22" ry="46" fill="' + fg + '"/>' +
             '<circle cx="200" cy="146" r="60" fill="' + fg + '"/>' +
             '<ellipse cx="200" cy="180" rx="34" ry="24" fill="' + ac + '"/>' +
             '<ellipse cx="200" cy="166" rx="13" ry="10" fill="' + fg + '"/>' +
             '<circle cx="178" cy="132" r="7" fill="' + ac + '"/>' +
             '<circle cx="222" cy="132" r="7" fill="' + ac + '"/>' +
             '<path d="M200 190 v10" stroke="' + fg + '" stroke-width="4"/>';
    },

    bunny: function (fg, ac) {
      return '<ellipse cx="174" cy="72" rx="18" ry="52" fill="' + fg + '"/>' +
             '<ellipse cx="226" cy="72" rx="18" ry="52" fill="' + fg + '"/>' +
             '<ellipse cx="174" cy="76" rx="8" ry="38" fill="' + ac + '"/>' +
             '<ellipse cx="226" cy="76" rx="8" ry="38" fill="' + ac + '"/>' +
             '<circle cx="200" cy="168" r="58" fill="' + fg + '"/>' +
             '<ellipse cx="200" cy="188" rx="24" ry="17" fill="' + ac + '"/>' +
             '<ellipse cx="200" cy="178" rx="9" ry="7" fill="' + fg + '"/>' +
             '<circle cx="178" cy="156" r="7" fill="' + ac + '"/>' +
             '<circle cx="222" cy="156" r="7" fill="' + ac + '"/>';
    },

    mouse: function (fg, ac) {
      return '<circle cx="150" cy="106" r="34" fill="' + fg + '"/>' +
             '<circle cx="250" cy="106" r="34" fill="' + fg + '"/>' +
             '<circle cx="150" cy="106" r="19" fill="' + ac + '"/>' +
             '<circle cx="250" cy="106" r="19" fill="' + ac + '"/>' +
             '<circle cx="200" cy="160" r="56" fill="' + fg + '"/>' +
             '<ellipse cx="200" cy="184" rx="20" ry="14" fill="' + ac + '"/>' +
             '<circle cx="200" cy="180" r="7" fill="' + fg + '"/>' +
             '<circle cx="180" cy="150" r="6" fill="' + ac + '"/>' +
             '<circle cx="220" cy="150" r="6" fill="' + ac + '"/>';
    },

    dino: function (fg, ac) {
      return '<polygon points="162,120 174,66 190,120" fill="' + fg + '"/>' +
             '<polygon points="184,112 200,52 216,112" fill="' + fg + '"/>' +
             '<polygon points="210,120 226,66 238,120" fill="' + fg + '"/>' +
             '<ellipse cx="200" cy="166" rx="70" ry="60" fill="' + fg + '"/>' +
             '<circle cx="174" cy="150" r="10" fill="' + ac + '"/>' +
             '<circle cx="226" cy="150" r="10" fill="' + ac + '"/>' +
             '<circle cx="174" cy="152" r="4" fill="' + fg + '"/>' +
             '<circle cx="226" cy="152" r="4" fill="' + fg + '"/>' +
             '<path d="M156 186 q44 34 88 0 z" fill="' + ac + '"/>' +
             '<polygon points="166,190 172,204 178,190" fill="' + fg + '"/>' +
             '<polygon points="186,194 192,210 198,194" fill="' + fg + '"/>' +
             '<polygon points="206,194 212,210 218,194" fill="' + fg + '"/>' +
             '<polygon points="224,190 230,204 236,190" fill="' + fg + '"/>';
    },

    dragon: function (fg, ac) {
      return '<path d="M144 148 q-58 -46 -50 -84 q40 20 58 58 z" fill="' + ac + '"/>' +
             '<path d="M256 148 q58 -46 50 -84 q-40 20 -58 58 z" fill="' + ac + '"/>' +
             '<path d="M170 108 q-14 -40 -44 -52 q34 2 60 38 z" fill="' + fg + '"/>' +
             '<path d="M230 108 q14 -40 44 -52 q-34 2 -60 38 z" fill="' + fg + '"/>' +
             '<path d="M200 100 q58 6 58 62 q0 44 -58 60 q-58 -16 -58 -60 ' +
             'q0 -56 58 -62 z" fill="' + fg + '"/>' +
             '<ellipse cx="178" cy="150" rx="9" ry="12" fill="' + ac + '"/>' +
             '<ellipse cx="222" cy="150" rx="9" ry="12" fill="' + ac + '"/>' +
             '<circle cx="178" cy="152" r="4" fill="' + fg + '"/>' +
             '<circle cx="222" cy="152" r="4" fill="' + fg + '"/>' +
             '<polygon points="184,196 190,214 196,196" fill="' + ac + '"/>' +
             '<polygon points="204,196 210,214 216,196" fill="' + ac + '"/>';
    },

    unicorn: function (fg, ac) {
      return '<polygon points="214,44 232,116 196,116" fill="' + ac + '"/>' +
             '<polygon points="238,116 246,72 268,106" fill="' + fg + '"/>' +
             '<path d="M262 118 q42 26 40 76 q-2 44 -34 60 q14 -46 -6 -76 ' +
             'q-16 -24 -34 -30 z" fill="' + ac + '"/>' +
             '<path d="M236 108 q40 10 44 56 q4 48 -12 74 l-46 6 ' +
             'q-16 -30 -46 -40 q-40 -14 -60 -12 q-14 -22 10 -34 ' +
             'q34 -16 74 -14 q22 -14 36 -36 z" fill="' + fg + '"/>' +
             '<circle cx="242" cy="152" r="8" fill="' + ac + '"/>' +
             '<ellipse cx="122" cy="176" rx="7" ry="5" fill="' + ac + '"/>' +
             '<path d="M112 194 q26 10 50 4" stroke="' + ac + '" stroke-width="4" ' +
             'fill="none" stroke-linecap="round"/>';
    },

    bird: function (fg, ac) {
      return '<circle cx="200" cy="156" r="62" fill="' + fg + '"/>' +
             '<path d="M212 132 q44 14 40 52 q-30 16 -50 -14 z" fill="' + ac + '"/>' +
             '<polygon points="142,146 96,162 142,178" fill="' + ac + '"/>' +
             '<circle cx="174" cy="132" r="9" fill="' + ac + '"/>' +
             '<circle cx="174" cy="132" r="4" fill="' + fg + '"/>' +
             '<path d="M182 216 v14 M218 216 v14" stroke="' + fg + '" ' +
             'stroke-width="6" stroke-linecap="round"/>' +
             '<path d="M172 230 h20 M208 230 h20" stroke="' + fg + '" ' +
             'stroke-width="6" stroke-linecap="round"/>';
    },

    // Round body, two pointed ears, and scalloped wings (three arcs a side)
    // whose membrane takes the accent colour.
    bat: function (fg, ac) {
      return '<path d="M176 132 L84 104 Q100 138 86 170 Q108 156 122 178 Q136 158 152 182 ' +
             'Q156 160 176 164 Z" fill="' + ac + '" stroke="' + fg + '" stroke-width="5" ' +
             'stroke-linejoin="round"/>' +
             '<path d="M224 132 L316 104 Q300 138 314 170 Q292 156 278 178 Q264 158 248 182 ' +
             'Q244 160 224 164 Z" fill="' + ac + '" stroke="' + fg + '" stroke-width="5" ' +
             'stroke-linejoin="round"/>' +
             '<polygon points="172,112 178,72 196,104" fill="' + fg + '"/>' +
             '<polygon points="228,112 222,72 204,104" fill="' + fg + '"/>' +
             '<circle cx="200" cy="148" r="42" fill="' + fg + '"/>' +
             '<circle cx="186" cy="136" r="7" fill="' + ac + '"/>' +
             '<circle cx="214" cy="136" r="7" fill="' + ac + '"/>' +
             '<path d="M192 162 l4 8 l4 -8 M200 162 l4 8 l4 -8" stroke="' + ac + '" ' +
             'stroke-width="3" fill="none" stroke-linejoin="round"/>';
    },

    penguin: function (fg, ac) {
      return '<ellipse cx="200" cy="152" rx="58" ry="70" fill="' + fg + '"/>' +
             '<ellipse cx="200" cy="166" rx="34" ry="50" fill="' + ac + '"/>' +
             '<circle cx="184" cy="118" r="7" fill="' + ac + '"/>' +
             '<circle cx="216" cy="118" r="7" fill="' + ac + '"/>' +
             '<polygon points="200,128 214,140 186,140" fill="' + fg + '"/>' +
             '<ellipse cx="182" cy="228" rx="20" ry="9" fill="' + ac + '"/>' +
             '<ellipse cx="218" cy="228" rx="20" ry="9" fill="' + ac + '"/>';
    },

    frog: function (fg, ac) {
      return '<circle cx="166" cy="108" r="28" fill="' + fg + '"/>' +
             '<circle cx="234" cy="108" r="28" fill="' + fg + '"/>' +
             '<circle cx="166" cy="106" r="13" fill="' + ac + '"/>' +
             '<circle cx="234" cy="106" r="13" fill="' + ac + '"/>' +
             '<ellipse cx="200" cy="166" rx="72" ry="52" fill="' + fg + '"/>' +
             '<path d="M164 178 q36 26 72 0" stroke="' + ac + '" stroke-width="5" ' +
             'fill="none" stroke-linecap="round"/>';
    },

    axolotl: function (fg, ac) {
      return '<path d="M144 128 q-40 -22 -50 -4 q22 4 30 22 q-24 2 -30 20 ' +
             'q26 6 36 22 q-20 12 -18 30 q26 -8 40 -2 z" fill="' + ac + '"/>' +
             '<path d="M256 128 q40 -22 50 -4 q-22 4 -30 22 q24 2 30 20 ' +
             'q-26 6 -36 22 q20 12 18 30 q-26 -8 -40 -2 z" fill="' + ac + '"/>' +
             '<ellipse cx="200" cy="160" rx="62" ry="54" fill="' + fg + '"/>' +
             '<circle cx="178" cy="146" r="8" fill="' + ac + '"/>' +
             '<circle cx="222" cy="146" r="8" fill="' + ac + '"/>' +
             '<path d="M178 180 q22 18 44 0" stroke="' + ac + '" stroke-width="5" ' +
             'fill="none" stroke-linecap="round"/>';
    },

    pig: function (fg, ac) {
      return '<polygon points="150,112 158,66 194,96" fill="' + fg + '"/>' +
             '<polygon points="250,112 242,66 206,96" fill="' + fg + '"/>' +
             '<circle cx="200" cy="156" r="62" fill="' + fg + '"/>' +
             '<ellipse cx="200" cy="178" rx="30" ry="23" fill="' + ac + '"/>' +
             '<ellipse cx="190" cy="178" rx="6" ry="9" fill="' + fg + '"/>' +
             '<ellipse cx="210" cy="178" rx="6" ry="9" fill="' + fg + '"/>' +
             '<circle cx="176" cy="140" r="7" fill="' + ac + '"/>' +
             '<circle cx="224" cy="140" r="7" fill="' + ac + '"/>';
    },

    cow: function (fg, ac) {
      return '<path d="M142 108 q-26 -18 -10 -38 q22 8 26 32 z" fill="' + ac + '"/>' +
             '<path d="M258 108 q26 -18 10 -38 q-22 8 -26 32 z" fill="' + ac + '"/>' +
             '<ellipse cx="200" cy="150" rx="64" ry="58" fill="' + fg + '"/>' +
             '<ellipse cx="200" cy="184" rx="34" ry="24" fill="' + ac + '"/>' +
             '<ellipse cx="188" cy="184" rx="5" ry="7" fill="' + fg + '"/>' +
             '<ellipse cx="212" cy="184" rx="5" ry="7" fill="' + fg + '"/>' +
             '<circle cx="176" cy="134" r="7" fill="' + ac + '"/>' +
             '<circle cx="224" cy="134" r="7" fill="' + ac + '"/>' +
             '<ellipse cx="160" cy="108" rx="16" ry="11" fill="' + ac + '"/>';
    },

    elephant: function (fg, ac) {
      return '<ellipse cx="132" cy="140" rx="34" ry="46" fill="' + ac + '"/>' +
             '<ellipse cx="268" cy="140" rx="34" ry="46" fill="' + ac + '"/>' +
             '<circle cx="200" cy="146" r="58" fill="' + fg + '"/>' +
             '<path d="M200 188 q-8 34 12 46 q16 8 20 -8" stroke="' + fg +
             '" stroke-width="20" fill="none" stroke-linecap="round"/>' +
             '<circle cx="178" cy="134" r="7" fill="' + ac + '"/>' +
             '<circle cx="222" cy="134" r="7" fill="' + ac + '"/>';
    },

    monkey: function (fg, ac) {
      return '<circle cx="142" cy="146" r="26" fill="' + fg + '"/>' +
             '<circle cx="258" cy="146" r="26" fill="' + fg + '"/>' +
             '<circle cx="142" cy="146" r="13" fill="' + ac + '"/>' +
             '<circle cx="258" cy="146" r="13" fill="' + ac + '"/>' +
             '<circle cx="200" cy="150" r="60" fill="' + fg + '"/>' +
             '<ellipse cx="200" cy="168" rx="40" ry="32" fill="' + ac + '"/>' +
             '<circle cx="184" cy="140" r="7" fill="' + fg + '"/>' +
             '<circle cx="216" cy="140" r="7" fill="' + fg + '"/>' +
             '<path d="M184 178 q16 12 32 0" stroke="' + fg + '" stroke-width="4" ' +
             'fill="none" stroke-linecap="round"/>';
    },

    butterfly: function (fg, ac) {
      return '<ellipse cx="148" cy="120" rx="44" ry="36" fill="' + fg + '"/>' +
             '<ellipse cx="252" cy="120" rx="44" ry="36" fill="' + fg + '"/>' +
             '<ellipse cx="158" cy="188" rx="36" ry="30" fill="' + ac + '"/>' +
             '<ellipse cx="242" cy="188" rx="36" ry="30" fill="' + ac + '"/>' +
             '<ellipse cx="200" cy="152" rx="11" ry="56" fill="' + fg + '"/>' +
             '<path d="M194 100 q-14 -22 -26 -28 M206 100 q14 -22 26 -28" stroke="' + fg +
             '" stroke-width="4" fill="none" stroke-linecap="round"/>';
    },

    spider: function (fg, ac) {
      return '<path d="M156 152 q-34 -18 -46 -44 M150 172 q-40 -6 -54 -22 ' +
             'M150 192 q-40 10 -50 32 M158 208 q-30 22 -34 44" stroke="' + fg +
             '" stroke-width="7" fill="none" stroke-linecap="round"/>' +
             '<path d="M244 152 q34 -18 46 -44 M250 172 q40 -6 54 -22 ' +
             'M250 192 q40 10 50 32 M242 208 q30 22 34 44" stroke="' + fg +
             '" stroke-width="7" fill="none" stroke-linecap="round"/>' +
             '<ellipse cx="200" cy="188" rx="56" ry="50" fill="' + fg + '"/>' +
             '<circle cx="200" cy="126" r="38" fill="' + fg + '"/>' +
             '<circle cx="186" cy="118" r="9" fill="' + ac + '"/>' +
             '<circle cx="214" cy="118" r="9" fill="' + ac + '"/>' +
             '<circle cx="176" cy="136" r="5" fill="' + ac + '"/>' +
             '<circle cx="224" cy="136" r="5" fill="' + ac + '"/>';
    },

    fish: function (fg, ac) {
      return '<polygon points="292,150 336,116 336,184" fill="' + ac + '"/>' +
             '<ellipse cx="196" cy="150" rx="94" ry="52" fill="' + fg + '"/>' +
             '<circle cx="144" cy="138" r="9" fill="' + ac + '"/>' +
             '<path d="M196 106 q14 -26 34 -20 M196 194 q14 26 34 20" fill="' + ac + '"/>' +
             '<path d="M232 118 q12 32 0 64" stroke="' + ac + '" stroke-width="4" ' +
             'fill="none"/>';
    },

    character: function (fg, ac) {
      return '<circle cx="200" cy="150" r="66" fill="' + fg + '"/>' +
             '<circle cx="178" cy="138" r="9" fill="' + ac + '"/>' +
             '<circle cx="222" cy="138" r="9" fill="' + ac + '"/>' +
             '<path d="M172 176 q28 24 56 0" stroke="' + ac + '" stroke-width="6" ' +
             'fill="none" stroke-linecap="round"/>' +
             '<polygon points="300,74 308,98 332,106 308,114 300,138 292,114 268,106 292,98" ' +
             'fill="' + ac + '"/>';
    },

    vehicle: function (fg, ac) {
      return '<rect x="112" y="118" width="176" height="70" rx="26" fill="' + fg + '"/>' +
             '<rect x="146" y="92" width="108" height="42" rx="18" fill="' + ac + '"/>' +
             '<circle cx="154" cy="196" r="26" fill="' + fg + '"/>' +
             '<circle cx="246" cy="196" r="26" fill="' + fg + '"/>' +
             '<circle cx="154" cy="196" r="11" fill="' + ac + '"/>' +
             '<circle cx="246" cy="196" r="11" fill="' + ac + '"/>';
    },

    shirt: function (fg, ac) {
      return '<path d="M148 92 L124 116 L146 140 L152 132 L152 214 ' +
             'q48 10 96 0 L248 132 L254 140 L276 116 L252 92 ' +
             'q-52 22 -104 0 z" fill="' + fg + '"/>' +
             '<path d="M176 92 q24 24 48 0" stroke="' + ac + '" stroke-width="5" ' +
             'fill="none"/>';
    },

    shoe: function (fg, ac) {
      return '<path d="M112 190 q0 -58 34 -58 q22 0 30 22 q14 26 62 34 ' +
             'q52 8 52 30 v10 q0 8 -12 8 H124 q-12 0 -12 -12 z" fill="' + fg + '"/>' +
             '<path d="M120 208 h168" stroke="' + ac + '" stroke-width="8"/>' +
             '<path d="M158 152 l24 14 M172 138 l24 16" stroke="' + ac +
             '" stroke-width="5" stroke-linecap="round"/>';
    },

    hat: function (fg, ac) {
      return '<ellipse cx="200" cy="196" rx="122" ry="26" fill="' + fg + '"/>' +
             '<path d="M144 196 q-6 -84 56 -84 q62 0 56 84 z" fill="' + fg + '"/>' +
             '<rect x="140" y="170" width="120" height="20" rx="8" fill="' + ac + '"/>';
    },

    bag: function (fg, ac) {
      return '<path d="M162 116 q0 -40 38 -40 q38 0 38 40" stroke="' + fg +
             '" stroke-width="10" fill="none"/>' +
             '<rect x="126" y="114" width="148" height="112" rx="18" fill="' + fg + '"/>' +
             '<rect x="126" y="150" width="148" height="18" fill="' + ac + '"/>';
    },

    props: function (fg, ac) {
      return '<polygon points="200,68 226,140 302,140 240,184 264,254 200,210 ' +
             '136,254 160,184 98,140 174,140" fill="' + fg + '"/>' +
             '<circle cx="200" cy="160" r="18" fill="' + ac + '"/>';
    },

    furniture: function (fg, ac) {
      return '<rect x="122" y="102" width="156" height="120" rx="12" fill="' + fg + '"/>' +
             '<path d="M200 102 v120" stroke="' + ac + '" stroke-width="6"/>' +
             '<circle cx="188" cy="162" r="7" fill="' + ac + '"/>' +
             '<circle cx="212" cy="162" r="7" fill="' + ac + '"/>' +
             '<path d="M142 222 v22 M258 222 v22" stroke="' + fg + '" stroke-width="10" ' +
             'stroke-linecap="round"/>';
    },

    // Default: a paw print. Used when the species is unrecorded.
    paw: function (fg, ac) {
      return '<ellipse cx="152" cy="122" rx="21" ry="27" fill="' + fg + '"/>' +
             '<ellipse cx="184" cy="100" rx="21" ry="28" fill="' + fg + '"/>' +
             '<ellipse cx="220" cy="100" rx="21" ry="28" fill="' + fg + '"/>' +
             '<ellipse cx="250" cy="122" rx="21" ry="27" fill="' + fg + '"/>' +
             '<path d="M200 140 q54 0 54 42 q0 34 -54 34 q-54 0 -54 -34 q0 -42 54 -42 z" ' +
             'fill="' + fg + '"/>' +
             '<circle cx="200" cy="182" r="14" fill="' + ac + '"/>';
    }
  };

  // Species and category names as they appear in the catalogue, mapped onto a
  // drawing. Anything unlisted falls through to the paw print.
  var SPECIES = {
    // The catalogue's species vocabulary, mapped onto the drawings we have.
    // Where nothing is close the answer is a paw print, not a near-miss: a
    // koala drawn as an elephant is worse than no picture at all, because the
    // reader believes it.
    Bear: 'bear', 'Polar Bear': 'bear', Panda: 'bear', 'Red Panda': 'bear',
    Yeti: 'bear',
    Cat: 'cat', Leopard: 'cat', Tiger: 'cat', Cheetah: 'cat', Jaguar: 'cat',
    Lion: 'cat', 'Big Cat': 'cat', Panther: 'cat', Lynx: 'cat',
    Dog: 'dog', Wolf: 'dog', Fox: 'dog', Coyote: 'dog', Badger: 'dog',
    Raccoon: 'dog', Werewolf: 'dog', Hyena: 'dog',
    Bunny: 'bunny',
    Mouse: 'mouse', Hamster: 'mouse', Capybara: 'mouse', Skunk: 'mouse',
    Squirrel: 'mouse', Otter: 'mouse', Lemur: 'mouse', Groundhog: 'mouse',
    Rodent: 'mouse', Hedgehog: 'mouse', Mole: 'mouse', Mustelid: 'mouse',
    'Woodland Animal': 'mouse', Chipmunk: 'mouse',
    Dinosaur: 'dino', Tardigrade: 'dino', Alligator: 'dino', Reptile: 'dino',
    Snake: 'dino', Lizard: 'dino', Turtle: 'dino', Crocodile: 'dino',
    Dragon: 'dragon', Cryptid: 'dragon', 'Mythical Creature': 'dragon',
    Monster: 'dragon', Pegasus: 'dragon', Phoenix: 'dragon',
    Unicorn: 'unicorn',
    Horse: 'horse', Zebra: 'horse', Donkey: 'horse', Pony: 'horse',
    Camel: 'horse', Camelid: 'horse', Llama: 'horse', Alpaca: 'horse',
    Deer: 'deer', Reindeer: 'deer', Moose: 'deer', Elk: 'deer',
    Gazelle: 'deer', Springbok: 'deer', Antelope: 'deer',
    Giraffe: 'giraffe', Okapi: 'giraffe',
    Koala: 'koala', Marsupial: 'koala', Kangaroo: 'koala', Wombat: 'koala',
    Sheep: 'sheep', Lamb: 'sheep', Goat: 'sheep', Ram: 'sheep', Alpaca2: 'sheep',
    Chick: 'bird', Bird: 'bird', Owl: 'bird', Flamingo: 'bird',
    Bat: 'bat', 'Fruit Bat': 'bat',
    Duck: 'bird', Chicken: 'bird', Eagle: 'bird', Parrot: 'bird',
    Penguin: 'penguin',
    Frog: 'frog', Amphibian: 'frog', Toad: 'frog', Newt: 'frog',
    Axolotl: 'axolotl',
    Pig: 'pig', Warthog: 'pig', Boar: 'pig',
    Cow: 'cow', Longhorn: 'cow', Ox: 'cow', Bison: 'cow', Buffalo: 'cow',
    Bovine: 'cow', Yak: 'cow',
    Elephant: 'elephant', Rhino: 'elephant', Hippo: 'elephant',
    Monkey: 'monkey', Sloth: 'monkey', Primate: 'monkey', Ape: 'monkey',
    Gorilla: 'monkey', Chimpanzee: 'monkey',
    Butterfly: 'butterfly', Insect: 'butterfly', Bee: 'butterfly',
    Ladybug: 'butterfly', Moth: 'butterfly',
    Spider: 'spider', Scorpion: 'spider',
    Fish: 'fish', 'Sea Monster': 'fish', Octopus: 'fish', Snail: 'fish',
    Shark: 'fish', Whale: 'fish', Lobster: 'fish', Narwhal: 'fish',
    'Aquatic Animal': 'fish', Seal: 'fish', Dolphin: 'fish', Crustacean: 'fish',
    Crab: 'fish', Jellyfish: 'fish', Mollusc: 'fish', Invertebrate: 'fish',
    Monotreme: 'fish', Seahorse: 'fish',
    Character: 'character', Human: 'character', Elf: 'character',
    Doll: 'character', Robot: 'character', Droid: 'character',
    Alien: 'character', Ghost: 'character', Snowman: 'character',
    Creature: 'character',

    // Not animals. These are item.species values for the accessory side of
    // the catalogue, and they are also matched against item.category - drop
    // them and every outfit falls back to a paw print.
    Clothing: 'shirt', Costumes: 'shirt', Pajamas: 'shirt', Outfit: 'shirt',
    Shoes: 'shoe', Hats: 'hat', Hat: 'hat',
    Accessories: 'bag', Bags: 'bag', Bag: 'bag',
    Props: 'props', Furniture: 'furniture', Vehicle: 'vehicle',
  };


  function iconKeyFor(item) {
    if (item.species && SPECIES[item.species]) return SPECIES[item.species];
    if (item.category && SPECIES[item.category]) return SPECIES[item.category];
    if (item.category === 'Clothing & Accessories') return 'shirt';
    if (item.mini_bean) return 'paw';
    return 'paw';
  }

  function draw(key, fg, ac) {
    return (ICONS[key] || ICONS.paw)(fg, ac);
  }

  root.BearChartIcons = {
    iconKeyFor: iconKeyFor,
    draw: draw,
    keys: Object.keys(ICONS),
    species: SPECIES
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BearChartIcons;
})(typeof globalThis !== 'undefined' ? globalThis : this);
