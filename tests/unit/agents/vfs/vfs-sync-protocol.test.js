import { describe, expect, it, vi, beforeEach } from "vitest";

const { normalizeVfsPathMock } = vi.hoisted(() => {
  /** @param {unknown} inputPath */
  const normalizeVfsPathMock = vi.fn((inputPath) => {
    const raw = String(inputPath ?? "").replaceAll("\\", "/").trim();
    if (!raw || raw === "/" || raw === "." || raw === "./") return "";
    let p = raw;
    while (p.startsWith("./")) p = p.slice(2);
    while (p.startsWith("/")) p = p.slice(1);
    p = p.replace(/\/+/g, "/").replace(/\/+$/, "");
    const parts = p.split("/").filter(Boolean);
    if (parts.some((seg) => seg === "..")) throw new Error(`Invalid VFS path traversal: ${raw}`);
    return parts.join("/");
  });
  return { normalizeVfsPathMock };
});

vi.mock("../../../../js/agents/vfs/path.js", () => ({
  normalizeVfsPath: normalizeVfsPathMock,
}));

vi.mock("../../../../js/agents/shared/index.js", async () => {
  const { EventEmitter } = await import("../../../../js/agents/shared/utils/event-emitter.js");
  return { EventEmitter };
});

vi.mock("../../../../js/agents/shared/utils/logger.js", () => ({
  createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
}));

const { VfsSyncProtocol } = await import("../../../../js/agents/vfs/vfs-sync-protocol.js");
const { MemoryVfs } = await import("../../../../js/agents/vfs/vfs.memory.js");

