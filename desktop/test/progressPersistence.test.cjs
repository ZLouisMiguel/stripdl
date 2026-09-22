const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createProgressPersistence } = require("../main/progressPersistence.cjs");

test("one reading position update changes all progress keys in one write", async () => {
  const writes = [];
  let config = { readingProgress: {} };
  const store = createProgressPersistence({
    getConfig: () => config,
    writeConfigAtomic: async (next) => { writes.push(structuredClone(next)); config = next; },
    now: () => 123,
  });
  await store.saveReadingPosition({ seriesTitle: "A", chapterNumber: 3, pageIndex: 4, totalPages: 9 });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].readingProgress["A/3"], 4);
  assert.equal(writes[0].readingProgress["A/lastRead"].pageIndex, 4);
  assert.equal(typeof writes[0].readingProgress["A/recentlyRead"], "number");
});

test("queued writes preserve the most recent position", async () => {
  let config = { readingProgress: {} };
  const store = createProgressPersistence({
    getConfig: () => config,
    writeConfigAtomic: async (next) => { await Promise.resolve(); config = next; },
    now: () => 123,
  });
  const first = store.saveReadingPosition({ seriesTitle: "A", chapterNumber: 3, pageIndex: 1, totalPages: 9 });
  const second = store.saveReadingPosition({ seriesTitle: "A", chapterNumber: 3, pageIndex: 8, totalPages: 9 });
  await Promise.all([first, second]);
  assert.equal(config.readingProgress["A/3"], 8);
});
