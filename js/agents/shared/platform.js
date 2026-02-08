/**
 * Platform Detection - 统一平台检测
 * @module shared/platform
 */

/** @typedef {"node"|"bun"|"deno"|"browser"|"unknown"} RuntimeType */

/**
 * `globalThis` in this repo is DOM-typed (no Node/Bun/Deno globals),
 * so we model the few runtime-detection properties we probe.
 * @typedef {typeof globalThis & {
 *   Bun?: unknown,
 *   Deno?: unknown,
 *   process?: { versions?: { node?: string } },
 *   window?: unknown,
 *   self?: unknown,
 * }} GlobalLike
 */

/**
 * @type {{ runtime: RuntimeType, isNode: boolean, isBun: boolean, isDeno: boolean, isBrowser: boolean }}
 */
export const Platform = {
  runtime: "unknown",
  isNode: false,
  isBun: false,
  isDeno: false,
  isBrowser: false,
};

function detectRuntime() {
  const g = /** @type {GlobalLike} */ (globalThis);

  // Bun (often exposes `process.versions.node`, so detect first)
  if (typeof g.Bun !== "undefined") {
    Platform.isBun = true;
    Platform.runtime = "bun";
    return;
  }

  // Deno — detected but NOT fully supported.
  // VFS falls back to browser paths (OPFS/Memory), Skills use browser loader,
  // MCP stdio transport is unavailable. Deno users get browser-grade functionality.
  if (typeof g.Deno !== "undefined") {
    Platform.isDeno = true;
    Platform.runtime = "deno";
    return;
  }

  // Node.js
  const p = g.process;
  if (p && typeof p === "object" && p.versions?.node) {
    Platform.isNode = true;
    Platform.runtime = "node";
    return;
  }

  // Browser / WebWorker
  if (typeof g.window !== "undefined" || typeof g.self !== "undefined") {
    Platform.isBrowser = true;
    Platform.runtime = "browser";
  }
}

detectRuntime();

/**
 * 兼容别名：检测是否为 Node-like 环境 (Node.js 或 Bun)
 * @returns {boolean}
 */
export function isNodeLike() {
  const g = /** @type {GlobalLike} */ (globalThis);
  // Bun (often exposes `process.versions.node`, so detect first)
  if (typeof g.Bun !== "undefined") return true;
  // Deno may expose Node compatibility globals; treat it as non-Node-like.
  if (typeof g.Deno !== "undefined") return false;
  const p = g.process;
  return !!(p && typeof p === "object" && p.versions?.node);
}
