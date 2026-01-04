import { isPlainObject } from "../shared/utils/value-utils.js";

function scopeFromToc(tocNodes, targetSectionId) {
  if (!Array.isArray(tocNodes)) return null;
  if (typeof targetSectionId !== "string" || !targetSectionId) return null;
  for (const n of tocNodes) {
    if (n && n.tocNodeId === targetSectionId && n.locator && Number.isFinite(n.locator.charStart)) {
      const charStart = Math.max(0, Math.floor(n.locator.charStart));
      const charEnd = Number.isFinite(n.locator.charEnd) ? Math.max(charStart, Math.floor(n.locator.charEnd)) : Infinity;
      return { charStart, charEnd };
    }
  }
  return null;
}

/**
 * @param {Array<{tocNodeId:string,level:number,locator:{charStart:number,charEnd:number}}>} tocNodes
 * @param {string} targetSectionId
 * @returns {{charStart:number,charEnd:number}}
 */
export function selectScope(tocNodes, targetSectionId) {
  const scoped = scopeFromToc(tocNodes, targetSectionId);
  if (scoped) return scoped;

  if (!Array.isArray(tocNodes) || tocNodes.length === 0) return { charStart: 0, charEnd: Infinity };
  let maxEnd = 0;
  for (const n of tocNodes) {
    const end = n && n.locator && Number.isFinite(n.locator.charEnd) ? n.locator.charEnd : 0;
    if (end > maxEnd) maxEnd = end;
  }
  return { charStart: 0, charEnd: maxEnd || Infinity };
}

/**
 * @param {Array<{chunkId:string,text:string,locator:{charStart:number,charEnd:number}}>} chunks
 * @param {{charStart:number,charEnd:number}} scope
 * @returns {Array<any>}
 */
export function chunksInScope(chunks, scope) {
  if (!Array.isArray(chunks)) throw new TypeError("chunksInScope(chunks, scope): chunks must be an array");
  if (!isPlainObject(scope)) throw new TypeError("chunksInScope(chunks, scope): scope must be an object");

  const charStart = Number.isFinite(scope.charStart) ? scope.charStart : 0;
  const charEnd = Number.isFinite(scope.charEnd) ? scope.charEnd : Infinity;
  if (!(charEnd > charStart)) return [];

  const out = [];
  for (const c of chunks) {
    const loc = c && c.locator;
    if (!loc || !Number.isFinite(loc.charStart) || !Number.isFinite(loc.charEnd)) continue;
    if (loc.charEnd <= charStart) continue;
    if (loc.charStart >= charEnd) continue;
    out.push(c);
  }
  return out;
}

