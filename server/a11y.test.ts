/**
 * Accessibility gate — the attributes a screen reader needs, none of which any
 * compiler or stylesheet check can see.
 *
 * Renders the REAL routes over a stub Db and matches the shipped HTML as text, the
 * same shape as the numberOrBlank gate in html-routes.test.ts. An aria-label is
 * invisible to tsc, silent when misspelled, and painted identically when removed:
 * without this file, every fix here rots on the next template edit.
 *
 * Seen red before commit: dropping the search field's label, moving #a11y-status
 * inside <main>, removing role="heading" from results.ejs, and removing tabindex
 * from the radical-animation div each fail here and nothing else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import express from "express";
import type { Server } from "http";
import type { Db } from "mongodb";
import type { KanjiDocument } from "./types";
import { router, init } from "./html-routes";

// Bound the wait, and a FUNCTION not a constant — AbortSignal.timeout() starts
// counting when created, so one shared signal is a single budget for the file.
const boundedFetch = (): RequestInit => ({ signal: AbortSignal.timeout(5000) });

interface StubCursor {
  toArray(): Promise<KanjiDocument[]>;
  sort(): StubCursor;
}

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
    // closeAllConnections() first, or a failing run hangs instead of ending.
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve(null)));
  }
}

// rad_name_ja / rad_name are load-bearing here: without them the grouped views
// fall through to the unlabelled radical glyph and the label assertions are moot.
function kanjiDoc(fields: Partial<KanjiDocument>): KanjiDocument {
  return {
    ka_id: "kanji_1",
    ka_utf: "水",
    kstroke: 4,
    rad_utf: "水",
    rad_stroke: 4,
    rad_order: 85,
    rad_name_ja: "みず",
    rad_name: "mizu",
    ...fields,
  } as KanjiDocument;
}

function detailDoc(fields: Partial<KanjiDocument>): KanjiDocument {
  return kanjiDoc({
    // Raw shape: extendKanjiWithAssets destructures each entry as [japanese, english].
    examples: [["水曜日", "Wednesday"]],
    kname: "mizu",
    mn_hint: "",
    rad_position: "",
    rad_name_file: "x",
    stroketimes: [],
    meaning: "water",
    ...fields,
  } as Partial<KanjiDocument>);
}

test("the search page names its field, has a heading, and owns a live region", async () => {
  await withServer(resultsDb([]), async (base) => {
    const res = await fetch(`${base}/search`, boundedFetch());
    assert.equal(res.status, 200);
    const body = await res.text();

    assert.match(
      body,
      /<input[^>]*aria-label="Search for kanji"/,
      "the single search field lost its accessible name — it announces as just 'edit text'"
    );
    assert.match(
      body,
      /<h1 class="visually-hidden">/,
      "the page lost its h1 — screen-reader heading navigation lands nowhere"
    );
    assert.ok(
      body.includes('id="a11y-status"'),
      "the live region is gone — result swaps announce nothing"
    );
    assert.match(
      body,
      /id="a11y-status"[^>]*role="status"/,
      "the live region lost role=status and no longer announces politely"
    );
    // A live region must pre-exist the mutation it reports. loadResults() replaces
    // #search-results' children, so a region inside <main> is destroyed by the first swap.
    assert.ok(
      body.indexOf('id="a11y-status"') > body.indexOf("</main>"),
      "the live region moved INSIDE the swap target — the first search deletes it"
    );
  });
});

test("the grouped results view announces its headings and names only the radicals", async () => {
  const docs = [
    kanjiDoc({}),
    kanjiDoc({ ka_id: "kanji_2", ka_utf: "氷", kstroke: 5 }),
  ];
  await withServer(resultsDb(docs), async (base) => {
    const res = await fetch(
      `${base}/partials/results?q=water&mode=rsort`,
      boundedFetch()
    );
    assert.equal(res.status, 200);
    const body = await res.text();

    assert.match(
      body,
      /role="heading" aria-level="2"/,
      "the results count is a plain div again — it is not announced as a heading"
    );
    assert.match(
      body,
      /ka-results-h1" aria-hidden="true"/,
      "the bare count is exposed again and is read twice, once as stray text"
    );

    // Pedagogical ruling: the radical carries name + romaji ONLY. No "Radical" prefix
    // (role=img already announces a category), and never its meaning.
    assert.match(
      body,
      /role="img" aria-label="[^"]+ \([^)]+\)"/,
      "the grey radical glyph lost its name + romaji label"
    );
    assert.ok(
      !body.includes('aria-label="Radical'),
      'the radical label grew a "Radical" prefix — role=img already says it'
    );

    // The kanji must stay unlabelled: students have to recognise them themselves.
    assert.ok(
      !/class="ka"[^>]*aria-label/.test(body) &&
        !/aria-label[^>]*class="ka"/.test(body),
      "a kanji link grew a label — the app deliberately withholds the answer"
    );
  });
});

test("the detail page labels its media controls and reaches the radical animation by keyboard", async () => {
  await withServer(resultsDb([detailDoc({})]), async (base) => {
    const res = await fetch(`${base}/${encodeURIComponent("水")}`, boundedFetch());
    assert.equal(res.status, 200);
    const body = await res.text();

    // A real <button> would pick up UA styling and move ink, so the div carries the role.
    assert.match(
      body,
      /class="ka-rad-anim[^>]*role="button"/,
      "the radical-animation trigger lost role=button and announces as nothing"
    );
    assert.match(
      body,
      /class="ka-rad-anim[^>]*tabindex="0"/,
      "the radical-animation trigger is unreachable by Tab again"
    );

    // Text child, not aria-label: the Japanese word must reach a Japanese voice.
    assert.match(
      body,
      /visually-hidden">Play pronunciation of <span lang="ja">/,
      "the example audio buttons lost their split-language name"
    );
    assert.ok(
      !/audio-play[^>]*aria-label/.test(body),
      "an aria-label came back on an audio button and overrides the split-language name"
    );

    assert.ok(
      body.includes(":aria-label=\"playing ?"),
      "play/pause no longer relabels itself, so its name lies about the current state"
    );
    assert.ok(
      body.includes("Pause stroke order animation"),
      "the play/pause label was shortened — a first-time user must understand it alone"
    );

    assert.ok(
      body.includes('id="video-label"') &&
        body.includes('aria-labelledby="video-label"'),
      "the stroke-order video lost its accessible name"
    );

    assert.ok(
      body.includes('lang="ja">詳細は'),
      "the help modal's Japanese paragraph is unmarked and gets an English voice"
    );
  });
});
