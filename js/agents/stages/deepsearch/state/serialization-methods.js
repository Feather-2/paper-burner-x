import { toSnapshot } from "./serializer.js";

export const serializationMethods = {
  toSnapshot({ includeCheckpoints = true } = {}) {
    return toSnapshot(this, { includeCheckpoints });
  },

  serialize({ pretty = false } = {}) {
    return JSON.stringify(this.toJSON(), null, pretty ? 2 : 0);
  },

  clone({ includeCheckpoints = true } = {}) {
    const snapshotObj = this.toSnapshot({ includeCheckpoints });
    return this.constructor.fromJSON(snapshotObj);
  },
};

export function deserialize(text) {
  const parsed = JSON.parse(String(text || ""));
  return this.fromJSON(parsed);
}
