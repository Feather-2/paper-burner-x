/**
 * @file tests/unit/agents/runtime/core/vfs-proxy-protocol.test.js
 * @description Unit tests for VFS proxy protocol constants.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const MODULE_PATH = "../../../../../js/agents/runtime/core/vfs-proxy-protocol.js";

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "00000000-0000-0000-0000-000000000001"),
}));

import { randomUUID } from "node:crypto";

async function loadProtocol() {
  return await import(MODULE_PATH);
}

function createDeepObject(depth = 40) {
  const root = {};
  let node = root;
  for (let i = 0; i < depth; i += 1) {
    node.child = {};
    node = node.child;
  }
  return root;
}

function createHugeFile(size = 1024 * 1024) {
  return {
    name: "huge.bin",
    content: "x".repeat(size),
  };
}

function createLongString(length = 100000) {
  return "x".repeat(length);
}

function buildRequest(protocol, overrides = {}) {
  return {
    type: protocol.VFS_REQUEST,
    id: 1,
    op: protocol.VFS_OPS.READ,
    path: "/mnt/workspace/a.txt",
    ...overrides,
  };
}

function buildResponse(protocol, overrides = {}) {
  return {
    type: protocol.VFS_RESPONSE,
    id: 1,
    ok: true,
    ...overrides,
  };
}

function isRequest(payload, requestType) {
  return payload?.type === requestType;
}

function isResponse(payload, responseType) {
  return payload?.type === responseType;
}

function isValidOp(value, opsSet) {
  return typeof value === "string" && opsSet.has(value);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("VFS_REQUEST", () => {
  it("exposes the request type constant", async () => {
    const { VFS_REQUEST, VFS_RESPONSE } = await loadProtocol();

    expect(VFS_REQUEST).toBe("vfs:request");
    expect(typeof VFS_REQUEST).toBe("string");
    expect(VFS_REQUEST).not.toBe(VFS_RESPONSE);
  });

  it("builds request payloads across boundary values", async () => {
    const protocol = await loadProtocol();
    const { VFS_REQUEST, VFS_OPS } = protocol;
    const deepNested = createDeepObject(60);
    const hugeFile = createHugeFile();
    const longPath = createLongString(100000);
    const objectAsArray = { 0: "a", length: 1 };
    const buffer = typeof SharedArrayBuffer === "undefined" ? null : new SharedArrayBuffer(16);

    const cases = [
      { id: 0, op: VFS_OPS.READ, path: "", args: [] },
      { id: -1, op: VFS_OPS.WRITE, path: "   ", args: {} },
      { id: Number.MAX_SAFE_INTEGER, op: VFS_OPS.LIST, path: "/mnt/workspace", args: { limit: 1 } },
      { id: "42", op: VFS_OPS.STAT, path: null, args: { size: "100" } },
      { id: randomUUID(), op: VFS_OPS.MKDIR, path: undefined, args: { entries: objectAsArray } },
      { id: 7, op: VFS_OPS.DELETE, path: "/tmp/a", args: { file: hugeFile } },
      { id: 8, op: VFS_OPS.EXISTS, path: longPath, args: deepNested },
      ...(buffer
        ? [{ id: 9, op: VFS_OPS.READ, path: "/tmp/b", mode: "sync", buffer }]
        : []),
    ];

    cases.forEach((item) => {
      let payload;
      expect(() => {
        payload = buildRequest(protocol, item);
      }).not.toThrow();
      expect(payload.type).toBe(VFS_REQUEST);
      expect(payload.op).toBe(item.op);
      expect(payload.path).toBe(item.path);
      expect(payload.id).toBe(item.id);
    });
  });

  it("identifies requests safely for invalid payloads", async () => {
    const { VFS_REQUEST } = await loadProtocol();

    const invalidPayloads = [
      null,
      undefined,
      "",
      "   ",
      0,
      -1,
      [],
      {},
      { type: "wrong" },
      { type: 0 },
      { type: null },
    ];

    invalidPayloads.forEach((payload) => {
      let result;
      expect(() => {
        result = isRequest(payload, VFS_REQUEST);
      }).not.toThrow();
      expect(result).toBe(false);
    });

    expect(isRequest({ type: VFS_REQUEST }, VFS_REQUEST)).toBe(true);
  });

  it("handles concurrent request creation", async () => {
    const protocol = await loadProtocol();
    const { VFS_REQUEST, VFS_OPS } = protocol;

    const ids = [0, -1, Number.MAX_SAFE_INTEGER, "99", randomUUID()];
    const requests = await Promise.all(
      ids.map((id) =>
        Promise.resolve(buildRequest(protocol, { id, op: VFS_OPS.READ, path: "/tmp/concurrent" }))
      )
    );

    requests.forEach((payload, index) => {
      expect(payload.type).toBe(VFS_REQUEST);
      expect(payload.id).toBe(ids[index]);
    });
  });
});

describe("VFS_RESPONSE", () => {
  it("exposes the response type constant", async () => {
    const { VFS_RESPONSE, VFS_REQUEST } = await loadProtocol();

    expect(VFS_RESPONSE).toBe("vfs:response");
    expect(typeof VFS_RESPONSE).toBe("string");
    expect(VFS_RESPONSE).not.toBe(VFS_REQUEST);
  });

  it("builds response payloads across boundary values", async () => {
    const protocol = await loadProtocol();
    const { VFS_RESPONSE } = protocol;
    const deepNested = createDeepObject(60);
    const hugeFile = createHugeFile();
    const longString = createLongString(120000);
    const objectAsArray = { 0: "a", length: 1 };

    const cases = [
      { id: 0, ok: true, data: null },
      { id: -1, ok: false, error: "" },
      { id: Number.MAX_SAFE_INTEGER, ok: false, error: "   " },
      { id: "7", ok: true, data: [] },
      { id: randomUUID(), ok: true, data: {} },
      { id: 2, ok: true, data: undefined },
      { id: 3, ok: true, data: objectAsArray },
      { id: 4, ok: true, data: deepNested },
      { id: 5, ok: true, data: hugeFile },
      { id: 6, ok: true, data: longString },
    ];

    cases.forEach((item) => {
      let payload;
      expect(() => {
        payload = buildResponse(protocol, item);
      }).not.toThrow();
      expect(payload.type).toBe(VFS_RESPONSE);
      expect(payload.id).toBe(item.id);
      expect(payload.ok).toBe(item.ok);
    });
  });

  it("identifies responses safely for invalid payloads", async () => {
    const { VFS_RESPONSE } = await loadProtocol();

    const invalidPayloads = [
      null,
      undefined,
      "",
      "   ",
      0,
      -1,
      [],
      {},
      { type: "wrong" },
      { type: 0 },
      { type: null },
    ];

    invalidPayloads.forEach((payload) => {
      let result;
      expect(() => {
        result = isResponse(payload, VFS_RESPONSE);
      }).not.toThrow();
      expect(result).toBe(false);
    });

    expect(isResponse({ type: VFS_RESPONSE }, VFS_RESPONSE)).toBe(true);
  });

  it("handles rapid consecutive response creation", async () => {
    const protocol = await loadProtocol();
    const { VFS_RESPONSE } = protocol;

    const responses = [];
    for (let i = 0; i < 50; i += 1) {
      responses.push(buildResponse(protocol, { id: i, ok: i % 2 === 0 }));
    }

    responses.forEach((payload, index) => {
      expect(payload.type).toBe(VFS_RESPONSE);
      expect(payload.id).toBe(index);
    });
  });
});

describe("VFS_OPS", () => {
  it("exposes frozen operations with unique values", async () => {
    const { VFS_OPS } = await loadProtocol();

    expect(Object.isFrozen(VFS_OPS)).toBe(true);
    expect(VFS_OPS.READ).toBe("read");
    expect(VFS_OPS.WRITE).toBe("write");
    expect(VFS_OPS.LIST).toBe("list");
    expect(VFS_OPS.STAT).toBe("stat");
    expect(VFS_OPS.MKDIR).toBe("mkdir");
    expect(VFS_OPS.DELETE).toBe("delete");
    expect(VFS_OPS.EXISTS).toBe("exists");

    const values = Object.values(VFS_OPS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("rejects mutation attempts", async () => {
    const { VFS_OPS } = await loadProtocol();

    expect(() => {
      VFS_OPS.READ = "oops";
    }).toThrow();

    expect(() => {
      Object.defineProperty(VFS_OPS, "RENAME", { value: "rename" });
    }).toThrow();
  });

  it("validates ops against boundary and resource-heavy inputs", async () => {
    const { VFS_OPS } = await loadProtocol();
    const opsSet = new Set(Object.values(VFS_OPS));
    const deepNested = createDeepObject(80);
    const hugeFile = createHugeFile();
    const longString = createLongString(100000);
    const objectAsArray = { 0: "a", length: 1 };

    Object.values(VFS_OPS).forEach((op) => {
      expect(isValidOp(op, opsSet)).toBe(true);
    });

    const invalidValues = [
      null,
      undefined,
      "",
      "   ",
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "0",
      [],
      {},
      objectAsArray,
      deepNested,
      hugeFile,
      longString,
    ];

    invalidValues.forEach((value) => {
      let result;
      expect(() => {
        result = isValidOp(value, opsSet);
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });

  it("keeps op reads consistent under simultaneous access", async () => {
    const { VFS_OPS } = await loadProtocol();

    const results = await Promise.all(
      Array.from({ length: 30 }, () => Promise.resolve(VFS_OPS.READ))
    );

    results.forEach((value) => {
      expect(value).toBe(VFS_OPS.READ);
    });
  });
});
