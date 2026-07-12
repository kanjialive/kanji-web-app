import { Db, Collection } from "mongodb";
import { Request, Response } from "express";
import * as search from "./search";
import { KanjiDocument } from "./types";
import { extendKanjiWithAssets } from "./kanji-assets";

let db: Db;

export const init = async (database: Db) => {
  db = database;
};

/**
 * Fields excluded from every private-API response.
 *
 * `textbook_search` is LICENCE-RESTRICTED data — it is deliberately absent from
 * the public API and from the public GitHub repo. This endpoint is
 * unauthenticated, so anything it returns is effectively published. Nothing
 * displays this field (it is only ever a *query filter*, see search.ts), so it
 * can safely be withheld from the response.
 *
 * `mn_hint` is also licence-restricted, but CANNOT be excluded here: AngularJS
 * renders the hint in the browser and needs the text as JSON, and
 * extendKanjiWithAssets() reads doc.mn_hint to build the hint markup. That leak
 * closes only when Angular is deleted (migration Phase 7) and this whole API
 * loses its last consumer — the HTMX frontend renders server-side and never
 * calls it. See offline/durability-plan-2026-07-12.md.
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
      : search.parseAdvancedQuery(req.query);
  await getSearchResultsWithQuery(query, req, res);
};

export const basicSearch = async (req: Request, res: Response) => {
  const query = search.generateBasicQuery(req.params.search);
  await getSearchResultsWithQuery(query, req, res);
};

