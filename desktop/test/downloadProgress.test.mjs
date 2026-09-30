import test from "node:test";
import assert from "node:assert/strict";
import { applyProgress } from "../renderer/src/lib/downloadProgress.mjs";

function activeJob() {
  return {
    title: "Series",
    status: "active",
    active: true,
    failureMessage: null,
    log: [],
  };
}

test("warning progress is logged without changing job state", () => {
  const job = applyProgress(activeJob(), {
    status: "warning",
    code: "metadata_unavailable",
    message: "Author metadata is unavailable; continuing without it.",
  });

  assert.equal(job.status, "active");
  assert.equal(job.active, true);
  assert.equal(job.failureMessage, null);
  assert.deepEqual(job.log.at(-1), {
    msg: "Author metadata is unavailable; continuing without it.",
    type: "warning",
  });
});

