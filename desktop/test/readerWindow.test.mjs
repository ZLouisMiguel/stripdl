import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getVisiblePageIndex,
  getReaderWindow,
  getWindowSpacerHeights,
} from "../renderer/src/lib/readerWindow.mjs";

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

test("reader window is bounded and clamps at both ends", () => {
  assert.deepEqual(getReaderWindow(1000, 500, 4), { start: 496, end: 504 });
  assert.deepEqual(getReaderWindow(10, 0, 4), { start: 0, end: 4 });
  assert.deepEqual(getReaderWindow(10, 9, 4), { start: 5, end: 9 });
  assert.deepEqual(getReaderWindow(10, 100, 4), { start: 5, end: 9 });
  assert.deepEqual(getReaderWindow(0, 0, 4), { start: 0, end: -1 });
});

test("spacers sum measured heights outside the mounted window", () => {
  assert.deepEqual(getWindowSpacerHeights([10, 20, 30, 40], 1, 2), { before: 10, after: 40 });
  assert.deepEqual(getWindowSpacerHeights([10, null, 30], 2, 2, 100), { before: 110, after: 0 });
});
