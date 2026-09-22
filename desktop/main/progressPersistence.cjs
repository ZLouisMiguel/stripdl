function createProgressPersistence({ getConfig, writeConfigAtomic, now = Date.now }) {
  let writes = Promise.resolve();

  function saveReadingPosition({ seriesTitle, chapterNumber, pageIndex, totalPages }) {
    const operation = writes.catch(() => {}).then(async () => {
      const current = getConfig();
      const readingProgress = { ...(current.readingProgress || {}) };
      const timestamp = now();
      readingProgress[`${seriesTitle}/${chapterNumber}`] = pageIndex;
      readingProgress[`${seriesTitle}/lastRead`] = {
        chapterNumber, pageIndex, totalPages, timestamp,
      };
      readingProgress[`${seriesTitle}/recentlyRead`] = timestamp;
      await writeConfigAtomic({ ...current, readingProgress });
    });
    writes = operation;
    return operation;
  }

  return { saveReadingPosition, flush: () => writes };
}

module.exports = { createProgressPersistence };
