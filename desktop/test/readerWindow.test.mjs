import { test } from "node:test";
import assert from "node:assert/strict";
import { getVisiblePageIndex } from "../renderer/src/lib/readerWindow.mjs";

test("chooses the intersecting page nearest the container top", () => {
  assert.equal(
    getVisiblePageIndex([
      { index: 4, top: 80 },
      { index: 5, top: 900 },
      { index: 3, top: -20 },
    ], 2),
    4,
  );
});
