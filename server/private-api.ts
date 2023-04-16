import { Db, Collection } from "mongodb";
import { Request, Response } from "express";
import * as search from "./search";
import { ExtendedKanjiDocument, KanjiDocument } from "./types";

let db: Db;

export const init = async (database: Db) => {
  db = database;
};

const getKanjiWithObject = async (obj: object, req: Request, res: Response) => {
  try {
    const collection: Collection<KanjiDocument> = db.collection("kanji");
    const result: KanjiDocument | null = await collection.findOne(obj);
    result
      ? res.send(extendKanjiWithAssets(result))
      : res.send({ Error: "No kanji found." });
  } catch (error) {
    console.error(error);
    res.send({ Error: "No kanji found." });
  }
};

export const getKanjiWithId = async (req: Request, res: Response) => {
  await getKanjiWithObject({ ka_id: req.params.id }, req, res);
};

export const getKanjiWithCharacter = async (req: Request, res: Response) => {
  await getKanjiWithObject({ ka_utf: req.params.character }, req, res);
};

const getSearchResultsWithQuery = async (
  query: object,
  req: Request,
  res: Response
) => {
  if (Object.keys(query).length === 0) {
    res.send({ error: "No kanji found." });
  } else {
    try {
      const collection: Collection = db.collection("kanji");
      const results = await collection
        .find(query, {
          projection: {
            ka_id: 1,
            ka_utf: 1,
            kstroke: 1,
            rad_utf: 1,
            rad_stroke: 1,
            rad_order: 1,
          },
        })
        .toArray();
      results ? res.send(results) : res.send({ error: "No kanji found." });
    } catch (error) {
      console.error(error);
      res.send({ error: "No kanji found." });
    }
  }
};

export const advancedSearch = async (
  req: Request<any, any, any, search.StringDict>,
  res: Response
) => {
  const query =
    req.query.basic !== undefined
      ? search.generateBasicQuery(req.query.basic)
      : search.parseAdvancedQuery(req.query);
  await getSearchResultsWithQuery(query, req, res);
};

export const basicSearch = async (req: Request, res: Response) => {
  const query = search.generateBasicQuery(req.params.search);
  await getSearchResultsWithQuery(query, req, res);
};

const baseURL = "https://media.kanjialive.com";
const examplesAudioBase = `${baseURL}/examples_audio`;
const animationPath = `${baseURL}/kanji_animations`;
const radAnimPath = `${baseURL}/rad_frames`;
const strokesPath = `${baseURL}/kanji_strokes`;
const typefacePath = `${baseURL}/ka_typefaces`;
const radCharPath = `${baseURL}/radical_character`;
const radPositionPath = `${baseURL}/rad_positions`;
const mnemonicHintsPath = `${baseURL}/mnemonic_hints`;

function extendKanjiWithAssets(doc: KanjiDocument): ExtendedKanjiDocument {
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

  const hint = doc.mn_hint.replace(
    /\[([0-9]+)\]/g,
    `<img src="${mnemonicHintsPath}/$1.svg" />`
  );

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
  };
}
