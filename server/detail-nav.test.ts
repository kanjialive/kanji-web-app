import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

//
// Why this file exists (2026-07-26).
//
// navigateKanji() is the detail page's prev/next: fetch the next kanji's page, lift its
// .container2 out with DOMParser and replaceWith() it. It started a bare fetch() per call
// with no request identity, exactly as loadResults() did — and it is reachable two ways
// that both fire as fast as the hardware allows: the on-screen chevrons, and ArrowLeft /
// ArrowRight, which literally call .click() on those same links. So rapid clicking and
// rapid key presses produce identical overlapping requests.
//
// The consequence here is worse than on the search page. Two failures, not one:
//
//   1. The response that ARRIVED last won. It replaced .container2 with one kanji while
//      history.pushState had already written a different kanji's URL, so the page and the
//      address bar disagreed about what you were looking at.
//
//   2. The catch falls back to `window.location.href = url` — a HARD page load. Once
//      requests are aborted, every superseded navigation lands in that catch, so the fix
//      for (1) would, on its own, yank the browser to the kanji the user had already
//      navigated past. That is why the AbortError branch is load-bearing here in a way it
//      is not in search.ejs, where the same omission only paints a wrong error message.
//
// Same approach as results-race.test.ts: lift the shipped code, run it against stubs. No
// jsdom — the surface is querySelector/replaceWith/dataset and the bug is ordering, so a
// spy answers it and a DOM would not add anything. See CLAUDE.md, "the five gates".
//

const EJS_PATH = path.join(__dirname, "views", "pages", "detail.ejs");
const src = fs.readFileSync(EJS_PATH, "utf8");

const START = "// DETAIL-NAV-START";
const END = "// DETAIL-NAV-END";

function liftSource(): string {
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  assert.ok(
    from !== -1 && to > from,
    `could not find ${START} … ${END} in views/pages/detail.ejs. If the markers were ` +
      `removed or renamed, restore them — do not delete this test.`,
  );
  return src.slice(from, to);
}

const LIFTED = liftSource();

assert.match(
  LIFTED,
  /window\.navigateKanji\s*=/,
  "the lifted region no longer defines window.navigateKanji — the markers have drifted",
);

// ── stubs ────────────────────────────────────────────────────────────────────────────

type FakeContainer = { id: string; dataset: { title?: string }; replaceWith(n: FakeContainer): void };

type Harness = {
  nav: (url: string, e: { preventDefault(): void }) => Promise<void>;
  current: () => string;
  pushed: string[];
  titles: string[];
  hardNavigations: string[];
};

type FetchStub = (url: string, opts: { signal: AbortSignal }) => Promise<{ text(): Promise<string> }>;

// The page body is irrelevant to what is under test; only which kanji it carries is. So a
// "page" is just its identifier, and the DOMParser stub hands back a node labelled with it.
function harness(fetchStub: FetchStub): Harness {
  let current: FakeContainer = { id: "start", dataset: {}, replaceWith: () => {} };
  const pushed: string[] = [];
  const titles: string[] = [];
  const hardNavigations: string[] = [];

  const makeContainer = (id: string): FakeContainer => ({
    id,
    dataset: { title: `${id} title` },
    replaceWith: () => {},
  });

  const documentStub = {
    querySelector: (sel: string): FakeContainer | null => {
      if (sel !== ".container2") return null;
      return {
        ...current,
        replaceWith: (node: FakeContainer): void => {
          current = node;
        },
      };
    },
    set title(v: string) {
      titles.push(v);
    },
    get title(): string {
      return titles[titles.length - 1] ?? "";
    },
  };

  class DOMParserStub {
    parseFromString(html: string): { querySelector(sel: string): FakeContainer | null } {
      return {
        querySelector: (sel: string) =>
          sel === ".container2" && html !== "" ? makeContainer(html) : null,
      };
    }
  }

  const windowStub = {
    navigateKanji: undefined as unknown as Harness["nav"],
    location: {
      get href(): string {
        return hardNavigations[hardNavigations.length - 1] ?? "";
      },
      set href(v: string) {
        hardNavigations.push(v);
      },
    },
  };

  const historyStub = {
    pushState: (_s: unknown, _t: string, url: string): void => {
      pushed.push(url);
    },
  };

  const factory = new Function(
    "window",
    "document",
    "fetch",
    "history",
    "DOMParser",
    "AbortController",
    `${LIFTED}\nreturn window.navigateKanji;`,
  );
  const nav = factory(
    windowStub,
    documentStub,
    fetchStub,
    historyStub,
    DOMParserStub,
    AbortController,
  ) as Harness["nav"];

  return { nav, current: () => current.id, pushed, titles, hardNavigations };
}

const ev = (): { preventDefault(): void } => ({ preventDefault: (): void => {} });
const page = (id: string): { text(): Promise<string> } => ({ text: async () => id });

// ── the race ─────────────────────────────────────────────────────────────────────────

test("a stale navigation cannot replace the page or push its URL", async () => {
  const release: Array<() => void> = [];
  // Ignores the abort signal on purpose: a response already past the abort point still
  // resolves, which is the case the request stamp — not the abort — has to cover.
  const h = harness(async (url) => {
    await new Promise<void>((resolve) => release.push(resolve));
    return page(url.replace("/", ""));
  });

  const first = h.nav("/水", ev());
  const second = h.nav("/火", ev());

  release[1]();
  await second;
  release[0]();
  await first;

  assert.equal(h.current(), "火", "a superseded navigation replaced the page");
  assert.deepEqual(h.pushed, ["/火"], "a superseded navigation pushed its URL");
  assert.deepEqual(h.titles, ["火 title"], "a superseded navigation set the document title");
});

