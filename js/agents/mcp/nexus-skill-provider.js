/**
 * Nexus Skill Provider
 *
 * Provides Skills from MCP-Nexus (local Gateway).
 * Browser-side client for discovering and loading remote Skills.
 *
 * Architecture:
 * - Browser (Vercel static) ←→ localhost MCP Gateway
 * - Gateway has full Node.js runtime
 * - Content passed via HTTP (not file paths)
 */

import { parseSseStream } from "./sse.js";
import { normalizeMaxBytes, readJsonWithLimit } from "../shared/utils/response-limits.js";

/**
 * @typedef {Object} NexusSkillInfo
 * @property {string} name
 * @property {string} description
 * @property {number} [priority]
 * @property {string} [mutexKey]
 * @property {string} [version]
 * @property {string[]} [allowedTools]
 */

/**
 * @typedef {Object} NexusSkillContent
 * @property {string} body - SKILL.md body content
 * @property {Object<string, string>} [supportFiles]
 * @property {Object} metadata
 */

/**
 * @typedef {Object} ProviderOptions
 * @property {string} [baseUrl='http://localhost:3000'] - Gateway URL
 * @property {string} [authToken] - Optional auth token
 * @property {number} [timeout=30000] - Request timeout ms
 * @property {boolean} [cacheEnabled=true] - Enable response caching
 * @property {number} [cacheTTL=300000] - Cache TTL in ms (5 min default)
 * @property {number} [maxResponseBytes] - Max JSON response size (bytes), Infinity to disable
 * @property {number} [maxSkillContentBytes] - Max skill content size (bytes), defaults to maxResponseBytes
 */

const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024; // 4 MiB

