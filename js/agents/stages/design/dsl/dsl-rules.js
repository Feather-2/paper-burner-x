/**
 * DSL Rules - 从 prompts/dsl/ppt-html-dsl.md 动态加载
 *
 * 提供两种使用方式：
 * 1. 异步: await getDslRules()
 * 2. 同步 (需先初始化): DSL_RULES (初始化后可用)
 */

import { loadPrompt } from "../../../prompts/prompt-loader.js";
import { createLogger } from "../../../shared/index.js";

const logger = createLogger("stages/design/dsl/dsl-rules");

const DEFAULT_CACHE_KEY = "default";
/** @type {Map<string, string>} */
const _dslRulesCache = new Map();
/** @type {Map<string, Promise<string>>} */
const _dslRulesLoadPromises = new Map();

function resolveDslRulesCacheKey(options = {}) {
  const direct = typeof options === "string" ? options : options?.cacheKey || options?.scopeKey || options?.tenantId;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  return DEFAULT_CACHE_KEY;
}

/**
 * 异步获取 DSL 规则 (推荐方式)
 * @returns {Promise<string>}
 */
export async function getDslRules(options = {}) {
  const cacheKey = resolveDslRulesCacheKey(options);
  if (_dslRulesCache.has(cacheKey)) {
    return _dslRulesCache.get(cacheKey);
  }

  if (_dslRulesLoadPromises.has(cacheKey)) {
    return _dslRulesLoadPromises.get(cacheKey);
  }

  const loadPromise = loadPrompt("dsl/ppt-html-dsl")
    .then((content) => {
      _dslRulesCache.set(cacheKey, content);
      _dslRulesLoadPromises.delete(cacheKey);
      return content;
    })
    .catch((err) => {
      logger.warn("[dsl-rules] Failed to load from file, using fallback:", { error: err?.message });
      // 返回一个最小化的 fallback
      _dslRulesCache.set(cacheKey, FALLBACK_DSL_RULES);
      _dslRulesLoadPromises.delete(cacheKey);
      return FALLBACK_DSL_RULES;
    });

  _dslRulesLoadPromises.set(cacheKey, loadPromise);
  return loadPromise;
}

/**
 * 同步获取 DSL 规则 (需要先调用 initDslRules)
 * @returns {string|null}
 */
export function getDslRulesSync(options = {}) {
  const cacheKey = resolveDslRulesCacheKey(options);
  return _dslRulesCache.has(cacheKey) ? _dslRulesCache.get(cacheKey) : null;
}

/**
 * 预初始化 DSL 规则
 * @returns {Promise<string>}
 */
export async function initDslRules(options = {}) {
  return getDslRules(options);
}

/**
 * 清除缓存 (用于测试或热更新)
 * @returns {void}
 */
export function clearDslRulesCache(options = {}) {
  const cacheKey = resolveDslRulesCacheKey(options);
  if (cacheKey !== DEFAULT_CACHE_KEY || (typeof options === "string" && options.trim())) {
    _dslRulesCache.delete(cacheKey);
    _dslRulesLoadPromises.delete(cacheKey);
    return;
  }

  // 默认行为保持兼容：不传参时清空全部缓存
  if (
    options === undefined ||
    options === null ||
    (typeof options === "object" && Object.keys(options).length === 0)
  ) {
    _dslRulesCache.clear();
    _dslRulesLoadPromises.clear();
    return;
  }

  _dslRulesCache.delete(cacheKey);
  _dslRulesLoadPromises.delete(cacheKey);
}

// Fallback: 最小化的 DSL 规则，用于加载失败时
const FALLBACK_DSL_RULES = `
# PPT HTML DSL 基础规范

## 基础结构
<section data-type="freeform" data-bg="#ffffff">
  <!-- 元素 -->
</section>

## 核心元素
- text: <div data-el="text" data-x="10%" data-y="10%" data-w="80%" data-font="24" data-color="#000">文字</div>
- shape: <div data-el="shape" data-shape="rect" data-x="10%" data-y="10%" data-w="30%" data-h="20%" data-fill="#ccc"></div>
- image: <div data-el="image" data-x="10%" data-y="10%" data-w="30%" data-h="20%" data-src="url"></div>
- svg: <div data-el="svg" data-x="10%" data-y="10%" data-w="30%" data-h="20%"><svg>...</svg></div>

## 通用属性
- data-x, data-y: 位置 (百分比)
- data-w, data-h: 尺寸 (百分比或auto)
- data-font: 字号 (px)
- data-color: 颜色 (hex)
- data-opacity: 透明度 (0-1)
`.trim();

/**
 * DSL 规则的同步访问代理。
 * 注意：首次访问时可能返回 fallback，需要先调用 initDslRules()。
 */
export const DSL_RULES = /** @type {string & { length: number }} */ (new Proxy({}, {
  get(target, prop) {
    if (prop === Symbol.toPrimitive || prop === "toString" || prop === "valueOf") {
      return () => getDslRulesSync(DEFAULT_CACHE_KEY) || FALLBACK_DSL_RULES;
    }
    if (prop === "length") {
      return (getDslRulesSync(DEFAULT_CACHE_KEY) || FALLBACK_DSL_RULES).length;
    }
    return (getDslRulesSync(DEFAULT_CACHE_KEY) || FALLBACK_DSL_RULES)[prop];
  },
  ownKeys() {
    return [];
  },
  getOwnPropertyDescriptor() {
    return { configurable: true, enumerable: true };
  },
}));
