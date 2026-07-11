import { test } from "node:test";
import assert from "node:assert/strict";
import { parseColonSyntax } from "./html-routes";

test("parseColonSyntax parses recognized colon-delimited advanced keys", () => {
  assert.deepEqual(parseColonSyntax("on:shin grade:3"), {
    on: "shin",
    grade: "3",
  });
});

test("parseColonSyntax returns null when no colon is present", () => {
  assert.equal(parseColonSyntax("water"), null);
});

test("parseColonSyntax returns null when no recognized advanced key is present", () => {
  assert.equal(parseColonSyntax("foo:bar"), null);
});

test("parseColonSyntax parses a single recognized key with a non-ASCII value", () => {
  assert.deepEqual(parseColonSyntax("kanji:水"), { kanji: "水" });
});
