import { EventBus, isValidEventName } from "../events/event-bus.js";

const RPC_KIND_REQUEST = "rpc_request";
const RPC_KIND_RESPONSE = "rpc_response";
const DEFAULT_TIMEOUT_MS = 30_000;

function toNonEmptyString(value) {
  const s = typeof value === "string" ? value : String(value ?? "");
  return s.trim().length ? s : null;
}

function toPositiveInt(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function createRpcId() {
  const c = globalThis?.crypto;
  const uuid = typeof c?.randomUUID === "function" ? c.randomUUID() : null;
  if (uuid) return uuid.toLowerCase().replace(/-/g, "_");
  return `r${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isAbortSignal(signal) {
  return !!signal && typeof signal === "object" && typeof signal.aborted === "boolean";
}

export class MessageBus {
  constructor(eventBus) {
    if (eventBus === undefined || eventBus === null) {
      this.eventBus = new EventBus();
      this._ownsEventBus = true;
      return;
    }
    if (!(eventBus instanceof EventBus)) {
      throw new TypeError("MessageBus(eventBus): eventBus must be an EventBus");
    }
    this.eventBus = eventBus;
    this._ownsEventBus = false;
  }

  dispose() {
    if (this._ownsEventBus && typeof this.eventBus?.dispose === "function") {
      try {
        this.eventBus.dispose();
      } catch {
        // ignore
      }
    }
  }

  emit(type, payload) {
    const name = toNonEmptyString(type);
    if (!name || !isValidEventName(name)) {
      throw new Error("MessageBus.emit(type, payload): type must be a valid event name");
    }
    return this.eventBus.emit(name, payload);
  }

  on(type, handler) {
    const name = toNonEmptyString(type);
    if (!name || !isValidEventName(name)) {
      throw new Error("MessageBus.on(type, handler): type must be a valid event name");
    }
    if (typeof handler !== "function") {
      throw new TypeError("MessageBus.on(type, handler): handler must be a function");
    }

    const off = this.eventBus.on(name, (evt) => {
      const meta = evt && typeof evt === "object" ? evt.meta : null;
      const isRpcRequest =
        meta &&
        typeof meta === "object" &&
        meta.kind === RPC_KIND_REQUEST &&
        typeof meta.replyTo === "string" &&
        typeof meta.requestId === "string";

      if (!isRpcRequest) {
        handler(evt?.payload, evt);
        return;
      }

      const replyTo = meta.replyTo;
      const requestId = meta.requestId;

      Promise.resolve()
        .then(() => handler(evt?.payload, evt))
        .then(
          (data) => {
            this.eventBus.emit(replyTo, {
              payload: { ok: true, data },
              meta: { kind: RPC_KIND_RESPONSE, requestId },
            });
          },
          (err) => {
            const message = err instanceof Error ? err.message : String(err);
            this.eventBus.emit(replyTo, {
              payload: { ok: false, error: message },
              meta: { kind: RPC_KIND_RESPONSE, requestId },
            });
          }
        );
    });

    return off;
  }

  request(type, payload, options = {}) {
    const name = toNonEmptyString(type);
    if (!name || !isValidEventName(name)) {
      throw new Error("MessageBus.request(type, payload): type must be a valid event name");
    }

    const timeoutMs = toPositiveInt(options?.timeoutMs, DEFAULT_TIMEOUT_MS);
    const signal = options?.signal;
    if (signal !== undefined && !isAbortSignal(signal)) {
      throw new TypeError("MessageBus.request(...): options.signal must be an AbortSignal");
    }

    const requestId = createRpcId();
    const replyTo = `rpc.response.${requestId}`;

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason || new Error("Request aborted"));
        return;
      }

      let done = false;
      let timerId = null;
      let off = null;
      let onAbort = null;

      const cleanup = () => {
        if (done) return;
        done = true;

        if (timerId) {
          try {
            clearTimeout(timerId);
          } catch {
            // ignore
          }
        }
        timerId = null;

        try {
          off?.();
        } catch {
          // ignore
        }
        off = null;

        if (onAbort && signal && typeof signal.removeEventListener === "function") {
          try {
            signal.removeEventListener("abort", onAbort);
          } catch {
            // ignore
          }
        }
        onAbort = null;
      };

      const finishResolve = (value) => {
        cleanup();
        resolve(value);
      };

      const finishReject = (error) => {
        cleanup();
        reject(error);
      };

      onAbort = () => finishReject(signal.reason || new Error("Request aborted"));
      if (signal && typeof signal.addEventListener === "function") {
        try {
          signal.addEventListener("abort", onAbort, { once: true });
        } catch {
          // ignore
        }
      }

      off = this.eventBus.once(replyTo, (evt) => {
        const meta = evt && typeof evt === "object" ? evt.meta : null;
        const expected =
          meta &&
          typeof meta === "object" &&
          meta.kind === RPC_KIND_RESPONSE &&
          meta.requestId === requestId;

        if (!expected) {
          finishReject(new Error(`Invalid response for requestId: ${requestId}`));
          return;
        }

        const body = evt?.payload;
        if (body && typeof body === "object" && "ok" in body) {
          if (body.ok) finishResolve(body.data);
          else finishReject(new Error(body.error || "Request failed"));
          return;
        }

        finishResolve(body);
      });

      timerId = setTimeout(() => {
        finishReject(new Error(`Request timeout after ${timeoutMs}ms: ${name}`));
      }, timeoutMs);

      this.eventBus.emit(name, {
        payload,
        meta: { kind: RPC_KIND_REQUEST, requestId, replyTo },
      });
    });
  }
}
