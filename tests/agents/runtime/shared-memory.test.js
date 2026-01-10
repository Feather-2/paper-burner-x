const test = require("node:test");
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

test("SharedMemoryBridge: support detection + SAB path", async (t) => {
  const mod = await import("../../../js/agents/runtime/core/shared-memory.js");
  const { SharedMemoryBridge, pack, unpack } = mod;

  await t.test("getSupport() reports SAB + COI gating", () => {
    const baseline = SharedMemoryBridge.getSupport();
    assert.equal(typeof baseline.sharedArrayBuffer, "boolean");
    assert.equal(typeof baseline.crossOriginIsolatedKnown, "boolean");
    assert.equal(typeof baseline.crossOriginIsolated, "boolean");
    assert.equal(typeof baseline.sharedArrayBufferEnabled, "boolean");
    assert.ok(baseline.mode === "sab" || baseline.mode === "messageport");

    withGlobal("crossOriginIsolated", false, () => {
      const s = SharedMemoryBridge.getSupport();
      assert.equal(s.crossOriginIsolatedKnown, true);
      assert.equal(s.crossOriginIsolated, false);
      assert.equal(s.sharedArrayBufferEnabled, false);
      assert.equal(s.mode, "messageport");
    });

    withGlobal("crossOriginIsolated", true, () => {
      const s = SharedMemoryBridge.getSupport();
      assert.equal(s.crossOriginIsolatedKnown, true);
      assert.equal(s.crossOriginIsolated, true);
      assert.equal(s.sharedArrayBufferEnabled, s.sharedArrayBuffer);
    });
  });

  await t.test("getSupport()/isCrossOriginIsolated() tolerate throwing COI getter", () => {
    withProperty("crossOriginIsolated", { get: () => { throw new Error("boom"); } }, () => {
      const s = SharedMemoryBridge.getSupport();
      assert.equal(s.crossOriginIsolatedKnown, false);
      assert.equal(s.crossOriginIsolated, false);
      assert.equal(SharedMemoryBridge.isCrossOriginIsolated(), false);
    });
  });

  await t.test("isSupported() returns false when SAB constructor throws", () => {
    withGlobal("SharedArrayBuffer", function SharedArrayBuffer() { throw new Error("no"); }, () => {
      assert.equal(SharedMemoryBridge.isSupported(), false);
    });
  });

  await t.test("allocate() validates byteLength", () => {
    assert.throws(() => SharedMemoryBridge.allocate(0), /byteLength must be positive/);
    const buf = SharedMemoryBridge.allocate(16);
    assert.equal(buf.byteLength, 16);
    assert.ok(buf instanceof SharedArrayBuffer);
  });

  await t.test("copyToShared() copies TypedArray + ArrayBuffer", () => {
    const input = new Uint8Array([1, 2, 3, 4]);
    const sab = SharedMemoryBridge.copyToShared(input);
    assert.ok(sab instanceof SharedArrayBuffer);
    assert.deepEqual(new Uint8Array(sab), input);

    const u16 = new Uint16Array([0x1234, 0xabcd]);
    const sab2 = SharedMemoryBridge.copyToShared(u16);
    assert.deepEqual(new Uint8Array(sab2), new Uint8Array(u16.buffer));

    const ab = new Uint8Array([9, 8, 7]).buffer;
    const sab3 = SharedMemoryBridge.copyToShared(ab);
    assert.deepEqual(new Uint8Array(sab3), new Uint8Array(ab));

    assert.throws(() => SharedMemoryBridge.copyToShared({ byteLength: 1 }), /must be TypedArray, ArrayBuffer, or SharedArrayBuffer/);
  });

  await t.test("copyToShared() respects COI gating when known=false/true", () => {
    // When COI is explicitly false, treat SAB as disabled and require fallback.
    withGlobal("crossOriginIsolated", false, () => {
      assert.throws(() => SharedMemoryBridge.copyToShared(new Uint8Array([1])), /not enabled/);
    });

    // Passing an existing SAB should still be a no-op.
    const existing = new SharedArrayBuffer(4);
    withGlobal("crossOriginIsolated", false, () => {
      assert.equal(SharedMemoryBridge.copyToShared(existing), existing);
    });
  });

  await t.test("createView() accepts ArrayBufferLike", () => {
    const buf = new ArrayBuffer(16);
    assert.ok(SharedMemoryBridge.createView(buf, "u1") instanceof Uint8Array);
    assert.ok(SharedMemoryBridge.createView(buf, "i1") instanceof Int8Array);
    assert.ok(SharedMemoryBridge.createView(buf, "u2") instanceof Uint16Array);
    assert.ok(SharedMemoryBridge.createView(buf, "i2") instanceof Int16Array);
    assert.ok(SharedMemoryBridge.createView(buf, "u4") instanceof Uint32Array);
    assert.ok(SharedMemoryBridge.createView(buf, "i4") instanceof Int32Array);
    assert.ok(SharedMemoryBridge.createView(buf, "f4") instanceof Float32Array);
    assert.ok(SharedMemoryBridge.createView(buf, "f8") instanceof Float64Array);
    assert.ok(SharedMemoryBridge.createView(buf, "unknown") instanceof Uint8Array);
    assert.throws(() => SharedMemoryBridge.createView(null), /must be SharedArrayBuffer or ArrayBuffer/);
  });

  await t.test("toPython() uses provided pyodide interface", async () => {
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
    assert.deepEqual(out, { pyMemory: { __py__: true, v: seen.view }, dtype: "uint8" });
    assert.ok(seen.view instanceof Uint8Array);
    assert.deepEqual(Array.from(seen.view), [5, 6, 7]);

    await assert.rejects(async () => SharedMemoryBridge.toPython(pyodide, null), /must be SharedArrayBuffer or ArrayBuffer/);
  });

  await t.test("pack()/unpack() use SAB when enabled", async () => {
    const had = Object.prototype.hasOwnProperty.call(globalThis, "crossOriginIsolated");
    const prev = globalThis.crossOriginIsolated;
    globalThis.crossOriginIsolated = true;
    try {
      const bytes = new Uint8Array([10, 20, 30]);
      const packed = pack(bytes); // default mode=auto
      assert.equal(packed.kind, "sab");
      const buf = await unpack(packed);
      assert.ok(buf instanceof SharedArrayBuffer);
      assert.deepEqual(new Uint8Array(buf), bytes);
    } finally {
      if (had) globalThis.crossOriginIsolated = prev;
      else delete globalThis.crossOriginIsolated;
    }

    await assert.rejects(async () => unpack({ kind: "sab", buffer: new ArrayBuffer(1) }), /invalid SAB packet\.buffer/);
  });

  await t.test("wrap() aliases copyToShared()", () => {
    const buf = SharedMemoryBridge.wrap(new Uint8Array([1, 2]));
    assert.ok(buf instanceof SharedArrayBuffer);
  });

  await t.test("pack(mode='sab') throws when SAB not enabled", () => {
    withGlobal("crossOriginIsolated", false, () => {
      assert.throws(() => SharedMemoryBridge.pack(new Uint8Array([1]), { mode: "sab" }), /not enabled/);
    });
  });

  await t.test("estimateOverhead() reports copy vs zero-copy", () => {
    const sab = new SharedArrayBuffer(2);
    const a = SharedMemoryBridge.estimateOverhead(sab);
    assert.equal(a.supported, true);
    assert.equal(a.needsCopy, false);
    assert.match(a.description, /zero-copy/i);

    const b = SharedMemoryBridge.estimateOverhead(new ArrayBuffer(3));
    assert.equal(typeof b.supported, "boolean");
    assert.equal(b.needsCopy, true);
    assert.match(b.description, /Will copy/i);
  });
});

