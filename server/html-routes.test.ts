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
    // closeAllConnections() before close(), or a FAILING run HANGS instead of
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
 * /api/docs must carry the licensing restriction — the ONLY place it is
 * written down anywhere public. The page was Angular-only (client-side
 * routed from partials/docs.html) until 2026-08-01; this pins the EJS port
 * so Phase 7 can delete Angular without deleting the restriction's one
 * statement. brokenDb() proves the render needs no database: the docs must
 * stay reachable during an outage.
 *
 * Seen red: removing the licensing paragraph from docs.ejs fails the wording
 * asserts; removing the route 404s.
 */
test("/api/docs renders the licensing restriction, without touching the database", async () => {
  await withServer(brokenDb(), async (base) => {
    const res = await fetch(`${base}/api/docs`);
    assert.equal(res.status, 200);

    const body = await res.text();
    assert.ok(
      body.includes("API Documentation"),
      "must be the API documentation page"
    );
    assert.ok(
      body.includes(
        "The only exceptions are searching for kanji by textbook and viewing the mnemonic hints"
      ),
      "must name BOTH restricted features: textbook search and mnemonic hints"
    );
    assert.ok(
      body.includes(
        "Due to licensing restrictions these features and data are not available in the public API"
      ),
      "must state the licensing restriction itself"
    );
    assert.ok(
      body.includes(
        "you cannot search for kanji by textbook (chapter)"
      ),
      "must repeat the restriction where advanced search is documented"
    );
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
 * These pass with a WORKING database on purpose. The crash had nothing to do with
 * Mongo — it happened before any query — so a brokenDb() would hide it behind a 500.
 *
 * Seen red: reverting queryParam() in renderSearchPage() fails exactly the three
 * "search page survives" cases and leaves the other nine green (2026-07-24).
 */

// A Db that answers every query with an empty result set.
// Annotate the return types. `npm test` compiles this file with noImplicitAny
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

// A Db that answers every query with the given documents.
function resultsDb(docs: KanjiDocument[]): Db {
  const cursor: StubCursor = {
    toArray: async (): Promise<KanjiDocument[]> => docs,
    sort: (): StubCursor => cursor,
  };
  return {
    collection() {
      return {
        find: (): StubCursor => cursor,
        findOne: async (): Promise<KanjiDocument | null> => docs[0] ?? null,
      };
    },
  } as unknown as Db;
}

function kanjiDoc(fields: Partial<KanjiDocument>): KanjiDocument {
  return {
    ka_id: "kanji_1",
    ka_utf: "水",
    kstroke: 4,
    rad_utf: "水",
    rad_stroke: 4,
    rad_order: 85,
    ...fields,
  } as KanjiDocument;
}

/**
 * The search box repaints an advanced search in the ORDER THE USER TYPED IT.
 *
 * The display string is rebuilt from req.query, and Express preserves the URL's
 * parameter order — which is the typed order, because the colon-syntax redirect
 * builds the URL in typed order too. Iterating the fixed ADVANCED_KEYS list
 * instead repainted "grade:3 rs:5" as "rs:5 grade:3" the moment the results
 * loaded (found by the maintainer within hours of the production swap).
 *
 * Seen red: rebuilding the string by iterating ADVANCED_KEYS fails the first case.
 */
test("the search box preserves the typed order of an advanced search", async () => {
  const docs = [kanjiDoc({})];
  await withServer(resultsDb(docs), async (base) => {
    for (const [queryString, displayed] of [
      ["grade=3&rs=5", "grade:3 rs:5"],
      ["rs=5&grade=3", "rs:5 grade:3"],
      ["kem=water&on=sui&ks=4", "kem:water on:sui ks:4"],
    ]) {
      const res = await fetch(`${base}/search?${queryString}`, hostileFetch());
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.ok(
        body.includes(`value="${displayed}"`),
        `?${queryString} must repaint the search box as "${displayed}"`
      );
    }
  });
});

/**
 * An unrecognised ?mode= must never report zero results over a non-empty result set.
 *
 * partials/results.ejs branches on exactly 'kanji' / 'ksort' / 'rsort' and its final
 * `else` falls through to no-results.ejs, so `?mode=xyz` rendered "No kanji were found
 * matching this search" — HTTP 200, with matches in hand. That is the SAME silent-failure
 * shape as the outage tests above: an answer the user cannot tell from a correct one.
 *
 * Seen red: restoring `queryParam(req.query.mode) || "kanji"` fails every case below
 * except 'kanji', 'ksort' and 'rsort'.
 */
const MODE_INPUTS = [
  "kanji", // the three real modes must still work
  "ksort",
  "rsort",
  "xyz", // nonsense
  "KANJI", // right word, wrong case — a plausible hand-typed URL
  "help", // a mode the SERVER sets; must not be reachable from the query string
  " kanji", // stray whitespace from a copied URL
];

for (const mode of MODE_INPUTS) {
  test(`?mode=${JSON.stringify(mode)} still shows the kanji it found`, async () => {
    const docs = [kanjiDoc({}), kanjiDoc({ ka_id: "kanji_2", ka_utf: "氷", kstroke: 5 })];
    await withServer(resultsDb(docs), async (base) => {
      for (const url of [
        `${base}/search?q=water&mode=${encodeURIComponent(mode)}`,
        `${base}/partials/results?q=water&mode=${encodeURIComponent(mode)}`,
      ]) {
        const res = await fetch(url, hostileFetch());
        assert.equal(res.status, 200, url);
        const body = await res.text();
        assert.ok(
          !body.includes("No kanji were found"),
          `${url} claimed zero results while holding two`
        );
        assert.ok(body.includes("水"), `${url} did not render the results`);
      }
    });
  });
}

/**
 * The NaN sentinel must not reach a results heading.
 *
 * 々 holds `rad_stroke: NaN` meaning "no radical strokes", and the rsort view printed it
 * straight into the group heading as the literal text "NaN". Production renders it blank
 * — not by choice, but because its NaN becomes null crossing JSON to AngularJS. Rendering
 * from the Mongo document directly loses that accident, which is what numberOrBlank()
 * exists to restore. It was fully unit-tested and simply not in scope in this template.
 *
 * This drives the REAL route and renders the REAL template, so it also proves the
 * helper is actually reachable from the view — a numberOrBlank() unit test cannot.
 *
 * Seen red: dropping numberOrBlank() from the rsort heading in partials/results.ejs, and
 * separately removing the res.locals middleware, both fail this and nothing else.
 */
test("the rsort view renders a blank heading for 々, never the text NaN", async () => {
  const docs = [
    kanjiDoc({}),
    kanjiDoc({ ka_id: "kanji_noma", ka_utf: "々", kstroke: 3, rad_utf: "々", rad_stroke: NaN, rad_order: -1 }),
  ];
  await withServer(resultsDb(docs), async (base) => {
    const res = await fetch(`${base}/partials/results?q=x&mode=rsort`, hostileFetch());
    assert.equal(res.status, 200);
    const body = await res.text();

    const headings = [...body.matchAll(/ka-results-h1"[^>]*>([^<]*)</g)].map((m) => m[1].trim());
    assert.ok(headings.length > 0, "found no group headings — has the class name changed?");
    assert.deepEqual(
      headings.filter((h) => h === "NaN"),
      [],
      `a group heading rendered the raw sentinel: ${JSON.stringify(headings)}`
    );
    assert.ok(body.includes("々"), "々 must still be listed under its blank heading");
  });
});

/**
 * Detail-page "n/a" — a deliberate departure from production, which renders these blank
 * (maintainer's ruling, 2026-07-28). Two DIFFERENT scopes, easy to conflate:
 *   Onyomi — GENERAL: all 13 kanji whose romaji field holds the "n/a" sentinel.
 *   Grade  — 々 ONLY: the repetition mark is not a kanji, so no grade can apply; the
 *            other 228 gradeless kanji stay blank (numberOrBlank, as production does).
 * Radical strokes stays blank — held until the "does 々 have a radical" question is
 * settled. Results-grid headings stay blank too (the rsort test above).
 */
function detailDoc(fields: Partial<KanjiDocument>): KanjiDocument {
  return kanjiDoc({
    examples: [],
    mn_hint: "",
    rad_position: "",
    rad_name: "x",
    rad_name_file: "x",
    stroketimes: [],
    meaning: "x",
    ...fields,
  });
}

// The VALUE elements, not the <h3> labels that share their class name.
function valueOf(body: string, selector: string): string {
  const match = body.match(
    new RegExp(`${selector.replace(/[[\]{}()*+?.\\^$|]/g, "\\$&")}([^<]*)<`)
  );
  assert.ok(match, `found no ${selector} — has the template changed?`);
  return match[1].trim();
}

test("々 renders n/a for grade and onyomi, blank for radical strokes", async () => {
  const doc = detailDoc({
    ka_utf: "々",
    kname: "noma",
    grade: NaN,
    rad_stroke: NaN,
    onyomi: "n/a",
    onyomi_ja: "",
    meaning: "repetition mark",
  });
  await withServer(resultsDb([doc]), async (base) => {
    const res = await fetch(`${base}/${encodeURIComponent("々")}`, hostileFetch());
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.equal(valueOf(body, '<p class="grade">'), "n/a");
    assert.equal(valueOf(body, '<p class="onyomi" lang="ja">'), "n/a");
    assert.equal(valueOf(body, '<div class="radical-stroke">'), "");
  });
});

test("a gradeless kanji that is not 々 still renders grade blank", async () => {
  // 芝 as the collection holds it: gradeless AND one of the 13 with no onyomi. The
  // two rules must not leak into each other — onyomi n/a, grade blank.
  const doc = detailDoc({
    ka_utf: "芝",
    kname: "shiba(fu)",
    grade: NaN,
    onyomi: "n/a",
    onyomi_ja: "",
    meaning: "lawn",
  });
  await withServer(resultsDb([doc]), async (base) => {
    const res = await fetch(`${base}/${encodeURIComponent("芝")}`, hostileFetch());
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.equal(valueOf(body, '<p class="grade">'), "");
    assert.equal(valueOf(body, '<p class="onyomi" lang="ja">'), "n/a");
  });
});

// A real onyomi must pass through untouched — the "n/a" branch keys on the romaji
// sentinel, never on the Japanese field being empty.
test("a real onyomi renders as itself, not n/a", async () => {
  const doc = detailDoc({
    kname: "water",
    grade: 1,
    onyomi: "sui",
    onyomi_ja: "スイ",
    meaning: "water",
  });
  await withServer(resultsDb([doc]), async (base) => {
    const res = await fetch(`${base}/${encodeURIComponent("水")}`, hostileFetch());
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.equal(valueOf(body, '<p class="grade">'), "1");
    assert.equal(valueOf(body, '<p class="onyomi" lang="ja">'), "スイ");
  });
});

// Bound the wait. A reintroduced crash leaves the request unanswered forever; without
// a deadline the assertion below never runs and the runner sits there looking busy.
//
// A FUNCTION, not a shared constant. AbortSignal.timeout() starts counting the moment
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
 * Ordering is the whole property: below app.all("/*") the route still compiles, still
 * looks right in review, and silently 302s /robots.txt to /search — which is what
 * production did for years. tsc cannot see route order, so this reads the shipped source.
 */
test("index.ts serves /robots.txt, and does so ABOVE the catch-all", () => {
  const source = fs.readFileSync(path.join(__dirname, "index.ts"), "utf8");

  const robots = source.indexOf('app.get("/robots.txt"');
  assert.notEqual(robots, -1, "no /robots.txt route in index.ts");

  // The call signature, not the bare string: prose above mentions app.all("/*") too,
  // and matching a comment would compare the route against the wrong position.
  const catchAll = source.indexOf('app.all("/*", function');
  assert.notEqual(catchAll, -1, "no catch-all found — has it moved? regex has rotted");
  assert.ok(
    robots < catchAll,
    "/robots.txt must be registered before the catch-all, or it redirects to /search"
  );

  // The body is the point: /api/ closed, the docs page carved back in.
  const body = source.slice(robots, catchAll);
  assert.match(body, /Disallow: \/api\//, "robots.txt must disallow /api/");
  assert.match(body, /Allow: \/api\/docs/, "the public API docs page must stay crawlable");
});

/**
 * The two tests above guard the helper. This one guards that index.ts still USES it —
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
