const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createLineDecoder, summarizeDownloadFailure } = require("../main/downloadOutput.cjs");

test("decodes JSON lines split across chunks and multiple lines per chunk", () => {
  const lines = [];
  const decode = createLineDecoder((line) => lines.push(line));
  decode('{"status":"progress","page":');
  decode('2}\n{"status":"done"}\n');
  assert.deepEqual(lines, ['{"status":"progress","page":2}', '{"status":"done"}']);
});

test("flushes a final line without a trailing newline", () => {
  const lines = [];
  const decode = createLineDecoder((line) => lines.push(line));
  decode('{"status":"done"}');
  decode.end();
  assert.deepEqual(lines, ['{"status":"done"}']);
});

test("includes chapter and cause in an actionable failure summary", () => {
  assert.equal(
    summarizeDownloadFailure({ status: "chapter_error", chapter: 7, message: "timeout" }, "", 1),
    "Chapter 7 failed: timeout. Retry this download to fetch the missing pages.",
  );
});

test("does not call ordinary stderr a failure when the process succeeds", () => {
  assert.equal(summarizeDownloadFailure(null, "diagnostic output", 0), null);
});

test("provides useful fallback detail for a nonzero exit", () => {
  assert.match(summarizeDownloadFailure(null, "network unreachable", 1), /network unreachable/);
});
