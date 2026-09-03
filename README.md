# Kanji alive web application

This project is a [Japanese kanji learning web application](https://app.kanjialive.com) built with:

  - Frontend: server-rendered EJS views with [Alpine.js](https://alpinejs.dev) for interactivity
  - Backend: Node.js 24.x + Express 5.x serving both static files and API endpoints
  - Database: MongoDB 8.x for kanji data storage

The architecture follows a client-server model with:

  1. Two JSON API surfaces: one requires a free RapidAPI key, the other is open and unsupported
  2. EJS pages for search, detail, and documentation views, rendered on the server
  3. Custom media handling for kanji stroke animations and audio

The app has three runtime dependencies — `ejs`, `express` and `mongodb`. Client libraries are vendored and pinned under `static/js/libs/` rather than loaded from a CDN.

### Feature changes

v2.1

- Made various small improvements to the appearance of the user interface
- Updated and standardised the use of web fonts 
- Added a “shift + r” keyboard shortcut for the radical animation
- Made web browser bookmarks of Kanji alive pages more informative
- Improved the web application’s accessibility features (work-in-progress)
- Search for missing values with an empty key only (e.g. "grade:"); "grade:n/a" no longer works
- Removed support for Kenkyusha’s Luminous Dictionary
- Updated the Kanji alive API

### Legacy version

Note: Until August 2026, this was an AngularJS 1.5.8 single-page app. That frontend has been removed; the last commit serving it is tagged
[`angularjs-final`](https://github.com/kanjialive/kanji-web-app/tree/angularjs-final).

### Kanji alive data and API

Our [data and media](https://github.com/kanjialive/kanji-data-media) repository includes all of the language data and media files created for _Kanji alive_. These files will primarily interest instructors and students who want to re-use them for teaching and learning. Developers may prefer instead to make use of the free [public API](https://rapidapi.com/KanjiAlive/api/learn-to-read-and-write-japanese-kanji) ([docs](https://app.kanjialive.com/api/docs/)) to the _Kanji alive_ web application. 

The application serves two JSON APIs. The public API above requires a free RapidAPI key and has documented, stable response shapes; it is the one to build against. A second set of endpoints under `/api/` needs no key. Despite the `private-api` name in the source these are not internal — they are reachable by anyone. But they have no documentation and their response shapes may change without notice. They are kept because they are the project's only JSON API that does not depend on a third-party gateway. Neither API serves the licence-restricted mnemonic hints or textbook mappings.

### Development

```bash
cp .env.example .env          # fill in the values
set -a; source .env; set +a   # no dotenv here — nothing reads .env on its own
npm run dev
```

Single-quote every value: the Atlas connection string contains `&`, and unquoted, `source .env` fails on it and sets nothing.

`npm run dev` builds before it runs, and must — static files are served only from `dist/static`, so an unbuilt server renders every page unstyled.

Gates, all three must pass: `npm run typecheck`, `npm run lint` (zero findings), `npm test`.

### Credits

Application development: Arno Bosse w/Claude Code (Alpine.js/EJS), Joshua Day (Angular). Japanese language data and media: Harumi Hibino Lory and the _Kanji alive_ team. UI/UX design: Arno Bosse. Contributions and bug fixes: Eric Volpert, Joshua Day, Peter Thorson, Tanya Gray Jones, Mat Wilcoxson and the many users who reported errors and suggested improvements over the years. Please see [our main website](https://kanjialive.com/credits/) for more details.

### Contact

Please contact kanjialive@gmail.com with questions or if you would like to contribute to the project. 
