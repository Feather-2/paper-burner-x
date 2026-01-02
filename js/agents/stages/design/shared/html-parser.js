export function parseTagAttributes(tag) {
  const attrs = {};
  if (!tag || typeof tag !== "string") return attrs;

  const isWs = (c) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f";
  const isNameChar = (c) => {
    const code = c.charCodeAt(0);
    return (
      (code >= 48 && code <= 57) || // 0-9
      (code >= 65 && code <= 90) || // A-Z
      (code >= 97 && code <= 122) || // a-z
      c === "-" ||
      c === "_" ||
      c === ":"
    );
  };

  // Best-effort: start scanning after tag name ("<div ...>").
  let i = tag.indexOf(" ");
  if (i === -1) return attrs;

  while (i < tag.length) {
    while (i < tag.length && isWs(tag[i])) i++;
    const ch = tag[i];
    if (!ch || ch === ">" || ch === "/") break;

    const nameStart = i;
    while (i < tag.length && isNameChar(tag[i])) i++;
    const nameRaw = tag.slice(nameStart, i);
    const name = nameRaw.toLowerCase();
    if (!name) {
      i++;
      continue;
    }

    while (i < tag.length && isWs(tag[i])) i++;
    if (tag[i] !== "=") {
      attrs[name] = "";
      continue;
    }

    i++; // "="
    while (i < tag.length && isWs(tag[i])) i++;
    if (i >= tag.length) {
      attrs[name] = "";
      break;
    }

    const quote = tag[i] === '"' || tag[i] === "'" ? tag[i] : null;
    if (quote) {
      i++;
      const valueStart = i;
      while (i < tag.length && tag[i] !== quote) i++;
      attrs[name] = tag.slice(valueStart, i);
      if (tag[i] === quote) i++;
      continue;
    }

    const valueStart = i;
    while (i < tag.length) {
      const c = tag[i];
      if (isWs(c) || c === ">" || c === "/") break;
      i++;
    }
    attrs[name] = tag.slice(valueStart, i);
  }

  return attrs;
}

