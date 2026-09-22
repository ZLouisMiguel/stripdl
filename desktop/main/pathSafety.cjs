const fs = require("node:fs/promises");
const path = require("node:path");

class LibraryPathError extends Error {
  constructor(message) {
    super(message);
    this.name = "LibraryPathError";
    this.code = "ERR_LIBRARY_PATH";
  }
}

async function assertLibraryPath(target, root, { allowRoot = false } = {}) {
  if (typeof target !== "string" || target.trim() === "") {
    throw new LibraryPathError("A valid library path is required.");
  }
  if (typeof root !== "string" || root.trim() === "") {
    throw new LibraryPathError("The library location is not configured.");
  }

  let realRoot;
  let realTarget;
  try {
    [realRoot, realTarget] = await Promise.all([
      fs.realpath(root),
      fs.realpath(target),
    ]);
  } catch (cause) {
    throw new LibraryPathError(`The requested library path is unavailable: ${cause.message}`);
  }

  const relative = path.relative(realRoot, realTarget);
  if (relative === "") {
    if (allowRoot) return realTarget;
    throw new LibraryPathError("The library root itself is not a valid target.");
  }
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new LibraryPathError("The requested path is outside the library folder.");
  }
  return realTarget;
}

async function assertDirectoryShape(target, root, expectedDepth, chapterDirectory = false) {
  const realTarget = await assertLibraryPath(target, root);
  const realRoot = await fs.realpath(root);
  const segments = path.relative(realRoot, realTarget).split(path.sep);
  if (segments.length !== expectedDepth ||
      (chapterDirectory && !/^\d+(?:_\d)?$/.test(segments.at(-1)))) {
    throw new LibraryPathError("The requested path is not a valid library item.");
  }
  const stat = await fs.stat(realTarget);
  if (!stat.isDirectory()) {
    throw new LibraryPathError("The requested library item is not a folder.");
  }
  return realTarget;
}

const assertSeriesPath = (target, root) => assertDirectoryShape(target, root, 1);
const assertChapterPath = (target, root) => assertDirectoryShape(target, root, 2, true);

module.exports = { assertLibraryPath, assertSeriesPath, assertChapterPath, LibraryPathError };
