import { buildIndex as buildBm25Index } from "../retrieval/bm25.js";
import { grepChunks as grepSearch } from "../retrieval/grep.js";
import { chunkText } from "../stages/textprep/chunk.js";
import { normalizeText } from "../stages/textprep/normalize.js";

function getWorkerMessenger() {
  if (typeof self !== "undefined" && typeof self.postMessage === "function") {
    return {
      onMessage(fn) {
        self.onmessage = (e) => fn(e && e.data);
      },
      postMessage(msg) {
        self.postMessage(msg);
      },
    };
  }
  return null;
}

async function getNodeMessenger() {
  const mod = await import("node:worker_threads");
  const parentPort = mod && mod.parentPort;
  if (!parentPort) throw new Error("deepsearch-worker: parentPort not available");
  return {
    onMessage(fn) {
      parentPort.on("message", (data) => fn(data));
    },
    postMessage(msg) {
      parentPort.postMessage(msg);
    },
  };
}

async function init() {
  const messenger = getWorkerMessenger() || (await getNodeMessenger());
  messenger.onMessage(async (data) => {
    const { type, payload, taskId } = data || {};

    try {
      let result;
      switch (type) {
        case "buildBm25Index":
          result = buildBm25Index(payload?.chunks || [], payload?.options || {});
          break;
        case "chunkText":
          result = chunkText(payload?.text || "", payload?.options || {});
          break;
        case "grepSearch":
          result = grepSearch(payload?.chunks || [], payload?.pattern, payload?.options || {});
          break;
        case "normalize":
          result = normalizeText(payload?.text || "");
          break;
        default:
          throw new Error(`Unknown worker task type: ${String(type)}`);
      }
      messenger.postMessage({ type: "result", taskId, result });
    } catch (error) {
      messenger.postMessage({ type: "error", taskId, error: error?.message || String(error) });
    }
  });
}

init();
