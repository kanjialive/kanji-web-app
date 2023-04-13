import { MongoClient, ServerApiVersion } from "mongodb";
import path from "path";
import express, { Request, Response, NextFunction } from "express";
import * as private_api from "./private-api";
import * as public_api from "./public-api";

const promBundle = require("express-prom-bundle");
const app = express();

const MONGODB_URI = process.env.MONGODB_URI as string;
const MASHAPE_SECRET = process.env.MASHAPE_SECRET as string;

let db: any;

const client = new MongoClient(MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function connectMongoDB() {
  try {
    await client.connect();
    await client.db("kanjialive").command({ ping: 1 });
    console.log("Successfully connected to MongoDB database for kanjialive!");

    db = client.db("kanjialive");
    public_api.init(db);
    private_api.init(db);

    app.set("port", process.env.PORT || 5000);

    app.listen(app.get("port"), function () {
      console.log("Node app is running at localhost:" + app.get("port"));
    });
  } catch (err) {
    console.error(err);
  }
}

app.use(express.static(__dirname));

// add the prometheus middleware to all routes
app.use(
  promBundle({
    includeMethod: true,
    includePath: true,

    normalizePath: [
      ["^/(?:%[0-9A-Fa-f]{2})+$", "/#character"],
      ["^/api/kanji/id/.*", "/api/kanji/id/#kanji_id"],
      ["^/api/search/.*", "/api/search/#search_term"],
      ["^/api/kanji/.*", "/api/kanji/#character"],
      ["^/api/public/kanji/.*", "/api/public/kanji/#character"],
      ["^/api/public/search/.*", "/api/public/search/#search_term"],
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

app.all("/*", function (req: Request, res: Response) {
  const options = {
    root: path.join(__dirname),
  };
  res.sendFile("index.html", options);
});

connectMongoDB();
