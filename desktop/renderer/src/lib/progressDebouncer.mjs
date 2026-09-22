export function createProgressDebouncer(save, delayMs = 500, timerApi = globalThis) {
  let pending;
  let timer = null;

  function cancelTimer() {
    if (timer !== null) timerApi.clearTimeout(timer);
    timer = null;
  }

  async function flush() {
    cancelTimer();
    if (pending === undefined) return;
    const value = pending;
    pending = undefined;
    await save(value);
  }

  return {
    schedule(value) {
      pending = value;
      cancelTimer();
      timer = timerApi.setTimeout(() => { void flush(); }, delayMs);
    },
    flush,
    cancel() {
      cancelTimer();
      pending = undefined;
    },
  };
}
