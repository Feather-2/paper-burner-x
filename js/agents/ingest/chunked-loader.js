/**
 * @typedef {object} ChunkedBinary
 * @property {ArrayBuffer} buffer
 * @property {number} offset
 * @property {number} size
 * @property {number} byteLength
 */

/**
 * @typedef {object} ChunkedText
 * @property {string} text
 * @property {number} offset
 * @property {number} size
 * @property {number} byteLength
 */

/**
 * @typedef {ChunkedBinary | ChunkedText} ChunkRecord
 */

/**
 * Stream large files in chunks to avoid memory spikes.
 *
 * Returns `ArrayBuffer` chunks by default (zero-copy from `Blob.slice()`).
 * Set `{ asText: true }` for string chunks (incurs decoding overhead).
 *
 * @param {Blob | File | { getReader: Function }} source
 * @param {number} [chunkSize]
 * @param {{ asText?: boolean }} [options]
 * @returns {AsyncGenerator<ChunkRecord, void, void>}
 */
export async function* loadChunksStream(source, chunkSize = 1024 * 1024, options = {}) {
  const size = Number.isFinite(chunkSize) ? Math.max(1, Math.floor(chunkSize)) : 1024 * 1024;
  const asText = Boolean(options.asText);

  if (source instanceof Blob || (typeof File !== "undefined" && source instanceof File)) {
    let offset = 0;
    while (offset < source.size) {
      const end = Math.min(offset + size, source.size);
      const slice = source.slice(offset, end);

      if (asText) {
        // 文本模式：需要解码，有内存开销
        const text = await slice.text();
        yield { text, offset, size: text.length, byteLength: slice.size };
      } else {
        // 二进制模式：零拷贝 ArrayBuffer
        const buffer = await slice.arrayBuffer();
        yield { buffer, offset, size: buffer.byteLength, byteLength: buffer.byteLength };
      }

      offset = end;
    }
    return;
  }

  // 支持 ReadableStream (浏览器 fetch response.body)
  if (source && typeof source.getReader === "function") {
    const reader = source.getReader();
    let offset = 0;
    let pending = new Uint8Array(0);

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          // 合并 pending 和新数据
          const combined = new Uint8Array(pending.length + value.length);
          combined.set(pending);
          combined.set(value, pending.length);
          pending = combined;
        }

        // 分块输出
        while (pending.length >= size) {
          const chunk = pending.slice(0, size);
          pending = pending.slice(size);

          if (asText) {
            const text = new TextDecoder().decode(chunk);
            yield { text, offset, size: text.length, byteLength: chunk.byteLength };
          } else {
            yield { buffer: chunk.buffer, offset, size: chunk.byteLength, byteLength: chunk.byteLength };
          }
          offset += chunk.byteLength;
        }

        if (done) break;
      }

      // 输出剩余数据
      if (pending.length > 0) {
        if (asText) {
          const text = new TextDecoder().decode(pending);
          yield { text, offset, size: text.length, byteLength: pending.byteLength };
        } else {
          yield { buffer: pending.buffer, offset, size: pending.byteLength, byteLength: pending.byteLength };
        }
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }

  throw new TypeError("loadChunksStream(source): source must be a Blob, File, or ReadableStream");
}

/**
 * Process a large file by streaming its chunks sequentially.
 *
 * @template T
 * @param {Blob | File} file
 * @param {(chunk: ChunkRecord) => (Promise<T> | T)} processor
 * @param {{ chunkSize?: number, onProgress?: (progress: { processed: number, total: number, percent: number }) => void, asText?: boolean }} [options]
 * @returns {Promise<T[]>}
 */
export async function processLargeFile(file, processor, options = {}) {
  const chunkSize = Number.isFinite(options.chunkSize) ? Math.max(1, Math.floor(options.chunkSize)) : 1024 * 1024;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const asText = options.asText ?? true; // 默认文本模式以保持向后兼容

  const results = [];
  let processed = 0;
  const total = file.size || 0;

  for await (const chunk of loadChunksStream(file, chunkSize, { asText })) {
    // processor can return any serializable value; keep ordering stable.
    // eslint-disable-next-line no-await-in-loop
    const result = await processor(chunk);
    results.push(result);
    processed += chunk.byteLength;
    onProgress?.({ processed, total, percent: total ? processed / total : 1 });
  }

  return results;
}
