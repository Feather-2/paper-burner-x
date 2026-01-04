import { createUnifiedDiff } from "./diff.js";

import { isPlainObject } from "../shared/utils/value-utils.js";
self.onmessage = (event) => {
  const data = event?.data;
  const id = data?.id;
  const opts = isPlainObject(data?.options) ? data.options : {};

  try {
    const diff = createUnifiedDiff(opts);
    self.postMessage({ id, ok: true, diff });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};

