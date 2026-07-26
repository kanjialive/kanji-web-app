import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

//
// Why this file exists (2026-07-26).
//
// window.loadResults() started a bare fetch() per call and unconditionally wrote
// #search-results with whatever came back. The issue that reported it blamed "a slow or
// variable connection", which makes it sound theoretical. It is not: holding ArrowUp or
// ArrowDown fires OS key repeat at ~30 events/sec, and search.ejs maps each one to
// cycleMode(), so a dozen requests overlap on a perfectly good connection. The response
// that ARRIVES last wins, and with that many in flight it is routinely not the one SENT
// last — leaving the displayed sort mode disagreeing with the URL and with the highlighted
// control, which reads to a student as the app being broken.
//
// The second bug lived in the same function. The success path detached the custom
// scrollbar track and put it back; the error path just overwrote innerHTML and destroyed
// it. Because the success path then found null where the track used to be, ONE failed
// search disabled the scrollbar for every LATER search until a full page reload — a
// permanent effect from a transient failure.
//
// The view layer has no test harness: this is an inline <script> in an EJS template, and
// jsdom is a dependency this project will not take on — 39 transitive packages sitting on
// undici, whose advisories would break the `npm audit` = 0 invariant every few weeks for
// zero real exposure (it is a devDependency that never deploys). It would also be the
// wrong tool: jsdom buys fidelity to browser SEMANTICS, and browser semantics are not what
// broke here. What broke is ORDERING. That needs a spy, not a DOM.
//
// So this lifts the shipped code out of the template and runs it against stubs. The one
// piece of real DOM behaviour that matters is modelled explicitly below: assigning
// innerHTML discards every existing child. That is the behaviour that destroys the track,
// so a stub that got it wrong would make this whole file worthless.
//

const EJS_PATH = path.join(__dirname, "views", "pages", "search.ejs");
const src = fs.readFileSync(EJS_PATH, "utf8");

const START = "// LOAD-RESULTS-START";
const END = "// LOAD-RESULTS-END";

// Lift the region between the markers. Unlike results-nav.test.ts this cannot key off a
// function signature, because the thing under test is the interaction between three
// functions and two module-scope variables — so the template carries explicit markers.
function liftSource(): string {
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  assert.ok(
    from !== -1 && to > from,
    `could not find ${START} … ${END} in views/pages/search.ejs. If the markers were ` +
      `removed or renamed, restore them — do not delete this test.`,
  );
  return src.slice(from, to);
}

const LIFTED = liftSource();

// Guard against the markers surviving while the code inside them moves elsewhere.
assert.match(
  LIFTED,
  /window\.loadResults\s*=/,
  "the lifted region no longer defines window.loadResults — the markers have drifted off it",
);
assert.match(
  LIFTED,
  /AbortController/,
  "the lifted region no longer aborts superseded requests",
);

// ── stubs ────────────────────────────────────────────────────────────────────────────

type FakeNode = { cls: string; remove?: () => void };

type FakeTarget = {
  innerHTML: string;
  querySelector(sel: string): FakeNode | null;
  appendChild(node: FakeNode): void;
  childClasses(): string[];
  // Every value ever assigned to innerHTML, in order. Asserting on the FINAL state is not
  // enough: a wrongly-rendered error state that a later response overwrites still reached
  // the screen, and at key-repeat rate it strobes. Only the write log sees that.
  writes(): string[];
};

function makeTarget(): FakeTarget {
  let html = "";
  const written: string[] = [];
  const children: FakeNode[] = [{ cls: "custom-scrollbar-track" }];
  return {
    get innerHTML(): string {
      return html;
    },
    // THE one piece of real DOM behaviour this file depends on: assigning innerHTML
    // discards every existing child. That is what destroys the scrollbar track.
    set innerHTML(value: string) {
      html = value;
      written.push(value);
      children.length = 0;
    },
    querySelector(sel: string): FakeNode | null {
      const cls = sel.replace(/^\./, "");
      const found = children.find((c) => c.cls === cls);
      if (!found) return null;
      found.remove = (): void => {
        const i = children.indexOf(found);
        if (i >= 0) children.splice(i, 1);
      };
      return found;
    },
    appendChild(node: FakeNode): void {
      children.push(node);
    },
    childClasses: (): string[] => children.map((c) => c.cls),
    writes: (): string[] => written.slice(),
  };
}

type FakeResponse = {
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};

function response(
  body: string,
  headers: Record<string, string> = {},
  ok = true,
): FakeResponse {
  return {
    ok,
    headers: { get: (name: string) => headers[name] ?? null },
    text: async () => body,
  };
}

type FetchStub = (
  url: string,
  opts: { signal: AbortSignal },
) => Promise<FakeResponse>;

type Harness = {
  load: (url: string) => Promise<void>;
  target: FakeTarget;
  pushed: string[];
  events: string[];
  location: { href: string };
};