test("SharedMemoryBridge: MessagePort fallback chunking (256KB)", async () => {
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
  assert.equal(chunkBytes, 256 * 1024);

  const total = chunkBytes * 2 + 123;
  const bytes = new Uint8Array(total);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;

  const packet = SharedMemoryBridge.pack(bytes, { mode: "messageport", port: port1 });
  assert.equal(packet.kind, "messageport");
  assert.equal(packet.byteLength, total);

  const out = await SharedMemoryBridge.unpack(packet, { port: port2 });
  assert.ok(out instanceof ArrayBuffer);
  assert.deepEqual(new Uint8Array(out), bytes);

  assert.deepEqual(seenChunkSizes, [chunkBytes, chunkBytes, 123]);

  receiver.close();
  port1.close();
  port2.close();
});

test("MessagePortFallback: edge cases + internal branches", async () => {
  const { MessagePortFallback } = await import("../../../js/agents/runtime/core/shared-memory.js");

  assert.throws(() => new MessagePortFallback(null), /port must be a MessagePort/);

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
  assert.equal(typeof stubPort.onmessage, "function");
  assert.equal(started, 1);
  stub.close();
  assert.equal(stubPort.onmessage, null);

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
  await assert.rejects(async () => stub.unpack({ kind: "messageport", id: "", byteLength: 0 }), /packet\.id is required/);

  // Cover existing.result path: 0-byte transfer completes before unpack() is called.
  {
    const { port1, port2 } = new MessageChannel();
    const sender = new MessagePortFallback(port1);
    const receiver = new MessagePortFallback(port2);
    const packet = sender.pack(new Uint8Array([]));
    await new Promise((r) => setTimeout(r, 0));
    const out = await receiver.unpack(packet);
    assert.ok(out instanceof ArrayBuffer);
    assert.equal(out.byteLength, 0);
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
    await assert.rejects(async () => receiver.unpack({ kind: "messageport", id, byteLength: 1 }), /chunk must be an ArrayBuffer/);
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
    await assert.rejects(async () => pending, /byteLength mismatch/);
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
    await assert.rejects(async () => pending, /chunk overflow/);
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
      assert.equal(packet.kind, "messageport");
      assert.ok(typeof packet.id === "string" && packet.id.startsWith("sm_"));
    });

    const packet2 = sender.pack(new Uint8Array([9, 8, 7]).buffer); // ArrayBufferLike branch
    assert.equal(packet2.byteLength, 3);

    assert.throws(() => sender.pack({}), /data must be TypedArray, ArrayBuffer, or SharedArrayBuffer/);

    sender.close();
    receiver.close();
    port1.close();
    port2.close();
  }
});

