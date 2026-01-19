/**
 * Minimal OPFS (Origin Private File System) mock for unit tests.
 *
 * The real OPFS API surface is quite large. These mocks only implement what
 * js/agents/vfs uses (directory handles, file handles, writable streams and
 * async iteration of entries).
 */

export class NotFoundError extends Error {
  constructor(message = "NotFoundError") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class TypeMismatchError extends Error {
  constructor(message = "TypeMismatchError") {
    super(message);
    this.name = "TypeMismatchError";
  }
}

function toUint8Array(chunk) {
  if (chunk === null || chunk === undefined) return new Uint8Array(0);
  if (chunk instanceof Uint8Array) return chunk;
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
  }
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (typeof Blob !== "undefined" && chunk instanceof Blob) {
    // Blob.arrayBuffer() is async, handled by caller where needed.
    throw new TypeError("Blob must be converted by caller");
  }
  if (typeof chunk === "string") return new TextEncoder().encode(chunk);
  return new TextEncoder().encode(String(chunk));
}

class MockFile {
  constructor(bytes, lastModified = Date.now()) {
    this._bytes = bytes instanceof Uint8Array ? bytes : toUint8Array(bytes);
    this.size = this._bytes.byteLength;
    this.lastModified = lastModified;
  }

  async arrayBuffer() {
    const b = this._bytes;
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }

  async text() {
    return new TextDecoder().decode(this._bytes);
  }
}

class MockWritable {
  constructor(onCommit) {
    this._onCommit = onCommit;
    this._closed = false;
    this._chunks = [];
  }

  async write(chunk) {
    if (this._closed) throw new Error("Writable is closed");
    this._chunks.push(chunk);
  }

  async close() {
    if (this._closed) return;
    this._closed = true;

    // In our codebase, we only ever do a single write per writable.
    const chunk = this._chunks.length ? this._chunks[this._chunks.length - 1] : new Uint8Array(0);

    let bytes;
    if (typeof Blob !== "undefined" && chunk instanceof Blob) {
      bytes = new Uint8Array(await chunk.arrayBuffer());
    } else {
      bytes = toUint8Array(chunk);
    }

    this._onCommit(bytes);
  }
}

export class MockFileHandle {
  constructor(name) {
    this.kind = "file";
    this.name = String(name || "");
    this._bytes = new Uint8Array(0);
    this._lastModified = Date.now();
  }

  async getFile() {
    return new MockFile(this._bytes, this._lastModified);
  }

  async createWritable() {
    return new MockWritable((bytes) => {
      this._bytes = bytes;
      this._lastModified = Date.now();
    });
  }
}

export class MockDirectoryHandle {
  constructor(name = "") {
    this.kind = "directory";
    this.name = String(name || "");
    /** @type {Map<string, any>} */
    this._entries = new Map();
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    const key = String(name || "");
    const existing = this._entries.get(key);
    if (existing) {
      if (existing.kind !== "directory") throw new TypeMismatchError(`Not a directory: ${key}`);
      return existing;
    }
    if (!create) throw new NotFoundError(`Directory not found: ${key}`);
    const dir = new MockDirectoryHandle(key);
    this._entries.set(key, dir);
    return dir;
  }

  async getFileHandle(name, { create = false } = {}) {
    const key = String(name || "");
    const existing = this._entries.get(key);
    if (existing) {
      if (existing.kind !== "file") throw new TypeMismatchError(`Not a file: ${key}`);
      return existing;
    }
    if (!create) throw new NotFoundError(`File not found: ${key}`);
    const file = new MockFileHandle(key);
    this._entries.set(key, file);
    return file;
  }

  async removeEntry(name, { recursive = false } = {}) {
    const key = String(name || "");
    const existing = this._entries.get(key);
    if (!existing) throw new NotFoundError(`Entry not found: ${key}`);

    if (existing.kind === "directory" && !recursive && existing._entries.size > 0) {
      const err = new Error(`Directory not empty: ${key}`);
      err.name = "InvalidModificationError";
      throw err;
    }

    this._entries.delete(key);
  }

  async *entries() {
    for (const [name, handle] of this._entries.entries()) {
      yield [name, handle];
    }
  }

  [Symbol.asyncIterator]() {
    return this.entries();
  }
}

export function createMockOpfsRoot() {
  return new MockDirectoryHandle("");
}

