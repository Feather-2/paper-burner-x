/**
 * Command safety classification (Codex-inspired).
 *
 * Intended for environments that expose an OS command tool (e.g. Node.js CLI).
 * Browser builds typically won't execute shell commands, but this classifier can still be used
 * for policy decisions and auditing.
 */

/**
 * @typedef {"safe" | "unknown" | "dangerous"} CommandSafetyLevel
 *
 * @typedef {object} CommandClassification
 * @property {CommandSafetyLevel} level
 * @property {boolean} requiresApproval
 * @property {string} [baseCommand]
 * @property {string[]} [reasons]
 */

const SAFE_COMMANDS = new Set([
  "cat",
  "cd",
  "echo",
  "grep",
  "head",
  "ls",
  "pwd",
  "tail",
  "wc",
  "which",
]);

const DANGEROUS_COMMANDS = new Set([
  "rm",
  "rmdir",
  "chmod",
  "chown",
  "kill",
  "shutdown",
  "dd",
  "mkfs",
  "mount",
  "umount",
]);

const SENSITIVE_PATH_PATTERNS = [
  /(^|\/)etc\/passwd$/i,
  /(^|\/)etc\/shadow$/i,
  /(^|\/)etc\/ssh(\/|$)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.aws\/credentials$/i,
  /(^|\/)\.gnupg(\/|$)/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.env$/i,
  /(^|\/)\.git\/config$/i,
  /id_rsa|id_ed25519|authorized_keys|known_hosts/i,
];

function toBaseName(cmd) {
  const raw = typeof cmd === "string" ? cmd.trim() : "";
  if (!raw) return "";
  const normalized = raw.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  return (parts[parts.length - 1] || "").toLowerCase();
}

function isConnector(token) {
  return token === "&&" || token === "||" || token === ";" || token === "|" || token === "&";
}

function normalizePathArg(arg) {
  const raw = String(arg ?? "");
  if (!raw) return "";
  return raw
    .replaceAll("\\", "/")
    .replace(/^~(?=\/|$)/, "/home")
    .replace(/\$HOME/g, "/home")
    .trim()
    .toLowerCase();
}

function looksSensitivePath(arg) {
  const candidate = normalizePathArg(arg);
  if (!candidate) return false;
  return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(candidate));
}

function looksLikeForkBomb(command) {
  const raw = typeof command === "string" ? command : Array.isArray(command) ? command.join(" ") : "";
  const compact = raw.replace(/\s+/g, "");
  if (!compact) return false;
  if (compact.includes(":(){:|:&};:")) return true;
  if (compact.includes("fork(){fork|fork&};fork")) return true;
  return false;
}

/**
 * Minimal shell tokenizer (quotes + backslash escapes).
 * Conservative: does not aim to fully parse POSIX shell.
 * @param {string} input
 * @returns {string[]}
 */
function tokenizeShell(input) {
  const s = String(input ?? "");
  const out = [];
  let cur = "";
  let quote = null; // "'" | '"' | null

  const push = () => {
    if (cur) out.push(cur);
    cur = "";
  };

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      if (quote === "\"" && ch === "\\" && i + 1 < s.length) {
        cur += s[i + 1];
        i += 1;
        continue;
      }
      cur += ch;
      continue;
    }

    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }

    if (ch === "\\" && i + 1 < s.length) {
      cur += s[i + 1];
      i += 1;
      continue;
    }

    // whitespace
    if (/\s/.test(ch)) {
      push();
      continue;
    }

    // connectors (2-char first)
    if ((ch === "&" || ch === "|") && i + 1 < s.length && s[i + 1] === ch) {
      push();
      out.push(ch + ch);
      i += 1;
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "&") {
      push();
      out.push(ch);
      continue;
    }

    cur += ch;
  }

  push();
  return out;
}

/**
 * Parse compound command strings into a list of argv-like arrays.
 * Example: `bash -c "ls && rm -rf /"` -> [["ls"], ["rm","-rf","/"]]
 *
 * @param {string | string[] | null | undefined} input
 * @returns {string[][]}
 */
export function parseCompoundCommand(input) {
  if (Array.isArray(input)) {
    const argv = input.map((t) => String(t ?? "")).filter((t) => t.length > 0);
    if (argv.length === 0) return [];

    const base = toBaseName(argv[0]);
    if ((base === "bash" || base === "sh" || base === "zsh") && argv.includes("-c")) {
      const idx = argv.indexOf("-c");
      const script = typeof argv[idx + 1] === "string" ? argv[idx + 1] : "";
      return parseCompoundCommand(script);
    }

    return [argv];
  }

  const s = typeof input === "string" ? input.trim() : "";
  if (!s) return [];

  const tokens = tokenizeShell(s);
  if (tokens.length === 0) return [];

  /** @type {string[][]} */
  const commands = [];
  /** @type {string[]} */
  let current = [];

  const flush = () => {
    if (current.length) commands.push(current);
    current = [];
  };

  for (const tok of tokens) {
    if (isConnector(tok)) {
      flush();
      continue;
    }
    current.push(tok);
  }
  flush();

  // If the whole command is itself a shell -c wrapper, expand it.
  if (commands.length === 1) {
    const argv = commands[0];
    const base = toBaseName(argv[0]);
    if ((base === "bash" || base === "sh" || base === "zsh") && argv.includes("-c")) {
      const idx = argv.indexOf("-c");
      const script = typeof argv[idx + 1] === "string" ? argv[idx + 1] : "";
      return parseCompoundCommand(script);
    }
  }

  return commands;
}

/**
 * @param {string | string[] | null | undefined} command
 * @returns {CommandClassification}
 */
export function classifyCommand(command) {
  if (looksLikeForkBomb(command)) {
    return { level: "dangerous", requiresApproval: true, reasons: ["fork_bomb"] };
  }

  const parsed = parseCompoundCommand(command);
  if (parsed.length === 0) return { level: "unknown", requiresApproval: true, reasons: ["empty_command"] };

  /** @type {CommandClassification | null} */
  let worst = null;

  for (const argv of parsed) {
    const base = toBaseName(argv[0]);
    if (!base) {
      worst = worst || { level: "unknown", requiresApproval: true, reasons: ["missing_executable"] };
      continue;
    }

    if (argv.slice(1).some(looksSensitivePath)) {
      return { level: "dangerous", requiresApproval: true, baseCommand: base, reasons: ["sensitive_path"] };
    }

    if (DANGEROUS_COMMANDS.has(base)) {
      return { level: "dangerous", requiresApproval: true, baseCommand: base, reasons: ["dangerous_executable"] };
    }

    if (SAFE_COMMANDS.has(base)) {
      worst = worst || { level: "safe", requiresApproval: false, baseCommand: base, reasons: ["allowlisted_executable"] };
      continue;
    }

    // Unknown subcommand => require approval
    worst = { level: "unknown", requiresApproval: true, baseCommand: base, reasons: ["unknown_executable"] };
  }

  return worst || { level: "unknown", requiresApproval: true };
}

export const __internal = { tokenizeShell, toBaseName };

export default {
  SAFE_COMMANDS,
  DANGEROUS_COMMANDS,
  parseCompoundCommand,
  classifyCommand,
};
