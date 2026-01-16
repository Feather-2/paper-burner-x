import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

function withGlobal(name, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, name);
  const prev = globalThis[name];
  globalThis[name] = value;
  try {
    return fn();
  } finally {
    if (had) globalThis[name] = prev;
    else delete globalThis[name];
  }
}

function withProperty(name, descriptor, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, name);
  const prev = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, enumerable: true, ...descriptor });
  try {
    return fn();
  } finally {
    if (had && prev) Object.defineProperty(globalThis, name, prev);
    else delete globalThis[name];
  }
}

it("SharedMemoryBridge: support detection + SAB path", async (t) => {
  const mod = await import("../../../js/agents/runtime/core/shared-memory.js");
  const { SharedMemoryBridge, pack, unpack } = mod;

  await t.it("getSupport() reports SAB + COI gating", () => {
    const baseline = SharedMemoryBridge.getSupport();
    expect(typeof baseline.sharedArrayBuffer).toBe("boolean");
    expect(typeof baseline.crossOriginIsolatedKnown).toBe("boolean");
    expect(typeof baseline.crossOriginIsolated).toBe("boolean");
    expect(typeof baseline.sharedArrayBufferEnabled).toBe("boolean");
    expect(baseline.mode === "sab" || baseline.mode === "messageport").toBeTruthy();

    withGlobal("crossOriginIsolated", false, () => {
      const s = SharedMemoryBridge.getSupport();
      expect(s.crossOriginIsolatedKnown).toBe(true);
      expect(s.crossOriginIsolated).toBe(false);
      expect(s.sharedArrayBufferEnabled).toBe(false);
      expect(s.mode).toBe("messageport");
    });

    withGlobal("crossOriginIsolated", true, () => {
      const s = SharedMemoryBridge.getSupport();
      expect(s.crossOriginIsolatedKnown).toBe(true);
      expect(s.crossOriginIsolated).toBe(true);
      expect(s.sharedArrayBufferEnabled).toBe(s.sharedArrayBuffer);
    });
  });

  await t.it("getSupport()/isCrossOriginIsolated() tolerate throwing COI getter", () => {
    withProperty("crossOriginIsolated", { get: () => { throw new Error("boom"); } }, () => {
      const s = SharedMemoryBridge.getSupport();
      expect(s.crossOriginIsolatedKnown).toBe(false);
      expect(s.crossOriginIsolated).toBe(false);
      expect(SharedMemoryBridge.isCrossOriginIsolated()).toBe(false);
    });
  });

  await t.it("isSupported() returns false when SAB constructor throws", () => {
    withGlobal("SharedArrayBuffer", function SharedArrayBuffer() { throw new Error("no"); }, () => {
      expect(SharedMemoryBridge.isSupported()).toBe(false);
    });
  });

  await t.it("allocate() validates byteLength", () => {
    expect(() => SharedMemoryBridge.allocate(0)).toThrow(/byteLength must be positive/);
    const buf = SharedMemoryBridge.allocate(16);
    expect(buf.byteLength).toBe(16);
    expect(buf instanceof SharedArrayBuffer).toBeTruthy();
  });

  await t.it("copyToShared() copies TypedArray + ArrayBuffer", () => {
    const input = new Uint8Array([1, 2, 3, 4]);
    const sab = SharedMemoryBridge.copyToShared(input);
    expect(sab instanceof SharedArrayBuffer).toBeTruthy();
    expect(new Uint8Array(sab)).toEqual(input);

    const u16 = new Uint16Array([0x1234, 0xabcd]);
    const sab2 = SharedMemoryBridge.copyToShared(u16);
    expect(new Uint8Array(sab2)).toEqual(new Uint8Array(u16.buffer));

    const ab = new Uint8Array([9, 8, 7]).buffer;
    const sab3 = SharedMemoryBridge.copyToShared(ab);
    expect(new Uint8Array(sab3)).toEqual(new Uint8Array(ab));

    expect(() => SharedMemoryBridge.copyToShared({ byteLength: 1 })).toThrow(/must be TypedArray, ArrayBuffer, or SharedArrayBuffer/);
  });

  await t.it("copyToShared() respects COI gating when known=false/true", () => {
    // When COI is explicitly false, treat SAB as disabled and require fallback.
    withGlobal("crossOriginIsolated", false, () => {
      expect(() => SharedMemoryBridge.copyToShared(new Uint8Array([1]).toThrow()), /not enabled/);
    });

    // Passing an existing SAB should still be a no-op.
    const existing = new SharedArrayBuffer(4);
    withGlobal("crossOriginIsolated", false, () => {
      expect(SharedMemoryBridge.copyToShared(existing)).toBe(existing);
    });
  });

  await t.it("createView() accepts ArrayBufferLike", () => {
    const buf = new ArrayBuffer(16);
    expect(SharedMemoryBridge.createView(buf, "u1").toBeTruthy() instanceof Uint8Array);
    expect(SharedMemoryBridge.createView(buf, "i1").toBeTruthy() instanceof Int8Array);
    expect(SharedMemoryBridge.createView(buf, "u2").toBeTruthy() instanceof Uint16Array);
    expect(SharedMemoryBridge.createView(buf, "i2").toBeTruthy() instanceof Int16Array);
    expect(SharedMemoryBridge.createView(buf, "u4").toBeTruthy() instanceof Uint32Array);
    expect(SharedMemoryBridge.createView(buf, "i4").toBeTruthy() instanceof Int32Array);
    expect(SharedMemoryBridge.createView(buf, "f4").toBeTruthy() instanceof Float32Array);
    expect(SharedMemoryBridge.createView(buf, "f8").toBeTruthy() instanceof Float64Array);
    expect(SharedMemoryBridge.createView(buf, "unknown").toBeTruthy() instanceof Uint8Array);
    expect(() => SharedMemoryBridge.createView(null)).toThrow(/must be SharedArrayBuffer or ArrayBuffer/);
  });

  await t.it("toPython() uses provided pyodide interface", async () => {
    const seen = { view: null, dtype: null };
    const pyodide = {
      toPy(v) {
        seen.view = v;
        return { __py__: true, v };
      },
      runPython(_code) {
        return (pyMemory, dtype) => {
          seen.dtype = dtype;
          return { pyMemory, dtype };
        };
      },
    };

    const sab = SharedMemoryBridge.copyToShared(new Uint8Array([5, 6, 7]));
    const out = await SharedMemoryBridge.toPython(pyodide, sab, "uint8");
    expect(out).toEqual({ pyMemory: { __py__: true, v: seen.view }, dtype: "uint8" });
    expect(seen.view instanceof Uint8Array).toBeTruthy();
    expect(Array.from(seen.view)).toEqual([5, 6, 7]);

    await expect(async () => SharedMemoryBridge.toPython(pyodide, null), /must be SharedArrayBuffer or ArrayBuffer/);
  });

  await t.it("pack()/unpack() use SAB when enabled", async () => {
    const had = Object.prototype.hasOwnProperty.call(globalThis, "crossOriginIsolated");
    const prev = globalThis.crossOriginIsolated;
    globalThis.crossOriginIsolated = true;
    try {
      const bytes = new Uint8Array([10, 20, 30]);
      const packed = pack(bytes); // default mode=auto
      expect(packed.kind).toBe("sab");
      const buf = await unpack(packed);
      expect(buf instanceof SharedArrayBuffer).toBeTruthy();
      expect(new Uint8Array(buf)).toEqual(bytes);
    } finally {
      if (had) globalThis.crossOriginIsolated = prev;
      else delete globalThis.crossOriginIsolated;
    }

    await expect(async () => unpack({ kind: "sab", buffer: new ArrayBuffer(1) }), /invalid SAB packet\.buffer/);
  });

  await t.it("wrap() aliases copyToShared()", () => {
    const buf = SharedMemoryBridge.wrap(new Uint8Array([1, 2]));
    expect(buf instanceof SharedArrayBuffer).toBeTruthy();
  });

  await t.it("pack(mode='sab') throws when SAB not enabled", () => {
    withGlobal("crossOriginIsolated", false, () => {
      expect(() => SharedMemoryBridge.pack(new Uint8Array([1]), { mode: "sab" })).toThrow(/not enabled/);
    });
  });

  await t.it("estimateOverhead() reports copy vs zero-copy", () => {
    const sab = new SharedArrayBuffer(2);
    const a = SharedMemoryBridge.estimateOverhead(sab);
    expect(a.supported).toBe(true);
    expect(a.needsCopy).toBe(false);
    expect(a.description).toMatch(/zero-copy/i);

    const b = SharedMemoryBridge.estimateOverhead(new ArrayBuffer(3));
    expect(typeof b.supported).toBe("boolean");
    expect(b.needsCopy).toBe(true);
    expect(b.description).toMatch(/Will copy/i);
  });
});

