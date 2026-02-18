/**
 * Race a promise against a timeout.
 * @param {Promise<any>} promise
 * @param {number} timeoutMs
 * @param {string | {
 *   label?: string,
 *   signal?: AbortSignal,
 *   onTimeout?: (error: Error & { code?: string }) => void,
 *   onAbort?: (error: Error & { code?: string }) => void,
 *   abortController?: { abort: (reason?: any) => void },
 * }} [labelOrOptions='operation']
 * @returns {Promise<any>}
 */
export function withTimeout(promise, timeoutMs, labelOrOptions = 'operation') {
  const options =
    labelOrOptions && typeof labelOrOptions === "object"
      ? labelOrOptions
      : { label: typeof labelOrOptions === "string" ? labelOrOptions : "operation" };

  const label = typeof options.label === "string" && options.label ? options.label : "operation";
  const signal = options.signal;
  const onTimeout = typeof options.onTimeout === "function" ? options.onTimeout : null;
  const onAbort = typeof options.onAbort === "function" ? options.onAbort : null;
  const abortController =
    options.abortController && typeof options.abortController.abort === "function" ? options.abortController : null;
  const timeoutEnabled = Number.isFinite(timeoutMs) && timeoutMs > 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;

    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (signal && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", handleAbort);
      }
    };

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };

    const buildAbortError = () => {
      const reason = signal?.reason;
      const msg = typeof reason === "string" && reason.trim() ? reason.trim() : `${label} aborted`;
      const err = /** @type {Error & { code?: string }} */ (new Error(msg));
      err.name = "AbortError";
      err.code = "ABORTED";
      return err;
    };

    const handleAbort = () => {
      const err = buildAbortError();
      try {
        onAbort?.(err);
      } catch {
        // ignore user callback errors
      }
      finish(reject, err);
    };

    if (signal && typeof signal.addEventListener === "function") {
      if (signal.aborted) {
        handleAbort();
        return;
      }
      signal.addEventListener("abort", handleAbort, { once: true });
    }

    if (timeoutEnabled) {
      timer = setTimeout(() => {
        const err = /** @type {Error & { code?: string }} */ (new Error(`${label} timed out after ${timeoutMs}ms`));
        err.code = "TIMEOUT";
        try {
          onTimeout?.(err);
        } catch {
          // ignore user callback errors
        }
        finish(reject, err);
        if (abortController) {
          try {
            abortController.abort(err);
          } catch {
            // ignore controller abort failures
          }
        }
      }, timeoutMs);
    }

    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}
