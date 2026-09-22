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

module.exports = { assertLibraryPath, LibraryPathError };
