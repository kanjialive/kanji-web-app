import { test } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import express from "express";
import type { Server } from "http";
import type { Db } from "mongodb";
import { parseColonSyntax, router, init } from "./html-routes";

test("parseColonSyntax parses recognized colon-delimited advanced keys", () => {
  assert.deepEqual(parseColonSyntax("on:shin grade:3"), {
    on: "shin",
    grade: "3",
  });
});

test("parseColonSyntax returns null when no colon is present", () => {
  assert.equal(parseColonSyntax("water"), null);
});

test("parseColonSyntax returns null when no recognized advanced key is present", () => {
  assert.equal(parseColonSyntax("foo:bar"), null);
});

test("parseColonSyntax parses a single recognized key with a non-ASCII value", () => {
  assert.deepEqual(parseColonSyntax("kanji:水"), { kanji: "水" });
});

/**
 * Database-outage contract.
 *
 * These pin the fix for the silent-failure bug: search used to return HTTP 200
 * with "No kanji were found" when MongoDB was unreachable, so an outage was
 * indistinguishable from a valid zero-match search and nothing ever alerted.
 * A volunteer-maintained app that nobody watches MUST fail loudly.
 */

// A Db whose every query rejects, standing in for an unreachable MongoDB.
function brokenDb(): Db {
  return {
    collection() {
      return {
        find() {
          throw new Error("connection refused");
        },
        findOne() {
          throw new Error("connection refused");
        },
      };
    },
  } as unknown as Db;
}

async function withServer(
  db: Db,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  init(db);
  app.use("/", router);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(null)));
  }
}

test("a database failure on the search page returns 500, not a cheerful 200", async () => {
  await withServer(brokenDb(), async (base) => {
    const res = await fetch(`${base}/search?q=water`);
    assert.equal(res.status, 500, "an outage must not masquerade as success");

    const body = await res.text();
    assert.ok(
      !body.includes("No kanji were found"),
      "must not tell the user the search legitimately matched nothing"
    );
    assert.ok(
      body.includes("database is unavailable"),
      "must say the database is unavailable"
    );
  });
});

test("a database failure on the results partial returns 500, not no-results", async () => {
  await withServer(brokenDb(), async (base) => {
    const res = await fetch(`${base}/partials/results?q=water`);
    assert.equal(res.status, 500);

    const body = await res.text();
    assert.ok(!body.includes("No kanji were found"));
    assert.ok(body.includes("database is unavailable"));
  });
});

test("a database failure on the detail page returns 500", async () => {
  await withServer(brokenDb(), async (base) => {
    const res = await fetch(`${base}/${encodeURIComponent("水")}`);
    assert.equal(res.status, 500);
  });
});