test("an aborted navigation never triggers the hard-reload fallback", async () => {
  // The dangerous one. The catch falls back to window.location.href, so treating an abort
  // as a failure would send the browser to the kanji the user had already moved past.
  let started = 0;
  const h = harness((_url, opts) => {
    started += 1;
    if (started === 1) {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }
    return Promise.resolve(page("火"));
  });

  await Promise.all([h.nav("/水", ev()), h.nav("/火", ev())]);

  assert.deepEqual(
    h.hardNavigations,
    [],
    "an aborted navigation fell through to window.location.href and reloaded the browser",
  );
  assert.equal(h.current(), "火");
});

test("a genuine failure still falls back to a hard navigation", async () => {
  // The abort guard must not have disabled the fallback for real failures.
  const h = harness(async () => {
    throw new TypeError("network down");
  });

  await h.nav("/水", ev());

  assert.deepEqual(h.hardNavigations, ["/水"], "a real failure no longer falls back");
});

test("a successful navigation swaps the page and pushes a clean URL", async () => {
  const h = harness(async () => page("火"));

  await h.nav("/火?from=search", ev());

  assert.equal(h.current(), "火");
  assert.deepEqual(h.pushed, ["/火"], "the query string was not stripped from the pushed URL");
  assert.deepEqual(h.titles, ["火 title"]);
  assert.deepEqual(h.hardNavigations, []);
});

test("a response with no .container2 falls back rather than blanking the page", async () => {
  const h = harness(async () => page(""));

  await h.nav("/水", ev());

  assert.equal(h.current(), "start", "the page was replaced with nothing");
  assert.deepEqual(h.hardNavigations, ["/水"]);
});

// ── the auto-repeat guard ────────────────────────────────────────────────────────────

// String-matched rather than executed: the handler is built inside the Alpine component's
// init() and closes over `this`, so it cannot be lifted the way navigateKanji can. That
// makes this the weaker kind of gate — it survives a rename and goes green while guarding
// nothing. It is here because the failure is silent (a held key looks like a broken page,
// not an error) and the guard is one easily-dropped line.
test("the detail keydown handler ignores auto-repeat", () => {
  assert.match(
    src,
    /if \(e\.repeat\) \{/,
    "the auto-repeat guard is gone from views/pages/detail.ejs — holding an arrow key " +
      "will fire ~33 actions per second again",
  );
});

test("auto-repeat still suppresses the browser's own scrolling", () => {
  // Returning early on repeat must not skip preventDefault for the keys this page owns,
  // or a held ArrowDown scrolls the window instead of doing nothing.
  const guard = src.slice(src.indexOf("if (e.repeat) {"), src.indexOf("// 'r' — replay"));
  for (const code of ["Space", "ArrowUp", "ArrowDown"]) {
    assert.match(
      guard,
      new RegExp(`'${code}'`),
      `${code} is no longer preventDefault-ed on auto-repeat, so holding it will scroll the page`,
    );
  }
  assert.match(guard, /e\.preventDefault\(\)/);
});

// ── play/pause state (2026-07-26) ────────────────────────────────────────────────────

// String-matched, like the auto-repeat tests above and for the same reason: these live
// inside the Alpine component and close over `this`, so they cannot be lifted and run.
//
// The bug this pins was NOT ours, which is what makes it worth pinning. A Safari
// extension ("Stop the Madness", https://underpassapp.com/StopTheMadness/) also binds
// the spacebar and paused the video immediately after our handler started it. Because
// `playing` was set optimistically beside video.play(), and only `ended` could clear it,
// the icon flipped to pause and STAYED there while nothing played — and every further
// press re-asserted it. It read as an application bug for an hour of investigation.
// Bound to the element's own events the icon cannot lie, so the same interference would
// present as the icon flipping straight back: visibly something else fighting the page.

test("the video's own events are the only thing that sets `playing`", () => {
  for (const evt of ["play", "pause", "ended"]) {
    assert.match(
      src,
      new RegExp(`addEventListener\\('${evt}',`),
      `the '${evt}' listener is gone from views/pages/detail.ejs — the play/pause icon ` +
        `can no longer track the video's real state`,
    );
  }
});

test("togglePlayPause and seek never assign `playing` themselves", () => {
  const body = (name: string): string => {
    const m = src.match(new RegExp(`\\n      ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n      \\},`));
    assert.ok(m, `could not find ${name}() in views/pages/detail.ejs — update this pattern`);
    return m![1];
  };

  for (const fn of ["togglePlayPause", "seek"]) {
    assert.doesNotMatch(
      body(fn),
      /this\.playing\s*=/,
      `${fn}() sets this.playing directly again. That is optimistic state: if playback ` +
        `does not actually start, the icon lies and cannot recover.`,
    );
  }

  // The rejection must be handled, or a blocked start becomes an unhandled rejection.
  assert.match(body("togglePlayPause"), /\.catch\(/, "video.play()'s rejection is unhandled");
});
