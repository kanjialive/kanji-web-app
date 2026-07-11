import { MongoClient, ServerApiVersion, Db } from "mongodb";
import path from "path";
import express, { Request, Response, NextFunction } from "express";
import promBundle from "express-prom-bundle";
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
    try {
      await client.connect();
      await client.db("kanjialive").command({ ping: 1 });
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

      break;
    } catch (err) {
      console.error(
        `Error connecting to MongoDB database (attempt ${
          connectionAttempts + 1
        }/${maxConnectionAttempts}): ${err}`
      );
      connectionAttempts++;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

// Root route handler for HTMX mode (must be before static middleware)
if (USE_HTMX) {
  app.get("/", (req: Request, res: Response) => {
    res.redirect("/htmx/search");
  });
}

// Static files — serve only intended directories, not the entire dist/ root
app.use("/static", express.static(path.join(__dirname, "static")));
app.use("/partials", express.static(path.join(__dirname, "partials")));
if (!USE_HTMX) {
  // AngularJS mode needs index.html served at root
  app.get("/", (req: Request, res: Response) => {
    res.sendFile("index.html", { root: __dirname });
  });
}

// add the prometheus middleware to all routes
app.use(
  promBundle({
    includeMethod: true,
    includePath: true,

    normalizePath: [
      ["^/(?:%[0-9A-Fa-f]{2})+$", "/#character"],
      ["^/search/.*", "/search/#search_term"],
      ["^/api/kanji/id/.*", "/api/kanji/id/#kanji_id"],
      ["^/api/search/.*", "/api/search/#search_term"],
      ["^/api/kanji/.*", "/api/kanji/#character"],
      ["^/api/public/kanji/.*", "/api/public/kanji/#character"],
      ["^/api/public/search/.*", "/api/public/search/#search_term"],
      ["^.*\\.[a-zA-Z0-9]+$", "/#static_files"],
    ],
    metricsPath: "/api/metrics",
  })
);

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

// HTMX routes (when USE_HTMX=true or ?htmx=true query param)
app.use("/htmx", html_routes.router);

// Catch-all route: serve HTMX or AngularJS based on feature flag
app.all("/*", function (req: Request, res: Response) {
  // Check for ?htmx=true query param to allow testing
  const useHtmx = USE_HTMX || req.query.htmx === "true";

  if (useHtmx) {
    // For HTMX mode, redirect root to /htmx/search
    const path = req.path;
    if (path === "/" || path === "") {
      return res.redirect("/htmx/search");
    }
    // For kanji character paths, redirect to /htmx/:character
    if (path.length <= 4 && !path.includes(".")) {
      return res.redirect(`/htmx${path}`);
    }
    // For search paths, redirect to /htmx/search
    if (path.startsWith("/search/")) {
      const query = path.replace("/search/", "");
      return res.redirect(`/htmx/search?q=${encodeURIComponent(query)}`);
    }
  }

  // Default: serve AngularJS SPA
  const options = {
    root: path.join(__dirname),
  };
  res.sendFile("index.html", options);
});

connectMongoDB();
