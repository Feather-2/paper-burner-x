import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { SkillScope } from "../../js/agents/skills/model.js";
import { loadSkills } from "../../js/agents/skills/loader.js";
import { loadSkillFromPath as loadSkillFromPathBrowser, loadSkills as loadSkillsBrowser } from "../../js/agents/skills/loader.browser.js";
import { SkillsManager } from "../../js/agents/skills/manager.js";
import { NexusSkillProvider } from "../../js/agents/mcp/nexus-skill-provider.js";
import { SkillExecutor } from "../../js/agents/core/sandbox/skill-executor.js";
import { readJsonWithLimit, readTextWithLimit } from "../../js/agents/shared/utils/response-limits.js";

async function writeSkillFile(rootDir, scope, name, body, frontmatter) {
  const skillsDir = path.join(rootDir, ".paper-burner", "skills", name);
  await fs.mkdir(skillsDir, { recursive: true });
  const filePath = path.join(skillsDir, "SKILL.md");
  const fm = frontmatter || {
    name,
    description: `desc for ${name} (${scope})`,
    keywords: "alpha,beta",
    "keywords-all": "must",
    priority: "50",
  };
  const lines = [
    "---",
    ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`),
    "---",
    "",
    body,
    "",
  ];
  await fs.writeFile(filePath, lines.join("\n"), "utf8");
  return filePath;
}

describe("skills/loader.node", () => {
  it("loads skills from repo/user roots and dedups by priority", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-skills-cwd-"));
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-skills-home-"));
    try {
      await writeSkillFile(home, SkillScope.USER, "SameSkill", "from user", { name: "SameSkill", description: "user", keywords: "user" });
      const repoPath = await writeSkillFile(cwd, SkillScope.REPO, "SameSkill", "from repo", { name: "SameSkill", description: "repo", keywords: "repo" });
      await writeSkillFile(cwd, SkillScope.REPO, "OtherSkill", "other", { name: "OtherSkill", description: "other", keywords: "alpha" });

      const outcome = await loadSkills({ cwd, homeDir: home });
      assert.equal(outcome.errors.length, 0);
      const names = outcome.skills.map((s) => s.metadata.name);
      assert.deepEqual(names, ["OtherSkill", "SameSkill"]);

      const same = outcome.skills.find((s) => s.metadata.name === "SameSkill");
      assert.equal(same.metadata.scope, SkillScope.REPO);
      assert.equal(same.metadata.path, repoPath);
      assert.equal(same.body.includes("from repo"), true);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it("records parse errors for invalid SKILL.md files", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-skills-bad-"));
    try {
      const badDir = path.join(cwd, ".paper-burner", "skills", "BadSkill");
      await fs.mkdir(badDir, { recursive: true });
      await fs.writeFile(path.join(badDir, "SKILL.md"), "no frontmatter", "utf8");

      const outcome = await loadSkills({ cwd, homeDir: null });
      assert.equal(outcome.skills.length, 0);
      assert.equal(outcome.errors.length, 1);
      assert.ok(String(outcome.errors[0].message).includes("frontmatter"));
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("skills/manager", () => {
  it("renders catalog without leaking absolute paths", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-skills-inject-"));
    try {
      await writeSkillFile(cwd, SkillScope.REPO, "AlphaSkill", "Body A", {
        name: "AlphaSkill",
        description: "alpha description",
        keywords: "alpha",
      });

      const outcome = await loadSkills({ cwd, homeDir: null });
      assert.equal(outcome.skills.length, 1);
      assert.equal(outcome.skills[0].metadata.name, "AlphaSkill");

      const manager = new SkillsManager({ cacheTtlMs: 60_000 });
      const a = await manager.getSkillsForCwd(cwd);
      const b = await manager.getSkillsForCwd(cwd);
      assert.equal(a, b);

      const catalog = await manager.getCatalogPrompt(cwd);
      assert.ok(catalog.includes("## Skills Catalog"));
      assert.ok(catalog.includes("$AlphaSkill"));
      assert.equal(catalog.includes(cwd.replaceAll("\\", "/")), false);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

describe("shared/utils/response-limits", () => {
  it("rejects responses exceeding declared content-length", async () => {
    const resp = {
      headers: { get: (name) => (String(name).toLowerCase() === "content-length" ? "20" : null) },
      text: async () => '{"a":1}',
    };
    await assert.rejects(
      () => readTextWithLimit(resp, { maxBytes: 10, context: "test" }),
      (err) => err && err.name === "ResponseTooLargeError" && err.code === "ERESPONSE_TOO_LARGE"
    );
  });

  it("enforces byte limits when reading streams", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode("abc"));
        controller.enqueue(enc.encode("def"));
        controller.close();
      },
    });
    const resp = { headers: { get: () => null }, body };
    await assert.rejects(
      () => readTextWithLimit(resp, { maxBytes: 4, context: "stream" }),
      (err) => err && err.name === "ResponseTooLargeError"
    );

    const okBody = new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode("abc"));
        controller.enqueue(enc.encode("def"));
        controller.close();
      },
    });
    const okResp = { headers: { get: () => null }, body: okBody };
    const text = await readTextWithLimit(okResp, { maxBytes: 10, context: "stream" });
    assert.equal(text, "abcdef");
  });

  it("reads JSON with a size guard", async () => {
    const resp = { headers: { get: () => null }, text: async () => '{"ok":true}' };
    const data = await readJsonWithLimit(resp, { maxBytes: 100, context: "json" });
    assert.deepEqual(data, { ok: true });
  });
});

describe("skills/loader.browser", () => {
  it("falls back to the secondary manifest url when the primary is too large", async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("skills/manifest.json") && !String(url).includes("public/skills/manifest.json")) {
        return new Response('{"skills":[]}', { status: 200, headers: { "content-length": "500" } });
      }
      if (String(url).includes("public/skills/manifest.json")) {
        return new Response('{"skills":[{"name":"A","description":"a","path":"a.md"}]}', {
          status: 200,
          headers: { "content-length": "80" },
        });
      }
      throw new Error(`unexpected fetch url: ${url}`);
    };

    try {
      const outcome = await loadSkillsBrowser({ manifestUrl: "skills/manifest.json", maxManifestBytes: 100 });
      assert.equal(outcome.errors.length, 0);
      assert.equal(outcome.skills.length, 1);
      assert.equal(outcome.skills[0].metadata.name, "A");
      assert.ok(calls.some((u) => u.includes("skills/manifest.json")));
      assert.ok(calls.some((u) => u.includes("public/skills/manifest.json")));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("enforces maxSkillBytes when loading a skill body via fetch", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        [
          "---",
          "name: BigSkill",
          "description: big",
          "---",
          "",
          "x".repeat(200),
          "",
        ].join("\n"),
        { status: 200, headers: { "content-length": "250" } }
      );

    try {
      await assert.rejects(
        () => loadSkillFromPathBrowser("https://example.com/BigSkill.md", SkillScope.SYSTEM, { maxSkillBytes: 100 }),
        (err) => err && err.name === "ResponseTooLargeError"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("mcp/nexus-skill-provider size limits", () => {
  it("enforces maxResponseBytes on listSkills", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('{"skills":[]}', { status: 200, headers: { "content-length": "20" } });

    try {
      const provider = new NexusSkillProvider({ maxResponseBytes: 10 });
      await assert.rejects(
        () => provider.listSkills(),
        (err) => err && err.name === "ResponseTooLargeError" && err.code === "ERESPONSE_TOO_LARGE"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("core/sandbox/skill-executor fallback", () => {
  it("isolates host globals via Proxy", async () => {
    const executor = new SkillExecutor({ fallbackMode: "eval" });
    // Avoid trying to initialize QuickJS WASM in Node tests.
    executor.wasmSupported = false;

    const originalWorker = globalThis.Worker;
    try {
      // Ensure we hit main-thread fallback in Node environments.
      if (typeof originalWorker !== "undefined") globalThis.Worker = undefined;

      const result = await executor.execute(
        {
          body: "return typeof Buffer;",
          metadata: { name: "ProxyIsolation", scope: "user" },
        },
        { args: {}, state: {} }
      );

      assert.equal(result.success, true);
      assert.equal(result.data, "undefined");
      assert.equal(result.metrics.mode, "eval");
    } finally {
      if (typeof originalWorker !== "undefined") globalThis.Worker = originalWorker;
    }
  });
});
