/**
 * Expand context around hit chunks by including neighboring chunks.
 *
 * @param {Array<{chunkId:string}>} allChunks
 * @param {string[]} hitChunkIds
 * @param {number} windowSize
 * @returns {Array<any>}
 */
export function readAround(allChunks, hitChunkIds, windowSize = 1) {
  if (!Array.isArray(allChunks)) throw new TypeError("readAround(allChunks, hitChunkIds): allChunks must be an array");
  if (!Array.isArray(hitChunkIds)) throw new TypeError("readAround(allChunks, hitChunkIds): hitChunkIds must be an array");

  const n = allChunks.length;
  const w = Number.isFinite(windowSize) ? Math.max(0, Math.floor(windowSize)) : 1;
  if (n === 0) return [];
  if (hitChunkIds.length === 0) return [];

  const idToIndex = new Map();
  for (let i = 0; i < n; i++) idToIndex.set(allChunks[i].chunkId, i);

  const include = new Set();
  for (const id of hitChunkIds) {
    const idx = idToIndex.get(id);
    if (!Number.isFinite(idx)) continue;
    const start = Math.max(0, idx - w);
    const end = Math.min(n - 1, idx + w);
    for (let j = start; j <= end; j++) include.add(j);
  }

  const indices = Array.from(include.values()).sort((a, b) => a - b);
  return indices.map((i) => allChunks[i]);
}

