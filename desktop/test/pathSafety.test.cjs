const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { assertLibraryPath, assertSeriesPath, assertChapterPath } = require("../main/pathSafety.cjs");

async function makeTempLibrary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strip-library-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("accepts a real child of the library root", async (t) => {
  const root = await makeTempLibrary(t);
  const series = path.join(root, "Series");
  await fs.mkdir(series);
  assert.equal(await assertLibraryPath(series, root), await fs.realpath(series));
});

test("rejects traversal and sibling-prefix paths", async (t) => {
  const root = await makeTempLibrary(t);
  await assert.rejects(assertLibraryPath(path.resolve(root, "..", "outside"), root));
  await assert.rejects(assertLibraryPath(`${root}-backup`, root));
});

test("rejects the root itself unless explicitly allowed", async (t) => {
  const root = await makeTempLibrary(t);
  await assert.rejects(assertLibraryPath(root, root));
  assert.equal(await assertLibraryPath(root, root, { allowRoot: true }), await fs.realpath(root));
});

test("rejects a directory symlink that resolves outside the library", async (t) => {
  const root = await makeTempLibrary(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "strip-outside-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const link = path.join(root, "Escape");
  await fs.symlink(outside, link, "junction");
  await assert.rejects(assertLibraryPath(link, root));
});

test("rejects non-string targets", async (t) => {
  const root = await makeTempLibrary(t);
  await assert.rejects(assertLibraryPath(null, root));
});

test("deletion helpers distinguish series paths from chapter paths", async (t) => {
  const root = await makeTempLibrary(t);
  const series = path.join(root, "Series");
  const chapter = path.join(series, "001");
  await fs.mkdir(chapter, { recursive: true });
  assert.equal(await assertSeriesPath(series, root), await fs.realpath(series));
  assert.equal(await assertChapterPath(chapter, root), await fs.realpath(chapter));
  await assert.rejects(assertChapterPath(series, root));
  await assert.rejects(assertSeriesPath(chapter, root));
});
