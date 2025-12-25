function toCapability(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function normalizeKey(value) {
  if (value === null || value === undefined) return "";
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchesCapability(candidate, capability) {
  const candidateKey = normalizeKey(candidate);
  const capabilityKey = normalizeKey(capability);
  if (!candidateKey || !capabilityKey) return false;
  return candidateKey === capabilityKey;
}

function collectCapabilities(values) {
  if (!Array.isArray(values)) return [];
  const list = [];
  const seen = new Set();
  for (const value of values) {
    const cap = toCapability(value);
    if (!cap || seen.has(cap)) continue;
    seen.add(cap);
    list.push(cap);
  }
  return list;
}

function capabilityIsAllowed(capability, allowed) {
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.some((cap) => matchesCapability(capability, cap));
}

function formatSection(title, entries) {
  if (!entries || entries.length === 0) return "";
  const lines = [`## ${title}`, ""];
  for (const entry of entries) {
    const providers = Array.isArray(entry.providers) ? entry.providers : [];
    const suffix = providers.length ? `: ${providers.join(", ")}` : "";
    lines.push(`- ${entry.capability}${suffix}`);
  }
  return lines.join("\n");
}

export class CapabilityLoader {
  constructor({ blockRegistry, skillRegistry, mcpNexus, tempSkillStore } = {}) {
    this.blocks = blockRegistry || null;
    this.skills = skillRegistry || null;
    this.mcp = mcpNexus || null;
    this.tempSkills = tempSkillStore || null;
    this.loaded = new Set();
    this._mcpToolsCache = null;
  }

  async loadRequired(capabilities) {
    const requested = collectCapabilities(capabilities);

    for (const cap of requested) {
      if (this.loaded.has(cap)) continue;

      let loaded = false;

      if (this._blocksHasCapability(cap)) {
        await this._loadBlockCapability(cap);
        loaded = true;
      } else if (this._skillsHasCapability(cap)) {
        await this._loadSkillCapability(cap);
        loaded = true;
      } else if (this._tempSkillsHasCapability(cap)) {
        await this._loadTempSkillCapability(cap);
        loaded = true;
      } else if (await this._mcpHasCapability(cap)) {
        await this._loadMcpCapability(cap);
        loaded = true;
      }

      if (loaded) this.loaded.add(cap);
    }
  }

  hasCapability(name) {
    const cap = toCapability(name);
    if (!cap) return false;
    if (this._blocksHasCapability(cap)) return true;
    if (this._skillsHasCapability(cap)) return true;
    if (this._tempSkillsHasCapability(cap)) return true;
    if (this._mcpHasCapabilitySync(cap)) return true;
    return false;
  }

  isLoaded(name) {
    const cap = toCapability(name);
    if (!cap) return false;
    return this.loaded.has(cap);
  }

  getLoadedCapabilities() {
    return Array.from(this.loaded.values());
  }

  buildCatalogPrompt({ filter } = {}) {
    const allowed = this._resolveAllowedCapabilities(filter);
    if (allowed.length === 0) return "";

    const sections = [
      this._buildBlockSection(allowed),
      this._buildSkillSection(allowed),
      this._buildTempSkillSection(allowed),
      this._buildMcpSection(allowed),
    ].filter(Boolean);

    return sections.join("\n\n");
  }

  reset() {
    this.loaded.clear();
  }

  _resolveAllowedCapabilities(filter) {
    const loaded = this.getLoadedCapabilities();
    if (!Array.isArray(filter)) return loaded;

    const requested = collectCapabilities(filter);
    if (requested.length === 0) return [];

    return loaded.filter((cap) => requested.some((candidate) => matchesCapability(cap, candidate)));
  }

  _getBlockManifests() {
    if (!this.blocks || typeof this.blocks.getManifests !== "function") return [];
    const manifests = this.blocks.getManifests();
    return Array.isArray(manifests) ? manifests : [];
  }

  _blocksHasCapability(capability) {
    if (!this.blocks) return false;
    if (typeof this.blocks.hasCapability === "function") {
      try {
        return Boolean(this.blocks.hasCapability(capability));
      } catch {
        return false;
      }
    }

    const manifests = this._getBlockManifests();
    for (const manifest of manifests) {
      const caps = Array.isArray(manifest?.capabilities) ? manifest.capabilities : [];
      if (caps.some((cap) => matchesCapability(cap, capability))) return true;
    }

    return false;
  }

  async _loadBlockCapability(capability) {
    if (!this.blocks) return false;
    if (typeof this.blocks.ensureLoaded === "function") {
      await this.blocks.ensureLoaded(capability);
    }
    return true;
  }

  _getSkillRegistry() {
    if (!this.skills) return null;
    if (typeof this.skills.getAllDefinitions === "function") return this.skills;
    if (this.skills.registry && typeof this.skills.registry.getAllDefinitions === "function") {
      return this.skills.registry;
    }
    return null;
  }

  _getSkillDefinitions() {
    const registry = this._getSkillRegistry();
    if (!registry) return [];
    const definitions = registry.getAllDefinitions();
    return Array.isArray(definitions) ? definitions : [];
  }

  _getSkillCapabilities(definition) {
    const caps = [];
    if (Array.isArray(definition?.capabilities)) caps.push(...definition.capabilities);
    if (Array.isArray(definition?.traits)) caps.push(...definition.traits);
    if (Array.isArray(definition?.activation?.traits)) caps.push(...definition.activation.traits);
    if (Array.isArray(definition?.metadata?.capabilities)) caps.push(...definition.metadata.capabilities);
    return collectCapabilities(caps);
  }

  _findSkillByCapability(capability) {
    const definitions = this._getSkillDefinitions();
    for (const def of definitions) {
      const caps = this._getSkillCapabilities(def);
      if (caps.some((cap) => matchesCapability(cap, capability))) {
        const name = toCapability(def?.name);
        if (name) return name;
      }
    }
    return null;
  }

  _skillsHasCapability(capability) {
    if (!this.skills) return false;
    if (typeof this.skills.hasCapability === "function") {
      try {
        return Boolean(this.skills.hasCapability(capability));
      } catch {
        return false;
      }
    }

    return this._findSkillByCapability(capability) !== null;
  }

  async _loadSkillCapability(capability) {
    const skillName = this._findSkillByCapability(capability);
    if (!skillName) return false;

    if (this.skills && typeof this.skills.load === "function") {
      await this.skills.load(skillName);
    }
    return true;
  }

  // TempSkillStore methods (第四层能力源)

  _tempSkillsHasCapability(capability) {
    if (!this.tempSkills) return false;
    if (typeof this.tempSkills.hasCapability === "function") {
      return this.tempSkills.hasCapability(capability);
    }
    return false;
  }

  async _loadTempSkillCapability(capability) {
    if (!this.tempSkills) return false;
    const skill = await this.tempSkills.get(capability);
    return skill !== null;
  }

  _getTempSkillDefinitions() {
    if (!this.tempSkills) return [];
    // 同步返回缓存中的 skill names
    const names = Array.from(this.tempSkills._cache || []);
    return names.map((name) => ({ name, source: "temp" }));
  }

  _buildTempSkillSection(allowed) {
    const definitions = this._getTempSkillDefinitions();
    if (definitions.length === 0) return "";

    const entries = [];
    for (const def of definitions) {
      if (!capabilityIsAllowed(def.name, allowed)) continue;
      entries.push({ capability: def.name, providers: ["TempSkillStore"] });
    }

    return formatSection("Temporary Skill Capabilities", entries);
  }

  _getMcpToolsSync() {
    if (Array.isArray(this._mcpToolsCache)) return this._mcpToolsCache;
    if (this.mcp && Array.isArray(this.mcp.tools)) return this.mcp.tools;
    if (this.mcp && Array.isArray(this.mcp.availableTools)) return this.mcp.availableTools;
    return [];
  }

  async _ensureMcpTools() {
    if (!this.mcp) return [];
    if (Array.isArray(this._mcpToolsCache)) return this._mcpToolsCache;
    if (Array.isArray(this.mcp.tools)) {
      this._mcpToolsCache = this.mcp.tools;
      return this._mcpToolsCache;
    }

    let tools = [];
    try {
      if (typeof this.mcp.listAvailableTools === "function") {
        tools = await this.mcp.listAvailableTools();
      } else if (typeof this.mcp.listTools === "function") {
        tools = await this.mcp.listTools();
      } else if (typeof this.mcp.listAllTools === "function") {
        tools = await this.mcp.listAllTools();
      }
    } catch {
      tools = [];
    }

    this._mcpToolsCache = Array.isArray(tools) ? tools : [];
    return this._mcpToolsCache;
  }

  _collectMcpToolCapabilities(tool) {
    const caps = [];
    if (tool?.name) caps.push(tool.name);
    if (tool?.id) caps.push(tool.id);
    if (Array.isArray(tool?.categories)) caps.push(...tool.categories);
    if (tool?.category) caps.push(tool.category);
    if (Array.isArray(tool?.tags)) caps.push(...tool.tags);
    return collectCapabilities(caps);
  }

  _mcpHasCapabilitySync(capability) {
    if (!this.mcp) return false;
    if (typeof this.mcp.hasCapability === "function") {
      try {
        return Boolean(this.mcp.hasCapability(capability));
      } catch {
        return false;
      }
    }

    const tools = this._getMcpToolsSync();
    for (const tool of tools) {
      const caps = this._collectMcpToolCapabilities(tool);
      if (caps.some((cap) => matchesCapability(cap, capability))) return true;
    }

    return false;
  }

  async _mcpHasCapability(capability) {
    if (!this.mcp) return false;
    if (typeof this.mcp.hasCapability === "function") {
      try {
        return Boolean(await this.mcp.hasCapability(capability));
      } catch {
        return false;
      }
    }

    const tools = await this._ensureMcpTools();
    for (const tool of tools) {
      const caps = this._collectMcpToolCapabilities(tool);
      if (caps.some((cap) => matchesCapability(cap, capability))) return true;
    }

    return false;
  }

  async _loadMcpCapability(capability) {
    if (!this.mcp) return false;
    if (typeof this.mcp.activate === "function") {
      await this.mcp.activate(capability);
    }
    return true;
  }

  _buildBlockSection(allowed) {
    const manifests = this._getBlockManifests();
    if (manifests.length === 0) return "";

    const entries = [];
    const byKey = new Map();

    for (const manifest of manifests) {
      const name = toCapability(manifest?.name);
      const caps = Array.isArray(manifest?.capabilities) ? manifest.capabilities : [];
      for (const cap of caps) {
        if (!capabilityIsAllowed(cap, allowed)) continue;
        const key = normalizeKey(cap) || cap;
        if (!byKey.has(key)) {
          byKey.set(key, { capability: cap, providers: [] });
        }
        const entry = byKey.get(key);
        if (name && !entry.providers.includes(name)) entry.providers.push(name);
      }
    }

    entries.push(...byKey.values());
    return formatSection("Block Capabilities", entries);
  }

  _buildSkillSection(allowed) {
    const definitions = this._getSkillDefinitions();
    if (definitions.length === 0) return "";

    const entries = [];
    const byKey = new Map();

    for (const def of definitions) {
      const name = toCapability(def?.name);
      const caps = this._getSkillCapabilities(def);
      for (const cap of caps) {
        if (!capabilityIsAllowed(cap, allowed)) continue;
        const key = normalizeKey(cap) || cap;
        if (!byKey.has(key)) {
          byKey.set(key, { capability: cap, providers: [] });
        }
        const entry = byKey.get(key);
        if (name && !entry.providers.includes(name)) entry.providers.push(name);
      }
    }

    entries.push(...byKey.values());
    return formatSection("Skill Capabilities", entries);
  }

  _buildMcpSection(allowed) {
    const tools = this._getMcpToolsSync();
    if (tools.length === 0) return "";

    const entries = [];
    const byKey = new Map();

    for (const tool of tools) {
      const toolName = toCapability(tool?.name || tool?.id || "");
      const caps = this._collectMcpToolCapabilities(tool);
      for (const cap of caps) {
        if (!capabilityIsAllowed(cap, allowed)) continue;
        const key = normalizeKey(cap) || cap;
        if (!byKey.has(key)) {
          byKey.set(key, { capability: cap, providers: [] });
        }
        const entry = byKey.get(key);
        if (toolName && !entry.providers.includes(toolName)) entry.providers.push(toolName);
      }
    }

    entries.push(...byKey.values());
    return formatSection("MCP Capabilities", entries);
  }
}

export default CapabilityLoader;
