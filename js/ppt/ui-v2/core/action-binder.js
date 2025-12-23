/**
 * UI V2 Action Binder
 * 统一 data-action 事件代理
 */

const DEFAULT_EVENTS = ['click', 'change', 'input', 'keydown'];

function coerceValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const num = Number(value);
  if (!Number.isNaN(num) && value.trim() !== '') return num;
  return value;
}

function extractPayload(target) {
  const payload = {};
  const data = target?.dataset || {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'action' || key === 'event') continue;
    payload[key] = coerceValue(value);
  }
  return payload;
}

export function bindActionEvents(root, resolveHandler, { events = DEFAULT_EVENTS } = {}) {
  if (!root || typeof root.addEventListener !== 'function') {
    return () => {};
  }

  const handler = (event) => {
    const target = event?.target?.closest?.('[data-action]');
    if (!target || !root.contains(target)) return;

    const action = target.dataset.action;
    if (!action) return;

    const expectedEvent = target.dataset.event;
    if (expectedEvent && expectedEvent !== event.type) return;
    if (!expectedEvent && event.type !== 'click') return;

    const resolved = typeof resolveHandler === 'function' ? resolveHandler(action) : null;
    if (typeof resolved !== 'function') return;

    const payload = extractPayload(target);
    const value = 'value' in target ? target.value : undefined;
    const checked = typeof target.checked === 'boolean' ? target.checked : undefined;

    resolved({ event, target, action, payload, value, checked });
  };

  events.forEach((type) => root.addEventListener(type, handler));
  return () => events.forEach((type) => root.removeEventListener(type, handler));
}

export default bindActionEvents;