it("SharedMemoryBridge: MessagePort fallback chunking (256KB)", async () => {
  const mod = await import("../../../js/agents/runtime/core/shared-memory.js");
  const { MessagePortFallback, SharedMemoryBridge } = mod;

  const { port1, port2 } = new MessageChannel();
  const receiver = new MessagePortFallback(port2);

  const seenChunkSizes = [];
  port2.addEventListener("message", (evt) => {
    const msg = evt?.data;
    if (msg?.type === "shared-memory:port-fallback:chunk" && msg.chunk instanceof ArrayBuffer) {
      seenChunkSizes.push(msg.chunk.byteLength);
    }
  });

  const chunkBytes = receiver.chunkBytes;
  expect(chunkBytes).toBe(256 * 1024);

  const total = chunkBytes * 2 + 123;
  const bytes = new Uint8Array(total);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;

  const packet = SharedMemoryBridge.pack(bytes, { mode: "messageport", port: port1 });
  expect(packet.kind).toBe("messageport");
  expect(packet.byteLength).toBe(total);

  const out = await SharedMemoryBridge.unpack(packet, { port: port2 });
  expect(out instanceof ArrayBuffer).toBeTruthy();
  expect(new Uint8Array(out)).toEqual(bytes);

  expect(seenChunkSizes).toEqual([chunkBytes, chunkBytes, 123]);

  receiver.close();
  port1.close();
  port2.close();
});

