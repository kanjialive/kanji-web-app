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
    // Comma-separated romaji, as in the collection; the position icon (and its
    // alt) must derive from the LAST entry, same as the filename.
    rad_position: "hen",
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

    // The live region reports the mode only after cycling; the button itself
    // must tell a screen reader the CURRENT mode on landing. The welcome page
    // has no active mode (`help` is not in modeNames), so the label needs a
    // fallback or it announces a dangling "Sort — currently ".
    assert.ok(
      body.includes("'Sort — currently ' + modeNames[mode]"),
      "the Sort button's state label is gone — it announces as just 'Sort'"
    );
    assert.ok(
      body.includes("'Sort — no results to sort'"),
      "the Sort label lost its welcome-page fallback — it trails off after 'currently'"
    );
    assert.equal(
      (body.match(/:aria-disabled="!modeNames\[mode\]"/g) ?? []).length,
      3,
      "Sort and the scroll buttons no longer announce as unavailable on the welcome page"
    );

    // The dialog's name is the first thing announced on entering it.
    assert.match(
      body,
      /<dialog[^>]*aria-labelledby="help-modal-title"/,
      "the Quick Reference dialog lost its name — it opens announcing only 'dialog'"
    );
    assert.ok(
      body.includes('id="help-modal-title"'),
      "the help modal's heading lost the id its dialog's aria-labelledby points at"
    );

    assert.match(
      body,
      /<form[^>]*role="search"/,
      "the search form lost its search landmark"
    );

    // Keyboard guards, string-matched from the shipped page: shortcuts must not
    // cycle the sort mode (and announce the swap) behind the open help dialog,
    // and the eased scroll must respect the OS reduce-motion setting.
    assert.ok(
      body.includes("this.$refs.helpDialog.open) return;"),
      "the modal guard is gone — arrows cycle sort modes behind the open Quick Reference"
    );
    assert.ok(
      body.includes("prefers-reduced-motion"),
      "the 900ms eased scroll no longer honours the OS reduce-motion setting"
    );

    assert.ok(
      body.includes('<th scope="row">'),
      "the help-modal tables lost their row headers — cells announce without context"
    );
  });
});

