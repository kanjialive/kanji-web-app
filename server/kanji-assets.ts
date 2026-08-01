/**
 * Shared CDN URL constants and asset enrichment for kanji documents.
 * Used by html-routes.ts (HTMX frontend) and private-api.ts (JSON API).
 */

import { KanjiDocument, ExtendedKanjiDocument } from "./types";

// CDN base URLs for assets
const baseURL = "https://media.kanjialive.com";
export const examplesAudioBase = `${baseURL}/examples_audio`;
export const animationPath = `${baseURL}/kanji_animations`;
export const radAnimPath = `${baseURL}/rad_frames`;
export const strokesPath = `${baseURL}/kanji_strokes`;
export const typefacePath = `${baseURL}/ka_typefaces`;
export const radCharPath = `${baseURL}/radical_character`;
export const radPositionPath = `${baseURL}/rad_positions`;
export const mnemonicHintsPath = `${baseURL}/mnemonic_hints`;

/**
 * Escapes text for an HTML *element content* context (NOT an attribute).
 * `&` and `<` are the only characters that can change parsing there; `>` is
 * escaped by convention. Quotes are deliberately left alone — escaping them
 * would emit &quot;/&#39; entities and churn the output of the ~200 hints that
 * quote a gloss, for no security gain. `hint` is only ever interpolated into
 * element content (detail.ejs), never into an attribute. If that ever changes,
 * this function is no longer sufficient.
 */
function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * The COMPLETE set of markup permitted inside a mnemonic hint.
 *
 * Derived by scanning all 1,006 hints in the production database on 2026-07-12,
 * not guessed: the only markup that occurs is a `<span class='note'>` wrapper
 * around etymology asides (115 uses) and its closing tag. No other tags, no HTML
 * entities.
 *
 * Hints must render as markup (`<%- doc.hint %>` in detail.ejs) because they
 * legitimately contain this span and the `[N]` image tokens. So renderHint()
 * escapes the whole string, then restores ONLY these exact sequences. Anything
 * else a hint could contain — a <script>, an onerror handler, a stray tag from a
 * bad or compromised import — stays escaped and renders as inert, visible text.
 *
 * An allowlist by construction, needing no sanitizer dependency: over this app's
 * remaining lifetime every dependency is a liability.
 */
const HINT_ALLOWED_MARKUP: ReadonlyArray<readonly [RegExp, string]> = [
  [/&lt;span class='note'&gt;/g, "<span class='note'>"],
  [/&lt;\/span&gt;/g, "</span>"],
];

/**
 * Renders a raw `mn_hint` into display HTML: escape, restore the allowlisted
 * markup, then expand `[N]` tokens into <img> tags (the id is constrained to
 * digits by the regex). Escaping leaves `[`, `]` and digits untouched, so the
 * tokens still match afterwards.
 */
export function renderHint(mnHint: string): string {
  let hint = escapeHtmlText(mnHint);
  for (const [pattern, replacement] of HINT_ALLOWED_MARKUP) {
    hint = hint.replace(pattern, replacement);
  }
  // The alt is the maintainer's wording: no name for the fragment exists in the
  // data (the token is only a file number), and without an alt VoiceOver reads
  // the SVG filename aloud mid-sentence.
  return hint.replace(
    /\[([0-9]+)\]/g,
    `<img src="${mnemonicHintsPath}/$1.svg" alt="Image of kanji fragment" />`
  );
}

/**
 * Extends a kanji document with all asset URLs for the HTMX detail page.
 */
export function extendKanjiWithAssets(doc: KanjiDocument): ExtendedKanjiDocument {
  const alpha = "abcdefghijklmnopqrstuvwxyz".split("");
  const examples = doc.examples.map(([japanese, english], i) => {
    const filename = `${doc.kname}_06_${alpha[i]}`;
    return {
      japanese,
      english,
      filename,
      opus: `${examplesAudioBase}/audio-opus/${filename}.opus`,
      aac: `${examplesAudioBase}/audio-aac/${filename}.aac`,
      ogg: `${examplesAudioBase}/audio-ogg/${filename}.ogg`,
      mp3: `${examplesAudioBase}/audio-mp3/${filename}.mp3`,
    };
  });

  const strokes = Array.from(
    { length: doc.kstroke },
    (_, i) => `${strokesPath}/${doc.kname}_${i + 1}.svg`
  );

  const hint = renderHint(doc.mn_hint);

  const rad_position_file = doc.rad_position.split(",").pop()?.trim() || "";
  const paddedID = doc.ka_id.split("_")[1].padStart(4, "0");

  return {
    ...doc,
    rad_position_file: rad_position_file
      ? `${radPositionPath}/${rad_position_file}.svg`
      : undefined,
    rad_anim_source: `${radAnimPath}/${doc.rad_name}`,
    examples,
    strokes,
    poster_video_source: `${strokesPath}/${doc.kname}_${doc.kstroke}.svg`,
    mp4_video_source: `${animationPath}/kanji_mp4/${doc.kname}_00.mp4`,
    webm_video_source: `${animationPath}/kanji_webm/${doc.kname}_00.webm`,
    kyokasho_source: `${typefacePath}/kyokasho-svg/kyokasho_Page_${paddedID}.svg`,
    mincho_source: `${typefacePath}/mincho-svg/mincho_Page_${paddedID}.svg`,
    gothic_source: `${typefacePath}/gothic-svg/gothic_Page_${paddedID}.svg`,
    maru_source: `${typefacePath}/maru-svg/maru_Page_${paddedID}.svg`,
    shino_source: `${typefacePath}/shino-svg/shino_Page_${paddedID}.svg`,
    tensho_source: `${typefacePath}/tensho-svg/tensho_Page_${paddedID}.svg`,
    hiragino_source: `${typefacePath}/hiragino-svg/hiragino_Page_${paddedID}.svg`,
    kanteiryu_source: `${typefacePath}/kanteiryu-svg/kanteiryu_Page_${paddedID}.svg`,
    suzumushi_source: `${typefacePath}/suzumushi-svg/suzumushi_Page_${paddedID}.svg`,
    rad_char_source: `${radCharPath}/${doc.rad_name_file}.svg`,
    rad_anim_frame_0: `${radAnimPath}/${doc.rad_name_file}0.svg`,
    rad_anim_frame_1: `${radAnimPath}/${doc.rad_name_file}1.svg`,
    rad_anim_frame_2: `${radAnimPath}/${doc.rad_name_file}2.svg`,
    hint,
  } as ExtendedKanjiDocument;
}
