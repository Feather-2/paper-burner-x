/**
 * @file dom-sanitizer.js
 * @description Small escaping/sanitizing helpers for LayerEditor UI templates.
 */

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
}

export function escapeAttr(value) {
  // Escapes enough to safely embed inside quoted HTML attributes.
  return escapeHtml(value).replace(/`/g, '&#96;');
}

export function sanitizeCssColor(value, fallback = 'transparent') {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;

  // Hex: #rgb/#rrggbb/#rrggbbaa
  if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;

  // rgb()/rgba()
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(raw)) {
    return raw;
  }

  // hsl()/hsla()
  if (/^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(raw)) {
    return raw;
  }

  // Basic named colors only (avoid `url(...)` etc).
  if (/^[a-z]+$/i.test(raw)) return raw;

  return fallback;
}

export function sanitizeUrlForAttr(value, { allowData = true } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();

  if (lower.startsWith('javascript:')) return '';
  if (lower.startsWith('data:text/html')) return '';
  if (!allowData && lower.startsWith('data:')) return '';

  return raw;
}

export function sanitizeSvg(svgString) {
  const raw = String(svgString ?? '');
  if (!raw) return '';

  // Fallback sanitization when DOMPurify is unavailable (e.g. some sandboxed contexts).
  const fallback = raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<foreignObject\b[^<]*(?:(?!<\/foreignObject>)<[^<]*)*<\/foreignObject>/gi, '')
    .replace(/\bon\w+\s*=/gi, 'data-removed-handler=')
    .replace(/\b(href|src|xlink:href)\s*=\s*(['"])\s*(?:javascript:|data:text\/html)[^'"]*\2/gi, '$1=$2#$2')
    .replace(/\b(href|src|xlink:href)\s*=\s*(?:javascript:|data:text\/html)[^\s>]+/gi, '$1=\"#\"');

  const purifier = globalThis.DOMPurify || globalThis.window?.DOMPurify;
  if (!purifier || typeof purifier.sanitize !== 'function') return fallback;

  try {
    return purifier.sanitize(fallback, {
      USE_PROFILES: { svg: true, svgFilters: true },
      KEEP_CONTENT: true,
      SAFE_FOR_TEMPLATES: true,
      ALLOW_DATA_ATTR: true,
    });
  } catch (e) {
    console.warn('[LayerEditor] DOMPurify sanitizeSvg failed:', e);
    return fallback;
  }
}
