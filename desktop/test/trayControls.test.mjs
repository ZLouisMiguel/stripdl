import test from "node:test";
import assert from "node:assert/strict";
import { getTrayChevronDirection } from "../renderer/src/lib/trayControls.mjs";

test("tray chevron points toward the action for each state", () => {
  assert.equal(getTrayChevronDirection(false), "down");
  assert.equal(getTrayChevronDirection(true), "up");
});
