import { validateBlockManifest } from "../shared/block-manifest.js";

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeTypeList(type) {
  if (!type) return [];
  return Array.isArray(type) ? type : [type];
}

function matchesType(value, type) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return isFiniteNumber(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

function enforceSchemaType(field, value, schema, label) {
  if (!schema || schema.type === undefined) return;
  const types = normalizeTypeList(schema.type);
  if (types.length === 0) return;
  const ok = types.some((type) => matchesType(value, type));
  if (!ok) {
    const expected = types.join("|");
    throw new TypeError(`${label} ${field} must be ${expected}`);
  }
}

function normalizeInput(input, schema) {
  if (input === undefined) input = {};
  if (!isPlainObject(input)) {
    throw new TypeError("Block executor input must be an object");
  }

  const properties = isPlainObject(schema?.properties) ? schema.properties : {};
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const normalized = {};

  for (const [key, propSchema] of Object.entries(properties)) {
    let value = input[key];
    if (value === undefined && propSchema && Object.prototype.hasOwnProperty.call(propSchema, "default")) {
      value = propSchema.default;
    }
    if (value === undefined) continue;

    enforceSchemaType(key, value, propSchema, "Input");
    normalized[key] = value;
  }

  for (const key of required) {
    if (normalized[key] === undefined) {
      throw new Error(`Missing required input: ${key}`);
    }
  }

  return normalized;
}

function mapOutput(result, schema) {
  if (!isPlainObject(result)) {
    throw new TypeError("Block executor result must be an object");
  }

  const properties = isPlainObject(schema?.properties) ? schema.properties : {};
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const mapped = {};

  for (const [key, propSchema] of Object.entries(properties)) {
    let value = result[key];
    if (value === undefined && propSchema && Object.prototype.hasOwnProperty.call(propSchema, "default")) {
      value = propSchema.default;
    }
    if (value === undefined) continue;

    enforceSchemaType(key, value, propSchema, "Output");
    mapped[key] = value;
  }

  for (const key of required) {
    if (mapped[key] === undefined) {
      throw new Error(`Missing required output: ${key}`);
    }
  }

  return mapped;
}

function emitBlockEvent(emit, name, status, payload, extra = {}) {
  if (typeof emit !== "function") return;
  emit(name, {
    actor: payload?.block ? `block:${payload.block}` : "block-executor",
    status,
    payload,
    ...extra,
  });
}

function ensureState(result) {
  if (!isPlainObject(result)) {
    throw new TypeError("Block executor result must be an object");
  }
  if (result.state === undefined) {
    throw new Error("Block executor result must include state");
  }
  return result.state;
}

export function createBlockExecutor(stageFn, manifest) {
  if (typeof stageFn !== "function") {
    throw new TypeError("createBlockExecutor(stageFn, manifest): stageFn must be a function");
  }
  const { ok, errors } = validateBlockManifest(manifest);
  if (!ok) {
    throw new Error(`Invalid block manifest: ${errors.join("; ")}`);
  }

  const maxAttempts = manifest.retryable ? 2 : 1;

  return async function blockExecutor(runContext, input, blockApi = {}) {
    const normalizedInput = normalizeInput(input, manifest.input);
    const emit = blockApi?.emit;

    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptStartedAt = Date.now();
      emitBlockEvent(emit, "dag.node.started", "started", {
        block: manifest.name,
        attempt,
        input: normalizedInput,
      });

      try {
        const result = await stageFn(runContext, normalizedInput, blockApi);
        const state = ensureState(result);
        const output = mapOutput(result, manifest.output);
        const durationMs = Date.now() - attemptStartedAt;

        emitBlockEvent(emit, "dag.node.completed", "completed", {
          block: manifest.name,
          attempt,
          output,
        }, { durationMs });

        return { state, ...output };
      } catch (err) {
        lastError = err;
        if (attempt >= maxAttempts) {
          const durationMs = Date.now() - attemptStartedAt;
          const message = err?.message ?? String(err);
          const name = err?.name ?? "Error";
          emitBlockEvent(emit, "dag.node.failed", "failed", {
            block: manifest.name,
            attempt,
            error: { message, name },
          }, { durationMs });
          throw err;
        }
      }
    }

    throw lastError;
  };
}
