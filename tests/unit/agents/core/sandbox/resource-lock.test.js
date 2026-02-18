import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { ResourceLock, sanitizeResourceId } from "../../../../../js/agents/core/sandbox/resource-lock.js";

/** @type {string[]} */
const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-resource-lock-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("sanitizeResourceId", () => {
  it("normalizes path-like input into safe filename segments", () => {
    const out = sanitizeResourceId("../etc/passwd");
    expect(out.includes("/")).toBe(false);
    expect(out.includes("\\")).toBe(false);
    expect(out.length).toBeGreaterThan(0);
  });

  it("throws on empty or invalid ids", () => {
    expect(() => sanitizeResourceId("   ")).toThrow(/resourceId/i);
    expect(() => sanitizeResourceId("\0bad")).toThrow(/null bytes/i);
  });
});

describe("ResourceLock", () => {
  it("keeps lock files inside lockDir even for traversal-like resource ids", async () => {
    const lockDir = makeTempDir();
    const lock = new ResourceLock({ lockDir, acquireTimeoutMs: 200, staleTimeoutMs: 1000 });

    const handle = await lock.acquire("../../escape-target");
    const resolvedDir = path.resolve(lockDir);
    const resolvedPath = path.resolve(handle.lockPath);

    expect(resolvedPath.startsWith(`${resolvedDir}${path.sep}`)).toBe(true);
    expect(fs.existsSync(handle.lockPath)).toBe(true);

    await handle.release();
    expect(fs.existsSync(handle.lockPath)).toBe(false);
  });
});
