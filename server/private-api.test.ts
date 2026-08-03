import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import type { Db } from "mongodb";
import * as privateApi from "./private-api";

// Minimal fake Response that captures status + body, and fake helpers to drive
// the handlers without Express or a real database. Casts go through `unknown` so
// the file stays free of explicit `any`.
interface CapturedRes {
  statusCode: number;
  body: unknown;
  status(code: number): CapturedRes;
  send(payload: unknown): CapturedRes;
}

function fakeRes(): CapturedRes {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function initDb(findOne: () => Promise<unknown>): void {
  privateApi.init({ collection: () => ({ findOne }) } as unknown as Db);
}

function charReq(character: string): Request {
  return { params: { character } } as unknown as Request;
}

test("getKanjiWithCharacter returns 404 with lowercase error when not found", async () => {
  initDb(async () => null);
  const res = fakeRes();
  await privateApi.getKanjiWithCharacter(charReq("zzz"), res as unknown as Response);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "No kanji found." });
});

test("getKanjiWithCharacter returns 500 on database error", async () => {
  initDb(async () => {
    throw new Error("db down");
  });
  const res = fakeRes();
  await privateApi.getKanjiWithCharacter(charReq("x"), res as unknown as Response);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "An error occurred." });
});

test("getKanjiWithCharacter returns 200 with an enriched body when found", async () => {
  const doc = {
    ka_id: "kanji_1",
    ka_utf: "水",
    kname: "mizu",
    kstroke: 1,
    examples: [] as string[][],
    mn_hint: "",
    rad_position: "",
    rad_name: "mizu",
    rad_name_file: "mizu",
  };
  initDb(async () => doc);
  const res = fakeRes();
  await privateApi.getKanjiWithCharacter(charReq("水"), res as unknown as Response);
  assert.equal(res.statusCode, 200);
  const body = res.body as { ka_utf: string; strokes: string[] };
  assert.equal(body.ka_utf, "水");
  // enrichment adds a per-stroke image array
  assert.equal(body.strokes.length, 1);
});

/**
 * LICENCE-RESTRICTED fields (CLAUDE.md "Key Patterns"). This route is UNAUTHENTICATED, so
 * the whole list must go — plus `hint`, which is mn_hint rendered by the shared enricher
 * AFTER the read and therefore out of reach of any Mongo projection.
 *
 * Both layers read ONE list, so a wrong list fails both tests. What each proves separately
 * is that its layer still RUNS: seen red by dropping withoutLicensedFields() (first test —
 * hint survives even with the projection in place) and by removing the projection argument
 * from findOne (second).
 */
const LICENSED_FIELDS = [
  "mn_hint",
  "hint",
  "hint_group",
  "txt_books",
  "textbook_search",
];

test("no licensed field leaves the private kanji route", async () => {
  // Deliberately leaky: findOne ignores the projection, so this proves the SPREAD layer
  // on its own. A doc arriving intact is exactly what a mistyped projection would give us.
  initDb(async () => ({
    ka_id: "kanji_1",
    ka_utf: "水",
    kname: "water",
    kstroke: 1,
    grade: 1,
    examples: [] as string[][],
    rad_position: "",
    rad_name: "mizu",
    rad_name_file: "mizu",
    mn_hint: "Between the rivers…",
    hint_group: 2,
    txt_books: [{ chapter: "19", txt_bk: "txtGenki" }],
    textbook_search: ["gen", "gen:c19"],
  }));
  const res = fakeRes();
  await privateApi.getKanjiWithCharacter(charReq("水"), res as unknown as Response);
  const body = res.body as Record<string, unknown>;
  for (const field of LICENSED_FIELDS) {
    assert.ok(!(field in body), `${field} must not leave the private API`);
  }
  // Deletion, not a DTO: everything else keeps its shape.
  assert.equal(body.ka_utf, "水");
  assert.equal(body.grade, 1);
  assert.equal((body.strokes as string[]).length, 1);
});

test("the private kanji route projects the licensed fields out at Mongo", async () => {
  const projections: unknown[] = [];
  privateApi.init({
    collection: () => ({
      findOne: async (
        _filter: object,
        options?: { projection?: object }
      ): Promise<unknown> => {
        projections.push(options?.projection);
        return null;
      },
    }),
  } as unknown as Db);

  await privateApi.getKanjiWithCharacter(charReq("水"), fakeRes() as unknown as Response);
  await privateApi.getKanjiWithId(
    { params: { id: "kanji_1" } } as unknown as Request,
    fakeRes() as unknown as Response
  );

  assert.equal(projections.length, 2, "both read paths must hit the stub");
  for (const projection of projections) {
    assert.deepEqual(projection, {
      mn_hint: 0,
      hint_group: 0,
      txt_books: 0,
      textbook_search: 0,
    });
  }
});

// Captures the filter the handler actually hands to Mongo.
function initDbCapturingFind(): { filter: () => object } {
  let seen: object = {};
  privateApi.init({
    collection: () => ({
      find: (filter: object) => {
        seen = filter;
        return { toArray: async (): Promise<unknown[]> => [] };
      },
    }),
  } as unknown as Db);
  return { filter: () => seen };
}

function queryReq(query: Record<string, string>): Request {
  return { query } as unknown as Request;
}

// search.test.ts proves parseAdvancedQuery is CLOSED on the "api" surface; only this
// proves advancedSearch asks for that surface. It took the "app" default for years,
// so ?text= on this unauthenticated route returned exactly one textbook chapter.
test("advancedSearch closes ?text= — the route passes the api surface", async () => {
  const cap = initDbCapturingFind();
  await privateApi.advancedSearch(
    queryReq({ text: "cij:15" }) as never,
    fakeRes() as unknown as Response
  );
  assert.deepEqual(
    cap.filter(),
    { textbook_search: { $in: [] } },
    "?text= must match nothing on the unauthenticated JSON API"
  );
});

// Study lists are NOT textbooks (maintainer's ruling): ?list= stays open here.
test("advancedSearch keeps ?list= working on the api surface", async () => {
  const cap = initDbCapturingFind();
  await privateApi.advancedSearch(
    queryReq({ list: "ap:c3" }) as never,
    fakeRes() as unknown as Response
  );
  assert.deepEqual(cap.filter(), { textbook_search: { $in: ["ap:c3"] } });
});
