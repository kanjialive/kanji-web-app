#!/usr/bin/env python3
"""Build static/fonts/ka-search-sans.woff2 — the search box's font.

WHY THIS EXISTS
---------------
The Source Sans Pro webfont on the CDN has CLAMPED vertical metrics: hhea, sTypo*
and usWin* were all rewritten to 0.75 / 0.25 em by whatever generator produced it
(the real font is 0.984 / 0.273). The cap height is 0.66 em, so a 0.75 em ascent
leaves the browser thinking the font is barely taller than its own capitals — and
a text caret is drawn from the font's ascent to its descent. Result: in the search
box the caret cleared the top of an "H" by 0.9px while still hanging 4px below the
baseline, i.e. it looked sunken. In TextEdit, which uses the *real* desktop font,
the same text has a balanced caret. That was the whole mystery.

Chrome/Firefox can fix this in CSS with `ascent-override`, but Safari 26 drops the
descriptor entirely (verified), so the only universal fix is to correct the metrics
in a copy of the file. That is what this script does. The glyph outlines are
untouched — this is purely a metrics + naming edit.

The numbers are chosen so that, at the search box's 17px / 32px / line-height 17px:

    caret height = ascent + descent            = 20px
    text baseline = 16 + (ascent - descent)/2  = 22px   <- production's baseline

so the text does NOT move; only the caret's top stops being clipped at the caps.
The 4px descent is also the deepest descender ink in the face (g = 3.81px), so the
caret still fully covers a "g". Maintainer chose 20px over 18px and 21.4px on
2026-07-12 after comparing all three in a browser.

LICENSING
---------
Source Sans Pro is SIL OFL 1.1 **with the Reserved Font Name "Source"**. OFL §3
forbids a Modified Version from using the reserved name, so this script also
rewrites the name table to "KA Search Sans". Do not put "Source" back.

USAGE
-----
    uv run --with fonttools --with brotli python tools/build-searchbar-font.py
"""

import io
import urllib.request

from fontTools.ttLib import TTFont

SRC = "https://media.kanjialive.com/fonts/sourcesanspro-regular-webfont.woff2"
OUT = "static/fonts/ka-search-sans"      # .woff2 and .woff are both written

SIZE = 17           # .search-bar font-size
ASCENT_PX = 16.0    # -> caret 20px, baseline 22px (see above)
DESCENT_PX = 4.0

FAMILY = "KA Search Sans"           # NOT "Source ..." — OFL reserved font name
PS_NAME = "KASearchSans-Regular"


def main() -> None:
    # Cloudflare in front of the CDN 403s the default urllib user-agent.
    request = urllib.request.Request(SRC, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request) as r:
        font = TTFont(io.BytesIO(r.read()))

    upm = font["head"].unitsPerEm
    ascent = round(ASCENT_PX / SIZE * upm)
    descent = round(DESCENT_PX / SIZE * upm)

    hhea, os2 = font["hhea"], font["OS/2"]
    hhea.ascender, hhea.descender, hhea.lineGap = ascent, -descent, 0
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = ascent, -descent, 0
    os2.usWinAscent, os2.usWinDescent = ascent, descent

    # OFL §3: a Modified Version may not carry the Reserved Font Name.
    name = font["name"]
    for record in list(name.names):
        text = {
            1: FAMILY,                                  # family
            2: "Regular",                               # subfamily
            3: f"{FAMILY}; derived from Source Sans Pro (SIL OFL 1.1)",
            4: FAMILY,                                  # full name
            6: PS_NAME,                                 # PostScript name
            16: FAMILY,
            17: "Regular",
        }.get(record.nameID)
        if text is not None:
            name.setName(text, record.nameID, record.platformID,
                         record.platEncID, record.langID)

    # woff2 for everything current; woff as the long tail (adds ~3 more years of
    # backwards compatibility for old browsers and costs a few KB in the repo).
    for flavor in ("woff2", "woff"):
        font.flavor = flavor
        font.save(f"{OUT}.{flavor}")

    for flavor in ("woff2", "woff"):
        check = TTFont(f"{OUT}.{flavor}")
        u = check["head"].unitsPerEm
        a = SIZE * check["hhea"].ascender / u
        d = SIZE * -check["hhea"].descender / u
        print(f"wrote {OUT}.{flavor}")
        print(f"  family         {check['name'].getDebugName(1)}")
        print(f"  ascent/descent {a:.2f}px / {d:.2f}px at {SIZE}px")
        print(f"  caret height   {a + d:.2f}px")
        print(f"  text baseline  {16 + (a - d) / 2:.2f}px  (production = 22.00)")
        print(f"  glyphs         {len(check.getGlyphOrder())}")


if __name__ == "__main__":
    main()
