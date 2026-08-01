import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderHint,
  mnemonicHintsPath,
  extendKanjiWithAssets,
  RADICALS_WITHOUT_ANIMATION,
} from "./kanji-assets";
import type { KanjiDocument } from "./types";

const img = (n: string) =>
  `<img src="${mnemonicHintsPath}/${n}.svg" alt="Image of kanji fragment" />`;

// --- Behaviour that must NOT change (real data, ~1,000 hints in production) ---

test("renderHint expands [N] tokens into CDN <img> tags", () => {
  assert.equal(
    renderHint("The cow [45] is high ranking."),
    `The cow ${img("45")} is high ranking.`
  );
});

test("renderHint preserves the allowlisted <span class='note'> markup", () => {
  // 115 hints in the database wrap etymology asides in exactly this span.
  assert.equal(
    renderHint("Trees 木 <span class='note'>(orig. \"inch\")</span> here."),
    "Trees 木 <span class='note'>(orig. \"inch\")</span> here."
  );
});

test("renderHint leaves quotes and apostrophes as literal characters", () => {
  // Escaping these would emit &quot;/&#39; and churn ~200 hints for no gain.
  assert.equal(
    renderHint(`The fields can use a man's "strength".`),
    `The fields can use a man's "strength".`
  );
});

test("renderHint handles a hint with both a token and a note span", () => {
  assert.equal(
    renderHint("Writing brush 聿 <span class='note'>(holding [38] brush)</span>."),
    `Writing brush 聿 <span class='note'>(holding ${img("38")} brush)</span>.`
  );
});

// --- Security: everything outside the allowlist must render inert ---

test("renderHint neutralises a <script> tag from a compromised import", () => {
  const out = renderHint("Danger <script>alert(1)</script> here.");
  assert.equal(out, "Danger &lt;script&gt;alert(1)&lt;/script&gt; here.");
  assert.ok(!out.includes("<script"), "must not emit a live script tag");
});

test("renderHint neutralises an event handler on an otherwise-allowed tag", () => {
  // A <span> is allowed, but ONLY in the exact allowlisted form. A span
  // carrying an onclick is not that form, so it stays escaped.
  const out = renderHint("<span class='note' onclick='steal()'>x</span>");
  assert.ok(!out.includes("onclick='steal()'>"), "must not emit a live handler");
  assert.ok(out.startsWith("&lt;span"), "the crafted opening tag stays escaped");
});

test("renderHint neutralises an <img onerror> payload", () => {
  const out = renderHint("<img src=x onerror=alert(1)>");
  assert.ok(!out.includes("<img src=x"), "must not emit a live img tag");
  assert.equal(out, "&lt;img src=x onerror=alert(1)&gt;");
});

test("renderHint escapes a bare ampersand", () => {
  assert.equal(renderHint("Rice & water"), "Rice &amp; water");
});

test("renderHint only expands digit tokens, so no path traversal via [N]", () => {
  // The token regex is [0-9]+, so a crafted token is left as literal text.
  const out = renderHint("[../../etc/passwd] and [12]");
  assert.equal(out, `[../../etc/passwd] and ${img("12")}`);
});

// --- The radicals with no animation (blank slot on the detail page) ---

const minimalDoc = (rad_name_file: string) =>
  ({
    ka_id: "kanji_1",
    ka_utf: "水",
    kname: "mizu",
    kstroke: 1,
    mn_hint: "",
    rad_position: "",
    rad_name: "mizu",
    rad_name_file,
    examples: [],
  } as unknown as KanjiDocument);

test("RADICALS_WITHOUT_ANIMATION is exactly the CDN-derived set", () => {
  // 14 radicals serve the "n/a" placeholder plus "none" (々's blank frames).
  // Re-derive with offline/scripts/scope-no-rad-anim.mjs before changing.
  assert.deepEqual(
    [...RADICALS_WITHOUT_ANIMATION].sort(),
    ["hanebou", "ichi", "iro", "kan", "keigamae", "nabebuta", "ni", "no",
     "nokanmuri", "nomata", "none", "otsu", "otsu-nine", "tatebou", "tsu"]
  );
});

test("rad_has_anim is false for a placeholder radical and 々, true otherwise", () => {
  assert.equal(extendKanjiWithAssets(minimalDoc("keigamae")).rad_has_anim, false);
  assert.equal(extendKanjiWithAssets(minimalDoc("none")).rad_has_anim, false);
  assert.equal(extendKanjiWithAssets(minimalDoc("mizu")).rad_has_anim, true);
});