it("MessagePortFallback: edge cases + internal branches", async () => {
  const { MessagePortFallback } = await import("../../../js/agents/runtime/core/shared-memory.js");

  expect(() => new MessagePortFallback(null)).toThrow(/port must be a MessagePort/);

  // Exercise _start() onmessage fallback path and close() nulls it out.
  let started = 0;
  const stubPort = {
    postMessage() {},
    start() {
      started += 1;
    },
    onmessage: null,
  };
  const stub = new MessagePortFallback(stubPort);
  expect(typeof stubPort.onmessage).toBe("function");
  expect(started).toBe(1);
  stub.close();
  expect(stubPort.onmessage).toBe(null);

  // close() should swallow removeEventListener errors.
  const noisyPort = {
    postMessage() {},
    addEventListener() {},
    removeEventListener() {
      throw new Error("boom");
    },
    start() {},
  };
  const noisy = new MessagePortFallback(noisyPort);
  noisy.close();

  // unpack() rejects when id is missing.
  await expect(async () => stub.unpack({ kind: "messageport", id: "", byteLength: 0 }), /packet\.id is required/);

  // Cover existing.result path: 0-byte transfer completes before unpack() is called.
  {
    const { port1, port2 } = new MessageChannel();
    const sender = new MessagePortFallback(port1);
    const receiver = new MessagePortFallback(port2);
    const packet = sender.pack(new Uint8Array([]));
    await new Promise((r) => setTimeout(r, 0));
    const out = await receiver.unpack(packet);
    expect(out instanceof ArrayBuffer).toBeTruthy();
    expect(out.byteLength).toBe(0);
    sender.close();
    receiver.close();
    port1.close();
    port2.close();
  }

  // Cover existing.error path: protocol error stored before unpack() is called.
  {
    const { port1, port2 } = new MessageChannel();
    const receiver = new MessagePortFallback(port2);
    const id = "err_pre";
    port1.postMessage({ type: "shared-memory:port-fallback:start", id, byteLength: 1, chunkBytes: 1024 });
    port1.postMessage({ type: "shared-memory:port-fallback:chunk", id, offset: 0, chunk: "bad" });
    await new Promise((r) => setTimeout(r, 0));
    await expect(async () => receiver.unpack({ kind: "messageport", id, byteLength: 1 }), /chunk must be an ArrayBuffer/);
    receiver.close();
    port1.close();
    port2.close();
  }

  // Cover byteLength mismatch -> _fail() rejects when a waiter exists.
  {
    const { port1, port2 } = new MessageChannel();
    const receiver = new MessagePortFallback(port2);
    const id = "mismatch";
    const pending = receiver.unpack({ kind: "messageport", id, byteLength: 4 });
    port1.postMessage({ type: "shared-memory:port-fallback:start", id, byteLength: 1, chunkBytes: 1024 });
    await expect(async () => pending, /byteLength mismatch/);
    receiver.close();
    port1.close();
    port2.close();
  }

  // Cover chunk overflow -> _fail() rejects.
  {
    const { port1, port2 } = new MessageChannel();
    const receiver = new MessagePortFallback(port2);
    const id = "overflow";
    const pending = receiver.unpack({ kind: "messageport", id, byteLength: 1 });
    port1.postMessage({ type: "shared-memory:port-fallback:start", id, byteLength: 1, chunkBytes: 1024 });
    const chunk = new ArrayBuffer(2);
    port1.postMessage({ type: "shared-memory:port-fallback:chunk", id, offset: 0, chunk }, [chunk]);
    await expect(async () => pending, /chunk overflow/);
    receiver.close();
    port1.close();
    port2.close();
  }

  // Exercise toUint8View branches + makeTransferId crypto fallback.
  {
    const { port1, port2 } = new MessageChannel();
    const sender = new MessagePortFallback(port1, { chunkBytes: 2048 });
    const receiver = new MessagePortFallback(port2);

    withProperty("crypto", { value: { getRandomValues: () => { throw new Error("no"); } } }, () => {
      const packet = sender.pack(new Int16Array([1, 2, 3])); // ArrayBuffer.isView branch
      expect(packet.kind).toBe("messageport");
      expect(typeof packet.id === "string" && packet.id.startsWith("sm_")).toBeTruthy();
    });

    const packet2 = sender.pack(new Uint8Array([9, 8, 7]).buffer); // ArrayBufferLike branch
    expect(packet2.byteLength).toBe(3);

    expect(() => sender.pack({})).toThrow(/data must be TypedArray, ArrayBuffer, or SharedArrayBuffer/);

    sender.close();
    receiver.close();
    port1.close();
    port2.close();
  }
});

