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

/** @type {RegExp[]} */
const DEFAULT_SENSITIVE_PATH_PATTERNS = [
  // 系统密码和认证
  /(^|\/)etc\/passwd$/i,
  /(^|\/)etc\/shadow$/i,
  /(^|\/)etc\/sudoers(\.d)?(\/|$)/i,
  // SSH
  /(^|\/)etc\/ssh(\/|$)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /id_rsa|id_ed25519|id_ecdsa|id_dsa|authorized_keys|known_hosts/i,
  // 云凭证
  /(^|\/)\.aws\/(credentials|config)$/i,
  /(^|\/)\.azure(\/|$)/i,
  /(^|\/)(\.gcloud|\.config\/gcloud)(\/|$)/i,
  // 容器和编排
  /(^|\/)\.docker\/(config\.json|daemon\.json)$/i,
  /(^|\/)\.kube\/(config|credentials)/i,
  // GPG 和加密
  /(^|\/)\.gnupg(\/|$)/i,
  /(^|\/)\.password-store(\/|$)/i,
  // 开发凭证
  /(^|\/)\.(npmrc|yarnrc)$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)\.git-credentials$/i,
  /(^|\/)\.git\/config$/i,
  // 环境变量
  /(^|\/)\.env(\..*)?$/i,
  // Linux 特殊文件系统
  /^\/proc\/(self|\d+)\/(environ|cmdline|maps|fd)/i,
  /^\/sys\/(class|devices|kernel)/i,
  // 历史文件
  /(^|\/)\.(bash_history|zsh_history|python_history)$/i,
];

/**
 * @typedef {Object} ClassifierConfig
 * @property {Set<string>} [safeCommands] - Commands considered safe
 * @property {Set<string>} [dangerousCommands] - Commands considered dangerous
 * @property {RegExp[]} [sensitivePathPatterns] - Patterns for sensitive paths
 * @property {string[]} [projectAllowPaths] - Project-specific paths to whitelist
 */

/** @type {ClassifierConfig} */
let _config = {
  safeCommands: SAFE_COMMANDS,
  dangerousCommands: DANGEROUS_COMMANDS,
  sensitivePathPatterns: DEFAULT_SENSITIVE_PATH_PATTERNS,
  projectAllowPaths: [],
};

/**
 * Configure the command classifier
 * @param {Partial<ClassifierConfig>} config
 */
export function configureClassifier(config) {
  if (config.safeCommands instanceof Set) {
    _config.safeCommands = config.safeCommands;
  }
  if (config.dangerousCommands instanceof Set) {
    _config.dangerousCommands = config.dangerousCommands;
  }
  if (Array.isArray(config.sensitivePathPatterns)) {
    _config.sensitivePathPatterns = config.sensitivePathPatterns;
  }
  if (Array.isArray(config.projectAllowPaths)) {
    _config.projectAllowPaths = config.projectAllowPaths.map((p) => normalizePathArg(p));
  }
}

/**
 * Reset classifier to defaults
 */
export function resetClassifierConfig() {
  _config = {
    safeCommands: SAFE_COMMANDS,
    dangerousCommands: DANGEROUS_COMMANDS,
    sensitivePathPatterns: DEFAULT_SENSITIVE_PATH_PATTERNS,
    projectAllowPaths: [],
  };
}

/**
 * Get current classifier config (for testing/debugging)
 * @returns {Readonly<ClassifierConfig>}
 */
export function getClassifierConfig() {
  return { ..._config };
}

/**
 * Command substitution patterns that bypass allow/block rules.
 * Detects $(), backticks, and process substitution <() >().
 */
