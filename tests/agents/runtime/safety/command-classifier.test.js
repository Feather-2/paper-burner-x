import { describe, it, expect } from "vitest";
import {
  classifyCommand,
  parseCompoundCommand,
  __internal,
} from "../../../js/agents/runtime/safety/command-classifier.js";

const { tokenizeShell, toBaseName } = __internal;

describe("command-classifier", () => {
  describe("parseCompoundCommand", () => {
    it("parses simple command", () => {
      expect(parseCompoundCommand("ls -la")).toEqual([["ls", "-la"]]);
    });

    it("parses && chained commands", () => {
      expect(parseCompoundCommand("echo hi && ls")).toEqual([["echo", "hi"], ["ls"]]);
    });

    it("parses || chained commands", () => {
      expect(parseCompoundCommand("cmd1 || cmd2")).toEqual([["cmd1"], ["cmd2"]]);
    });

    it("parses ; separated commands", () => {
      expect(parseCompoundCommand("cmd1 ; cmd2 ; cmd3")).toEqual([["cmd1"], ["cmd2"], ["cmd3"]]);
    });

    it("parses | piped commands", () => {
      expect(parseCompoundCommand("cat file | grep pattern")).toEqual([["cat", "file"], ["grep", "pattern"]]);
    });

    it("parses & background commands", () => {
      expect(parseCompoundCommand("cmd1 & cmd2")).toEqual([["cmd1"], ["cmd2"]]);
    });

    it("handles mixed connectors", () => {
      expect(parseCompoundCommand("a && b || c ; d | e")).toEqual([["a"], ["b"], ["c"], ["d"], ["e"]]);
    });

    it("handles quoted strings", () => {
      expect(parseCompoundCommand("echo 'hello world'")).toEqual([["echo", "hello world"]]);
      expect(parseCompoundCommand('echo "hello world"')).toEqual([["echo", "hello world"]]);
    });

    it("handles escaped characters in double quotes", () => {
      expect(parseCompoundCommand('echo "a\\"b"')).toEqual([["echo", 'a"b']]);
    });

    it("handles backslash escapes outside quotes", () => {
      expect(parseCompoundCommand("echo hello\\ world")).toEqual([["echo", "hello world"]]);
    });

    it("expands bash -c wrapper", () => {
      expect(parseCompoundCommand("bash -c 'ls && rm -rf /'")).toEqual([["ls"], ["rm", "-rf", "/"]]);
      expect(parseCompoundCommand("sh -c 'echo hi'")).toEqual([["echo", "hi"]]);
      expect(parseCompoundCommand("zsh -c 'pwd'")).toEqual([["pwd"]]);
    });

    it("expands bash -c from argv array", () => {
      expect(parseCompoundCommand(["bash", "-c", "ls && rm -rf /"])).toEqual([["ls"], ["rm", "-rf", "/"]]);
    });

    it("returns empty array for empty input", () => {
      expect(parseCompoundCommand("")).toEqual([]);
      expect(parseCompoundCommand(null)).toEqual([]);
      expect(parseCompoundCommand(undefined)).toEqual([]);
    });

    it("returns argv as-is if not bash -c", () => {
      expect(parseCompoundCommand(["git", "status"])).toEqual([["git", "status"]]);
    });
  });

  describe("tokenizeShell", () => {
    it("tokenizes simple command", () => {
      expect(tokenizeShell("ls -la")).toEqual(["ls", "-la"]);
    });

    it("tokenizes with single quotes", () => {
      expect(tokenizeShell("echo 'a b c'")).toEqual(["echo", "a b c"]);
    });

    it("tokenizes with double quotes", () => {
      expect(tokenizeShell('echo "a b c"')).toEqual(["echo", "a b c"]);
    });

    it("handles connectors", () => {
      expect(tokenizeShell("a && b || c")).toEqual(["a", "&&", "b", "||", "c"]);
    });

    it("handles empty input", () => {
      expect(tokenizeShell("")).toEqual([]);
      expect(tokenizeShell(null)).toEqual([]);
    });
  });

  describe("toBaseName", () => {
    it("extracts base command from path", () => {
      expect(toBaseName("/usr/bin/ls")).toBe("ls");
      expect(toBaseName("/bin/bash")).toBe("bash");
    });

    it("handles backslash paths", () => {
      expect(toBaseName("C:\\Windows\\System32\\cmd.exe")).toBe("cmd.exe");
    });

    it("handles simple command names", () => {
      expect(toBaseName("ls")).toBe("ls");
      expect(toBaseName("GREP")).toBe("grep");
    });

    it("returns empty for empty input", () => {
      expect(toBaseName("")).toBe("");
      expect(toBaseName(null)).toBe("");
    });
  });

  describe("classifyCommand - safe commands", () => {
    const safeCommands = ["cat", "cd", "echo", "grep", "head", "ls", "pwd", "tail", "wc", "which"];

    for (const cmd of safeCommands) {
      it(`classifies '${cmd}' as safe`, () => {
        const result = classifyCommand(cmd);
        expect(result.level).toBe("safe");
        expect(result.requiresApproval).toBe(false);
        expect(result.baseCommand).toBe(cmd);
      });
    }

    it("classifies safe command with args as safe", () => {
      expect(classifyCommand(["ls", "-la"]).level).toBe("safe");
      expect(classifyCommand("cat /tmp/file.txt").level).toBe("safe");
      expect(classifyCommand("grep -r pattern .").level).toBe("safe");
    });
  });

  describe("classifyCommand - dangerous commands", () => {
    const dangerousCommands = ["rm", "rmdir", "chmod", "chown", "kill", "shutdown", "dd", "mkfs", "mount", "umount"];

    for (const cmd of dangerousCommands) {
      it(`classifies '${cmd}' as dangerous`, () => {
        const result = classifyCommand(cmd);
        expect(result.level).toBe("dangerous");
        expect(result.requiresApproval).toBe(true);
        expect(result.baseCommand).toBe(cmd);
        expect(result.reasons).toContain("dangerous_executable");
      });
    }

    it("classifies dangerous command with args", () => {
      const result = classifyCommand("rm -rf /");
      expect(result.level).toBe("dangerous");
      expect(result.requiresApproval).toBe(true);
    });

    it("classifies dangerous command in path", () => {
      const result = classifyCommand("/bin/rm -rf /tmp");
      expect(result.level).toBe("dangerous");
      expect(result.baseCommand).toBe("rm");
    });
  });

  describe("classifyCommand - unknown commands", () => {
    it("classifies unknown command as unknown", () => {
      const result = classifyCommand("unknowncmd");
      expect(result.level).toBe("unknown");
      expect(result.requiresApproval).toBe(true);
    });

    it("classifies npm/node as unknown (requires approval)", () => {
      expect(classifyCommand("npm install").level).toBe("unknown");
      expect(classifyCommand("node script.js").level).toBe("unknown");
    });

    it("classifies curl/wget as unknown", () => {
      expect(classifyCommand("curl https://example.com").level).toBe("unknown");
      expect(classifyCommand("wget https://example.com").level).toBe("unknown");
    });
  });

  describe("classifyCommand - sensitive paths", () => {
    const sensitivePaths = [
      // System auth
      "/etc/passwd",
      "/etc/shadow",
      "/etc/sudoers",
      "/etc/sudoers.d/custom",
      // SSH
      "/etc/ssh/sshd_config",
      "~/.ssh/id_rsa",
      "~/.ssh/id_ed25519",
      "~/.ssh/authorized_keys",
      "~/.ssh/known_hosts",
      "/home/user/.ssh/config",
      // Cloud credentials
      "~/.aws/credentials",
      "~/.aws/config",
      "~/.azure/config",
      "~/.gcloud/credentials",
      "~/.config/gcloud/credentials.db",
      // Container/K8s
      "~/.docker/config.json",
      "~/.docker/daemon.json",
      "~/.kube/config",
      "~/.kube/credentials",
      // GPG
      "~/.gnupg/private-keys-v1.d",
      "~/.password-store/secrets",
      // Dev credentials
      "~/.npmrc",
      "~/.yarnrc",
      "~/.netrc",
      "~/.git-credentials",
      ".git/config",
      // Environment
      ".env",
      ".env.local",
      ".env.production",
      // Linux special
      "/proc/self/environ",
      "/proc/1234/cmdline",
      "/proc/self/maps",
      "/sys/class/net",
      "/sys/devices/pci",
      "/sys/kernel/debug",
      // History
      "~/.bash_history",
      "~/.zsh_history",
      "~/.python_history",
    ];

    for (const path of sensitivePaths) {
      it(`blocks access to sensitive path: ${path}`, () => {
        const result = classifyCommand(`cat ${path}`);
        expect(result.level).toBe("dangerous");
        expect(result.requiresApproval).toBe(true);
        expect(result.reasons).toContain("sensitive_path");
      });
    }

    it("blocks head/tail on sensitive files", () => {
      expect(classifyCommand("head -n 10 /etc/shadow").level).toBe("dangerous");
      expect(classifyCommand("tail -f ~/.ssh/id_rsa").level).toBe("dangerous");
    });

    it("blocks grep on sensitive files", () => {
      expect(classifyCommand("grep password ~/.aws/credentials").level).toBe("dangerous");
    });
  });

  describe("classifyCommand - fork bomb detection", () => {
    const forkBombs = [
      // Classic form
      ":(){ :|:& };:",
      ":(){:|:&};:",
      // With spaces
      ": () { : | : & }; :",
      // Named function
      "bomb(){ bomb|bomb& };bomb",
      "f(){ f|f& };f",
      // bash -c wrapped
      "bash -c ':(){ :|:& };:'",
      "sh -c ':(){:|:&};:'",
      // While true variants
      "while true; do echo hi & done",
      "while 1; do sleep 0 & done",
      "while :; do :& done",
      // For loop infinite
      "for((;;)); do :& done",
      // Self-replicating $0
      "$0 & $0 &",
      "${0} & ${0} &",
      // Function calling itself twice with &
      "x(){ x& x& };x",
      "boom(){ boom & boom & }; boom",
    ];

    for (const bomb of forkBombs) {
      it(`detects fork bomb: ${bomb.slice(0, 30)}...`, () => {
        const result = classifyCommand(bomb);
        expect(result.level).toBe("dangerous");
        expect(result.requiresApproval).toBe(true);
        expect(result.reasons).toContain("fork_bomb");
      });
    }

    it("does not flag normal loops as fork bomb", () => {
      expect(classifyCommand("for i in 1 2 3; do echo $i; done").reasons).not.toContain("fork_bomb");
      expect(classifyCommand("while read line; do echo $line; done").reasons).not.toContain("fork_bomb");
    });

    it("does not flag normal function definitions as fork bomb", () => {
      expect(classifyCommand("greet(){ echo hello; }").reasons || []).not.toContain("fork_bomb");
    });
  });

  describe("classifyCommand - compound commands", () => {
    it("flags compound if any part is dangerous", () => {
      const result = classifyCommand("ls && rm -rf /");
      expect(result.level).toBe("dangerous");
    });

    it("safe compound stays safe", () => {
      const result = classifyCommand("ls && pwd && echo hi");
      expect(result.level).toBe("safe");
    });

    it("unknown in compound makes result unknown", () => {
      const result = classifyCommand("ls && unknowncmd");
      expect(result.level).toBe("unknown");
    });

    it("dangerous trumps unknown", () => {
      const result = classifyCommand("unknowncmd && rm -rf /");
      expect(result.level).toBe("dangerous");
    });

    it("sensitive path trumps safe command", () => {
      const result = classifyCommand("ls && cat /etc/shadow");
      expect(result.level).toBe("dangerous");
      expect(result.reasons).toContain("sensitive_path");
    });
  });

  describe("classifyCommand - edge cases", () => {
    it("handles empty command", () => {
      const result = classifyCommand("");
      expect(result.level).toBe("unknown");
      expect(result.requiresApproval).toBe(true);
      expect(result.reasons).toContain("empty_command");
    });

    it("handles null/undefined", () => {
      expect(classifyCommand(null).level).toBe("unknown");
      expect(classifyCommand(undefined).level).toBe("unknown");
    });

    it("handles empty array", () => {
      expect(classifyCommand([]).level).toBe("unknown");
    });

    it("handles array with empty string", () => {
      const result = classifyCommand([""]);
      expect(result.level).toBe("unknown");
    });

    it("handles whitespace-only command", () => {
      const result = classifyCommand("   ");
      expect(result.level).toBe("unknown");
    });

    it("handles command with only connectors", () => {
      const result = classifyCommand("&& ||");
      expect(result.level).toBe("unknown");
    });

    it("handles deeply nested bash -c", () => {
      const result = classifyCommand("bash -c \"bash -c 'rm -rf /'\"");
      expect(result.level).toBe("dangerous");
    });

    it("handles case variations", () => {
      expect(classifyCommand("LS").level).toBe("safe");
      expect(classifyCommand("RM").level).toBe("dangerous");
      expect(classifyCommand("Cat").level).toBe("safe");
    });

    it("handles command in subdirectory path", () => {
      expect(classifyCommand("./scripts/rm").level).toBe("dangerous");
      expect(classifyCommand("../bin/ls").level).toBe("safe");
    });
  });

  describe("classifyCommand - real-world examples", () => {
    it("allows common dev commands", () => {
      expect(classifyCommand("ls -la").level).toBe("safe");
      expect(classifyCommand("cat package.json").level).toBe("safe");
      expect(classifyCommand("grep -r TODO src/").level).toBe("safe");
    });

    it("requires approval for build commands", () => {
      expect(classifyCommand("npm install").level).toBe("unknown");
      expect(classifyCommand("npm run build").level).toBe("unknown");
      expect(classifyCommand("pip install -r requirements.txt").level).toBe("unknown");
    });

    it("blocks destructive operations", () => {
      expect(classifyCommand("rm -rf node_modules").level).toBe("dangerous");
      expect(classifyCommand("chmod 777 /etc").level).toBe("dangerous");
      expect(classifyCommand("kill -9 1").level).toBe("dangerous");
    });

    it("blocks credential access", () => {
      expect(classifyCommand("cat ~/.ssh/id_rsa").level).toBe("dangerous");
      expect(classifyCommand("cat .env").level).toBe("dangerous");
      expect(classifyCommand("grep API_KEY .env.production").level).toBe("dangerous");
    });
  });
});
