/**
 * _init-root.js — 设置项目根目录 env（side-effect module）
 *
 * 必须在 @pb/context-cli/lib/utils.js 加载前 import，
 * 确保 _PB_CONTEXT_ROOT 在 utils 评估 ROOT 时已就绪。
 */
import { resolve } from 'node:path';
if (!process.env._PB_CONTEXT_ROOT) {
  process.env._PB_CONTEXT_ROOT = resolve(import.meta.dirname, '..');
}
