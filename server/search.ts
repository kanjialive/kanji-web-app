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

export const parseAdvancedQuery = (query: StringDict): ParsedQuery => {
  const parsed_query: ParsedQuery = {};

  for (const key in numeric_keys) {
    if (!Object.prototype.hasOwnProperty.call(query, key)) continue;

    const raw = query[key];
    // Injection guard (plans/002): qs can deliver an operator object
    // (?grade[$ne]=1). A non-string operand must never reach Mongo.
    if (typeof raw !== "string") continue;

    // "" and "n/a" mean "this kanji has no grade" — a real search (229 kanji).
    // Gradeless kanji are stored as NaN, and Mongo matches NaN to NaN, so the
    // filter { grade: NaN } is what finds them. Verified against the live
    // collection 2026-07-12: 229 docs hold grade=NaN, 0 hold null or nothing.
    // Do NOT rewrite this as a null/$exists check without re-checking the data.
    if (raw === "" || raw.toLowerCase() === "n/a") {
      parsed_query[numeric_keys[key]] = NaN;
      continue;
    }

    const num = parseInt(raw, 10);
    if (!isNaN(num)) {
      parsed_query[numeric_keys[key]] = num;
    }
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
        let array_key = array_keys[key];
        array_key += !/[a-zA-Z0-9]/.test(query[key]) ? "_ja_search" : "_search";

        parsed_query[array_key] = { $in: [query[key]] };
      }
    }
  }

  for (const key in textbook_keys) {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      const textbook_value = query[key];
      if (typeof textbook_value === "string") {
        parsed_query[textbook_keys[key]] = { $in: [textbook_value] };
      }
    }
  }

  return parsed_query;
};

export const generateBasicQuery = (query: string): ParsedQuery => {
  return {
    $or: [
      { meaning_search: { $in: [query] } },
      { ka_utf: query },
      { kunyomi_ja_search: { $in: [query] } },
      { onyomi_ja_search: { $in: [query] } },
    ],
  };
};
