import { computeContentHash } from "./hash.js";

export function getTimeline(index, options = {}) {
  const includeSuperseded = options?.includeSuperseded === true;
  const timeline = Array.isArray(index.timeline) ? index.timeline : [];
  const filtered = includeSuperseded
    ? timeline
    : timeline.filter((entry) => !(entry && typeof entry === "object" && entry.superseded === true));
  return filtered.map((entry) => (entry && typeof entry === "object" ? { ...entry } : entry));
}

export function getSupersededTimeline(index) {
  const timeline = Array.isArray(index.timeline) ? index.timeline : [];
  return timeline
    .filter((entry) => entry && typeof entry === "object" && entry.superseded === true)
    .map((entry) => ({ ...entry }));
}

export function searchByKeyword(index, keyword, options = {}) {
  const k = typeof keyword === "string" ? keyword.trim().toLowerCase() : "";
  if (!k) return [];
  const ids = index.keywords.get(k);
  if (!ids) return [];
  const list = Array.from(ids || []);
  const includeSuperseded = options?.includeSuperseded === true;
  if (includeSuperseded) return list;

  const timeline = Array.isArray(index.timeline) ? index.timeline : [];
  if (timeline.length === 0) return list;

  const supersededIds = new Set();
  for (const entry of timeline) {
    const id = typeof entry?.id === "string" ? entry.id : null;
    if (id && entry && typeof entry === "object" && entry.superseded === true) {
      supersededIds.add(id);
    }
  }

  return list.filter((id) => !supersededIds.has(id));
}

export function isDuplicate(index, data) {
  const contentHash = computeContentHash(data);
  if (index.hashIndex.has(contentHash)) {
    return { duplicate: true, existingId: index.hashIndex.get(contentHash) };
  }
  return { duplicate: false };
}
