import { Db, Collection } from "mongodb";
import { Request, Response } from "express";
import * as search from "./search";
import { KanjiDocument, LicensedField, RetiredField } from "./types";
import { extendKanjiWithAssets } from "./kanji-assets";

let db: Db;

// Sync, like public-api's and html-routes'. index.ts does not await it, so a rejection
// would bypass the startup retry and terminate the process.
export const init = (database: Db) => {
  db = database;
};

/**
 * LICENCE-RESTRICTED fields (CLAUDE.md "Key Patterns"), excluded from every private-API
 * response. This route is UNAUTHENTICATED, so the same list the public API withholds
 * applies here — keyed off the same `LicensedField` type so the two cannot drift.
 *
 * Two layers, as on the public API: the Mongo read below and the response spread. A leak
 * needs both to be wrong. The FILTER is a third surface and is closed separately — see the
 * "api" argument in advancedSearch().
 */
const LICENSED_FIELDS_PROJECTION: Record<LicensedField, 0> = {
  mn_hint: 0,
  hint_group: 0,
  txt_books: 0,
  textbook_search: 0,
};

/**
 * `hint` is mn_hint RENDERED — derived by extendKanjiWithAssets() after the read, so no
 * Mongo projection can reach it. Delete it HERE, never in kanji-assets.ts: html-routes.ts
 * shares that enricher and the EJS detail page genuinely needs the hint.
 */
const DERIVED_LICENSED_FIELDS = ["hint"] as const;

/**
 * Kenkyusha retired the Luminous dictionary, so every document's `luminous` URL 404s.
 * Withheld rather than served as a dead link — no frontend renders it. NOT a licensing
 * matter: keep it out of LICENSED_FIELDS_PROJECTION, whose docblock states that constraint.
 */
const RETIRED_FIELDS_PROJECTION: Record<RetiredField, 0> = { luminous: 0 };

const KANJI_PROJECTION = {
  ...LICENSED_FIELDS_PROJECTION,
  ...RETIRED_FIELDS_PROJECTION,
};

const withoutLicensedFields = (doc: object): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...doc };
  for (const field of Object.keys(LICENSED_FIELDS_PROJECTION)) delete copy[field];
  for (const field of DERIVED_LICENSED_FIELDS) delete copy[field];
  return copy;
};

const getKanjiWithObject = async (obj: object, req: Request, res: Response) => {
  try {
    const collection: Collection<KanjiDocument> = db.collection("kanji");
    const result: KanjiDocument | null = await collection.findOne(obj, {
      projection: KANJI_PROJECTION,
    });
    if (result) {
      // The projection leaves mn_hint undefined, which renderHint() would throw on. Feed
      // it an empty string so nothing licensed is derived; the empty `hint` is deleted
      // with the rest.
      res.send(withoutLicensedFields(extendKanjiWithAssets({ ...result, mn_hint: "" })));
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

export const basicSearch = async (req: Request<{ search: string }>, res: Response) => {
  const query = search.generateBasicQuery(req.params.search);
  await getSearchResultsWithQuery(query, req, res);
};

