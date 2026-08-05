import { MongoClient, ServerApiVersion, Db } from "mongodb";
import path from "path";
import express, { Request, Response, NextFunction } from "express";
import * as private_api from "./private-api";
import * as public_api from "./public-api";
import * as html_routes from "./html-routes";

const app = express();

// EJS view engine.
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// USE_HTMX=true serves the Alpine/EJS frontend; unset serves the legacy AngularJS SPA.
const USE_HTMX = process.env.USE_HTMX === "true";

const MONGODB_URI = process.env.MONGODB_URI;
const MASHAPE_SECRET = process.env.MASHAPE_SECRET;

if (!MONGODB_URI) {
  console.error("MONGODB_URI environment variable is required");
  process.exit(1);
}
if (!MASHAPE_SECRET) {
  console.error("MASHAPE_SECRET environment variable is required");
  process.exit(1);
}

let db: Db;

const client = new MongoClient(MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function connectMongoDB() {
  let connectionAttempts = 0;
  const maxConnectionAttempts = 10;
  while (connectionAttempts < maxConnectionAttempts) {
    // Only the connection belongs in this try: a throw from an init() or app.listen()
    // inside it gets reported as a MongoDB failure and retried ten times, sending the
    // reader to check Atlas for no reason.
    try {
      await client.connect();
      await client.db("kanjialive").command({ ping: 1 });
    } catch (err) {
      console.error(
        `Error connecting to MongoDB database (attempt ${
          connectionAttempts + 1
        }/${maxConnectionAttempts}): ${err}`
      );
      connectionAttempts++;
      // No point sleeping after the last attempt.
      if (connectionAttempts < maxConnectionAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      continue;
    }

    console.log("Successfully connected to MongoDB database for kanjialive!");

    db = client.db("kanjialive");
    public_api.init(db);
    private_api.init(db);
    html_routes.init(db);

    app.set("port", process.env.PORT || 5000);

    const server = app.listen(app.get("port"), function () {
      console.log("Node app is running at localhost:" + app.get("port"));
    });

    const shutdown = async () => {
      console.log("Shutting down gracefully...");
      server.close();
      await client.close();
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    return;
  }

  // Fail LOUDLY, the same rule the HTML routes follow. Falling out of the loop without
  // exiting leaves the process alive serving nothing — a deploy that looks like it booted
  // and never did. A non-zero exit is what makes Heroku's log say "crashed".
  console.error(
    `FATAL: could not connect to MongoDB after ${maxConnectionAttempts} attempts. Exiting.`
  );
  process.exit(1);
}

// Must precede the static middleware.
if (USE_HTMX) {
  app.get("/", (req: Request, res: Response) => {
    res.redirect("/search");
  });
}

// Serve only the intended directories, never the whole dist/ root.
//
// Fonts are mounted FIRST and separately so they can carry a long cache lifetime:
// Express's default is `Cache-Control: max-age=0`, i.e. revalidate on every page load,
// which would cost six extra round trips per page.
//
// Do NOT fold this into the /static mount below. CSS and JS MUST keep revalidating or a
// deploy would not reach anyone for a month. Fonts are safe to cache hard because they
// only ever change by being REPLACED under a new name.
app.use(
  "/static/fonts",
  express.static(path.join(__dirname, "static/fonts"), { maxAge: "30d" })
);
app.use("/static", express.static(path.join(__dirname, "static")));
app.use("/partials", express.static(path.join(__dirname, "partials")));

// Must stay ABOVE app.all("/*") — without it the catch-all 302s /robots.txt to /search,
// so crawlers read an HTML page as the rules and conclude nothing is disallowed.
// `/api/` because the unauthenticated JSON routes serve licence-restricted mn_hint;
// `/api/docs` is carved back in — it is public reference documentation and the place
// the licensing restriction is stated. A crawler that ignores Allow just skips the
// docs page; it cannot reach anything restricted. Kanji pages stay crawlable: they
// are the app's public face. This is a request to well-behaved crawlers, NOT access
// control — it does not stop a scraper, and nothing here should assume it does.
app.get("/robots.txt", (req: Request, res: Response) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /api/\nAllow: /api/docs\n");
});

// Must stay ABOVE app.all("/*") for the same reason as /robots.txt: the catch-all answers a
// missing icon with a 302 to /search, so every page load fetched an HTML page as its favicon.
// maxAge is the point — without it each load still revalidates, and a 304 is still a request.
// 7d, not the fonts' 30d: favicon.ico is a fixed path, so a replacement cannot be cache-busted.
const iconOptions = { root: path.join(__dirname, "static/icons"), maxAge: "7d" };
app.get("/favicon.ico", (req: Request, res: Response) => {
  res.sendFile("favicon.ico", iconOptions);
});
// iOS probes both spellings at the root; no view declares them.
app.get(
  ["/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"],
  (req: Request, res: Response) => {
    res.sendFile("apple-touch-icon.png", iconOptions);
  }
);
if (!USE_HTMX) {
  // AngularJS mode serves index.html at the root.
  app.get("/", (req: Request, res: Response) => {
    res.sendFile("index.html", { root: __dirname });
  });
}

// There is no metrics endpoint, deliberately. Prometheus metrics could not observe the
// failures that matter — every route returned HTTP 200 during a database outage, so they
// reported a healthy app while it was broken. Failures are loud (5xx) instead, which any
// log or uptime monitor can see, and two dependencies are gone.

app.get("/api/kanji/id/:id", private_api.getKanjiWithId);
app.get("/api/kanji/:character", private_api.getKanjiWithCharacter);
app.get("/api/search/advanced", private_api.advancedSearch);
app.get("/api/search/:search", private_api.basicSearch);

const requiresApiKey = function (
  req: Request,
  res: Response,
  next: NextFunction
) {
  const mashape_key = req.get("X-Mashape-Proxy-Secret");
  if (mashape_key === MASHAPE_SECRET) {
    next();
  } else {
    res.status(403).end();
  }
};

app.get(
  "/api/public/search/advanced",
  requiresApiKey,
  public_api.advancedSearch
);
app.get("/api/public/search/:search", requiresApiKey, public_api.basicSearch);
app.get("/api/public/kanji/all", requiresApiKey, public_api.getAllKanji);
app.get(
  "/api/public/kanji/:character",
  requiresApiKey,
  public_api.getKanjiWithCharacter
);

// USE_HTMX=true: the EJS frontend serves at the SAME canonical URLs as the AngularJS app
// (/search, /search/advanced, /search/:term, /:character), so bookmarked production links
// keep their shape. Legacy /htmx page URLs 302 to canonical; only the XHR partial endpoint
// stays under the prefix, and it never appears in the address bar.
// USE_HTMX unset: the EJS frontend stays reachable at /htmx for testing.
if (USE_HTMX) {
  app.use("/htmx", (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/partials/")) return next();
    // canonicalHtmxUrl() collapses the leading slashes. Do NOT inline a bare
    // originalUrl.replace(/^\/htmx/, "") here: that sends "/htmx//evil.example" to
    // "//evil.example", which a browser reads as protocol-relative and follows off-site.
    // res.redirect() does not normalise the location for us.
    res.redirect(html_routes.canonicalHtmxUrl(req.originalUrl));
  });
  app.use("/htmx", html_routes.router);
  app.use("/", html_routes.router);
} else {
  app.use("/htmx", html_routes.router);
}

// Catch-all: serves the EJS or AngularJS frontend per the feature flag.
app.all("/*", function (req: Request, res: Response) {
  if (USE_HTMX) {
    // The canonical routes are mounted above, so anything reaching here is unknown —
    // Angular's router used redirectTo:'/search' for those.
    return res.redirect("/search");
  }

  // Angular mode + ?htmx=true: a per-request testing escape hatch.
  if (req.query.htmx === "true") {
    const path = req.path;
    if (path === "/" || path === "") {
      return res.redirect("/htmx/search");
    }
    // Advanced search keeps its query string; check before /search/.
    if (path === "/search/advanced") {
      const qIndex = req.originalUrl.indexOf("?");
      const qs = qIndex >= 0 ? req.originalUrl.slice(qIndex) : "";
      return res.redirect(`/htmx/search/advanced${qs}`);
    }

    if (path.startsWith("/search/")) {
      const query = decodeURIComponent(path.replace("/search/", ""));
      return res.redirect(`/htmx/search?q=${encodeURIComponent(query)}`);
    }
    // req.path is percent-encoded, so decode before the length check:
    // "/分" arrives as "/%E5%88%86".
    let decodedPath = path;
    try {
      decodedPath = decodeURIComponent(path);
    } catch {
      // Malformed escape sequence — fall through to the SPA.
    }
    if (decodedPath.length <= 4 && !decodedPath.includes(".")) {
      return res.redirect(`/htmx${path}`);
    }
  }

  // Default: the AngularJS SPA.
  const options = {
    root: path.join(__dirname),
  };
  res.sendFile("index.html", options);
});

connectMongoDB();
