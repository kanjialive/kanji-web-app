interface ParsedQuery {
  [key: string]: unknown;
}

export interface StringDict {
  [key: string]: string;
}

const numeric_keys: StringDict = {
  ks: "kstroke",
  rs: "rad_stroke",
  grade: "grade",
};
const textbook_keys: StringDict = {
  text: "textbook_search",
  list: "textbook_search",
};
const string_keys: StringDict = { kanji: "ka_utf" };
const array_keys: StringDict = {
  kem: "meaning",
  rem: "rad_meaning",
  on: "onyomi",
  kun: "kunyomi",
  rpos: "rad_position",
  rjn: "rad_name",
};

/**
 * Search is case-insensitive: the hidden `*_search` arrays are a LOWERCASE index,
 * so we lower-case the operand to match. The arrays are never displayed — the
 * visible text lives in `meaning`, `rad_meaning`, etc., whose capitalisation is an
 * editorial matter and is left untouched.
 *
 * Every romaji index (onyomi, kunyomi, rad_name, rad_position, textbook) was already
 * stored entirely lower-case; only `meaning_search` (15 docs) and `rad_meaning_search`
 * (7 docs) carried capitals, and both were lower-cased on 2026-07-12. Before that,
 * `?kem=Buddha` and `?kem=Shinto` returned nothing at all.
 *
 * ⚠️ Do NOT replace this with a Mongo case-insensitive collation. It was tried and
 * rejected: `{locale:"en", strength:2}` treats hiragana and katakana as EQUAL (they
 * differ only at the tertiary level, the same level as letter case), so searching
 * すい matched the katakana onyomi スイ — 6 hits where there should be 0. That would
 * blur the on'yomi/kun'yomi distinction across the whole app.
 *
 * Lower-casing is safe here precisely because it is a no-op for Japanese:
 * "みず".toLowerCase() === "みず". Only Latin letters are affected.
 */
const searchOperand = (value: string): string => value.toLowerCase();

export const parseAdvancedQuery = (query: StringDict): ParsedQuery => {
  const parsed_query: ParsedQuery = {};

  for (const key in numeric_keys) {
    if (!Object.prototype.hasOwnProperty.call(query, key)) continue;

    const raw = query[key];
    // Injection guard (plans/002): qs can deliver an operator object
    // (?grade[$ne]=1). A non-string operand must never reach Mongo.
    if (typeof raw !== "string") continue;

    // "" means "this kanji has no grade" — a real search (229 kanji), and the ONE
    // spelling for absence across every key. Gradeless kanji are stored as NaN, and
    // Mongo matches NaN to NaN, so { grade: NaN } is what finds them. Verified
    // 2026-07-12: 229 docs hold grade=NaN, 0 hold null or nothing.
    // Do NOT rewrite this as a null/$exists check without re-checking the data.
    if (raw === "") {
      parsed_query[numeric_keys[key]] = NaN;
      continue;
    }

    // Full-string parse, and an unusable operand matches NOTHING — never dropped.
    // parseInt alone truncates ("3abc" ran as 3), and dropping the term silently
    // broadens a combined query to whatever survives. $in: [] forces an honest 0.
    const num = raw.trim();
    parsed_query[numeric_keys[key]] = /^\d+$/.test(num)
      ? parseInt(num, 10)
      : { $in: [] };
  }

  for (const key in string_keys) {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      if (typeof query[key] === "string") {
        parsed_query[string_keys[key]] = query[key];
      }
    }
  }

  for (const key in array_keys) {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      if (typeof query[key] === "string") {
        const base = array_keys[key];

        // "" is an ABSENCE search and must bypass the suffix rule: it has no
        // alphanumerics, so the rule would ask the Japanese index — which does not
        // exist for meaning/rad_meaning (0 of 1,235 docs) and silently returns 0.
        // The romaji index exists on all 1,235 and stores absence as "".
        if (query[key] === "") {
          parsed_query[base + "_search"] = { $in: [""] };
          continue;
        }

        const suffix = !/[a-zA-Z0-9]/.test(query[key]) ? "_ja_search" : "_search";
        parsed_query[base + suffix] = { $in: [searchOperand(query[key])] };
      }
    }
  }

  for (const key in textbook_keys) {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      const textbook_value = query[key];
      if (typeof textbook_value === "string") {
        parsed_query[textbook_keys[key]] = {
          $in: [searchOperand(textbook_value)],
        };
      }
    }
  }

  return parsed_query;
};

export const generateBasicQuery = (query: string): ParsedQuery => {
  return {
    $or: [
      { meaning_search: { $in: [searchOperand(query)] } },
      // ka_utf is a kanji character, matched exactly — not a text search.
      { ka_utf: query },
      { kunyomi_ja_search: { $in: [searchOperand(query)] } },
      { onyomi_ja_search: { $in: [searchOperand(query)] } },
    ],
  };
};
