/**
 * Generate `server/kanji-ink-offsets.ts` from the maintainer's approved corrections.
 *
 *   node tools/build-kanji-offsets.mjs            # dry run — prints, writes nothing
 *   node tools/build-kanji-offsets.mjs --apply    # write server/kanji-ink-offsets.ts
 *
 * WHAT THIS IS
 * ------------
 * 73 of the 1,235 hand-drawn stroke stills are horizontally displaced relative to
 * Kyokashotai (教科書体) — the teaching typeface, which is THE reference. The maintainer
 * reviewed all 73 by eye and approved 60. This turns his approvals into a compiled lookup.
 *
 * 🔴 THE HUMAN GATE IS LOAD-BEARING. Do not regenerate this from the detector's output.
 *    The detector reliably FINDS displacement; it cannot judge whether a shift is worth
 *    making, nor recognise a structural anchor. Exactly one of the 73 (応) is actually
 *    WRONG — its first stroke 丶 is deliberately on the centre axis and the whole glyph
 *    hangs from it; the estimators were fooled by 广 sweeping left. No statistic separates
 *    the 60 approvals from the 13 rejections, and the boundary MOVES (he revised 55 -> 60
 *    on a second look, with no new data). The JSON is the live source of truth.
 *
 * INPUT is gitignored (`offline/`), so this cannot run in CI or a fresh clone — same as
 * tools/build-searchbar-font.py. The OUTPUT is committed. That is deliberate: it keeps the
 * licensed/working material out of the public repo while the app ships only the numbers.
 *
 * WHY A .ts FILE AND NOT .json
 * ----------------------------
 * `npm run build` = `tsc && copyfiles 'index.html' 'static/**' 'partials/**' dist/ &&
 * cp -r server/views dist/`. A `server/*.json` is copied by NONE of those, so it would be
 * missing from dist/ and the compiled server would throw at runtime while `npm run dev`
 * looked fine — this repo has been bitten by exactly that __dirname/dist class of bug
 * before. A .ts module is compiled by tsc like any other source: it always lands in dist/,
 * needs no fs read, no __dirname, no resolveJsonModule, and it typechecks and lints.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPROVED = join(ROOT, "offline/ink-overlay/approved-horizontal-corrections.json");
const REVIEW = join(ROOT, "offline/ink-overlay/review.html");
const OUT = join(ROOT, "server/kanji-ink-offsets.ts");
const APPLY = process.argv.includes("--apply");

const approved = JSON.parse(readFileSync(APPROVED, "utf8"));

// --- Ground truth: the 73 candidates are embedded in review.html as `const DATA = [...]`.
//     Validate every approval against it. An approval that is not a candidate, or whose dx
//     has been hand-edited, means the file has drifted from the review it records.
const review = readFileSync(REVIEW, "utf8");
const m = review.match(/const DATA\s*=\s*(\[[\s\S]*?\]);/);
if (!m) {
  console.error("🔴 Could not find `const DATA = [...]` in review.html. NOT WRITING.");
  process.exit(1);
}
const candidates = JSON.parse(m[1]);
const byId = new Map(candidates.map((d) => [d.id, d]));

console.log(`candidates in review.html : ${candidates.length}`);
console.log(`approved by the maintainer: ${approved.length}`);
console.log(`rejected                  : ${candidates.length - approved.length}\n`);

const problems = [];
const seen = new Set();
for (const a of approved) {
  const d = byId.get(a.ka_id);
  if (!d) problems.push(`${a.ka_id} (${a.kanji}) is not one of the 73 candidates`);
  else {
    if (d.u !== a.kanji) problems.push(`${a.ka_id}: kanji ${a.kanji} != candidate ${d.u}`);
    if (Math.abs(d.dx - a.dx) > 1e-9) problems.push(`${a.ka_id} (${a.kanji}): dx ${a.dx} != candidate ${d.dx} — HAND-EDITED`);
  }
  if (seen.has(a.ka_id)) problems.push(`${a.ka_id} appears twice`);
  seen.add(a.ka_id);
  if (typeof a.dx !== "number" || !Number.isFinite(a.dx) || a.dx === 0)
    problems.push(`${a.ka_id} (${a.kanji}): dx ${a.dx} is not a usable non-zero number`);
}
// 応 is the one correction known to be WRONG. If it ever appears, stop.
if (seen.has("ka_542")) problems.push("応 (ka_542) is APPROVED — it is the one known-wrong correction. Refusing.");

if (problems.length) {
  console.error("🔴 The approvals file does not agree with review.html:");
  for (const p of problems) console.error(`   - ${p}`);
  console.error("\nNOT WRITING.");
  process.exit(1);
}
console.log("✅ every approval is a genuine candidate with an untouched dx");
console.log("✅ no duplicates; no zero/NaN dx");
console.log("✅ 応 (ka_542) — the one known-wrong correction — is not present\n");

const rejected = candidates.filter((d) => !seen.has(d.id));
console.log(`rejected (${rejected.length}), for the record: ${rejected.map((d) => d.u).join(" ")}\n`);

// --- Emit. Sorted by ka_id for a stable, reviewable diff (input order is the review's).
const rows = [...approved].sort((a, b) =>
  Number(a.ka_id.slice(3)) - Number(b.ka_id.slice(3)));

// Align the trailing kanji comments into a column — this file is read by a non-developer.
const pairs = rows.map((a) => [`  "${a.ka_id}": ${a.dx},`, a.kanji]);
const width = Math.max(...pairs.map(([code]) => code.length));
const body = pairs
  .map(([code, kanji]) => `${code.padEnd(width + 2)}// ${kanji}`)
  .join("\n");

const out = `// GENERATED by tools/build-kanji-offsets.mjs — DO NOT EDIT BY HAND.
// Source: offline/ink-overlay/approved-horizontal-corrections.json (gitignored), validated
// against the 73 candidates embedded in offline/ink-overlay/review.html.
//
// Horizontal ink corrections for hand-drawn stroke stills, in CSS px, keyed by ka_id.
// Positive = move the artwork RIGHT. A kanji absent from this map means 0 — i.e. today's
// behaviour, untouched. ${rows.length} of 1,235 kanji are corrected.
//
// The values are in the stroke SVG's own units: every still shares viewBox="0 0 248 248"
// and \`video[poster]\` renders at exactly 248px, so canvas units ARE CSS px, 1:1.
//
// 🔴 These are the maintainer's per-kanji judgements, not a formula's output. No statistic
//    separates the 60 he approved from the 13 he rejected. Never regenerate from a detector
//    and never extend this list by rule — see tools/build-kanji-offsets.mjs.
//
// Reference is Kyokashotai (教科書体), the teaching face — not the canvas centre, and not a
// consensus of the nine typefaces (the other eight are display faces meant to depart from it).

export const KANJI_INK_DX: Readonly<Record<string, number>> = Object.freeze({
${body}
});
`;

console.log(`=== ${OUT.replace(ROOT + "/", "")} (${rows.length} entries) ===`);
console.log(out.split("\n").slice(0, 22).join("\n"));
console.log("   …");

if (!APPLY) {
  console.log("\n(DRY RUN — nothing was written. Pass --apply to write.)");
  process.exit(0);
}
writeFileSync(OUT, out);
console.log(`\n✅ WROTE ${OUT}`);
