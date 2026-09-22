import { test } from "node:test";
import assert from "node:assert/strict";
import { createProgressDebouncer } from "../renderer/src/lib/progressDebouncer.mjs";

test("debouncer keeps only the newest pending value", async () => {
  const saved = [];
  let callback;
  const fakeTimers = {
    setTimeout: (fn) => { callback = fn; return 1; },
    clearTimeout: () => { callback = null; },
  };
  const debouncer = createProgressDebouncer((value) => saved.push(value), 50, fakeTimers);
  debouncer.schedule(2);
  debouncer.schedule(9);
  assert.deepEqual(saved, []);
  await debouncer.flush();
  assert.deepEqual(saved, [9]);
});
