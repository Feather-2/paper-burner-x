function coerceNumber(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

async function tryImportMediabunny() {
  try {
    const mod = await import("mediabunny");
    return mod || null;
  } catch {
    return null;
  }
}

async function arrayBufferToBase64(ab) {
  if (typeof Buffer !== "undefined") return Buffer.from(ab).toString("base64");
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // eslint-disable-next-line no-undef
  return btoa(bin);
}

async function blobToBase64(blob) {
  if (!blob || typeof blob.arrayBuffer !== "function") throw new Error("blobToBase64(blob): blob must implement arrayBuffer()");
  return arrayBufferToBase64(await blob.arrayBuffer());
}

async function defaultFrameToBase64(frame) {
  if (frame && typeof frame.arrayBuffer === "function") return blobToBase64(frame);
  if (frame && typeof frame.toBlob === "function") return blobToBase64(await frame.toBlob());

  const createImageBitmapFn = globalThis?.createImageBitmap;
  const OffscreenCanvasCtor = globalThis?.OffscreenCanvas;
  if (typeof createImageBitmapFn !== "function" || typeof OffscreenCanvasCtor !== "function") {
    throw new Error("getVideoFrames: frameToBase64 required (no canvas/WebCodecs available)");
  }

  const bitmap = await createImageBitmapFn(frame);
  const canvas = new OffscreenCanvasCtor(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  if (typeof bitmap.close === "function") bitmap.close();
  return blobToBase64(blob);
}

/**
 * Tool for AI to request video frames on-demand.
 * Returns an array of base64-encoded JPEG frames (no data: prefix).
 * @param {Blob|{arrayBuffer?:Function,type?:string,size?:number}} videoBlob
 * @param {number} startSec
 * @param {number} endSec
 * @param {number} count
 * @param {{mediabunny?:any,frameToBase64?:Function}=} opts
 * @returns {Promise<string[]>}
 */
export async function getVideoFrames(videoBlob, startSec, endSec, count, opts = {}) {
  const nCount = Math.max(0, Math.floor(coerceNumber(count) ?? 0));
  if (!nCount) return [];

  const start = Math.max(0, coerceNumber(startSec) ?? 0);
  const end = Math.max(start, coerceNumber(endSec) ?? start);
  const duration = end - start;
  const interval = nCount <= 1 ? 0 : duration / Math.max(nCount - 1, 1);

  const mediabunny = opts?.mediabunny || (await tryImportMediabunny());
  const Input = mediabunny?.Input;
  const BlobSource = mediabunny?.BlobSource;
  if (typeof Input !== "function" || typeof BlobSource !== "function") return [];

  const frameToBase64 = typeof opts?.frameToBase64 === "function" ? opts.frameToBase64 : defaultFrameToBase64;

  const input = new Input(new BlobSource(videoBlob));
  await input.open();
  try {
    const tracks = Array.isArray(input?.tracks) ? input.tracks : [];
    const videoTrack = tracks.find((t) => t?.type === "video" && typeof t.getFrameAt === "function");
    if (!videoTrack) return [];

    const frames = [];
    for (let i = 0; i < nCount; i++) {
      const timeSec = start + i * interval;
      const timeUs = timeSec * 1e6;
      const frame = await videoTrack.getFrameAt(timeUs);
      try {
        frames.push(await frameToBase64(frame));
      } finally {
        if (frame && typeof frame.close === "function") frame.close();
      }
    }

    return frames;
  } finally {
    await input.close();
  }
}

