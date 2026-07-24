import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import express from "express";
import type { Server } from "http";
import type { Db } from "mongodb";
import type { KanjiDocument } from "./types";
import {
  parseColonSyntax,
  canonicalHtmxUrl,
  router,
  init,
} from "./html-routes";

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
    // ⚠️ closeAllConnections() before close(), or a FAILING run HANGS instead of
    // ending. A route handler that throws out of an async function never sends a
    // response, so its socket stays open and server.close() waits for it forever —
    // which is exactly the state the hostile-query tests below provoke when the bug
    // they guard is reintroduced. A gate has to fail fast, not stall the runner.
    server.closeAllConnections();
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

/**
 * Non-string query parameters must not reach string methods.
 *
 * Express parses `?q[$ne]=x` into an OBJECT and `?q=a&q=b` into an ARRAY, and every
 * `req.query.q as string` cast in html-routes.ts asserted otherwise. parseColonSyntax()
 * runs BEFORE the route's try/catch, so `.includes(":")` threw out of an async handler
 * and Node terminated the process: two unauthenticated GETs crashed the staging dyno on
 * 2026-07-24 and Heroku's backoff kept it down.
 *
 * ⚠️ These pass with a WORKING database on purpose. The crash had nothing to do with
 * Mongo — it happened before any query — so a brokenDb() would hide it behind a 500.
 *
 * Seen red: reverting queryParam() in renderSearchPage() fails exactly the three
 * "search page survives" cases and leaves the other nine green (2026-07-24).
 */

// A Db that answers every query with an empty result set.
// ⚠️ Annotate the return types. `npm test` compiles this file with noImplicitAny
// (tsconfig excludes *.test.ts, so the typecheck gate never sees it), and a stub
// cursor whose sort() returns itself is an implicit any — TS7011 at test time only.
interface StubCursor {
  toArray(): Promise<KanjiDocument[]>;
  sort(): StubCursor;
}

function emptyDb(): Db {
  const cursor: StubCursor = {
    toArray: async (): Promise<KanjiDocument[]> => [],
    sort: (): StubCursor => cursor,
  };
  return {
    collection() {
      return {
        find: (): StubCursor => cursor,
        findOne: async (): Promise<KanjiDocument | null> => null,
      };
    },
  } as unknown as Db;
}

// Bound the wait. A reintroduced crash leaves the request unanswered forever; without
// a deadline the assertion below never runs and the runner sits there looking busy.
//
// ⚠️ A FUNCTION, not a shared constant. AbortSignal.timeout() starts counting the moment
// it is CREATED, not when a fetch picks it up, and once fired it stays fired forever. One
// module-scope signal would therefore be a single 5s budget for the whole FILE: on a slow
// CI runner every test after the 5s mark fails instantly with TimeoutError — a red that
// has nothing to do with the crash these tests guard. Each call gets its own deadline.
const hostileFetch = (): RequestInit => ({ signal: AbortSignal.timeout(5000) });

const HOSTILE_QUERIES = [
  "q[$ne]=x", // object — the shape that crashed staging
  "q[$regex]=.*", // object — the shape reported as an injection
  "q=a&q=b", // array — same class, different qs behaviour
  "mode[$ne]=kanji", // the other parameter read with the same cast
];

for (const query of HOSTILE_QUERIES) {
  test(`the search page survives ?${query} without crashing the process`, async () => {
    await withServer(emptyDb(), async (base) => {
      const res = await fetch(`${base}/search?${query}`, hostileFetch());
      assert.ok(
        res.status < 500,
        `?${query} must not be a server error, got ${res.status}`
      );
    });
  });

  test(`the results partial survives ?${query} without crashing the process`, async () => {
    await withServer(emptyDb(), async (base) => {
      const res = await fetch(`${base}/partials/results?${query}`, hostileFetch());
      assert.ok(
        res.status < 500,
        `?${query} must not be a server error, got ${res.status}`
      );
    });
  });

  test(`the detail page survives ?${query} without crashing the process`, async () => {
    await withServer(emptyDb(), async (base) => {
      const res = await fetch(`${base}/${encodeURIComponent("水")}?${query}`, hostileFetch());
      assert.ok(
        res.status < 500,
        `?${query} must not be a server error, got ${res.status}`
      );
    });
  });
}

/**
 * The /htmx canonical redirect must stay same-origin.
 *
 * "/htmx//evil.example/path" once redirected to "//evil.example/path" — a browser reads
 * a leading "//" as protocol-relative and leaves the site. Verified against staging's
 * own middleware on 2026-07-24.
 */
test("canonicalHtmxUrl strips the prefix on ordinary URLs", () => {
  assert.equal(canonicalHtmxUrl("/htmx/search?q=water"), "/search?q=water");
  assert.equal(canonicalHtmxUrl("/htmx/%E6%B0%B4"), "/%E6%B0%B4");
  assert.equal(canonicalHtmxUrl("/htmx"), "/");
  assert.equal(canonicalHtmxUrl("/htmx/"), "/");
});

test("canonicalHtmxUrl never returns a protocol-relative or off-origin location", () => {
  const hostile = [
    "/htmx//evil.example/path",
    "/htmx///evil.example",
    "/htmx/\\evil.example",
    "/htmx/\\/evil.example",
    "/htmx//\\evil.example",
  ];
  for (const url of hostile) {
    const canonical = canonicalHtmxUrl(url);
    assert.ok(
      canonical.startsWith("/") &&
        canonical[1] !== "/" &&
        canonical[1] !== "\\",
      `${url} -> ${canonical} is not a same-origin path`
    );
    // The decisive check: resolved against any origin, it must STAY on that origin.
    assert.equal(
      new URL(canonical, "https://kanjialive.example").origin,
      "https://kanjialive.example",
      `${url} -> ${canonical} escapes the origin`
    );
  }
});

/**
 * ⚠️ The two tests above guard the helper. This one guards that index.ts still USES it —
 * without this, someone re-inlining the old one-liner passes every test above while
 * reopening the hole. It reads the source that ships, like the other gates here do.
 */
test("index.ts routes its /htmx redirect through canonicalHtmxUrl", () => {
  const source = fs.readFileSync(path.join(__dirname, "index.ts"), "utf8");
  const redirects = source.match(/res\.redirect\([^)]*\)/g) ?? [];
  assert.ok(redirects.length > 0, "found no res.redirect() calls — regex has rotted");
  const htmxRedirect = redirects.find((call) => call.includes("originalUrl"));
  assert.ok(
    htmxRedirect,
    "found no res.redirect() using req.originalUrl — has the /htmx redirect moved?"
  );
  assert.match(
    htmxRedirect,
    /canonicalHtmxUrl\(/,
    "the /htmx redirect must go through canonicalHtmxUrl(), not a raw originalUrl"
  );
});