const COMMAND_SUBSTITUTION_PATTERN = /\$\(|\`|<\(|>\(/;

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
  // Check project allow paths first
  if (_config.projectAllowPaths.some((allowed) => candidate.startsWith(allowed))) {
    return false;
  }
  return _config.sensitivePathPatterns.some((pattern) => pattern.test(candidate));
}

/**
 * Check if command contains command substitution that could bypass rules.
 * @param {string} command
 * @returns {boolean}
 */
function hasCommandSubstitution(command) {
  const raw = typeof command === "string" ? command : "";
  return COMMAND_SUBSTITUTION_PATTERN.test(raw);
}

/**
 * Fork bomb 检测 - 基于行为特征而非字面匹配
 *
 * 检测模式:
 * 1. 函数定义 + 递归调用 + 后台执行 (: (){ :|:& };:)
 * 2. 无限循环 + 进程派生 (while true; do ... & done)
 * 3. 自我复制脚本 ($0 & $0 &)
 */
function looksLikeForkBomb(command) {
  const raw = typeof command === "string" ? command : Array.isArray(command) ? command.join(" ") : "";
  if (!raw || raw.length < 5) return false;

  // 移除空白进行紧凑匹配
  const compact = raw.replace(/\s+/g, "");
  const lower = raw.toLowerCase();

  // 1. 经典 fork bomb 变体 (函数定义 + 管道/后台 + 递归)
  // 匹配: :(){:|:&};: 及其变体 (任意函数名)
  if (/(\w+)\(\)\{[\s]*\1[\s]*[|&][\s]*\1/.test(raw)) return true;
  if (/(\w+)\(\)\{[^}]*\1[^}]*[&]/.test(raw)) return true;

  // 2. 紧凑形式检测
  // :(){:|:&};: 或 :(){ :|:& };: 等
  if (/:\(\)\{[^}]*:[|&]/.test(compact)) return true;
  if (/\w\(\)\{\w[|&]\w[&]?\}/.test(compact)) return true;

  // 3. while/for 无限循环 + 后台派生
  // while true; do cmd & done 或 for((;;)); do cmd & done
  if (/while\s*(true|1|:)/.test(lower) && /&/.test(raw) && /done/.test(lower)) return true;
  if (/for\s*\(\(?\s*;?\s*;?\s*\)?\)/.test(lower) && /&/.test(raw)) return true;

  // 4. 自我复制 $0 & $0 &
  if (/\$0\s*&[^&]*\$0\s*&/.test(raw)) return true;
  if (/\$\{?0\}?\s*&/.test(raw) && (raw.match(/\$\{?0\}?\s*&/g) || []).length >= 2) return true;

  // 5. 通过 bash -c 递归 (成对引号匹配)
  if (/bash\s+-c\s*(['"])(.*?)\1[^'"]*&/.test(raw)) return true;

  // 6. 函数内调用自身两次以上（指数增长）
  const funcMatch = raw.match(/(\w+)\s*\(\)\s*\{([^}]+)\}/);
  if (funcMatch) {
    const funcName = funcMatch[1];
    const funcBody = funcMatch[2];
    const callCount = (funcBody.match(new RegExp(`\\b${funcName}\\b`, "g")) || []).length;
    if (callCount >= 2 && /[&|]/.test(funcBody)) return true;
  }

  return false;
}

/**
 * Minimal shell tokenizer (quotes + backslash escapes).
 * Conservative: does not aim to fully parse POSIX shell.
 *
 * NOTE: This tokenizer does NOT expand command substitutions ($(), ``, <(), >()).
 * Use hasCommandSubstitution() to detect and reject such commands before tokenizing.
 *
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
  // Check for command substitution first - these bypass allow/block rules
  const rawStr = typeof command === "string" ? command : Array.isArray(command) ? command.join(" ") : "";
  if (hasCommandSubstitution(rawStr)) {
    return { level: "dangerous", requiresApproval: true, reasons: ["command_substitution"] };
  }

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

    if (_config.dangerousCommands.has(base)) {
      return { level: "dangerous", requiresApproval: true, baseCommand: base, reasons: ["dangerous_executable"] };
    }

    if (_config.safeCommands.has(base)) {
      worst = worst || { level: "safe", requiresApproval: false, baseCommand: base, reasons: ["allowlisted_executable"] };
      continue;
    }

    // Unknown subcommand => require approval
    worst = { level: "unknown", requiresApproval: true, baseCommand: base, reasons: ["unknown_executable"] };
  }

  return worst || { level: "unknown", requiresApproval: true };
}

export const __internal = { tokenizeShell, toBaseName, hasCommandSubstitution };

export default {
  SAFE_COMMANDS,
  DANGEROUS_COMMANDS,
  DEFAULT_SENSITIVE_PATH_PATTERNS,
  parseCompoundCommand,
  classifyCommand,
  configureClassifier,
  resetClassifierConfig,
  getClassifierConfig,
};
