export interface Id {
  $oid: string;
}

export interface TxtBook {
  chapter: string;
  txt_bk: string;
}

export interface Reference {
  grade: number;
  kodansha: string;
  classic_nelson: string;
}

export interface KanjiDocument {
  _id: Id;
  _rev: string;
  dick: string;
  dicn: string;
  examples: string[][];
  grade: number;
  hint_group: number;
  ka_id: string;
  ka_utf: string;
  kname: string;
  kstroke: number;
  kunyomi: string;
  kunyomi_ja: string;
  kunyomi_ja_search: string[];
  kunyomi_ka_display: string;
  kunyomi_search: string[];
  luminous: string;
  meaning: string;
  meaning_search: string[];
  mn_hint: string;
  onyomi: string;
  onyomi_ja: string;
  onyomi_ja_search: string[];
  onyomi_search: string[];
  rad_meaning: string;
  rad_meaning_search: string[];
  rad_name: string;
  rad_name_file: string;
  rad_name_ja: string;
  rad_name_ja_search: string[];
  rad_name_search: string[];
  rad_order: number;
  rad_position: string;
  rad_position_ja: string;
  rad_position_ja_search: string[];
  rad_position_search: string[];
  rad_stroke: number;
  rad_utf: string;
  stroketimes: number[];
  textbook_search: string[];
  txt_books: TxtBook[];
}

export interface SimpleExtendedKanjiDocument
  extends Omit<KanjiDocument, "examples"> {
  kanji: Kanji;
  radical: Radical;
  examples: Example[];
  references: Reference;
}

export interface ExtendedKanjiDocument extends Omit<KanjiDocument, "examples"> {
  rad_position_file: string;
  rad_anim_source: string;
  examples: {
    japanese: string;
    english: string;
    filename: string;
    opus: string;
    aac: string;
    ogg: string;
    mp3: string;
  }[];
  strokes: string[];
  poster_video_source: string;
  mp4_video_source: string;
  webm_video_source: string;
  kyokasho_source: string;
  mincho_source: string;
  gothic_source: string;
  maru_source: string;
  shino_source: string;
  tensho_source: string;
  hiragino_source: string;
  kanteiryu_source: string;
  suzumushi_source: string;
  rad_char_source: string;
  rad_anim_frame_0: string;
  rad_anim_frame_1: string;
  rad_anim_frame_2: string;
  hint: string;
}

export interface Example {
  japanese: string;
  meaning: {
    english: string;
  };
  audio: {
    opus: string;
    aac: string;
    ogg: string;
    mp3: string;
  };
}

export interface Kanji {
  character: string;
  meaning: {
    english: string;
  };
  strokes: {
    count: number;
    timings: number[];
    images: string[];
  };
  onyomi: {
    romaji: string;
    katakana: string;
  };
  kunyomi: {
    romaji: string;
    hiragana: string;
  };
  video: {
    mp4: string;
    webm: string;
    poster: string;
  };
}

export interface Radical {
  character: string;
  strokes: number;
  image: string;
  name: {
    hiragana: string;
    romaji: string;
  };
  position: {
    hiragana: string;
    romaji: string;
    icon: string;
  };
  meaning: {
    english: string;
  };
  animation: string[];
}
