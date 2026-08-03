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
 * The hidden `*_search` arrays are a LOWERCASE index, so the operand is lower-cased to
 * match. Safe because it is a no-op for Japanese ("みず".toLowerCase() === "みず"); only
 * Latin letters are affected. The visible text in `meaning`, `rad_meaning` etc. keeps
 * its editorial capitalisation and is untouched.
 *
 * Never replace this with a Mongo case-insensitive collation. `{locale:"en",
 * strength:2}` treats hiragana and katakana as EQUAL — they differ only at the tertiary
 * level, the same level as letter case — so すい matches the katakana onyomi スイ,
 * blurring the on'yomi/kun'yomi distinction across the whole app.
 */
const searchOperand = (value: string): string => value.toLowerCase();

/**
 * `text` (textbook) and `list` (study list) write to the SAME field, so the OPERAND is
 * what decides which one a query really is — otherwise `?list=gen:c3` reaches a licensed
 * textbook through the unrestricted key. Study lists (`ap`, `mac`) are public; the other
 * textbook codes are licence-restricted, and reachable from the EJS frontend only —
 * both JSON APIs are unauthenticated or externally published, so neither may query one.
 *
 * A disallowed operand matches NOTHING and is never dropped — dropping would silently
 * broaden `?text=gen&grade=1` to `?grade=1`.
 */
const STUDY_LIST_OPERAND = /^(ap|mac)(:|$)/;

/**
 * "app" is the server-rendered EJS frontend ALONE — the only surface where textbook
 * search is a feature (the Quick Reference panel documents all 15 codes). "api" is the
 * unauthenticated JSON API, "public" the RapidAPI one; neither may reach a textbook.
 */
export type SearchSurface = "app" | "api" | "public";

const textbookOperandAllowed = (
  key: string,
  operand: string,
  surface: SearchSurface
): boolean => {
  // Allowlist, not a denylist: a surface added later is closed until it says otherwise.
  if (key === "text" && surface !== "app") return false;
  // "" is the absence search every advanced key supports.
  if (operand === "") return true;
  if (key === "list") return STUDY_LIST_OPERAND.test(operand);
  return true;
};

export const parseAdvancedQuery = (
  query: StringDict,
  surface: SearchSurface = "app"
): ParsedQuery => {
  const parsed_query: ParsedQuery = {};

  for (const key in numeric_keys) {
    if (!Object.prototype.hasOwnProperty.call(query, key)) continue;

    const raw = query[key];
    // Injection guard: qs delivers an operator object for ?grade[$ne]=1.
    // A non-string operand must never reach Mongo.
    if (typeof raw !== "string") continue;

    // "" is the ONE spelling for an absence search, on every key. Gradeless kanji are
    // stored as the NaN sentinel and Mongo matches NaN to NaN, so { grade: NaN } finds
    // them (229 docs; none hold null or nothing). Do NOT rewrite as a null/$exists
    // check without re-checking the data.
    if (raw === "") {
      parsed_query[numeric_keys[key]] = NaN;
      continue;
    }

    // Full-string parse, and an unusable operand matches NOTHING — never dropped.
    // parseInt alone truncates ("3abc" to 3), and dropping the term silently broadens
    // a combined query to whatever survives. $in: [] forces an honest 0.
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

        // "" must bypass the suffix rule below: it has no alphanumerics, so the rule
        // would route to the Japanese index — which does not exist for
        // meaning/rad_meaning and silently returns 0. The romaji index exists on every
        // document and stores absence as "".
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
        const operand = searchOperand(textbook_value);
        parsed_query[textbook_keys[key]] = {
          $in: textbookOperandAllowed(key, operand, surface) ? [operand] : [],
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
