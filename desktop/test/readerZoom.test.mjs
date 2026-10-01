import test from "node:test";
import assert from "node:assert/strict";
import {
  applyZoomLock,
  getAnchoredScrollTop,
  getReaderZoomStyle,
} from "../renderer/src/lib/readerZoom.mjs";

test("reader zoom uses layout-aware scaling at non-default zoom levels", () => {
  const style = getReaderZoomStyle(1.5);

  assert.equal(style.zoom, 1.5);
  assert.equal(style.transform, undefined);
  assert.equal(style.transformOrigin, undefined);
});

test("reader zoom keeps the default layout at 100 percent", () => {
  assert.deepEqual(getReaderZoomStyle(1), { zoom: 1 });
});

test("zoom keeps the current page anchored after layout reflow", () => {
  assert.equal(getAnchoredScrollTop(1200, 240, 310), 1270);
});

test("locked zoom ignores button, reset, and pinch updates", () => {
  assert.equal(applyZoomLock(1.5, 1.75, true), 1.5);
  assert.equal(applyZoomLock(1.5, 1, true), 1.5);
  assert.equal(applyZoomLock(1.5, 1.25, false), 1.25);
});
