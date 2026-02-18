import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessagePortFallback } from "../../../../../js/agents/runtime/core/shared-memory.js";
import { randomBytes } from "node:crypto";

vi.mock("node:crypto", () => ({
  randomBytes: vi.fn((size) => Buffer.alloc(size, 0xab)),
}));

async function withGlobal(name, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, name);
  const prev = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
  try {
    return await fn();
  } finally {
    if (had && prev) {
      Object.defineProperty(globalThis, name, prev);
    } else {
      delete globalThis[name];
    }
  }
}

function createPortPair() {
  const makePort = () => {
    const listeners = new Set();
    const port = {
      _peer: null,
      postMessage(data, _transfer) {
        Promise.resolve().then(() => {
          const peer = port._peer;
          if (!peer) return;
          const event = { data };
          if (typeof peer.onmessage === "function") {
            peer.onmessage(event);
          }
          peer._listeners.forEach((listener) => listener(event));
        });
      },
      addEventListener(type, handler) {
        if (type === "message") port._listeners.add(handler);
      },
      removeEventListener(type, handler) {
        if (type === "message") port._listeners.delete(handler);
      },
      start: vi.fn(),
      onmessage: null,
      _listeners: listeners,
    };
    return port;
  };

  const port1 = makePort();
  const port2 = makePort();
  port1._peer = port2;
  port2._peer = port1;
  return { port1, port2 };
}

const flush = () => Promise.resolve();

function buildNestedObject(depth) {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
}

