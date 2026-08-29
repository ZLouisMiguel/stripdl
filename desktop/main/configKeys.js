// desktop/main/configKeys.js
// Single source of truth mapping Electron's camelCase config keys to the
// `stripdl` CLI flags that carry them.
//
// Why this exists: config settings were previously duplicated by hand in
// three uncoordinated places — Python's defaults (strip/config.py), the
// Electron config shape (main/index.js), and a manually-written
// if (cfg.x) args.push(...) line per setting inside download:start. Nothing
// forced that third list to stay complete, which is exactly how a bug like
// "the Metadata cache (days) setting is silently dropped unless it's 0"
// happened — cacheTtlDays was set in the config object but only ever
// translated into a flag in the one special case.
//
// This module doesn't merge the two config files (Python's config.py still
// needs its own standalone defaults, since `stripdl` can run without
// Electron at all), but it gives the Electron side ONE table to extend
// when a new download-affecting setting is added, instead of another
// hand-written branch in download:start.

/**
 * Each entry describes one Electron config key that should be forwarded to
 * `stripdl download` as a CLI flag:
 *   camelKey  — key in Electron's appConfig / config.json
 *   flag      — the stripdl CLI flag that carries this value
 *   kind      — "value"   -> flag takes an argument (--flag <value>)
 *               "boolean" -> flag is a bare switch, emitted only when the
 *                            config value is truthy
 *   include   — optional predicate (value) => boolean, only used for
 *               "value" entries, to decide whether to emit the flag at all
 *               (e.g. skip it entirely when the value is undefined rather
 *               than emitting "--rate-limit undefined")
 */
const DOWNLOAD_CONFIG_FLAGS = [
  {
    camelKey: "maxConcurrentChapters",
    flag: "--chapter-concurrency",
    kind: "value",
  },
  { camelKey: "imageConcurrency", flag: "--image-concurrency", kind: "value" },
  {
    camelKey: "rateLimit",
    flag: "--rate-limit",
    kind: "value",
    include: (v) => v !== undefined,
  },
  {
    camelKey: "cacheTtlDays",
    flag: "--cache-ttl",
    kind: "value",
    include: (v) => v !== undefined,
  },
  { camelKey: "verifyIntegrity", flag: "--verify", kind: "boolean" },
  { camelKey: "overwrite", flag: "--overwrite", kind: "boolean" },
];

/**
 * Build the `stripdl download` CLI argument list from an Electron config
 * object, using DOWNLOAD_CONFIG_FLAGS as the single source of truth for
 * "which config keys map to which flags." Adding a new download-affecting
 * setting means adding one entry here — download:start in main/index.js
 * never needs a new hand-written branch.
 */
function buildDownloadConfigArgs(cfg) {
  const args = [];
  for (const entry of DOWNLOAD_CONFIG_FLAGS) {
    const value = cfg[entry.camelKey];
    if (entry.kind === "boolean") {
      if (value) args.push(entry.flag);
      continue;
    }
    const shouldInclude = entry.include ? entry.include(value) : !!value;
    if (shouldInclude) args.push(entry.flag, String(value));
  }
  return args;
}

module.exports = { DOWNLOAD_CONFIG_FLAGS, buildDownloadConfigArgs };
