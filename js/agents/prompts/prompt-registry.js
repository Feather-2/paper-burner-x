import { PromptTemplate } from "./prompt-template.js";

/**
 * Simple in-memory prompt registry.
 *
 * Stores prompt templates by name and renders them with variables.
 */
export class PromptRegistry {
  constructor() {
    /** @type {Map<string, PromptTemplate>} */
    this._templates = new Map();
  }

  /**
   * @param {string} name
   * @param {string|PromptTemplate} template
   */
  register(name, template) {
    const key = typeof name === "string" ? name.trim() : "";
    if (!key) throw new TypeError("PromptRegistry.register: name must be a non-empty string");

    const tpl = template instanceof PromptTemplate ? template : new PromptTemplate(template);
    this._templates.set(key, tpl);
    return this;
  }

  /**
   * Register multiple templates.
   * @param {Record<string, string|PromptTemplate> | Array<[string, string|PromptTemplate]> | Map<string, string|PromptTemplate>} templates
   */
  registerMany(templates) {
    if (!templates) return this;
    if (templates instanceof Map) {
      for (const [name, tpl] of templates.entries()) this.register(name, tpl);
      return this;
    }
    if (Array.isArray(templates)) {
      for (const [name, tpl] of templates) this.register(name, tpl);
      return this;
    }
    if (typeof templates === "object") {
      for (const [name, tpl] of Object.entries(templates)) this.register(name, tpl);
      return this;
    }
    throw new TypeError("PromptRegistry.registerMany: templates must be an object, array, or map");
  }

  /**
   * @param {string} name
   * @returns {PromptTemplate | null}
   */
  get(name) {
    const key = typeof name === "string" ? name.trim() : "";
    return key ? this._templates.get(key) || null : null;
  }

  /**
   * @param {string} name
   */
  has(name) {
    const key = typeof name === "string" ? name.trim() : "";
    return key ? this._templates.has(key) : false;
  }

  /**
   * @returns {string[]}
   */
  list() {
    return Array.from(this._templates.keys());
  }

  /**
   * @param {string=} name
   */
  clear(name) {
    if (typeof name === "string" && name.trim()) {
      this._templates.delete(name.trim());
      return;
    }
    this._templates.clear();
  }

  /**
   * Render a registered prompt by name.
   * @param {string} name
   * @param {import("./prompt-template.js").RenderPromptTemplateOptions} [options]
   * @returns {string}
   */
  render(name, options = {}) {
    const tpl = this.get(name);
    if (!tpl) {
      throw new Error(`PromptRegistry.render: unknown prompt "${name}"`);
    }
    return tpl.render(options);
  }
}

