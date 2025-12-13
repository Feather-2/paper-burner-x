// Stream large files in chunks to avoid memory spikes.
export async function* loadChunksStream(source, chunkSize = 1024 * 1024) {
  const size = Number.isFinite(chunkSize) ? Math.max(1, Math.floor(chunkSize)) : 1024 * 1024;

  if (source instanceof Blob || (typeof File !== "undefined" && source instanceof File)) {
    let offset = 0;
    while (offset < source.size) {
      const slice = source.slice(offset, offset + size);
      const text = await slice.text();
      yield { text, offset, size: text.length };
      offset += size;
    }
    return;
  }

  throw new TypeError("loadChunksStream(source): source must be a Blob or File");
}

export async function processLargeFile(file, processor, options = {}) {
  const chunkSize = Number.isFinite(options.chunkSize) ? Math.max(1, Math.floor(options.chunkSize)) : 1024 * 1024;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;

  const results = [];
  let processed = 0;

  for await (const chunk of loadChunksStream(file, chunkSize)) {
    // processor can return any serializable value; keep ordering stable.
    // eslint-disable-next-line no-await-in-loop
    const result = await processor(chunk);
    results.push(result);
    processed += chunk.size;
    onProgress?.({ processed, total: file.size, percent: file.size ? processed / file.size : 1 });
  }

  return results;
}