describe("VfsSyncProtocol", () => {
  /** @type {InstanceType<typeof MemoryVfs>} */
  let vfs;
  /** @type {InstanceType<typeof VfsSyncProtocol>} */
  let proto;

  beforeEach(() => {
    vfs = new MemoryVfs();
    proto = new VfsSyncProtocol(vfs);
  });

  // ── constructor ──────────────────────────────────────────────

  describe("constructor", () => {
    it("throws TypeError when vfs is null", () => {
      expect(() => new VfsSyncProtocol(null)).toThrow(TypeError);
    });

    it("creates instance with valid vfs", () => {
      const p = new VfsSyncProtocol(new MemoryVfs());
      expect(p).toBeInstanceOf(VfsSyncProtocol);
      expect(p.vfs).toBeInstanceOf(MemoryVfs);
    });
  });

  // ── toSnapshot ───────────────────────────────────────────────

  describe("toSnapshot", () => {
    it("returns empty files array for empty VFS", async () => {
      const snap = await proto.toSnapshot();
      expect(snap.files).toEqual([]);
    });

    it("returns correct snapshot for VFS with files", async () => {
      await vfs.writeFile("a.txt", "hello");
      await vfs.writeFile("dir/b.txt", "world");
      const snap = await proto.toSnapshot();
      expect(snap.files).toHaveLength(2);
      const paths = snap.files.map((f) => f.path).sort();
      expect(paths).toEqual(["a.txt", "dir/b.txt"]);
    });

    it("includes timestamp and version", async () => {
      const before = Date.now();
      const snap = await proto.toSnapshot();
      expect(snap.timestamp).toBeGreaterThanOrEqual(before);
      expect(snap.version).toBe("1.0");
    });

    it("content is base64 encoded", async () => {
      await vfs.writeFile("test.txt", "hello world");
      const snap = await proto.toSnapshot();
      const file = snap.files.find((f) => f.path === "test.txt");
      expect(file).toBeDefined();
      expect(file.type).toBe("file");
      // Decode base64 and verify
      const decoded = Buffer.from(file.content, "base64").toString("utf-8");
      expect(decoded).toBe("hello world");
    });
  });

  // ── fromSnapshot ─────────────────────────────────────────────

  describe("fromSnapshot", () => {
    it("restores files from snapshot", async () => {
      await vfs.writeFile("a.txt", "aaa");
      const snap = await proto.toSnapshot();

      const vfs2 = new MemoryVfs();
      const proto2 = new VfsSyncProtocol(vfs2);
      await proto2.fromSnapshot(snap);

      const content = await vfs2.readText("a.txt");
      expect(content).toBe("aaa");
    });

    it("restored content matches original", async () => {
      await vfs.writeFile("x.txt", "exact match");
      const snap = await proto.toSnapshot();

      const vfs2 = new MemoryVfs();
      const proto2 = new VfsSyncProtocol(vfs2);
      await proto2.fromSnapshot(snap);

      const original = await vfs.readText("x.txt");
      const restored = await vfs2.readText("x.txt");
      expect(restored).toBe(original);
    });

    it("throws TypeError for invalid snapshot", async () => {
      await expect(proto.fromSnapshot(null)).rejects.toThrow(TypeError);
      await expect(proto.fromSnapshot({})).rejects.toThrow(TypeError);
      await expect(proto.fromSnapshot({ files: "bad" })).rejects.toThrow(TypeError);
    });

    it("clear=true clears VFS before restoring", async () => {
      await vfs.writeFile("old.txt", "old");
      await vfs.writeFile("new.txt", "new");
      const snap = await proto.toSnapshot();

      // Write an extra file that should be cleared
      await vfs.writeFile("extra.txt", "extra");

      // Restore with clear=true
      const snapOnlyNew = { files: [{ path: "new.txt", type: "file", content: snap.files.find((f) => f.path === "new.txt").content }], timestamp: Date.now(), version: "1.0" };
      await proto.fromSnapshot(snapOnlyNew, { clear: true });

      // extra.txt and old.txt should be gone
      expect(await vfs.exists("extra.txt")).toBe(false);
      expect(await vfs.exists("old.txt")).toBe(false);
      expect(await vfs.exists("new.txt")).toBe(true);
    });

    it("emits change events", async () => {
      await vfs.writeFile("a.txt", "aaa");
      const snap = await proto.toSnapshot();

      const vfs2 = new MemoryVfs();
      const proto2 = new VfsSyncProtocol(vfs2);
      const events = [];
      proto2.on("change", (e) => events.push(e));
      await proto2.fromSnapshot(snap);

      expect(events).toHaveLength(1);
      expect(events[0].path).toBe("a.txt");
      expect(events[0].source).toBe("snapshot");
    });
  });

  // ── applyDelta ───────────────────────────────────────────────

  describe("applyDelta", () => {
    it("writes a new file", async () => {
      const content = Buffer.from("new content").toString("base64");
      await proto.applyDelta({ path: "new.txt", content });
      const text = await vfs.readText("new.txt");
      expect(text).toBe("new content");
    });

    it("updates an existing file", async () => {
      await vfs.writeFile("exist.txt", "old");
      const content = Buffer.from("updated").toString("base64");
      await proto.applyDelta({ path: "exist.txt", content });
      const text = await vfs.readText("exist.txt");
      expect(text).toBe("updated");
    });

    it("deletes file when content is null", async () => {
      await vfs.writeFile("del.txt", "bye");
      await proto.applyDelta({ path: "del.txt", content: null });
      expect(await vfs.exists("del.txt")).toBe(false);
    });

    it("handles batch deltas (array)", async () => {
      const c1 = Buffer.from("one").toString("base64");
      const c2 = Buffer.from("two").toString("base64");
      await proto.applyDelta([
        { path: "f1.txt", content: c1 },
        { path: "f2.txt", content: c2 },
      ]);
      expect(await vfs.readText("f1.txt")).toBe("one");
      expect(await vfs.readText("f2.txt")).toBe("two");
    });

    it("emits change and delete events", async () => {
      await vfs.writeFile("target.txt", "data");
      const changes = [];
      const deletes = [];
      proto.on("change", (e) => changes.push(e));
      proto.on("delete", (e) => deletes.push(e));

      const content = Buffer.from("new").toString("base64");
      await proto.applyDelta([
        { path: "added.txt", content },
        { path: "target.txt", content: null },
      ]);

      expect(changes).toHaveLength(1);
      expect(changes[0].path).toBe("added.txt");
      expect(deletes).toHaveLength(1);
      expect(deletes[0].path).toBe("target.txt");
    });

    it("skips invalid delta without path", async () => {
      // Should not throw
      await proto.applyDelta({ content: "abc" });
      await proto.applyDelta(null);
      await proto.applyDelta([null, { content: "x" }, { path: 123, content: "y" }]);
    });
  });

  // ── round-trip ───────────────────────────────────────────────

  describe("round-trip consistency", () => {
    it("toSnapshot -> fromSnapshot preserves text content", async () => {
      await vfs.writeFile("doc.md", "# Hello\n\nWorld");
      await vfs.writeFile("data.json", '{"key":"value"}');
      const snap = await proto.toSnapshot();

      const vfs2 = new MemoryVfs();
      const proto2 = new VfsSyncProtocol(vfs2);
      await proto2.fromSnapshot(snap);

      expect(await vfs2.readText("doc.md")).toBe("# Hello\n\nWorld");
      expect(await vfs2.readText("data.json")).toBe('{"key":"value"}');
    });

    it("binary content (Uint8Array) round-trips correctly", async () => {
      const binary = new Uint8Array([0x00, 0x01, 0xff, 0x80, 0x7f, 0x00, 0xfe]);
      await vfs.writeFile("bin.dat", binary);
      const snap = await proto.toSnapshot();

      const vfs2 = new MemoryVfs();
      const proto2 = new VfsSyncProtocol(vfs2);
      await proto2.fromSnapshot(snap);

      const restored = await vfs2.readFile("bin.dat");
      expect(restored).toEqual(binary);
    });
  });

  // ── _bytesToBase64 / _base64ToBytes ──────────────────────────

  describe("_bytesToBase64 / _base64ToBytes", () => {
    it("handles empty array", () => {
      const empty = new Uint8Array(0);
      const b64 = proto._bytesToBase64(empty);
      const back = proto._base64ToBytes(b64);
      expect(back).toEqual(empty);
    });

    it("handles ASCII text", () => {
      const text = new TextEncoder().encode("Hello, World!");
      const b64 = proto._bytesToBase64(text);
      const back = proto._base64ToBytes(b64);
      expect(back).toEqual(text);
    });

    it("handles binary data with 0x00", () => {
      const data = new Uint8Array([0x00, 0x42, 0x00, 0xff, 0x00]);
      const b64 = proto._bytesToBase64(data);
      const back = proto._base64ToBytes(b64);
      expect(back).toEqual(data);
    });
  });
});
