const path = require("node:path");
const { assertLibraryPath } = require("./pathSafety.cjs");

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
    let seriesDir;
    try {
      seriesDir = await assertLibraryPath(path.join(root, entry.name), root);
    } catch (_) {
      continue;
    }
    const metaPath = path.join(seriesDir, "metadata.json");
    if (!(await exists(fsPromises, metaPath))) continue;
    let safeMetaPath;
    try {
      safeMetaPath = await assertLibraryPath(metaPath, root);
    } catch (_) {
      continue;
    }
    const meta = await readJson(fsPromises, safeMetaPath);
    const coverPath = path.join(seriesDir, "cover.jpg");
    const chapterEntries = await fsPromises.readdir(seriesDir, { withFileTypes: true });
    const chapters = [];

    for (const chapterEntry of chapterEntries) {
      if (!chapterEntry.isDirectory()) continue;
      const match = CHAPTER_DIR_RE.exec(chapterEntry.name);
      if (!match) continue;

      const number = parseInt(match[1], 10) + (match[2] ? parseInt(match[2], 10) / 10 : 0);
      let chapterDir;
      try {
        chapterDir = await assertLibraryPath(path.join(seriesDir, chapterEntry.name), root);
      } catch (_) {
        continue;
      }
      let chapterMetaPath = path.join(chapterDir, "metadata.json");
      try {
        chapterMetaPath = await assertLibraryPath(chapterMetaPath, root);
      } catch (_) {
        chapterMetaPath = null;
      }
      const chapterMeta = chapterMetaPath ? await readJson(fsPromises, chapterMetaPath) : {};
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
      coverPath: (await exists(fsPromises, coverPath)) &&
        await assertLibraryPath(coverPath, root).then(() => true, () => false)
        ? coverPath : null,
      chapters,
    });
  }
  return series;
}

module.exports = { scanLibrary };
