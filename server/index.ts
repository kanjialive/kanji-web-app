import { MongoClient, ServerApiVersion, Db } from "mongodb";
import path from "path";
import express, { Request, Response, NextFunction } from "express";
import * as private_api from "./private-api";
import * as public_api from "./public-api";
import * as html_routes from "./html-routes";

const app = express();

// Configure EJS as the view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Feature flag for HTMX frontend (set USE_HTMX=true to enable)
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
    // ONLY the connection is retried, and only it is inside this try. Everything below
    // used to sit in here too, so any throw from an init(), app.set() or app.listen()
    // was logged as "Error connecting to MongoDB database", retried ten times over ~45
    // seconds, and finally reported as FATAL: could not connect to MongoDB — sending
    // whoever read the log to check Atlas while Atlas was fine. Retrying app.listen()
    // is meaningless anyway. Nothing below can realistically throw today; this keeps the
    // message honest if that ever changes.
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
      // No point sleeping after the last attempt — nothing follows it.
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

  // Fail LOUDLY, the same rule the HTML routes follow. This used to fall out of the
  // loop and simply... stop: no app.listen(), no exit, no final message. The process
  // stayed alive, serving nothing, saying nothing — a deploy that looks like it booted
  // and never did. Exiting non-zero is what makes Heroku's log say "crashed" instead.
  // Missing MONGODB_URI already exits 1 above; an unreachable database must too.
  console.error(
    `FATAL: could not connect to MongoDB after ${maxConnectionAttempts} attempts. Exiting.`
  );
  process.exit(1);
}

// Root route handler for HTMX mode (must be before static middleware)
if (USE_HTMX) {
  app.get("/", (req: Request, res: Response) => {
    res.redirect("/search");
  });
}

// Static files — serve only intended directories, not the entire dist/ root.
//
// Fonts are mounted FIRST, and separately, so they can carry a long cache lifetime.
// Every webfont is self-hosted (see the @font-face note in kanji-alive-modern.css:
// webfonts are CORS-restricted, media is not, so a font on the CDN depends on a
// Cloudflare header that nothing else in the app needs). Express's default for static
// files is `Cache-Control: max-age=0`, i.e. revalidate on every page load — which
// would mean six extra round trips per page, where the CDN previously sent 30 days.
//
// ⚠️ Do NOT fold this into the /static mount below. CSS and JS MUST keep revalidating,
// or a deploy would not reach anyone for a month. Fonts are safe to cache hard because
// they only ever change by being REPLACED under a new name (as ka-search-sans was).
app.use(
  "/static/fonts",
  express.static(path.join(__dirname, "static/fonts"), { maxAge: "30d" })
);
app.use("/static", express.static(path.join(__dirname, "static")));
app.use("/partials", express.static(path.join(__dirname, "partials")));
if (!USE_HTMX) {
  // AngularJS mode needs index.html served at root
  app.get("/", (req: Request, res: Response) => {
    res.sendFile("index.html", { root: __dirname });
  });
}

// Prometheus metrics (express-prom-bundle + prom-client) were removed on
// 2026-07-12. They could not observe the failures that matter: every route
// returned HTTP 200 even during a database outage, so the metrics reported a
// perfectly healthy app while it was broken. Failures are now loud (5xx), which
// Heroku's logs and any uptime monitor can see — with two fewer dependencies to
// maintain over the app's remaining lifetime.
// See offline/durability-plan-2026-07-12.md.

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

// HTMX routes.
// USE_HTMX=true: the EJS frontend is served at the SAME canonical URLs as the
// AngularJS app (/search, /search/advanced, /search/:term, /:character) so
// bookmarked and shared production links keep their exact shape. Legacy /htmx
// page URLs 302 to their canonical form; only the XHR partial endpoint
// (/htmx/partials/*) is still served under the prefix — it never appears in
// the address bar.
// USE_HTMX unset (Angular mode): the HTMX frontend stays reachable at /htmx
// for testing, incl. the ?htmx=true escape hatch below.
if (USE_HTMX) {
  app.use("/htmx", (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/partials/")) return next();
    // 🔴 canonicalHtmxUrl() collapses the leading slashes — do NOT inline a bare
    // originalUrl.replace(/^\/htmx/, "") here again. That left "/htmx//evil.example"
    // redirecting to "//evil.example", which a browser reads as protocol-relative and
    // follows OFF this site. res.redirect() does not normalise the location for us.
    res.redirect(html_routes.canonicalHtmxUrl(req.originalUrl));
  });
  app.use("/htmx", html_routes.router);
  app.use("/", html_routes.router);
} else {
  app.use("/htmx", html_routes.router);
}

// Catch-all route: serve HTMX or AngularJS based on feature flag
app.all("/*", function (req: Request, res: Response) {
  if (USE_HTMX) {
    // Canonical HTMX routes are mounted above; whatever falls through is an
    // unknown path — Angular's router used redirectTo:'/search' for those
    return res.redirect("/search");
  }

  // Angular mode with ?htmx=true: per-request testing escape hatch
  if (req.query.htmx === "true") {
    const path = req.path;
    if (path === "/" || path === "") {
      return res.redirect("/htmx/search");
    }
    // Advanced search keeps its query string (must be checked before /search/)
    if (path === "/search/advanced") {
      const qIndex = req.originalUrl.indexOf("?");
      const qs = qIndex >= 0 ? req.originalUrl.slice(qIndex) : "";
      return res.redirect(`/htmx/search/advanced${qs}`);
    }
    // For search paths, redirect to /htmx/search
    if (path.startsWith("/search/")) {
      const query = decodeURIComponent(path.replace("/search/", ""));
      return res.redirect(`/htmx/search?q=${encodeURIComponent(query)}`);
    }
    // For kanji character paths, redirect to /htmx/:character
    // (req.path is percent-encoded, so decode before the length check —
    // "/分" arrives as "/%E5%88%86")
    let decodedPath = path;
    try {
      decodedPath = decodeURIComponent(path);
    } catch {
      // malformed escape sequence — fall through to the SPA
    }
    if (decodedPath.length <= 4 && !decodedPath.includes(".")) {
      return res.redirect(`/htmx${path}`);
    }
  }

  // Default: serve AngularJS SPA
  const options = {
    root: path.join(__dirname),
  };
  res.sendFile("index.html", options);
});

connectMongoDB();
