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
