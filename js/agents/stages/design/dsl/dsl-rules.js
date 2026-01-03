/**
 * DSL Rules - 从 prompts/dsl/ppt-html-dsl.md 动态加载
 *
 * 提供两种使用方式：
 * 1. 异步: await getDslRules()
 * 2. 同步 (需先初始化): DSL_RULES (初始化后可用)
 */

import { loadPrompt } from "../../../prompts/prompt-loader.js";
import { createLogger } from "../../../shared/utils/logger.js";

const logger = createLogger("stages/design/dsl/dsl-rules");

// 缓存的 DSL 规则
let _cachedDslRules = null;
let _loadPromise = null;

/**
 * 异步获取 DSL 规则 (推荐方式)
 * @returns {Promise<string>}
 */
export async function getDslRules() {
  if (_cachedDslRules !== null) {
    return _cachedDslRules;
  }

  if (_loadPromise) {
    return _loadPromise;
  }

  _loadPromise = loadPrompt("dsl/ppt-html-dsl")
    .then((content) => {
      _cachedDslRules = content;
      return content;
    })
    .catch((err) => {
      logger.warn("[dsl-rules] Failed to load from file, using fallback:", { error: err?.message });
      // 返回一个最小化的 fallback
      _cachedDslRules = FALLBACK_DSL_RULES;
      return _cachedDslRules;
    });

  return _loadPromise;
}

/**
 * 同步获取 DSL 规则 (需要先调用 initDslRules)
 * @returns {string|null}
 */
export function getDslRulesSync() {
  return _cachedDslRules;
}

/**
 * 预初始化 DSL 规则
 * @returns {Promise<string>}
 */
export async function initDslRules() {
  return getDslRules();
}

/**
 * 清除缓存 (用于测试或热更新)
 */
export function clearDslRulesCache() {
  _cachedDslRules = null;
  _loadPromise = null;
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

// 为了向后兼容，导出一个 getter
// 注意：首次访问时可能为 null，需要先调用 initDslRules()
export const DSL_RULES = new Proxy({}, {
  get(target, prop) {
    if (prop === Symbol.toPrimitive || prop === "toString" || prop === "valueOf") {
      return () => _cachedDslRules || FALLBACK_DSL_RULES;
    }
    if (prop === "length") {
      return (_cachedDslRules || FALLBACK_DSL_RULES).length;
    }
    return (_cachedDslRules || FALLBACK_DSL_RULES)[prop];
  },
  ownKeys() {
    return [];
  },
  getOwnPropertyDescriptor() {
    return { configurable: true, enumerable: true };
  },
});
