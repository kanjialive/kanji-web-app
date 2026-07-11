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