it("SharedMemoryBridge: fallback errors when port missing", async () => {
  const { SharedMemoryBridge } = await import("../../../js/agents/runtime/core/shared-memory.js");
  expect(() => SharedMemoryBridge.pack(new Uint8Array([1]), { mode: "messageport" })).toThrow(/MessagePort required/);
  await expect(async () => SharedMemoryBridge.unpack({ kind: "messageport", id: "x", byteLength: 1 })).rejects.toThrow(/MessagePort required/);
  expect(() => SharedMemoryBridge.pack(new Uint8Array([1]), { mode: "bogus" })).toThrow(/unsupported mode/);
  await expect(async () => SharedMemoryBridge.unpack({ kind: "bogus" })).rejects.toThrow(/unsupported packet kind/);
});

it("SharedMemoryBridge: behaves when SharedArrayBuffer is absent", async (t) => {
  const mod = await import("../../../js/agents/runtime/core/shared-memory.js");
  const { SharedMemoryBridge } = mod;

  await t.it("getSupport() reflects missing SAB", () =>
    withGlobal("SharedArrayBuffer", undefined, () => {
      const s = SharedMemoryBridge.getSupport();
      expect(s.sharedArrayBuffer).toBe(false);
      expect(s.sharedArrayBufferEnabled).toBe(false);
      expect(s.mode).toBe("messageport");
    }));

  await t.it("allocate()/copyToShared() throw clean errors", () =>
    withGlobal("SharedArrayBuffer", undefined, () => {
      expect(() => SharedMemoryBridge.allocate(8)).toThrow(/not available/);
      expect(() => SharedMemoryBridge.copyToShared(new Uint8Array([1]).toThrow()), /not enabled/);
    }));
});
