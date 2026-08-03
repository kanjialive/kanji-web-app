import { Db, Collection } from "mongodb";
import { Request, Response } from "express";
import * as search from "./search";
import { KanjiDocument } from "./types";
import { extendKanjiWithAssets } from "./kanji-assets";

let db: Db;

// Sync, like public-api's and html-routes'. index.ts does not await it, so a rejection
// would bypass the startup retry and terminate the process.
export const init = (database: Db) => {
  db = database;
};

/**
 * Fields excluded from every private-API response.
 *
 * `textbook_search` and `mn_hint` are both LICENCE-RESTRICTED and this endpoint is
 * unauthenticated, so this projection alone closes very little:
 *
 *   - The FILTER is the leak. search.ts maps `text` onto textbook_search, so an
 *     unauthenticated ?text=gen:19 here returns exactly that chapter whether or not the
 *     field is in the body. (The public route rejects it, and ?list= accepts only the two
 *     public study lists on every route.)
 *   - mn_hint cannot be dropped here at all: AngularJS renders the hint from JSON.
 *     Phase 7 closes that leak and no other.
 */
const LICENSED_FIELDS_PROJECTION = { textbook_search: 0 } as const;

const getKanjiWithObject = async (obj: object, req: Request, res: Response) => {
  try {
    const collection: Collection<KanjiDocument> = db.collection("kanji");
    const result: KanjiDocument | null = await collection.findOne(obj, {
      projection: LICENSED_FIELDS_PROJECTION,
    });
    if (result) {
      res.send(extendKanjiWithAssets(result));
    } else {
      res.status(404).send({ error: "No kanji found." });
    }
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: "An error occurred." });
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
      res.send(results);
    } catch (error) {
      console.error(error);
      res.status(500).send({ error: "An error occurred." });
    }
  }
};

export const advancedSearch = async (
  req: Request<Record<string, string>, unknown, unknown, search.StringDict>,
  res: Response
) => {
  const basic = req.query.basic;
  const query =
    typeof basic === "string"
      ? search.generateBasicQuery(basic)
      // "api", not the "app" default: this route is unauthenticated, so ?text= here
      // discloses the licensed textbook mapping to anyone. The EJS frontend never
      // calls it — it renders through html-routes, which keeps the feature.
      : search.parseAdvancedQuery(req.query, "api");
  await getSearchResultsWithQuery(query, req, res);
};

export const basicSearch = async (req: Request, res: Response) => {
  const query = search.generateBasicQuery(req.params.search);
  await getSearchResultsWithQuery(query, req, res);
};

