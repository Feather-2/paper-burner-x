const INDEX_KEY = "paperburner_user_skills_index_v1";
const BODY_PREFIX = "paperburner_user_skills_body_v1:";

function hasLocalStorage() {
  try {
    return typeof localStorage !== "undefined" && !!localStorage && typeof localStorage.getItem === "function";
  } catch {
    return false;
  }
}

const MEMORY = { index: { schemaVersion: "0.1", skills: [] }, bodies: new Map() };

function toNonEmptyString(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s.length ? s : "";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeIndex(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  const skills = Array.isArray(obj.skills) ? obj.skills : [];
  return {
    schemaVersion: "0.1",
    skills: skills.filter((s) => s && typeof s === "object" && toNonEmptyString(s.name)),
  };
}

export function listUserSkills() {
  const index = loadUserSkillsIndex();
  return index.skills;
}

export function loadUserSkillsIndex() {
  if (!hasLocalStorage()) return normalizeIndex(MEMORY.index);
  const raw = localStorage.getItem(INDEX_KEY);
  if (!raw) return { schemaVersion: "0.1", skills: [] };
  try {
    return normalizeIndex(JSON.parse(raw));
  } catch {
    return { schemaVersion: "0.1", skills: [] };
  }
}

export function saveUserSkillsIndex(index) {
  const normalized = normalizeIndex(index);
  if (!hasLocalStorage()) {
    MEMORY.index = normalized;
    return true;
  }
  localStorage.setItem(INDEX_KEY, JSON.stringify(normalized));
  return true;
}

export function getUserSkillBody(name) {
  const id = toNonEmptyString(name);
  if (!id) return "";
  if (!hasLocalStorage()) return String(MEMORY.bodies.get(id) || "");
  return String(localStorage.getItem(BODY_PREFIX + id) || "");
}

export function setUserSkillBody(name, body) {
  const id = toNonEmptyString(name);
  if (!id) return false;
  const text = typeof body === "string" ? body : String(body ?? "");
  if (!hasLocalStorage()) {
    MEMORY.bodies.set(id, text);
    return true;
  }
  localStorage.setItem(BODY_PREFIX + id, text);
  return true;
}

export function upsertUserSkill({ metadata, body } = {}) {
  const meta = isPlainObject(metadata) ? metadata : {};
  const name = toNonEmptyString(meta.name);
  const description = toNonEmptyString(meta.description);
  if (!name || !description) throw new Error("upsertUserSkill: metadata.name/description are required");

  const index = loadUserSkillsIndex();
  const now = new Date().toISOString();

  const normalizedMeta = {
    name,
    description,
    shortDescription: toNonEmptyString(meta.shortDescription) || null,
    scope: "user",
    keywords: Array.isArray(meta.keywords) ? meta.keywords : [],
    keywordsAll: Array.isArray(meta.keywordsAll) ? meta.keywordsAll : [],
    allowedTools: toNonEmptyString(meta.allowedTools) || null,
    tags: isPlainObject(meta.tags) ? meta.tags : null,
    traits: Array.isArray(meta.traits) ? meta.traits : null,
    priority: Number.isFinite(Number(meta.priority)) ? Number(meta.priority) : 100,
    updatedAt: now,
  };

  const nextSkills = [];
  let replaced = false;
  for (const s of index.skills) {
    if (toNonEmptyString(s.name) !== name) {
      nextSkills.push(s);
      continue;
    }
    nextSkills.push({ ...s, ...normalizedMeta });
    replaced = true;
  }
  if (!replaced) {
    nextSkills.push({ ...normalizedMeta, createdAt: now });
  }

  saveUserSkillsIndex({ ...index, skills: nextSkills });
  setUserSkillBody(name, body);
  return { ok: true, name };
}

export function deleteUserSkill(name) {
  const id = toNonEmptyString(name);
  if (!id) return false;
  const index = loadUserSkillsIndex();
  const nextSkills = index.skills.filter((s) => toNonEmptyString(s.name) !== id);
  saveUserSkillsIndex({ ...index, skills: nextSkills });

  if (!hasLocalStorage()) {
    MEMORY.bodies.delete(id);
    return true;
  }
  localStorage.removeItem(BODY_PREFIX + id);
  return true;
}

export function clearUserSkills() {
  const index = loadUserSkillsIndex();
  for (const s of index.skills) {
    const id = toNonEmptyString(s?.name);
    if (!id) continue;
    deleteUserSkill(id);
  }
  saveUserSkillsIndex({ schemaVersion: "0.1", skills: [] });
  return true;
}

export default {
  listUserSkills,
  loadUserSkillsIndex,
  saveUserSkillsIndex,
  getUserSkillBody,
  setUserSkillBody,
  upsertUserSkill,
  deleteUserSkill,
  clearUserSkills,
};