function harness(fetchStub: FetchStub): Harness {
  const target = makeTarget();
  const pushed: string[] = [];
  const events: string[] = [];
  const windowStub = {
    location: { href: "" },
    loadResults: undefined as unknown as (url: string) => Promise<void>,
  };
  const documentStub = {
    getElementById: (id: string): FakeTarget | null =>
      id === "search-results" ? target : null,
    dispatchEvent: (e: { type: string }): boolean => {
      events.push(e.type);
      return true;
    },
  };
  const historyStub = {
    pushState: (_state: unknown, _title: string, url: string): void => {
      pushed.push(url);
    },
  };
  class CustomEventStub {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  }

  // Each call re-evaluates the lifted source, so the module-scope request counter starts
  // clean per test rather than leaking across them.
  const factory = new Function(
    "window",
    "document",
    "fetch",
    "history",
    "CustomEvent",
    "AbortController",
    `${LIFTED}\nreturn window.loadResults;`,
  );
  const load = factory(
    windowStub,
    documentStub,
    fetchStub,
    historyStub,
    CustomEventStub,
    AbortController, // the real one — Node has it, so there is no need to fake it
  ) as (url: string) => Promise<void>;

  return { load, target, pushed, events, location: windowStub.location };
}

// ── the race (#4) ────────────────────────────────────────────────────────────────────

test("a stale response cannot overwrite a newer one", async () => {
  const release: Array<() => void> = [];
  // Deliberately ignores the abort signal: this models a response that was already past
  // the abort point when the next request started. Aborting is an optimisation for the
  // server, never the correctness guarantee — that is what the request stamp is for.
  const env = harness(async (url) => {
    await new Promise<void>((resolve) => release.push(resolve));
    return response(`<p>${url}</p>`, { "X-Push-Url": url });
  });

  const first = env.load("/htmx/partials/results?mode=rsort");
  const second = env.load("/htmx/partials/results?mode=ksort");

  // The SECOND request answers first, then the first straggles in — the ordering a held
  // arrow key produces routinely.
  release[1]();
  await second;
  release[0]();
  await first;

  assert.match(env.target.innerHTML, /mode=ksort/);
  assert.doesNotMatch(
    env.target.innerHTML,
    /mode=rsort/,
    "a superseded response overwrote the newer results",
  );
  assert.deepEqual(
    env.pushed,
    ["/htmx/partials/results?mode=ksort"],
    "a superseded response pushed its URL, desynchronising the address bar from the view",
  );
  assert.deepEqual(env.events, ["results:loaded"]);
});

test("a stale response cannot navigate the browser", async () => {
  const release: Array<() => void> = [];
  const env = harness(async (url) => {
    await new Promise<void>((resolve) => release.push(resolve));
    return url === "/a"
      ? response("", { "X-Redirect": "/stale-target" })
      : response("<p>fresh</p>");
  });

  const first = env.load("/a");
  const second = env.load("/b");
  release[1]();
  await second;
  release[0]();
  await first;

  assert.equal(
    env.location.href,
    "",
    "a superseded response followed its X-Redirect and navigated the browser away",
  );
  assert.match(env.target.innerHTML, /fresh/);
});

test("an aborted request does not paint the error state over good results", async () => {
  let started = 0;
  const env = harness((_url, opts) => {
    started += 1;
    if (started === 1) {
      // Honour the abort, as a real fetch does.
      return new Promise<FakeResponse>((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }
    return Promise.resolve(response("<p>fresh results</p>"));
  });

  const first = env.load("/a");
  const second = env.load("/b");
  await Promise.all([first, second]);

  assert.match(env.target.innerHTML, /fresh results/);
  // Checked against every write, not the final state. Without the AbortError early-return
  // the error markup IS painted and then overwritten by the winning response — invisible
  // to a final-state assertion, but at key-repeat rate the user sees it strobe.
  const errorWrites = env.target.writes().filter((w) => /something went wrong/.test(w));
  assert.deepEqual(
    errorWrites,
    [],
    "cancelling a superseded request rendered the error state — the fix is worse than the bug",
  );
});

// ── the scrollbar track (#5) ─────────────────────────────────────────────────────────

test("a failed search leaves the scrollbar track intact for the next one", async () => {
  let call = 0;
  const env = harness(async () => {
    call += 1;
    if (call === 1) throw new Error("network down");
    return response("<p>results</p>");
  });

  await env.load("/a");
  assert.match(env.target.innerHTML, /something went wrong/, "the error state must still render");
  assert.deepEqual(
    env.target.childClasses(),
    ["custom-scrollbar-track"],
    "the error path destroyed the scrollbar track, which disables it for every later search",
  );

  await env.load("/b");
  assert.match(env.target.innerHTML, /results/);
  assert.deepEqual(
    env.target.childClasses(),
    ["custom-scrollbar-track"],
    "the track did not survive the search after a failure",
  );
});

test("a server error renders the error state and keeps the track", async () => {
  const env = harness(async () => response("<p>ignored</p>", {}, false));

  await env.load("/a");

  assert.match(env.target.innerHTML, /something went wrong/);
  // The .scroller wrapper is load-bearing: .no-results is absolutely positioned against
  // it, and without the wrapper the message renders 23px high.
  assert.match(env.target.innerHTML, /class="scroller scroller-kanji"/);
  assert.deepEqual(env.target.childClasses(), ["custom-scrollbar-track"]);
});
