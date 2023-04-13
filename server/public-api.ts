import { Db, Collection } from "mongodb";
import { Request, Response } from "express";
import * as search from "./search";
import { KanjiDocument } from "./types";
import { extendKanjiWithAssets } from "./private-api";

let db: Db;

export const init = (database: Db) => {
  db = database;
};

const getSearchResultsWithQuery = async (
  query: object,
  req: Request,
  res: Response
) => {
  try {
    const collection: Collection<KanjiDocument> = db.collection("kanji");
    const results: KanjiDocument[] = await collection
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

    if (!results) {
      res.send({ error: "No kanji found." });
    } else {
      const structured_results = results.map((doc) => ({
        kanji: {
          //'id':doc['ka_id'],
          character: doc["ka_utf"],
          stroke: doc["kstroke"],
        },
        radical: {
          character: doc["rad_utf"],
          stroke: doc["rad_stroke"],
          order: doc["rad_order"],
        },
      }));
      res.send(structured_results);
    }
  } catch (error) {
    res.send({ error: "No kanji found." });
  }
};

export const advancedSearch = async (
  req: Request<any, any, any, search.StringDict>,
  res: Response
) => {
  const query = search.parseAdvancedQuery(req.query);
  await getSearchResultsWithQuery(query, req, res);
};

export const basicSearch = async (req: Request, res: Response) => {
  const query = search.generateBasicQuery(req.params.search);
  await getSearchResultsWithQuery(query, req, res);
};

export const getKanjiWithCharacter = async (req: Request, res: Response) => {
  try {
    const collection: Collection<KanjiDocument> = db.collection("kanji");
    const result: KanjiDocument | null = await collection.findOne({
      ka_utf: req.params.character,
    });
    result
      ? res.send(extendKanjiWithAssets(result))
      : res.send({ error: "No kanji found." });
  } catch (error) {
    res.send({ error: "No kanji found." });
  }
};

export const getAllKanji = async (req: Request, res: Response) => {
  try {
    const collection: Collection<KanjiDocument> = db.collection("kanji");
    const results: KanjiDocument[] = await collection.find({}).toArray();
    if (!results) {
      res.send({ error: "No kanji found." });
    } else {
      const structured_results = results.map((doc) =>
        extendKanjiWithAssets(doc)
      );
      res.send(structured_results);
    }
  } catch (error) {
    res.send({ error: "No kanji found." });
  }
};
