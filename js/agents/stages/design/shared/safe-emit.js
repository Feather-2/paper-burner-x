/**
 * @typedef {Record<string, unknown>} EventPayload
 */

/**
 * @typedef {(name: string, event: { actor: string, status: string, payload: EventPayload }) => void} EmitFn
 */

/**
 * Emit a design-stage event only when `emit` is a function.
 *
 * @param {EmitFn|undefined|null} emit - Optional emit function.
 * @param {string} name - Event name.
 * @param {string} status - Event status.
 * @param {EventPayload} payload - Event payload to emit.
 * @returns {void} No return value.
 */
export function safeEmit(emit, name, status, payload) {
  if (typeof emit !== "function") return;
  emit(name, { actor: "design", status, payload });
}

/** @type {{ safeEmit: typeof safeEmit }} */
export default { safeEmit };