export class NexusSkillProvider {
  /**
   * @param {ProviderOptions} options
   */
  constructor({
    baseUrl = "http://localhost:3000",
    authToken = null,
    timeout = 30000,
    cacheEnabled = true,
    cacheTTL = 300000,
    maxResponseBytes,
    maxSkillContentBytes,
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.authToken = authToken;
    this.timeout = timeout;
    this.cacheEnabled = cacheEnabled;
    this.cacheTTL = cacheTTL;
    this.maxResponseBytes = normalizeMaxBytes(maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES);
    this.maxSkillContentBytes = normalizeMaxBytes(maxSkillContentBytes, this.maxResponseBytes);

    /** @type {Map<string, { data: any, timestamp: number }>} */
    this.cache = new Map();

    /** @type {boolean} */
    this.connected = false;
  }

  async _readJson(response, { maxBytes, context, fallback } = {}) {
    try {
      return await readJsonWithLimit(response, { maxBytes, context });
    } catch (err) {
      if (err && typeof err === "object" && /** @type {any} */ (err).name === "ResponseTooLargeError") {
        throw err;
      }
      if (fallback !== undefined) return fallback;
      throw err;
    }
  }

  /**
   * Check if Gateway is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      const response = await this._fetch("/api/health", { method: "GET" });
      this.connected = response.ok;
      return this.connected;
    } catch {
      this.connected = false;
      return false;
    }
  }

  /**
   * List available Skills from Gateway
   * @returns {Promise<NexusSkillInfo[]>}
   */
  async listSkills() {
    const cacheKey = "skills:list";
    const cached = this._getCache(cacheKey);
    if (cached) return cached;

    const response = await this._fetch("/api/skills");
    if (!response.ok) {
      throw new Error(`Failed to list skills: ${response.status}`);
    }

    const data = await this._readJson(response, {
      maxBytes: this.maxResponseBytes,
      context: "Nexus skills list response",
    });
    const skills = data.skills || [];

    this._setCache(cacheKey, skills);
    return skills;
  }

  /**
   * Get Skill content (body + support files)
   * @param {string} name
   * @returns {Promise<NexusSkillContent>}
   */
  async getSkillContent(name) {
    const cacheKey = `skills:content:${name}`;
    const cached = this._getCache(cacheKey);
    if (cached) return cached;

    const response = await this._fetch(`/api/skills/${encodeURIComponent(name)}/content`);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Skill not found: ${name}`);
      }
      throw new Error(`Failed to get skill content: ${response.status}`);
    }

    const content = await this._readJson(response, {
      maxBytes: this.maxSkillContentBytes,
      context: `Nexus skill content response: ${name}`,
    });
    this._setCache(cacheKey, content);
    return content;
  }

  /**
   * Execute a tool via Gateway
   * @param {string} toolId
   * @param {Object} params
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async executeTool(toolId, params, options = {}) {
    const response = await this._fetch("/api/tools/execute", {
      method: "POST",
      body: JSON.stringify({
        toolId,
        params,
        ...options,
      }),
    });

    if (!response.ok) {
      const error = await this._readJson(response, {
        maxBytes: this.maxResponseBytes,
        context: `Nexus tool error response: ${toolId}`,
        fallback: {},
      });
      throw new Error(error.message || `Tool execution failed: ${response.status}`);
    }

    return await this._readJson(response, {
      maxBytes: this.maxResponseBytes,
      context: `Nexus tool response: ${toolId}`,
    });
  }

  /**
   * Execute orchestrated workflow via Gateway
   * @param {string} goal
   * @param {Object[]} steps
   * @param {Object} [context]
   * @returns {Promise<any>}
   */
  async executeWorkflow(goal, steps, context = {}) {
    const response = await this._fetch("/api/orchestrator/execute", {
      method: "POST",
      body: JSON.stringify({ goal, steps, context }),
    });

    if (!response.ok) {
      const error = await this._readJson(response, {
        maxBytes: this.maxResponseBytes,
        context: "Nexus workflow error response",
        fallback: {},
      });
      throw new Error(error.message || `Workflow execution failed: ${response.status}`);
    }

    return await this._readJson(response, {
      maxBytes: this.maxResponseBytes,
      context: "Nexus workflow response",
    });
  }

  /**
   * Stream execution results via SSE
   * @param {string} endpoint
   * @param {Object} params
   * @param {Function} onMessage
   * @param {Function} [onError]
   * @returns {Promise<void>}
   */
  async streamExecution(endpoint, params, onMessage, onError) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = this._getHeaders();
    const emit = typeof onMessage === "function" ? onMessage : () => {};

    const connectTimeoutMs = typeof this.timeout === "number" && Number.isFinite(this.timeout) ? Math.max(0, Math.floor(this.timeout)) : 30_000;
    const readTimeoutMs = Math.max(60_000, connectTimeoutMs);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort("connect_timeout"), connectTimeoutMs);

      const response = await fetch(url, {
        method: "POST",
        headers: { ...headers, Accept: "text/event-stream" },
        body: JSON.stringify(params),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));
      if (!response.ok) {
        throw new Error(`Stream failed: ${response.status}`);
      }

      const ctype = response.headers?.get?.("content-type") || "";
      if (ctype && !ctype.toLowerCase().includes("text/event-stream")) {
        throw new Error(`Stream failed: unexpected content-type: ${ctype}`);
      }

      for await (const evt of parseSseStream(response.body, { signal: controller.signal, readTimeoutMs })) {
        const data = typeof evt?.data === "string" ? evt.data.trim() : "";
        if (!data) continue;
        try {
          emit(JSON.parse(data));
        } catch {
          // ignore invalid JSON payloads
        }
      }
    } catch (error) {
      if (onError) {
        onError(error);
      } else {
        throw error;
      }
    }
  }

  /**
   * Create SkillRegistration objects for use with SkillRegistry
   * @returns {Promise<Array<{ definition: Object, handler: Function }>>}
   */
  async createRegistrations() {
    const skills = await this.listSkills();
    const registrations = [];

    for (const skill of skills) {
      registrations.push({
        definition: {
          name: skill.name,
          description: skill.description,
          priority: skill.priority || 0,
          mutexKey: skill.mutexKey || null,
          metadata: {
            source: "nexus",
            version: skill.version,
            allowedTools: skill.allowedTools,
          },
        },
        handler: this._createHandler(skill.name),
      });
    }

    return registrations;
  }

  /**
   * Create lazy handler for a Skill
   * @private
   */
  _createHandler(name) {
    return async (params, context) => {
      const content = await this.getSkillContent(name);
      return {
        skill: name,
        output: {
          body: content.body,
          support_files: content.supportFiles,
        },
        metadata: content.metadata,
      };
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Invalidate specific cache entry
   * @param {string} key
   */
  invalidateCache(key) {
    for (const [k] of this.cache) {
      if (k.startsWith(key)) {
        this.cache.delete(k);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────

  _getHeaders() {
    const headers = {
      "Content-Type": "application/json",
    };
    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  async _fetch(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: { ...this._getHeaders(), ...options.headers },
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  _getCache(key) {
    if (!this.cacheEnabled) return null;

    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  _setCache(key, data) {
    if (!this.cacheEnabled) return;
    this.cache.set(key, { data, timestamp: Date.now() });
  }
}

export default NexusSkillProvider;
