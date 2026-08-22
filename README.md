# Kanji alive web application

This project is a Japanese kanji learning web application [https://app.kanjialive.com](https://app.kanjialive.com) built with:

  - Frontend: server-rendered EJS views with [Alpine.js](https://alpinejs.dev) for interactivity
  - Backend: Node.js 24.x + Express 4.x serving both static files and API endpoints
  - Database: MongoDB 8.x for kanji data storage

The architecture follows a client-server model with:

  1. Server API split into private (internal) and public (external) endpoints
  2. EJS pages for search, detail, and documentation views, rendered on the server
  3. Custom media handling for kanji stroke animations and audio

The app has three runtime dependencies — `ejs`, `express` and `mongodb`. Client libraries are vendored and pinned under `static/js/libs/` rather than loaded from a CDN.

### Feature changes

• Made various small improvements to the appearance of the user interface
• Updated and standardised the use of web fonts 
• Added a “shift + r” keyboard shortcut for the radical animation
• Made web browser bookmarks of Kanji alive pages more informative
• Improved the web application’s accessibility features (work-in-progress)
• Added support for searching for missing values with an empty key (e.g. 'grade:'); grade:n/a no longer works."
• Removed support for Kenkyusha’s Luminous Dictionary
• Updated the Kanji alive API

### Legacy version

Note: Until August 2026, this was an AngularJS 1.5.8 single-page app. That frontend has been removed; the last commit serving it is tagged
[`angularjs-final`](https://github.com/kanjialive/kanji-web-app/tree/angularjs-final).

### Kanji alive data and API

Our [data and media](https://github.com/kanjialive/kanji-data-media) repository includes all of the language data and media files created for _Kanji alive_. These files will primarily interest instructors and students who want to re-use them for teaching and learning. Developers may prefer instead to make use of the free [public API](https://rapidapi.com/KanjiAlive/api/learn-to-read-and-write-japanese-kanji) ([docs](https://app.kanjialive.com/api/docs/)) to the _Kanji alive_ web application. 

### Credits

Application development: Arno Bosse w/Claude Code (Alpine.js/EJS), Joshua Day (Angular). Japanese language data and media: Harumi Hibino Lory and the _Kanji alive_ team. UI Design: Arno Bosse. Contributions and bug fixes: Eric Volpert, Joshua Day, Peter Thorson, Tanya Gray Jones, Mat Wilcoxson and to the many users who reported errors and suggested improvements over the years. Please see [our main website](http://kanjialive.com/credits/) for more details.

### Contact

Please contact kanjialive@gmail.com with questions or if you would like to contribute to the project. 
