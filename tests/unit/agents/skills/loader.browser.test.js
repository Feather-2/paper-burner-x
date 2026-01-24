import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =========================
// Dependency mocks (MUST)
// =========================

const modelMock = vi.hoisted(() => ({
  SkillScope: Object.freeze({
    SYSTEM: "system",
    USER: "user",
    REPO: "repo",
    REMOTE: "remote",
  }),
}));

const userStoreMock = vi.hoisted(() => ({
  initUserSkillStore: vi.fn(),
  listUserSkills: vi.fn(),
  getUserSkillBody: vi.fn(),
}));

const sharedMock = vi.hoisted(() => {
  /**
   * Keep the mocked behaviors close to the real contracts so the loader logic
   * is exercised meaningfully without importing real implementations.
   */
  function isPlainObject(v) {
    if (v === null || typeof v !== "object") return false;
    if (Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  }

  function toNonEmptyString(v) {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s.length ? s : undefined;
  }

  function normalizeMaxBytes(value, fallback) {
    if (value === Infinity) return Infinity;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const n = Math.floor(parsed);
    return n > 0 ? n : fallback;
  }

  function createResponseTooLargeError(context, maxBytes, observedBytes, code = "ERESPONSE_TOO_LARGE") {
    const label = toNonEmptyString(context) || "Response body";
    const err = new Error(`${label} exceeds limit (${observedBytes} > ${maxBytes} bytes)`);
    err.name = "ResponseTooLargeError";
    err.code = code;
    err.maxBytes = maxBytes;
    err.observedBytes = observedBytes;
    return err;
  }

  return {
    isPlainObject: vi.fn(isPlainObject),
    toNonEmptyString: vi.fn(toNonEmptyString),
    normalizeMaxBytes: vi.fn(normalizeMaxBytes),
    createResponseTooLargeError: vi.fn(createResponseTooLargeError),
    readJsonWithLimit: vi.fn(),
    readTextWithLimit: vi.fn(),
    createLogger: vi.fn(() => ({
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    })),
  };
});

vi.mock("../../../../js/agents/skills/model.js", () => modelMock);
vi.mock("../../../../js/agents/skills/user-store.js", () => userStoreMock);
vi.mock("../../../../js/agents/shared/index.js", () => sharedMock);

function makeSkillMarkdown({
  name = "Example",
  description = "Example description",
  shortDescription,
  keywords,
  keywordsAll,
  allowedTools,
  tags,
  traits,
  priority,
  extraFrontmatterLines = [],
  body = "Body",
} = {}) {
  const lines = ["---", `name: ${name}`, `description: ${description}`];
  if (shortDescription !== undefined) lines.push(`short-description: ${shortDescription}`);
  if (keywords !== undefined) lines.push(`keywords: ${keywords}`);
  if (keywordsAll !== undefined) lines.push(`keywords-all: ${keywordsAll}`);
  if (allowedTools !== undefined) lines.push(`allowed-tools: ${allowedTools}`);
  if (tags !== undefined) lines.push(`tags: ${tags}`);
  if (traits !== undefined) lines.push(`traits: ${traits}`);
  if (priority !== undefined) lines.push(`priority: ${priority}`);
  lines.push(...extraFrontmatterLines);
  lines.push("---", body);
  return lines.join("\n");
}

function makeFetchResponse({ ok = true, status = 200 } = {}) {
  return { ok, status, headers: { get: () => null } };
}

async function importLoader() {
  return import("../../../../js/agents/skills/loader.browser.js");
}

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();

  userStoreMock.initUserSkillStore.mockResolvedValue(undefined);
  userStoreMock.listUserSkills.mockReturnValue([]);
  userStoreMock.getUserSkillBody.mockReturnValue(null);

  sharedMock.readJsonWithLimit.mockImplementation(async () => {
    throw new Error("readJsonWithLimit not mocked");
  });
  sharedMock.readTextWithLimit.mockImplementation(async () => {
    throw new Error("readTextWithLimit not mocked");
  });
  sharedMock.createLogger.mockImplementation(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("skills/loader.browser public exports", () => {
  it("exports the expected functions and default export object", async () => {
    const mod = await importLoader();

    expect(typeof mod.loadSkills).toBe("function");
    expect(typeof mod.loadSkillsFromNexus).toBe("function");
    expect(typeof mod.loadAllSkills).toBe("function");
    expect(typeof mod.loadSkillFromPath).toBe("function");
    expect(mod.default).toBeTruthy();

    expect(mod.default.loadSkills).toBe(mod.loadSkills);
    expect(mod.default.loadSkillsFromNexus).toBe(mod.loadSkillsFromNexus);
    expect(mod.default.loadAllSkills).toBe(mod.loadAllSkills);
    expect(mod.default.loadSkillFromPath).toBe(mod.loadSkillFromPath);
  });
});

describe("loadSkills", () => {
  it("returns an error outcome when fetch is unavailable (and does not touch the user store)", async () => {
    vi.stubGlobal("fetch", undefined);
    const { loadSkills } = await importLoader();

    const outcome = await loadSkills({ manifestUrl: "skills/manifest.json" });

    expect(outcome.skills).toEqual([]);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0].path).toBe("skills/manifest.json");
    expect(String(outcome.errors[0].message)).toContain("fetch is not available");

    expect(userStoreMock.initUserSkillStore).not.toHaveBeenCalled();
    expect(userStoreMock.listUserSkills).not.toHaveBeenCalled();
  });

  it("loads skills from the manifest, normalizes fields, and ignores invalid entries", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    sharedMock.readJsonWithLimit.mockResolvedValue({
      skills: [
        {
          name: "Alpha",
          description: "alpha desc",
          shortDescription: "short",
          path: "alpha.md",
          scope: modelMock.SkillScope.REPO,
          keywords: ["one", " two ", "", null, 0],
          keywordsAll: "all",
          allowedTools: "tool1, tool2",
          tags: { kind: "test" },
          traits: ["fast", " calm "],
          priority: "7",
        },
        { name: "MissingPath", description: "no path" },
        "not-an-object",
        {
          name: "Beta",
          description: "beta desc",
          path: "beta.md",
          scope: "not-a-real-scope",
          keywords: "k",
          keywordsAll: ["x", "y"],
          allowedTools: "",
          tags: "nope",
          traits: "solo",
          priority: "not-a-number",
        },
      ],
    });

    const { loadSkills } = await importLoader();
    const outcome = await loadSkills();

    expect(outcome.errors).toEqual([]);
    expect(outcome.skills.map((s) => s.metadata.name)).toEqual(["Alpha", "Beta"]);

    const alpha = outcome.skills.find((s) => s.metadata.name === "Alpha");
    expect(alpha.body).toBe(null);
    expect(alpha.metadata.scope).toBe(modelMock.SkillScope.REPO);
    expect(alpha.metadata.path).toBe("alpha.md");
    expect(alpha.metadata.shortDescription).toBe("short");
    expect(alpha.metadata.keywords).toEqual(["one", "two"]);
    expect(alpha.metadata.keywordsAll).toEqual(["all"]);
    expect(alpha.metadata.allowedTools).toBe("tool1, tool2");
    expect(alpha.metadata.tags).toEqual({ kind: "test" });
    expect(alpha.metadata.traits).toEqual(["fast", "calm"]);
    expect(alpha.metadata.priority).toBe(7);

    const beta = outcome.skills.find((s) => s.metadata.name === "Beta");
    expect(beta.metadata.scope).toBe(modelMock.SkillScope.SYSTEM);
    expect(beta.metadata.priority).toBe(100);
    expect(beta.metadata.allowedTools).toBe(null);
    expect(beta.metadata.tags).toBe(null);
    // For manifest normalization, traits is normalized but not split on commas.
    expect(beta.metadata.traits).toEqual(["solo"]);

    expect(fetchMock).toHaveBeenCalledWith("skills/manifest.json", { cache: "no-store" });
    expect(sharedMock.normalizeMaxBytes).toHaveBeenCalledWith(undefined, 512 * 1024);
    expect(sharedMock.readJsonWithLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        maxBytes: 512 * 1024,
        context: "Skills manifest: skills/manifest.json",
      }),
    );
    expect(userStoreMock.initUserSkillStore).toHaveBeenCalledTimes(1);
    expect(userStoreMock.listUserSkills).toHaveBeenCalledTimes(1);
  });

  it("falls back to the secondary manifest url when the first candidate fails", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    sharedMock.readJsonWithLimit
      .mockRejectedValueOnce(sharedMock.createResponseTooLargeError("Skills manifest: skills/manifest.json", 1, 2))
      .mockResolvedValueOnce({
        skills: [{ name: "FromFallback", description: "ok", path: "f.md" }],
      });

    const { loadSkills } = await importLoader();
    const outcome = await loadSkills({ manifestUrl: "skills/manifest.json", maxManifestBytes: 123 });

    expect(outcome.errors).toEqual([]);
    expect(outcome.skills.map((s) => s.metadata.name)).toEqual(["FromFallback"]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("skills/manifest.json");
    expect(fetchMock.mock.calls[1][0]).toBe("public/skills/manifest.json");
    expect(sharedMock.normalizeMaxBytes).toHaveBeenCalledWith(123, 512 * 1024);
  });

  it("dedupes by name (scope precedence then lower numeric priority) and sorts by name", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    sharedMock.readJsonWithLimit.mockResolvedValue({
      skills: [
        { name: "Zed", description: "z", path: "z.md", scope: modelMock.SkillScope.SYSTEM, priority: 100 },
        { name: "Same", description: "system", path: "sys.md", scope: modelMock.SkillScope.SYSTEM, priority: 20 },
        { name: "Same", description: "repo (worse priority but better scope)", path: "repo.md", scope: modelMock.SkillScope.REPO, priority: 999 },
        { name: "Same", description: "repo (wins by lower priority)", path: "repo2.md", scope: modelMock.SkillScope.REPO, priority: 10 },
      ],
    });

    userStoreMock.listUserSkills.mockReturnValue([
      { name: "Alpha", description: "user alpha", priority: 5 },
      { name: "Same", description: "user overrides", priority: 1 },
    ]);

    const { loadSkills } = await importLoader();
    const outcome = await loadSkills();

    expect(outcome.errors).toEqual([]);
    expect(outcome.skills.map((s) => s.metadata.name)).toEqual(["Alpha", "Same", "Zed"]);

    const same = outcome.skills.find((s) => s.metadata.name === "Same");
    expect(same.metadata.scope).toBe(modelMock.SkillScope.USER);
    expect(same.metadata.path).toBe("user:Same");
    expect(same.metadata.description).toBe("user overrides");
  });

  it("logs a warning and still returns manifest skills when user skill store init fails", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    sharedMock.readJsonWithLimit.mockResolvedValue({
      skills: [{ name: "Alpha", description: "a", path: "a.md" }],
    });

    userStoreMock.initUserSkillStore.mockRejectedValueOnce(new Error("boom"));

    const { loadSkills } = await importLoader();
    const outcome = await loadSkills();

    expect(outcome.errors).toEqual([]);
    expect(outcome.skills.map((s) => s.metadata.name)).toEqual(["Alpha"]);

    expect(sharedMock.createLogger).toHaveBeenCalledWith("skills/loader.browser");
    const logger = sharedMock.createLogger.mock.results[0]?.value;
    expect(logger.warn).toHaveBeenCalledWith(
      "User skill store initialization failed",
      expect.objectContaining({ error: "boom" }),
    );
    expect(userStoreMock.listUserSkills).not.toHaveBeenCalled();
  });

  it("caches the manifest for 30s (per maxManifestBytes + url) and refreshes after TTL expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const fetchMock = vi.fn(async () => makeFetchResponse({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    sharedMock.readJsonWithLimit.mockResolvedValue({ skills: [] });

    const { loadSkills } = await importLoader();

    await loadSkills({ manifestUrl: "skills/manifest.json", maxManifestBytes: 100 });
    await loadSkills({ manifestUrl: "skills/manifest.json", maxManifestBytes: 100 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(29_999));
    await loadSkills({ manifestUrl: "skills/manifest.json", maxManifestBytes: 100 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(30_000));
    await loadSkills({ manifestUrl: "skills/manifest.json", maxManifestBytes: 100 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not reuse the manifest cache when maxManifestBytes changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const fetchMock = vi.fn(async () => makeFetchResponse({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    sharedMock.readJsonWithLimit.mockResolvedValue({ skills: [] });

    const { loadSkills } = await importLoader();
    await loadSkills({ manifestUrl: "skills/manifest.json", maxManifestBytes: 100 });
    await loadSkills({ manifestUrl: "skills/manifest.json", maxManifestBytes: 101 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("loadSkillsFromNexus", () => {
  it("returns an empty outcome when nexusProvider is missing", async () => {
    const { loadSkillsFromNexus } = await importLoader();
    const outcome = await loadSkillsFromNexus(undefined);
    expect(outcome).toEqual({ skills: [], errors: [] });
  });

  it("short-circuits when nexusProvider.isAvailable() returns false", async () => {
    const { loadSkillsFromNexus } = await importLoader();
    const provider = {
      isAvailable: vi.fn(async () => false),
      listSkills: vi.fn(async () => [{ name: "A", description: "a" }]),
      getSkillContent: vi.fn(async () => ({ body: "x" })),
    };

    const outcome = await loadSkillsFromNexus(provider);
    expect(outcome).toEqual({ skills: [], errors: [] });
    expect(provider.isAvailable).toHaveBeenCalledTimes(1);
    expect(provider.listSkills).not.toHaveBeenCalled();
    expect(provider.getSkillContent).not.toHaveBeenCalled();
  });

  it("loads remote skills and maps them into SkillContent objects", async () => {
    const { loadSkillsFromNexus } = await importLoader();
    const provider = {
      isAvailable: vi.fn(async () => true),
      listSkills: vi.fn(async () => [
        { name: "RemoteA", description: "desc A", allowedTools: ["t1", "t2"], priority: 0 },
        { name: "RemoteB", description: "desc B", priority: 150 },
      ]),
      getSkillContent: vi.fn(async (name) => ({
        body: `body for ${name}`,
        supportFiles: { "extra.txt": `extra for ${name}` },
      })),
    };

    const outcome = await loadSkillsFromNexus(provider);
    expect(outcome.errors).toEqual([]);
    expect(outcome.skills.map((s) => s.metadata.name)).toEqual(["RemoteA", "RemoteB"]);

    const a = outcome.skills.find((s) => s.metadata.name === "RemoteA");
    expect(a.metadata.scope).toBe(modelMock.SkillScope.REMOTE);
    expect(a.metadata.path).toBe("nexus://RemoteA");
    expect(a.metadata.allowedTools).toBe("t1,t2");
    // Current implementation uses `skill.priority || 200`, so 0 falls back to 200.
    expect(a.metadata.priority).toBe(200);
    expect(a.body).toBe("body for RemoteA");
    expect(a.supportFiles).toEqual({ "extra.txt": "extra for RemoteA" });

    const b = outcome.skills.find((s) => s.metadata.name === "RemoteB");
    expect(b.metadata.priority).toBe(150);
    expect(b.metadata.allowedTools).toBe(null);
  });

  it("records per-skill errors and continues loading remaining skills", async () => {
    const { loadSkillsFromNexus } = await importLoader();
    const provider = {
      isAvailable: vi.fn(async () => true),
      listSkills: vi.fn(async () => [
        { name: "Bad", description: "bad" },
        { name: "Good", description: "good" },
      ]),
      getSkillContent: vi.fn(async (name) => {
        if (name === "Bad") throw new Error("nope");
        return { body: "ok", supportFiles: { "a.txt": "a" } };
      }),
    };

    const outcome = await loadSkillsFromNexus(provider);
    expect(outcome.skills.map((s) => s.metadata.name)).toEqual(["Good"]);
    expect(outcome.errors).toEqual([{ path: "nexus://Bad", message: "nope" }]);
  });

  it("records a connection error when nexus provider operations throw", async () => {
    const { loadSkillsFromNexus } = await importLoader();
    const provider = {
      isAvailable: vi.fn(async () => {
        throw new Error("network down");
      }),
      listSkills: vi.fn(),
      getSkillContent: vi.fn(),
    };

    const outcome = await loadSkillsFromNexus(provider);
    expect(outcome.skills).toEqual([]);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0].path).toBe("nexus://");
    expect(outcome.errors[0].message).toContain("Failed to connect to Nexus");
    expect(outcome.errors[0].message).toContain("network down");
  });
});

describe("loadAllSkills", () => {
  it("merges local and remote skills, skipping remote duplicates by name, and appends remote errors", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    sharedMock.readJsonWithLimit.mockResolvedValue({
      skills: [
        { name: "LocalOnly", description: "local", path: "l.md" },
        { name: "Shared", description: "local shared", path: "s.md" },
      ],
    });

    const nexusProvider = {
      isAvailable: vi.fn(async () => true),
      listSkills: vi.fn(async () => [
        { name: "Shared", description: "remote shared" },
        { name: "RemoteOnly", description: "remote", allowedTools: ["t"] },
        { name: "RemoteBad", description: "bad" },
      ]),
      getSkillContent: vi.fn(async (name) => {
        if (name === "RemoteBad") throw new Error("no content");
        return { body: `body ${name}`, supportFiles: { "x.txt": "x" } };
      }),
    };

    const { loadAllSkills } = await importLoader();
    const outcome = await loadAllSkills({ nexusProvider });

    // loadSkills() returns a sorted local list; loadAllSkills() appends new remote skills (no re-sort).
    expect(outcome.skills.map((s) => s.metadata.name)).toEqual(["LocalOnly", "Shared", "RemoteOnly"]);
    expect(outcome.skills.find((s) => s.metadata.name === "Shared").metadata.path).toBe("s.md");
    expect(outcome.skills.find((s) => s.metadata.name === "RemoteOnly").metadata.path).toBe("nexus://RemoteOnly");

    expect(outcome.errors).toEqual([{ path: "nexus://RemoteBad", message: "no content" }]);
  });

  it("still returns remote skills when the manifest fails to load", async () => {
    vi.stubGlobal("fetch", undefined);

    const nexusProvider = {
      isAvailable: vi.fn(async () => true),
      listSkills: vi.fn(async () => [{ name: "Remote", description: "remote" }]),
      getSkillContent: vi.fn(async () => ({ body: "remote body" })),
    };

    const { loadAllSkills } = await importLoader();
    const outcome = await loadAllSkills({ manifestUrl: "skills/manifest.json", nexusProvider });

    expect(outcome.skills.map((s) => s.metadata.name)).toEqual(["Remote"]);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0].path).toBe("skills/manifest.json");
  });
});

describe("loadSkillFromPath", () => {
  it.each([[null], [undefined], [""], ["   "], [[]]])(
    "rejects invalid filePath %p",
    async (value) => {
      const { loadSkillFromPath } = await importLoader();
      await expect(loadSkillFromPath(value)).rejects.toThrow("filePath is required");
    },
  );

  it("coerces non-string filePath values via toNonEmptyString() and forwards them to fetch()", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse({ ok: false, status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const { loadSkillFromPath } = await importLoader();

    await expect(loadSkillFromPath(0)).rejects.toThrow("Failed to load skill: 0 (404)");
    await expect(loadSkillFromPath({})).rejects.toThrow("Failed to load skill: [object Object] (404)");

    expect(fetchMock).toHaveBeenCalledWith("0", { cache: "no-store" });
    expect(fetchMock).toHaveBeenCalledWith("[object Object]", { cache: "no-store" });
  });

  it("treats the second argument as options when a plain object is provided", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const markdown = makeSkillMarkdown({
      name: "OptSkill",
      description: "desc",
      body: "body",
    });
    sharedMock.readTextWithLimit.mockResolvedValueOnce(markdown);

    const { loadSkillFromPath } = await importLoader();
    const skill = await loadSkillFromPath("skills/opt.md", { maxSkillBytes: 123 });

    expect(sharedMock.normalizeMaxBytes).toHaveBeenCalledWith(123, 2 * 1024 * 1024);
    expect(sharedMock.readTextWithLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxBytes: 123, context: expect.stringContaining("Skill content:") }),
    );
    expect(skill.metadata.scope).toBe(modelMock.SkillScope.SYSTEM);
  });

  it("loads a user skill via the user store, enforces maxSkillBytes, and parses YAML frontmatter", async () => {
    const { loadSkillFromPath } = await importLoader();

    userStoreMock.getUserSkillBody.mockReturnValue(
      makeSkillMarkdown({
        name: "UserSkill",
        description: "\"  user desc  \"",
        shortDescription: "short",
        keywords: "one, two , , three",
        keywordsAll: "alpha, beta",
        allowedTools: "tool1, tool2",
        tags: "kind:test, constructor:bad, empty:",
        traits: "fast, calm",
        priority: "7",
        body: "Body line1\nBody line2",
        extraFrontmatterLines: ["__proto__: evil", "constructor: evil", "prototype: evil"],
      }),
    );

    const skill = await loadSkillFromPath("user:UserSkill", modelMock.SkillScope.REPO, { maxSkillBytes: 10_000 });

    expect(userStoreMock.initUserSkillStore).toHaveBeenCalledTimes(1);
    expect(userStoreMock.getUserSkillBody).toHaveBeenCalledWith("UserSkill");
    expect(skill.metadata.scope).toBe(modelMock.SkillScope.USER);
    expect(skill.metadata.path).toBe("user:UserSkill");
    expect(skill.metadata.description).toBe("user desc");
    expect(skill.metadata.shortDescription).toBe("short");
    expect(skill.metadata.keywords).toEqual(["one", "two", "three"]);
    expect(skill.metadata.keywordsAll).toEqual(["alpha", "beta"]);
    expect(skill.metadata.allowedTools).toBe("tool1, tool2");
    expect(skill.metadata.tags).toEqual(expect.objectContaining({ kind: "test", empty: "" }));
    expect(Object.prototype.hasOwnProperty.call(skill.metadata.tags, "constructor")).toBe(false);
    expect(skill.metadata.traits).toEqual(["fast", "calm"]);
    expect(skill.metadata.priority).toBe(7);
    expect(skill.body).toBe("Body line1\nBody line2");
  });

  it("rejects user: paths with missing skill name", async () => {
    const { loadSkillFromPath } = await importLoader();
    await expect(loadSkillFromPath("user:")).rejects.toThrow("missing skill name");
    await expect(loadSkillFromPath("user:   ")).rejects.toThrow("missing skill name");
  });

  it("rejects user skills with a missing body", async () => {
    const { loadSkillFromPath } = await importLoader();
    userStoreMock.getUserSkillBody.mockReturnValue(null);
    await expect(loadSkillFromPath("user:Missing")).rejects.toThrow("User skill missing body");
  });

  it("throws ResponseTooLargeError when a user skill body exceeds maxSkillBytes (string-length best effort)", async () => {
    const { loadSkillFromPath } = await importLoader();
    userStoreMock.getUserSkillBody.mockReturnValue(makeSkillMarkdown({ name: "Big", description: "d", body: "x".repeat(50) }));

    await expect(loadSkillFromPath("user:Big", { maxSkillBytes: 10 })).rejects.toMatchObject({
      name: "ResponseTooLargeError",
      code: "ERESPONSE_TOO_LARGE",
    });
    expect(sharedMock.createResponseTooLargeError).toHaveBeenCalledWith("User skill body: Big", 10, expect.any(Number));
  });

  it("loads a skill via fetch and uses resolveUrl(location.href) as a base when available", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", { href: "https://example.com/app/" });

    sharedMock.readTextWithLimit.mockResolvedValueOnce(
      makeSkillMarkdown({ name: "Fetched", description: "fetched", body: "body" }),
    );

    const { loadSkillFromPath } = await importLoader();
    const skill = await loadSkillFromPath("skills/Fetched.md", modelMock.SkillScope.REPO, { maxSkillBytes: 2048 });

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/app/skills/Fetched.md", { cache: "no-store" });
    // The loader preserves the caller's input path in metadata.path.
    expect(skill.metadata.path).toBe("skills/Fetched.md");
    expect(skill.metadata.scope).toBe(modelMock.SkillScope.REPO);
  });

  it("rejects when fetch is unavailable for non-user paths", async () => {
    vi.stubGlobal("fetch", undefined);
    const { loadSkillFromPath } = await importLoader();
    await expect(loadSkillFromPath("x.md")).rejects.toThrow("fetch is not available");
  });

  it("rejects when fetch returns a non-OK response", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse({ ok: false, status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const { loadSkillFromPath } = await importLoader();
    await expect(loadSkillFromPath("https://example.com/missing.md")).rejects.toThrow("Failed to load skill");
  });

  it("rejects when the fetched skill body is empty", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    sharedMock.readTextWithLimit.mockResolvedValueOnce("");

    const { loadSkillFromPath } = await importLoader();
    await expect(loadSkillFromPath("https://example.com/empty.md")).rejects.toThrow("Failed to load skill body");
  });

  it("propagates YAML parsing errors from fetched skill content", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    sharedMock.readTextWithLimit.mockResolvedValueOnce("no frontmatter here");

    const { loadSkillFromPath } = await importLoader();
    await expect(loadSkillFromPath("https://example.com/bad.md")).rejects.toThrow("missing YAML frontmatter");
  });

  it("parses multiline YAML fields (|, >) into single-line strings", async () => {
    const fetchMock = vi.fn(async () => makeFetchResponse({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const markdown = [
      "---",
      "name: Multi",
      "description: |",
      "  line one",
      "  line two",
      "---",
      "Body",
    ].join("\n");

    sharedMock.readTextWithLimit.mockResolvedValueOnce(markdown);

    const { loadSkillFromPath } = await importLoader();
    const skill = await loadSkillFromPath("multi.md");
    expect(skill.metadata.description).toBe("line one line two");
  });
});
