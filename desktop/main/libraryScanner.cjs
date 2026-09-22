const path = require("node:path");

const CHAPTER_DIR_RE = /^(\d+)(?:_(\d))?$/;

async function readJson(fsPromises, filePath) {
  try {
    return JSON.parse(await fsPromises.readFile(filePath, "utf8"));
  } catch (_) {
    return {};
  }
}

async function exists(fsPromises, filePath) {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

async function scanLibrary(root, fsPromises = require("node:fs/promises")) {
  let entries;
  try {
    entries = await fsPromises.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  }

  const series = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const seriesDir = path.join(root, entry.name);
    const metaPath = path.join(seriesDir, "metadata.json");
    if (!(await exists(fsPromises, metaPath))) continue;
    const meta = await readJson(fsPromises, metaPath);
    const coverPath = path.join(seriesDir, "cover.jpg");
    const chapterEntries = await fsPromises.readdir(seriesDir, { withFileTypes: true });
    const chapters = [];

    for (const chapterEntry of chapterEntries) {
      if (!chapterEntry.isDirectory()) continue;
      const match = CHAPTER_DIR_RE.exec(chapterEntry.name);
      if (!match) continue;

      const number = parseInt(match[1], 10) + (match[2] ? parseInt(match[2], 10) / 10 : 0);
      const chapterDir = path.join(seriesDir, chapterEntry.name);
      const chapterMeta = await readJson(fsPromises, path.join(chapterDir, "metadata.json"));
      const pageFiles = await fsPromises.readdir(chapterDir);
      chapters.push({
        number,
        title: `Chapter ${number}`,
        ...chapterMeta,
        directory: chapterDir,
        pageCount: pageFiles.filter((file) => file.endsWith(".jpg") && file !== "cover.jpg").length,
      });
    }

    chapters.sort((a, b) => a.number - b.number);
    series.push({
      ...meta,
      directory: seriesDir,
      coverPath: (await exists(fsPromises, coverPath)) ? coverPath : null,
      chapters,
    });
  }
  return series;
}

module.exports = { scanLibrary };
