import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

//
// Why this file exists (2026-07-14).
//
// A comment terminator was typed into the MIDDLE of a comment in kanji-alive-modern.css.
// The browser's parser closed the comment there, treated the rest of that comment's prose
// as garbage CSS, and silently discarded the `.audio-play` rule that followed it. The
// example play triangles lost their size, their position and their vertical centring —
// live on staging, and only a human eye caught it.
//
// Nothing in the repo could have. `npm run lint` reads only server/, `tsc` does not know
// CSS exists, and `npm run build` copies the sheet verbatim. A malformed stylesheet is not
// a build error anywhere: CSS has no compiler, and the browser fails SILENTLY BY DESIGN —
// it discards what it cannot parse and renders on, with nothing in the console.
//
// (This very file made the same mistake once, in a JSDoc block. TypeScript refused to
// compile it. That is the whole difference, and the whole reason for the gate below.)
//
// So the gate lives here. These tests are deliberately dumb and dependency-free: no
// stylelint, no PostCSS — nothing to keep current for the next ten years.
//

const CSS_PATH = path.join(__dirname, "..", "static", "css", "kanji-alive-modern.css");
const css = fs.readFileSync(CSS_PATH, "utf8");

//
// Walks the sheet the way a CSS tokenizer does — comments first, so braces inside prose are
// ignored — and reports the two mistakes that silently DELETE rules:
//
//   1. an unterminated comment  — swallows every rule after it
//   2. an early comment terminator — turns the rest of that comment's prose into garbage
//      declarations, taking the following rule down with it
//
function scan(src: string) {
  const errors: string[] = [];
  let i = 0;
  let line = 1;
  let depth = 0;

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === "\n") {
      line++;
      i++;
      continue;
    }

    // comment opener
    if (ch === "/" && next === "*") {
      const openedAt = line;
      let j = i + 2;
      let closed = false;
      for (; j < src.length - 1; j++) {
        if (src[j] === "\n") line++;
        if (src[j] === "*" && src[j + 1] === "/") {
          closed = true;
          break;
        }
      }
      if (!closed) errors.push(`unterminated comment opened at line ${openedAt}`);
      i = j + 2;
      continue;
    }

    // A comment terminator reached OUTSIDE a comment means one above it was closed early.
    if (ch === "*" && next === "/") {
      errors.push(`stray comment terminator at line ${line} — a comment above it was closed early`);
      i += 2;
      continue;
    }

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth < 0) errors.push(`unbalanced closing brace at line ${line}`);
    }
    i++;
  }

  if (depth > 0) errors.push(`${depth} unclosed opening brace(s) at end of file`);
  return errors;
}

test("stylesheet parses: comments terminate correctly and braces balance", () => {
  assert.deepEqual(scan(css), []);
});