test("SharedMemoryBridge: fallback errors when port missing", async () => {
  const { SharedMemoryBridge } = await import("../../../js/agents/runtime/core/shared-memory.js");
  assert.throws(() => SharedMemoryBridge.pack(new Uint8Array([1]), { mode: "messageport" }), /MessagePort required/);
  await assert.rejects(async () => SharedMemoryBridge.unpack({ kind: "messageport", id: "x", byteLength: 1 }), /MessagePort required/);
  assert.throws(() => SharedMemoryBridge.pack(new Uint8Array([1]), { mode: "bogus" }), /unsupported mode/);
  await assert.rejects(async () => SharedMemoryBridge.unpack({ kind: "bogus" }), /unsupported packet kind/);
});

test("SharedMemoryBridge: behaves when SharedArrayBuffer is absent", async (t) => {
  const mod = await import("../../../js/agents/runtime/core/shared-memory.js");
  const { SharedMemoryBridge } = mod;

  await t.test("getSupport() reflects missing SAB", () =>
    withGlobal("SharedArrayBuffer", undefined, () => {
      const s = SharedMemoryBridge.getSupport();
      assert.equal(s.sharedArrayBuffer, false);
      assert.equal(s.sharedArrayBufferEnabled, false);
      assert.equal(s.mode, "messageport");
    }));

  await t.test("allocate()/copyToShared() throw clean errors", () =>
    withGlobal("SharedArrayBuffer", undefined, () => {
      assert.throws(() => SharedMemoryBridge.allocate(8), /not available/);
      assert.throws(() => SharedMemoryBridge.copyToShared(new Uint8Array([1])), /not enabled/);
    }));
});
