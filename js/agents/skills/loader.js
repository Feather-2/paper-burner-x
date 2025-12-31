/**
 * Skill Loader (Env Router)
 *
 * - Node: scans `.paper-burner/skills` and `~/.paper-burner/skills`
 * - Browser: loads from a fetchable manifest (public/skills/manifest.json)
 */

const isNode =
  typeof process !== "undefined" &&
  !!process.versions?.node;

let _implPromise = null;

async function getImpl() {
  if (_implPromise) return _implPromise;
  _implPromise = isNode
    ? import("./loader.node.js")
    : import("./loader.browser.js");
  return _implPromise;
}

export async function loadSkills(options = {}) {
  const mod = await getImpl();
  return mod.loadSkills(options);
}

export async function loadSkillsFromNexus(nexusProvider) {
  const mod = await getImpl();
  return mod.loadSkillsFromNexus(nexusProvider);
}

export async function loadAllSkills(options = {}) {
  const mod = await getImpl();
  return mod.loadAllSkills(options);
}

export async function loadSkillFromPath(filePath, scope) {
  const mod = await getImpl();
  return mod.loadSkillFromPath(filePath, scope);
}

export default {
  loadSkills,
  loadSkillFromPath,
  loadSkillsFromNexus,
  loadAllSkills,
};

