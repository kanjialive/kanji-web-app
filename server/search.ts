interface ParsedQuery {
  [key: string]: any;
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
    if (query.hasOwnProperty(key)) {
      parsed_query[numeric_keys[key]] = parseInt(query[key]);
    }
  }

  for (const key in string_keys) {
    if (query.hasOwnProperty(key)) {
      parsed_query[string_keys[key]] = query[key];
    }
  }

  for (const key in array_keys) {
    if (query.hasOwnProperty(key)) {
      let array_key = array_keys[key];
      array_key += !/[a-zA-Z0-9]/.test(query[key]) ? "_ja_search" : "_search";

      parsed_query[array_key] = { $in: [query[key]] };
    }
  }

  for (const key in textbook_keys) {
    if (query.hasOwnProperty(key)) {
      const textbook_key = textbook_keys[key];
      const textbook_value = query[key];

      parsed_query[textbook_key] = { $in: [textbook_value] };
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
