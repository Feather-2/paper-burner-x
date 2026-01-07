/**
 * Skill Loader (Env Router)
 *
 * - Node: scans `.paper-burner/skills` and `~/.paper-burner/skills`
 * - Browser: loads from a fetchable manifest (public/skills/manifest.json)
 */

/**
 * @typedef {import("./model.js").SkillMetadata} SkillMetadata
 * @typedef {{ metadata: SkillMetadata, body: (string | null), supportFiles?: Record<string, string> }} SkillContent
 * @typedef {{ skills: SkillContent[], errors: Array<{ path: string, message: string }> }} SkillLoadOutcome
 *
 * @typedef {Object} LoadSkillsOptions
 * @property {string} [cwd] - Node: repo cwd
 * @property {string} [homeDir] - Node: home directory
 * @property {string} [manifestUrl] - Browser: manifest URL
 *
 * @typedef {Object} LoadAllSkillsOptions
 * @property {string} [cwd]
 * @property {string} [homeDir]
 * @property {string} [manifestUrl]
 * @property {any} [nexusProvider]
 */

const isNode =
  /** @ts-ignore */
  typeof process !== "undefined" &&
  /** @ts-ignore */
  !!process.versions?.node;

let _implPromise = null;

async function getImpl() {
  if (_implPromise) return _implPromise;
  _implPromise = isNode
    ? import("./loader.node.js")
    : import("./loader.browser.js");
  return _implPromise;
}

/**
 * Load skills available in the current environment.
 *
 * @param {LoadSkillsOptions} [options]
 * @returns {Promise<SkillLoadOutcome>}
 */
export async function loadSkills(options = {}) {
  const mod = await getImpl();
  return mod.loadSkills(options);
}

/**
 * Load remote skills from an MCP-Nexus provider.
 *
 * @param {any} nexusProvider
 * @returns {Promise<SkillLoadOutcome>}
 */
export async function loadSkillsFromNexus(nexusProvider) {
  const mod = await getImpl();
  return mod.loadSkillsFromNexus(nexusProvider);
}

/**
 * Load all skills (local + remote).
 *
 * @param {LoadAllSkillsOptions} [options]
 * @returns {Promise<SkillLoadOutcome>}
 */
export async function loadAllSkills(options = {}) {
  const mod = await getImpl();
  return mod.loadAllSkills(options);
}

/**
 * Load a single skill from a local path / URL (or `user:<name>` in browser mode).
 *
 * @param {string} filePath
 * @param {string} [scope]
 * @returns {Promise<SkillContent>}
 */
export async function loadSkillFromPath(filePath, scope) {
  const mod = await getImpl();
  return mod.loadSkillFromPath(filePath, scope);
}

/** @type {{ loadSkills: typeof loadSkills, loadSkillFromPath: typeof loadSkillFromPath, loadSkillsFromNexus: typeof loadSkillsFromNexus, loadAllSkills: typeof loadAllSkills }} */
export default {
  loadSkills,
  loadSkillFromPath,
  loadSkillsFromNexus,
  loadAllSkills,
};
