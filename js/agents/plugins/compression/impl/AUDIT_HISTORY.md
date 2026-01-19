# Audit History - impl

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] error-handling
*Archived: 2026-01-19T20:43:26.748Z*

- **File**: `js/agents/plugins/compression/impl/watchdog.js`:90
- **Description**: 空 catch 吞掉异常，违反“异常需记录或重新抛出”的约定，导致 BehaviorFingerprint 初始化失败不可见。
- **Suggestion**: 记录日志或通过 eventBus 发出告警；若无法恢复，考虑抛出或携带降级原因。
```
try {
  this._behaviorFingerprint = new BehaviorFingerprint(cfg);
} catch {
  this._behaviorFingerprint = null;
}
```

---

## Archived: 2026-01-19

### [RESOLVED] test-import-path
*Archived: 2026-01-19T20:43:13.943Z*

- **File**: `tests/unit/agents/runtime/compression/proactive-compressor.test.js`:6
- **Description**: 单测从 js/agents/runtime/compression/* 导入，但源码不存在该路径，测试会失败或被跳过，影响覆盖率。
- **Suggestion**: 将导入改为 `js/agents/plugins/compression/impl/proactive-compressor.js`，并同步修正 context-predictor/adaptive-zone-manager/quality-monitor 测试，或补充 re-export 文件。
```
import { ProactiveCompressor } from '../../../../../js/agents/runtime/compression/proactive-compressor.js';
```

---

## Archived: 2026-01-19

### [RESOLVED] jsdoc-any
*Archived: 2026-01-19T20:42:54.839Z*

- **File**: `js/agents/plugins/compression/impl/cicada-compressor.js`:12
- **Description**: JSDoc 选项类型使用 any，违反项目约定（需具体类型）。
- **Suggestion**: 改为具体接口类型（例如 {call: Function}|{chat: Function}），或用 unknown 并在使用处收窄。
```
* @property {any} [modelRouter]
```

---

## Archived: 2026-01-19

### [RESOLVED] prototype-pollution
*Archived: 2026-01-19T20:42:50.425Z*

- **File**: `js/agents/plugins/compression/impl/cicada-compressor.js`:364
- **Description**: compressValue 直接将外部数据的 key 写入普通对象；若 key 为 __proto__/constructor/prototype，会导致原型污染。tool 输出/LLM 结构化摘要可触发。
- **Suggestion**: 用 Object.create(null) 构造 result，并显式跳过 __proto__/constructor/prototype；或使用安全的 setKey 过滤危险键。
```
const result = {};
for (const [key, val] of entries) {
  ...
  result[key] = compressValue(val, options, stats, depth + 1);
}
```

---

