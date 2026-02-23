/**
 * context-utils.js — re-export shim
 *
 * 真实逻辑在全局包 @pb/context-cli，此文件仅设置项目根后 re-export。
 * _init-root.js 必须在 utils.js 之前 import，确保 env 在 utils 评估 ROOT 时已就绪。
 * ESM 规范保证 import/export-from 按源码顺序评估依赖。
 * @module context-utils
 */
import './_init-root.js';

export {
  PERSPECTIVES, TRIGGER_TYPES, CONDITION_TYPES, SIGNAL_TYPES, DECISION_OPS,
  ROOT, CTX_DIR, INTENT_DIR, LOCK_DIR,
  getRoot, loadConfig, ulid, contentHash,
  acquireLock, withLock,
  readJsonl, appendJsonl,
  moduleToShard, loadRenames, canonicalize, normalizeModules,
  detectSecret,
  isValidAtomKey, isValidExcludedKey, isValidSlug,
  pathExists, output, today,
  gitLatestCommitDates,
} from '@pb/context-cli';