test("pages carry descriptive, query-first titles (WCAG 2.4.2)", async () => {
  // The title is the bookmark's offered name and the tab's label. Query-first,
  // matching the detail pages, so the distinctive part survives tab truncation.
  // The welcome page alone keeps the application name.
  const docs = [detailDoc({})];
  await withServer(resultsDb(docs), async (base) => {
    const welcome = await (await fetch(`${base}/search`, boundedFetch())).text();
    assert.ok(
      welcome.includes("<title>Kanji alive Web Application</title>"),
      "the welcome page lost its application-name title"
    );

    const basic = await (await fetch(`${base}/search/tree`, boundedFetch())).text();
    assert.ok(
      basic.includes("<title>tree - Kanji alive</title>"),
      "a basic search no longer titles the tab with the query"
    );

    const advanced = await (
      await fetch(`${base}/search/advanced?ks=3&grade=1`, boundedFetch())
    ).text();
    assert.ok(
      advanced.includes("<title>ks:3 grade:1 - Kanji alive</title>"),
      "an advanced search no longer titles the tab with its colon syntax"
    );

    // The XHR path: loadResults() swaps results without a page load, so the
    // title must travel as a header (percent-encoded — headers cannot carry
    // raw Japanese) or it goes stale the moment the user searches in-page.
    const partial = await fetch(
      `${base}/partials/results?q=${encodeURIComponent("水")}`,
      boundedFetch()
    );
    assert.equal(
      decodeURIComponent(partial.headers.get("x-title") ?? ""),
      "水 - Kanji alive",
      "the results partial no longer carries X-Title — in-page searches leave the tab stale"
    );

    // The detail pages had this right all along; pin it while we are here.
    const detail = await (
      await fetch(`${base}/${encodeURIComponent("水")}`, boundedFetch())
    ).text();
    assert.ok(
      detail.includes("<title>水 - water - Kanji alive</title>"),
      "the detail page lost its kanji-first title"
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

    // Pedagogical ruling: never the meaning. And the JAPANESE NAME ONLY, no romaji —
    // VoiceOver spoke the name, then re-read the romaji in English, a duplicate the
    // maintainer heard himself (2026-07-30). The name is REAL hidden text, not an
    // aria-label: NVDA speaks attributes in the page language, so a labelled name
    // never reached the Japanese voice (his speech-viewer trace, 2026-08-01) — text
    // inside the lang="ja" element does. The glyph stays aria-hidden: VoiceOver read
    // it and appended its own English description of the character.
    assert.match(
      body,
      /class="ka-radical inline" lang="ja"><span class="visually-hidden">みず<\/span><span aria-hidden="true">/,
      "the radical lost its hidden Japanese-name text or its aria-hidden glyph wrapper"
    );
    assert.ok(
      !/ka-radical inline" lang="ja"><span class="visually-hidden">[^<]*[(（]/.test(body),
      "romaji came back into the radical name — VoiceOver reads the name twice again"
    );
    assert.ok(
      !/class="ka-radical[^>]*aria-label/.test(body),
      "the radical name moved back into an aria-label — NVDA speaks those in English"
    );

    // The kanji must stay unlabelled: students have to recognise them themselves.
    assert.ok(
      !/class="ka"[^>]*aria-label/.test(body) &&
        !/aria-label[^>]*class="ka"/.test(body),
      "a kanji link grew a label — the app deliberately withholds the answer"
    );

    // The ksort view renders the radical label from a SEPARATE branch of the
    // partial; pin it to the same shape or it drifts on its own.
    const ksort = await (
      await fetch(`${base}/partials/results?q=water&mode=ksort`, boundedFetch())
    ).text();
    assert.match(
      ksort,
      /class="ka-radical inline" lang="ja"><span class="visually-hidden">みず<\/span><span aria-hidden="true">/,
      "the ksort radical lost its hidden Japanese-name text or its aria-hidden glyph wrapper"
    );
    assert.ok(
      !/ka-radical inline" lang="ja"><span class="visually-hidden">[^<]*[(（]/.test(ksort),
      "romaji came back into the ksort radical name — VoiceOver reads the name twice again"
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
    // Named via aria-labelledby to that child — name-from-content would prepend
    // the CSS play glyph (a private-use character) to every announcement.
    assert.match(
      body,
      /audio-play[^>]*aria-labelledby="example-audio-label-0"/,
      "an audio button no longer points at its label — the CSS glyph re-enters its name"
    );
    assert.match(
      body,
      /id="example-audio-label-0"[^>]*>Play pronunciation of <span lang="ja">/,
      "the example audio buttons lost their split-language name"
    );
    assert.ok(
      !/audio-play[^>]*aria-label="/.test(body),
      "a flat aria-label came back on an audio button and overrides the split-language name"
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
      body.includes('id="video-label" class="visually-hidden" aria-hidden="true"') &&
        body.includes('aria-labelledby="video-label"'),
      "the stroke-order video lost its accessible name, or its label source lost " +
        "aria-hidden and VoiceOver stops on it as a phantom item"
    );

    assert.ok(
      body.includes('lang="ja">詳細は'),
      "the help modal's Japanese paragraph is unmarked and gets an English voice"
    );

    // Landmarks: without a <main>, the page is a run of generic containers.
    assert.match(
      body,
      /<main class="container2"/,
      "the detail page lost its main landmark"
    );
    assert.match(
      body,
      /<form[^>]*role="search"/,
      "the search form lost its search landmark"
    );
    assert.match(
      body,
      /<dialog[^>]*aria-labelledby="help-modal-title"/,
      "the Quick Reference dialog lost its name — it opens announcing only 'dialog'"
    );
    assert.ok(
      body.includes('id="help-modal-title"'),
      "the help modal's heading lost the id its dialog's aria-labelledby points at"
    );

    // navigateKanji() replaces .container2 wholesale, so its announcer must sit
    // outside it — anchored here to the version div, the last child inside.
    const statusAt = body.indexOf('id="a11y-status"');
    assert.ok(statusAt !== -1, "the detail page lost its live region — prev/next announces nothing");
    assert.ok(
      statusAt > body.indexOf('<div class="version">'),
      "the live region moved INSIDE .container2 — the first prev/next swap deletes it"
    );

    assert.match(
      body,
      /<h1 class="visually-hidden" tabindex="-1">/,
      "the h1 lost tabindex=-1 — after a prev/next swap, keyboard focus restarts from <body>"
    );

    // Every radical-panel element announces what it is before its value, matching
    // "Radical position: hen" — the maintainer's spec, 2026-08-01. The image's
    // label splits languages ("Radical image:" English, the name Japanese) via
    // aria-labelledby, since a flat alt inherits one language. role="img" on both
    // images: Safari otherwise
    // exposes the SVG file's INTERNAL tree as extra VoiceOver stops — its
    // Sketch-export <title>, empty layer groups, "Created with Sketch."
    // aria-hidden: the span is a LABEL SOURCE, not content — without it VoiceOver
    // stops on the span itself as a huge phantom selection before the image.
    // aria-labelledby still resolves into hidden elements by spec.
    assert.ok(
      body.includes(
        '<span id="radical-label" class="visually-hidden" aria-hidden="true">Radical image: <span lang="ja">みず</span></span>'
      ),
      "the radical image's label span lost its 'Radical image:' prefix or its " +
        "aria-hidden — VoiceOver stops on it as a phantom item without the latter"
    );
    assert.match(
      body,
      /class="radical-character" role="img" aria-labelledby="radical-label"[^>]*alt="みず"/,
      "the radical image no longer points at its split-language label"
    );
    assert.match(
      body,
      /class="radical-position" role="img"[^>]*alt="Radical position: hen"/,
      "the position icon lost its position-naming alt or its role=img"
    );

    // Name, meaning and stroke count announce what they are, not bare values. The
    // colon is deliberate: it paces the spoken announcement (his wording).
    assert.ok(
      body.includes(
        'class="radical-name"><span class="visually-hidden">Radical name: </span><span lang="ja">みず</span>'
      ),
      "the radical name lost its hidden 'Radical name:' prefix or its lang=\"ja\" run"
    );
    // &nbsp; after the colon, not a space: VoiceOver trims a run's trailing
    // whitespace, so a plain space read as "Radical strokes:7".
    assert.ok(
      body.includes(
        'class="radical-meaning"><span class="visually-hidden">Radical meaning:&nbsp;</span>'
      ),
      "the radical meaning lost its hidden 'Radical meaning:' prefix or its &nbsp;"
    );
    assert.ok(
      body.includes(
        '<span class="visually-hidden">Radical strokes:&nbsp;</span>4'
      ),
      "the radical stroke count announces as a bare number again, or lost its &nbsp;"
    );

    // VoiceOver walks the panel in DOM order; the maintainer specified the visual
    // reading order (2026-07-30): glyph, reading, meaning, strokes, position,
    // animation. All absolutely positioned, so the DOM is free to follow speech.
    const radOrder = [
      'class="radical-character"',
      'class="radical-name"',
      'class="radical-meaning"',
      'class="radical-stroke"',
      'class="radical-position"',
      'class="ka-rad-anim',
    ].map((sel) => body.indexOf(sel));
    assert.ok(
      radOrder.every((at) => at !== -1) &&
        radOrder.every((at, i) => i === 0 || at > radOrder[i - 1]),
      "the radical panel's DOM order no longer matches the specified speech order " +
        "(glyph, reading, meaning, strokes, position, animation)"
    );

    assert.match(
      body,
      /<h3 class="meaning" aria-level="2">/,
      "the detail h3s lost aria-level=2 — heading navigation jumps from level 1 to 3"
    );

    // aria-disabled (never disabled, which restyles): the typeface chevrons must
    // announce as unavailable at the ends instead of being silent no-ops.
    assert.ok(
      body.includes(':aria-disabled="typefaceIndex === 0"') &&
        body.includes(':aria-disabled="typefaceIndex === typefaces.length - 1"'),
      "the typeface chevrons no longer announce their disabled state at the ends"
    );

    assert.ok(
      body.includes('<th scope="row">'),
      "the help-modal tables lost their row headers — cells announce without context"
    );

    // Two keyboard guards, string-matched from the shipped page (the handler
    // closes over `this` and cannot be lifted): Space must yield to a focused
    // control, and no shortcut may act behind the open help dialog.
    assert.ok(
      body.includes("e.target.closest('button, [role=\"button\"], a')"),
      "the Space-yield guard is gone — Space on a focused button toggles the video instead"
    );
    assert.ok(
      body.includes("this.$refs.helpDialog.open) return;"),
      "the modal guard is gone — shortcuts navigate behind the open Quick Reference"
    );
  });
});
