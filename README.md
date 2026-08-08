# Kanji alive web application

This project is a Japanese kanji learning web application [https://app.kanjialive.com](https://app.kanjialive.com) built with:

  - Frontend: server-rendered EJS views with [Alpine.js](https://alpinejs.dev) for interactivity
  - Backend: Node.js 24.x + Express 4.x serving both static files and API endpoints
  - Database: MongoDB 8.x for kanji data storage

  The architecture follows a client-server model with:
  1. Server API split into private (internal) and public (external) endpoints
  2. EJS pages for search, detail, and documentation views, rendered on the server
  3. Custom media handling for kanji stroke animations and audio

The app has three runtime dependencies — `ejs`, `express` and `mongodb`. That is a
deliberate constraint rather than a coincidence: it is maintained by a single volunteer
and has to keep running for years at a time, so client libraries are vendored and pinned
under `static/js/libs/` rather than loaded from a CDN.

The application was an AngularJS 1.5.8 single-page app until August 2026. That frontend
has been removed; the last commit serving it is tagged
[`angularjs-final`](https://github.com/kanjialive/kanji-web-app/tree/angularjs-final).

### Environment setup

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

`MONGODB_URI` and `MASHAPE_SECRET` are required — the server exits on startup if
either is missing. `PORT` (default 5000) is optional.

The project does not use `dotenv`, and nothing reads `.env` on its own. Export the
variables into your shell before `npm run dev` or `npm start`:

```bash
set -a; source .env; set +a
```

`npm run dev` compiles TypeScript and copies the static files into `dist/`, then
runs the compiled server — the same tree that deploys. It is deliberately not a
separate source-execution path: CSS, fonts and client JS are only served from
`dist/static`, so a command that skipped the build would render every page
unstyled.

### Developer API and data

Our [data and media](https://github.com/kanjialive/data-media) repository includes all of the language data and media files created for _Kanji alive_. We expected that these files will primarily interest instructors and students who want to re-use them for teaching and learning. Developers may prefer instead to make use of our free, [public API](https://rapidapi.com/KanjiAlive/api/learn-to-read-and-write-japanese-kanji) ([docs](https://app.kanjialive.com/api/docs/)) to the _Kanji alive_ web application. 

### Contributions

Your bug reports, feature suggestions or pull requests with improvements to the app are all welcome.

### Credits

Application development: Joshua Day. Japanese language data and media: Harumi Hibino Lory and the _Kanji alive_ team. UI Design: Arno Bosse. Contributions and bug fixes: Eric Volpert, Joshua Day, Peter Thorson, Tanya Gray Jones, Mat Wilcoxson, and Arno Bosse. Please see [our main website](http://kanjialive.com/credits/) for more details.

### Contact

Please contact kanjialive@gmail.com with questions or if you would like to contribute to the project. 
