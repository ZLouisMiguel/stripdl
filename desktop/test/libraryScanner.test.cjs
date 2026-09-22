const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { scanLibrary } = require("../main/libraryScanner.cjs");

async function makeSeriesFixture(t, invalidSeriesMetadata = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strip-scan-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const seriesDir = path.join(root, "A");
  await fs.mkdir(path.join(seriesDir, "001"), { recursive: true });
  await fs.mkdir(path.join(seriesDir, "002_5"));
  await fs.writeFile(path.join(seriesDir, "metadata.json"), invalidSeriesMetadata ? "{" : JSON.stringify({ title: "A" }));
  await fs.writeFile(path.join(seriesDir, "001", "metadata.json"), JSON.stringify({ number: 1, title: "One" }));
  await fs.writeFile(path.join(seriesDir, "002_5", "metadata.json"), JSON.stringify({ number: 2.5, title: "Two and a half" }));
  return root;
}

test("scans series and chapter metadata asynchronously", async (t) => {
  const root = await makeSeriesFixture(t);
  const series = await scanLibrary(root);
  assert.equal(series[0].title, "A");
  assert.deepEqual(series[0].chapters.map((chapter) => chapter.number), [1, 2.5]);
});

test("returns an empty list for a missing root and tolerates invalid metadata", async (t) => {
  assert.deepEqual(await scanLibrary(path.join(os.tmpdir(), "missing-strip-library")), []);
  const root = await makeSeriesFixture(t, true);
  assert.equal((await scanLibrary(root)).length, 1);
});
