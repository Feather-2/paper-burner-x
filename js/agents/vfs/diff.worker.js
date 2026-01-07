import { createUnifiedDiff } from "./diff.js";

import { isPlainObject } from "../shared/utils/value-utils.js";

/**
 * @typedef {object} UnifiedDiffOptions
 * @property {string=} path
 * @property {string=} beforeText
 * @property {string=} afterText
 * @property {number=} context
 */

/**
 * @typedef {object} UnifiedDiffResult
 * @property {Array} hunks
 * @property {string} text
 */

/**
 * @typedef {object} DiffWorkerRequest
 * @property {string} id
 * @property {UnifiedDiffOptions=} options
 */

/**
 * @typedef {object} DiffWorkerResponseOk
 * @property {string} id
 * @property {true} ok
 * @property {UnifiedDiffResult} diff
 */

/**
 * @typedef {object} DiffWorkerResponseErr
 * @property {string} id
 * @property {false} ok
 * @property {string} error
 */

/**
 * @typedef {DiffWorkerResponseOk | DiffWorkerResponseErr} DiffWorkerResponse
 */

/** @type {(this: DedicatedWorkerGlobalScope, event: MessageEvent<DiffWorkerRequest>) => void} */
self.onmessage = (event) => {
  const data = event?.data;
  const id = data?.id;
  const opts = isPlainObject(data?.options) ? data.options : {};

  try {
    const diff = createUnifiedDiff(opts);
    self.postMessage(/** @type {DiffWorkerResponse} */ ({ id, ok: true, diff }));
  } catch (err) {
    self.postMessage(/** @type {DiffWorkerResponse} */ ({ id, ok: false, error: String(err?.message || err) }));
  }
};
