#!/usr/bin/env python3
"""Remove zero-length table entries from a .woff2 file, in place.

WHY THIS EXISTS
---------------
static/fonts/mplus-1m-icons.woff2 shipped with an empty `cvt ` table. Chrome runs
every webfont through OTS, which rejects a zero-length table outright:

    Failed to decode downloaded font: .../static/fonts/mplus-1m-icons.woff2
    OTS parsing error: cvt : zero-length table

Chrome then falls through to the .woff in the same @font-face, so the icons still
draw — the cost is a wasted download and a second FOUT window on every page load.
Firefox's sanitizer is the same OTS code, so it behaves identically; Safari does not
use OTS and accepted the file, which is why this went unseen.

The sibling mplus-1m-icons.woff has no `cvt ` at all. The empty table came from the
woff2 generator, not the source font, so removing it makes the two agree rather than
inventing a third variant. `fpgm`/`prep` stay: they are exactly what the .woff has
already been shipping without a cvt.

WHY A BYTE PATCH AND NOT FONTTOOLS
----------------------------------
A zero-length, untransformed table contributes no bytes to the brotli stream, so its
directory entry can be deleted without re-encoding anything. The compressed payload
comes through byte-identical — no risk of a re-serializer moving a metric. It also
keeps the repo free of a font-toolchain dependency for a one-line repair.

Usage:  python3 tools/strip-empty-woff2-tables.py static/fonts/mplus-1m-icons.woff2
Idempotent: re-running on a clean file reports nothing to do.
"""

import struct
import sys

# WOFF2 known-table tags, indexed by the low 6 bits of an entry's flags byte.
KNOWN_TAGS = [
    "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post",
    "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
    "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
    "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
    "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
    "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
    "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop",
    "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
]

DIRECTORY_OFFSET = 48  # the WOFF2 header is a fixed 48 bytes
SFNT_RECORD_SIZE = 16  # one table record in the reconstructed sfnt directory


def read_uint_base128(data, pos):
    """WOFF2's variable-length integer: 7 bits per byte, high bit = continue."""
    value = 0
    for _ in range(5):
        byte = data[pos]
        pos += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            return value, pos
    raise ValueError("malformed UIntBase128")


def parse_directory(data, num_tables):
    """Yield (tag, entry_start, entry_end, orig_length) for each table entry."""
    pos = DIRECTORY_OFFSET
    for _ in range(num_tables):
        start = pos
        flags = data[pos]
        pos += 1
        index = flags & 0x3F
        if index == 0x3F:
            tag = data[pos:pos + 4].decode("ascii")
            pos += 4
        else:
            tag = KNOWN_TAGS[index]
        transform = (flags >> 6) & 3
        orig_length, pos = read_uint_base128(data, pos)
        # glyf/loca use 3 to mean "untransformed"; every other table uses 0.
        null_transform = 3 if tag in ("glyf", "loca") else 0
        if transform != null_transform:
            _, pos = read_uint_base128(data, pos)
        yield tag, start, pos, orig_length


def strip(path):
    data = bytearray(open(path, "rb").read())
    if bytes(data[:4]) != b"wOF2":
        sys.exit(f"{path}: not a WOFF2 file")

    num_tables = struct.unpack(">H", data[12:14])[0]
    total_sfnt_size = struct.unpack(">I", data[16:20])[0]
    entries = list(parse_directory(data, num_tables))

    # Confirm we read the directory the way the encoder wrote it before editing it.
    derived = 12 + SFNT_RECORD_SIZE * num_tables + sum(
        (length + 3) & ~3 for _, _, _, length in entries
    )
    if derived != total_sfnt_size:
        sys.exit(f"{path}: parsed sfnt size {derived} != header {total_sfnt_size}")

    empty = [e for e in entries if e[3] == 0]
    if not empty:
        print(f"{path}: no zero-length tables")
        return

    # Delete back-to-front so earlier offsets stay valid.
    removed = 0
    for tag, start, end, _ in reversed(empty):
        del data[start:end]
        removed += end - start
        print(f"{path}: removed empty '{tag}' ({end - start} directory bytes)")

    struct.pack_into(">H", data, 12, num_tables - len(empty))
    struct.pack_into(">I", data, 8, len(data))
    struct.pack_into(">I", data, 16, total_sfnt_size - SFNT_RECORD_SIZE * len(empty))

    open(path, "wb").write(data)
    print(f"{path}: {len(data) + removed} -> {len(data)} bytes")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for arg in sys.argv[1:]:
        strip(arg)
