import test from "node:test";
import assert from "node:assert/strict";
import { getReaderZoomStyle } from "../renderer/src/lib/readerZoom.mjs";

test("reader zoom uses layout-aware scaling at non-default zoom levels", () => {
  const style = getReaderZoomStyle(1.5);

  assert.equal(style.zoom, 1.5);
  assert.equal(style.transform, undefined);
  assert.equal(style.transformOrigin, undefined);
});

test("reader zoom keeps the default layout at 100 percent", () => {
  assert.deepEqual(getReaderZoomStyle(1), { zoom: 1 });
});
