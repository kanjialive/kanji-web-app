# Fonts

Every webfont the app uses is **self-hosted from this directory**. None are loaded from
`media.kanjialive.com`, and none should be.

**Why self-hosted.** Not for outage resilience — if the media CDN is down the app is useless
anyway (no video, no strokes, no audio). It is because **webfonts are CORS-restricted and media
is not**:

```
CDN font   ->  access-control-allow-origin: *     (REQUIRED, or the browser rejects it)
CDN image  ->  no CORS header at all              (not required)
```

That single Cloudflare header is load-bearing for the fonts and for nothing else in the app.
Lose it — a tightened rule, Hotlink Protection, any config drift — and the CDN stays perfectly
healthy: every image, video and audio file keeps loading, while *every font is silently
rejected*. The play buttons vanish, the Sort view's radicals turn to tofu, and nothing in the
logs explains why. A same-origin font cannot fail that way. See the `@font-face` note in
`static/css/kanji-alive-modern.css`.

⚠️ Legacy AngularJS (`static/css/kanji-alive.css`) still loads its fonts from the CDN, so the
CDN's font files and their CORS header must stay until Angular is deleted.

**Caching.** `server/index.ts` mounts `/static/fonts` separately with `maxAge: 30d`. Express
defaults static files to `max-age=0` (revalidate every load). Do not fold that mount into the
general `/static` one — CSS and JS *must* keep revalidating or a deploy would not reach anyone
for a month.

## What is here

| font | renders | source | licence |
|---|---|---|---|
| `sourcesanspro-regular-webfont` | all Latin body text | Adobe Source Sans Pro (subset, 97 glyphs) | OFL 1.1 — `LICENSE-SourceSansPro.md` |
| `sourcesanspro-italic-webfont` | the italic *Kanji alive* wordmark | Adobe Source Sans Pro Italic | OFL 1.1 — `LICENSE-SourceSansPro.md` |
| `ka-search-sans` | the search input **only** | Source Sans Pro with **repaired vertical metrics** (below) | OFL 1.1 — `LICENSE-SourceSansPro.md` |
| `JapaneseRadicals-Regular` | `.ka-radical` — radical glyphs in the Sort views | Adobe **Source Han Sans** → [kanjialive/kanji-data-media/radicals-font](https://github.com/kanjialive/kanji-data-media/tree/master/radicals-font) | **Apache 2.0** — `LICENSE-JapaneseRadicals.txt` |
| `mplus-1m-icons` | typeface-gallery chevrons (`.ka-typeface-left/right`) | M+ 1m 1.056 subset (name table says `mplus-1m-regular`) | **M+ FONTS LICENSE** — `LICENSE-mplus.txt` |
| `ka-multimedia` | play / pause / step icons, incl. every example-audio button | Kanji alive's own icon font — **no licence metadata in the file** | ❓ unstated — see below |

`.woff2` is what every current browser takes; the `.woff` beside it is the legacy fallback.

### ka-search-sans — do not rename it back

Same outlines as `sourcesanspro-regular-webfont`, with the **vertical metrics repaired**. The
CDN's Source Sans Pro has its metrics clamped to 0.75 / 0.25 em (the real face is 0.984 / 0.273)
— and a text caret is drawn from the font's ascent to its descent, so in the search box the caret
cleared the top of an "H" by 0.9px while hanging 4px below the baseline. Used by `.search-bar`
only; correcting the metrics app-wide would shift baselines on every page.

Rebuild with `tools/build-searchbar-font.py`. It is **renamed** from "Source …" because OFL's
Reserved Font Name clause forbids a modified version from carrying it.

### ka-multimedia — provenance needs stating

This file carries **no copyright, licence or vendor string** in its name table (verified). It
appears to be Kanji alive's own icon font. Before this repo is published, that should be stated
explicitly — either an authorship line here, or a licence file if it was derived from something.
An icon font with no stated licence is the one asset here a downstream user could not safely
redistribute.
