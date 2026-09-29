const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("preload exposes a read-only runtime app version", () => {
  const preload = fs.readFileSync(path.join(root, "main", "preload.js"), "utf8");
  assert.match(preload, /app:\s*\{/);
  assert.match(preload, /version:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("app:version"\)/);
});

test("About view uses the runtime version and Strip logo", () => {
  const settings = fs.readFileSync(
    path.join(root, "renderer", "src", "views", "SettingsView.jsx"),
    "utf8",
  );
  assert.match(settings, /window\.strip\.app\.version\(\)/);
  assert.match(settings, /strip-logo\.png/);
  assert.doesNotMatch(settings, /strip v0\.3\.1/);
});

test("CLI build manifest includes every registered parser", () => {
  const build = fs.readFileSync(path.resolve(root, "..", "build_cli.py"), "utf8");
  for (const parser of ["webtoons", "weebcentral", "comix", "asurascans", "mangakakalot"]) {
    assert.match(build, new RegExp(`strip\\.parsers\\.${parser}`));
  }
});

test("CLI build status output is safe on Windows code pages", () => {
  const build = fs.readFileSync(path.resolve(root, "..", "build_cli.py"), "utf8");
  assert.doesNotMatch(build, /[✓✗]/);
});