describe("MessagePortFallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates ports and binds listeners", () => {
    expect(() => new MessagePortFallback(null)).toThrow(/port must be a MessagePort/);
    expect(() => new MessagePortFallback(undefined)).toThrow(/port must be a MessagePort/);
    expect(() => new MessagePortFallback("")).toThrow(/port must be a MessagePort/);

    const emptyObject = {};
    const withEmptyObject = new MessagePortFallback(emptyObject, { chunkBytes: 0 });
    expect(withEmptyObject.chunkBytes).toBe(0);
    expect(typeof emptyObject.onmessage).toBe("function");
    withEmptyObject.close();
    expect(emptyObject.onmessage).toBe(null);

    const emptyArray = [];
    const withEmptyArray = new MessagePortFallback(emptyArray, { chunkBytes: -1 });
    expect(withEmptyArray.chunkBytes).toBe(-1);
    expect(typeof emptyArray.onmessage).toBe("function");
    withEmptyArray.close();
    expect(emptyArray.onmessage).toBe(null);

    const port = {
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      start: vi.fn(),
    };
    const instance = new MessagePortFallback(port);
    const handler = port.addEventListener.mock.calls[0][1];
    expect(port.addEventListener).toHaveBeenCalledWith("message", expect.any(Function));
    expect(port.start).toHaveBeenCalledTimes(1);
    instance.close();
    expect(port.removeEventListener).toHaveBeenCalledWith("message", handler);

    const noisyPort = {
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(() => {
        throw new Error("boom");
      }),
      start: vi.fn(),
    };
    const noisy = new MessagePortFallback(noisyPort);
    expect(() => noisy.close()).not.toThrow();
  });

  it("packs start + chunk messages with deterministic id", async () => {
    const messages = [];
    const port = {
      postMessage: vi.fn((data) => messages.push(data)),
    };

    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const seed = randomBytes(8);
    const expectedId = "sm_" + Array.from(seed, (b) => b.toString(16).padStart(2, "0")).join("");

    await withGlobal("crypto", {
      getRandomValues(arr) {
        arr.set(seed);
        return arr;
      },
    }, () => {
      const fallback = new MessagePortFallback(port, { chunkBytes: 4 });
      const packet = fallback.pack(data);
      expect(packet.id).toBe(expectedId);
      expect(packet.byteLength).toBe(9);
      expect(messages).toHaveLength(4);
      expect(messages[0]).toEqual({
        type: "shared-memory:port-fallback:start",
        id: expectedId,
        byteLength: 9,
        chunkBytes: 4,
      });
      expect(messages.slice(1).map((m) => m.offset)).toEqual([0, 4, 8]);
      expect(messages[3].chunk).toBeInstanceOf(ArrayBuffer);
      expect(messages[3].chunk.byteLength).toBe(1);
    });
  });

  it("falls back to non-crypto id generation when crypto fails", async () => {
    const port = {
      postMessage: vi.fn(),
    };
    const fallback = new MessagePortFallback(port);
    await withGlobal("crypto", {
      getRandomValues() {
        throw new Error("nope");
      },
    }, () => {
      const ids = new Set();
      for (let i = 0; i < 5; i += 1) {
        const packet = fallback.pack(new Uint8Array([1]));
        expect(packet.id).toMatch(/^sm_[a-z0-9]+_[a-z0-9]+_[a-z0-9]+$/);
        ids.add(packet.id);
      }
      expect(ids.size).toBe(5);
    });
  });

  it("supports custom idFactory for transfer ids", () => {
    const messages = [];
    const port = {
      postMessage: vi.fn((data) => messages.push(data)),
    };
    const idFactory = vi.fn(() => "custom_transfer_id");
    const fallback = new MessagePortFallback(port, { idFactory });

    const packet = fallback.pack(new Uint8Array([1, 2]));
    expect(packet.id).toBe("custom_transfer_id");
    expect(idFactory).toHaveBeenCalledTimes(1);
    expect(messages[0]).toMatchObject({
      type: "shared-memory:port-fallback:start",
      id: "custom_transfer_id",
    });
  });

  it("packs zero-length buffers and rejects invalid data inputs", () => {
    const messages = [];
    const port = {
      postMessage: vi.fn((data) => messages.push(data)),
    };
    const fallback = new MessagePortFallback(port);

    const empty = new Uint8Array([]);
    const packet = fallback.pack(empty);
    expect(packet.byteLength).toBe(0);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("shared-memory:port-fallback:start");

    const objectAsArray = { 0: 1, 1: 2, length: 2 };
    expect(() => fallback.pack(null)).toThrow(TypeError);
    expect(() => fallback.pack(undefined)).toThrow(TypeError);
    expect(() => fallback.pack("")).toThrow(TypeError);
    expect(() => fallback.pack([])).toThrow(TypeError);
    expect(() => fallback.pack({})).toThrow(TypeError);
    expect(() => fallback.pack(objectAsArray)).toThrow(TypeError);

    const longString = "x".repeat(1024 * 1024);
    expect(() => fallback.pack(longString)).toThrow(TypeError);

    const nested = buildNestedObject(64);
    expect(() => fallback.pack(nested)).toThrow(TypeError);

    const buffer = new Uint8Array([9, 8, 7]).buffer;
    expect(() => fallback.pack(buffer)).not.toThrow();
  });

  it("reconstructs data for concurrent and rapid transfers", async () => {
    const { port1, port2 } = createPortPair();
    const sender = new MessagePortFallback(port1, { chunkBytes: 32 });
    const receiver = new MessagePortFallback(port2);

    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5, 6, 7]);
    const packetA = sender.pack(a);
    const packetB = sender.pack(b);

    const [bufA, bufB] = await Promise.all([receiver.unpack(packetA), receiver.unpack(packetB)]);
    expect(new Uint8Array(bufA)).toEqual(a);
    expect(new Uint8Array(bufB)).toEqual(b);

    const payloads = [];
    const promises = [];
    for (let i = 0; i < 5; i += 1) {
      const data = new Uint8Array([i, i + 1, i + 2]);
      payloads.push(data);
      const packet = sender.pack(data);
      promises.push(receiver.unpack(packet));
    }

    const results = await Promise.all(promises);
    results.forEach((buf, index) => {
      expect(new Uint8Array(buf)).toEqual(payloads[index]);
    });

    sender.close();
    receiver.close();
  });

  it("handles large payloads within limits", async () => {
    const { port1, port2 } = createPortPair();
    const sender = new MessagePortFallback(port1, { chunkBytes: 64 * 1024 });
    const receiver = new MessagePortFallback(port2, { maxByteLength: 2 * 1024 * 1024 });

    const size = 1024 * 1024 + 123;
    const data = new Uint8Array(size);
    data[0] = 7;
    data[size - 1] = 9;

    const packet = sender.pack(data);
    const out = await receiver.unpack(packet);
    expect(out.byteLength).toBe(size);
    const view = new Uint8Array(out);
    expect(view[0]).toBe(7);
    expect(view[size - 1]).toBe(9);

    sender.close();
    receiver.close();
  });

  it("resolves zero-length transfers and accepts whitespace ids", async () => {
    const { port1, port2 } = createPortPair();
    const sender = new MessagePortFallback(port1);
    const receiver = new MessagePortFallback(port2);

    const packet = sender.pack(new Uint8Array([]));
    await flush();
    const out = await receiver.unpack(packet);
    expect(out.byteLength).toBe(0);

    const id = "   ";
    port1.postMessage({ type: "shared-memory:port-fallback:start", id, byteLength: 0, chunkBytes: 16 });
    await flush();
    const out2 = await receiver.unpack({ kind: "messageport", id, byteLength: 0 });
    expect(out2.byteLength).toBe(0);

    sender.close();
    receiver.close();
  });

  it("rejects invalid packet inputs and length boundaries", async () => {
    const { port2 } = createPortPair();
    const receiver = new MessagePortFallback(port2, { maxByteLength: 8 });

    await expect(receiver.unpack(undefined)).rejects.toThrow(/packet.id is required/);
    await expect(receiver.unpack(null)).rejects.toThrow(/packet.id is required/);
    await expect(receiver.unpack({})).rejects.toThrow(/packet.id is required/);
    await expect(receiver.unpack({ kind: "messageport", id: "", byteLength: 0 })).rejects.toThrow(/packet.id is required/);
    await expect(receiver.unpack({ kind: "messageport", id: "neg", byteLength: -1 })).rejects.toThrow(/non-negative/);
    await expect(receiver.unpack({ kind: "messageport", id: "huge", byteLength: Number.MAX_SAFE_INTEGER }))
      .rejects.toThrow(/exceeds limit/);

    receiver.close();
  });

  it("rejects when start length is negative or exceeds maxByteLength", async () => {
    {
      const { port1, port2 } = createPortPair();
      const receiver = new MessagePortFallback(port2);
      const id = "neg";
      const pending = receiver.unpack({ kind: "messageport", id, byteLength: 1 });
      port1.postMessage({ type: "shared-memory:port-fallback:start", id, byteLength: -1, chunkBytes: 4 });
      await expect(pending).rejects.toThrow(/non-negative/);
      receiver.close();
    }

    {
      const { port1, port2 } = createPortPair();
      const receiver = new MessagePortFallback(port2, { maxByteLength: 4 });
      const id = "limit";
      const pending = receiver.unpack({ kind: "messageport", id, byteLength: 4 });
      port1.postMessage({ type: "shared-memory:port-fallback:start", id, byteLength: 10, chunkBytes: 4 });
      await expect(pending).rejects.toThrow(/exceeds limit/);
      receiver.close();
    }
  });

  it("rejects mismatched lengths including string byteLength values", async () => {
    {
      const { port1, port2 } = createPortPair();
      const receiver = new MessagePortFallback(port2);
      const id = "mismatch";
      const pending = receiver.unpack({ kind: "messageport", id, byteLength: 4 });
      port1.postMessage({ type: "shared-memory:port-fallback:start", id, byteLength: 2, chunkBytes: 4 });
      await expect(pending).rejects.toThrow(/byteLength mismatch/);
      receiver.close();
    }

    {
      const { port1, port2 } = createPortPair();
      const receiver = new MessagePortFallback(port2);
      const id = "string";
      const pending = receiver.unpack({ kind: "messageport", id, byteLength: "8" });
      port1.postMessage({ type: "shared-memory:port-fallback:start", id, byteLength: 8, chunkBytes: 4 });
      await expect(pending).rejects.toThrow(/byteLength mismatch/);
      receiver.close();
    }
  });

  it("rejects invalid chunk payloads and overflows", async () => {
    {
      const { port1, port2 } = createPortPair();
      const receiver = new MessagePortFallback(port2);
      const id = "badchunk";
      const pending = receiver.unpack({ kind: "messageport", id, byteLength: 1 });
      port1.postMessage({ type: "shared-memory:port-fallback:start", id, byteLength: 1, chunkBytes: 4 });
      port1.postMessage({ type: "shared-memory:port-fallback:chunk", id, offset: 0, chunk: "bad" });
      await expect(pending).rejects.toThrow(/chunk must be an ArrayBuffer/);
      receiver.close();
    }

    {
      const { port1, port2 } = createPortPair();
      const receiver = new MessagePortFallback(port2);
      const id = "overflow";
      const pending = receiver.unpack({ kind: "messageport", id, byteLength: 1 });
      port1.postMessage({ type: "shared-memory:port-fallback:start", id, byteLength: 1, chunkBytes: 4 });
      const chunk = new ArrayBuffer(2);
      port1.postMessage({ type: "shared-memory:port-fallback:chunk", id, offset: 0, chunk }, [chunk]);
      await expect(pending).rejects.toThrow(/chunk overflow/);
      receiver.close();
    }
  });

  it("surfaces errors that arrive before unpack and ignores invalid messages", async () => {
    const { port1, port2 } = createPortPair();
    const receiver = new MessagePortFallback(port2);
    const id = "pre_error";

    port1.postMessage({ type: "shared-memory:port-fallback:start", id, byteLength: 1, chunkBytes: 4 });
    port1.postMessage({ type: "shared-memory:port-fallback:chunk", id, offset: 0, chunk: "bad" });
    await flush();

    await expect(receiver.unpack({ kind: "messageport", id, byteLength: 1 }))
      .rejects.toThrow(/chunk must be an ArrayBuffer/);

    port1.postMessage(null);
    port1.postMessage(undefined);
    port1.postMessage(" ");
    port1.postMessage({ type: "unknown", id: "ignored" });
    await flush();
    expect(receiver._transfers.size).toBe(0);

    receiver.close();
  });
});
