# Kanji alive web application

This project is a Japanese kanji learning web application [https://app.kanjialive.com](https://app.kanjialive.com) built with:

  - Frontend: AngularJS 1.5.8 SPA with Bootstrap UI components
  - Backend: Node.js 22.x + Express 4.x serving both static files and API endpoints
  - Database: MongoDB 8.x for kanji data storage

  The architecture follows a client-server model with:
  1. Server API split into private (internal) and public (external) endpoints
  2. Angular controllers for search, detail, and documentation views
  3. Custom media handling for kanji stroke animations and audio

### Developer API and data

Our [data and media](https://github.com/kanjialive/data-media) repository includes all of the language data and media files created for _Kanji alive_. We expected that these files will primarily interest instructors and students who want to re-use them for teaching and learning. Developers may prefer instead to make use of our free, [public API](https://rapidapi.com/KanjiAlive/api/learn-to-read-and-write-japanese-kanji) ([docs](https://app.kanjialive.com/api/docs/)) to the _Kanji alive_ web application. 

### Contributions

Your bug reports, feature suggestions or pull requests with improvements to the app are all welcome.

### Credits

Application development: Joshua Day. Japanese language data and media: Harumi Hibino Lory and the _Kanji alive_ team. UI Design: Arno Bosse. Contributions and bug fixes: Eric Volpert, Joshua Day, Peter Thorson, Tanya Gray Jones, Mat Wilcoxson, and Arno Bosse. Please see [our main website](http://kanjialive.com/credits/) for more details.

### Contact

Please contact kanjialive@gmail.com with questions or if you would like to contribute to the project. 