//
// A parse error is not the only way to lose a rule — a careless edit can just delete one.
// Below are declarations whose absence is INVISIBLE in review but changes what students
// see. Each is documented at its site in the sheet. If you are removing one deliberately,
// delete its line here too, and say why in the commit.
//
const LOAD_BEARING: Array<[string, RegExp]> = [
  // The example play triangle: box identical to production's <a>, tip landing on the rule.
  [".audio-play zeroes ALL padding (tip lands on the rule)", /\.audio-play\s*\{[^}]*padding:\s*0\s*;/],
  [".audio-play pins its line box to the compound's", /\.audio-play\s*\{[^}]*line-height:\s*22\.857143px/],

  // The results grid's pitch: 25px kanji + 12.5px pad = 37.5px, independent of any font.
  ["p.kanji collapses the whitespace between anchors", /p\.kanji\s*\{[^}]*font-size:\s*0\s*;/],
  ["p.kanji > a.ka declares the 12.5px grid gap", /p\.kanji\s*>\s*a\.ka\s*\{[^}]*padding-right:\s*12\.5px/],

  // Anything inside a column must size to it, never restate its width.
  [".example tracks its column (width: 100%)", /\.example\s*\{[^}]*width:\s*100%/],
  ["div.examples tracks its column (width: 100%)", /div\.examples\s*\{[^}]*width:\s*100%/],

  // The sorted views' scroll ends on a column boundary ONLY if both of these hold: the
  // results gutter is the grid's 24px (not production's 25px) AND the last column drops its
  // trailing gutter. Either one alone leaves the scroll running past the last aligned
  // column — 24px or 3px respectively, where both together give 0. See .grouped-column.
  ["results columns use the grid gutter, not a literal", /\.grouped-column\s*\{[^}]*margin-right:\s*var\(--gutter\)/],
  [
    "the last results column drops its trailing gutter",
    /\.results-group:last-child\s+\.grouped-column:last-child\s*\{[^}]*margin-right:\s*0\s*;/,
  ],

  // The true grid: 4 x 258 + 3 x 24 = 1104, centred by (1158 - 1104) / 2 = 27.
  ["content block is 1104px (4 cols + 3 gutters)", /--content-width:\s*1104px/],
  ["content block is centred (container2 margin-left: 27px)", /\.container2\s*\{[^}]*margin-left:\s*27px/],
  ["col4 completes the grid at 846px with no width override", /\.col4\s*\{\s*left:\s*846px;\s*\}/],

  // Production's <a> left-aligns its glyph; a <button> centres it (UA sheet).
  ["animation controls left-align their glyph", /\.animation-controls\s+\.icon-step-left\s*\{[^}]*text-align:\s*left/],

  // The counter chevrons: a named font + a pinned line box (this replaced a -1.9px nudge).
  ["counter chevrons name the icon font", /\.recordCounter\s+\.icon-left[^{]*\{[^}]*font-family:\s*var\(--font-icons\)/],
  ["counter chevrons pin their line box", /\.recordCounter\s+\.icon-left[^{]*\{[^}]*line-height:\s*28\.571429px/],

  // Hover feedback on the media controls — templates apply .ka-icon-gray, not .gray-out.
  ["icon hover targets the class the templates apply", /\.ka-icon-gray:hover\s*\{[^}]*color:\s*gray/],

  // Row 1 all lands on baseline 69. `Info` and the branding each need a 1px correction to
  // get there; the search bar, Sort and the counter arrive by other routes.
  ["Info sits on the row-1 baseline", /\.info-button\s*\{[^}]*top:\s*3px/],
  ["branding sits on the row-1 baseline", /\.desktop-branding\s*\{[^}]*padding-top:\s*11px/],

  // The radical grey is the maintainer's contrast pick (1.8:1 on white), not a WCAG value.
  // A contrast sweep "fixing" it must fail here rather than change the page silently.
  ["radical grey is the maintainer's 1.8:1 pick", /--color-radical:\s*#C1C1C1/],

  // .ka-rad-anim has no box of its own (its frames are absolute), so the generic
  // :focus-visible ring paints a collapsed strip in the wrong place. Suppressed on the
  // container, painted on the frames — both halves are required.
  ["the focus ring is suppressed on the boxless .ka-rad-anim", /\.ka-rad-anim:focus-visible\s*\{[^}]*outline:\s*none\s*;/],
  ["the focus ring paints on the .ka-rad-anim frames", /\.ka-rad-anim:focus-visible\s+img\s*\{[^}]*outline:\s*2px\s+solid/],
];

for (const [name, pattern] of LOAD_BEARING) {
  test(`stylesheet keeps its load-bearing rule: ${name}`, () => {
    assert.ok(
      pattern.test(css),
      "Missing from static/css/kanji-alive-modern.css — read the comment at that rule before removing it.",
    );
  });
}

//
// The grid identity. --content-width is not an independent number: it IS four columns and
// three gutters. Everything downstream leans on that, but the consequence people trip over
// is the sorted views' horizontal scroll. With the results columns on the same pitch and no
// trailing gutter, the maximum scroll is
//
//     (N x pitch - gutter) - (contentWidth - gutter)  =  (N - 4) x pitch
//
// for any N >= 4 — an exact multiple of the pitch, so the scroll always ends with a column
// flush at the left inset. The gutters cancel ONLY because contentWidth is 4 columns + 3
// gutters. Change any of the three variables so that identity no longer holds and the
// sorted views silently start overscrolling again (they did, by 28px, until 2026-07-17).
//
function cssVar(name: string): number {
  const m = css.match(new RegExp(`--${name}:\\s*([\\d.]+)px`));
  assert.ok(m, `--${name} is not declared in the stylesheet`);
  return parseFloat(m![1]);
}

test("grid identity: 4 columns + 3 gutters = the content width", () => {
  const col = cssVar("col-width");
  const gutter = cssVar("gutter");
  const content = cssVar("content-width");
  assert.equal(
    4 * col + 3 * gutter,
    content,
    `4 x ${col} + 3 x ${gutter} = ${4 * col + 3 * gutter}, but --content-width is ${content}px. ` +
      `These three are one system, not three choices. While this holds, the sorted views' ` +
      `scroll ends on a column boundary by construction; break it and they overscroll.`,
  );
});

//
// Every heading→value `top` on the detail page is DERIVED, not chosen:
//
//     value_top = heading_effective_top + 31.5 − d(value's font)
//
// so that all eight pairs share one 31.5px baseline gap. `d` is how much lower the value's
// baseline sits inside its line box than the h3's — it depends ONLY on the value's font,
// which is why three values with the same font-size need three different tops to LOOK
// aligned. Give two of them the same top "because they line up in the CSS" and their
// baselines drift apart on screen; that is precisely the bug this replaced.
//
// This test re-derives the numbers rather than hard-coding them, so it explains itself when
// it fails. If the clamped SourceSansPro metrics are ever repaired, d changes and every top
// must move — this is the test that will tell you.
//
const GAP = 31.5;
const D = { latin15: 0.5, latin16: 1.5, japanese16: 3.5 };

function declaredTop(selector: string): number {
  // The selector must match EXACTLY — `\s*\{`, not `[^{]*\{`. These properties are split
  // across two rules on purpose (a shared `position: absolute`, then a per-font `top`), and
  // a loose match happily finds the shared one, which declares no top at all.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`);
  const m = css.match(rule);
  assert.ok(m, `could not find a rule whose selector is exactly \`${selector}\``);
  const top = m![1].match(/(?:^|;)\s*top:\s*(-?[\d.]+)px/);
  assert.ok(top, `rule \`${selector}\` declares no top`);
  return parseFloat(top![1]);
}

// heading effective top = its `top` + its `margin-top`
const HEADING_TOP = { row1: 10 + 20, row2: 123 - 8, row3: 194 - 8 };

const VALUE_PAIRS: Array<[string, string, keyof typeof HEADING_TOP, keyof typeof D]> = [
  ["Meaning", "p.meaning", "row1", "latin15"],
  ["Strokes / Grade", "p.strokes,\np.grade", "row1", "latin16"],
  ["Examples", "div.examples", "row1", "japanese16"],
  ["Onyomi", "p.onyomi", "row2", "latin15"],
  ["Kodansha / Nelson", "p.kodansha,\np.nelson", "row2", "latin16"],
  ["Kunyomi", "p.kunyomi", "row3", "latin15"],
];

for (const [name, selector, row, font] of VALUE_PAIRS) {
  test(`detail page: ${name} keeps the 31.5px baseline gap`, () => {
    const expected = HEADING_TOP[row] + GAP - D[font];
    assert.equal(
      declaredTop(selector),
      expected,
      `${name}: top should be ${HEADING_TOP[row]} + ${GAP} - ${D[font]} = ${expected}px. ` +
        `Every value's top is derived from its FONT's baseline offset — see the comment above ` +
        `h3.meaning in the stylesheet before changing it.`,
    );
  });
}
