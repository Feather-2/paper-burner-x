# analysis - 行为分析

Agent 行为指纹 / 循环检测 与语义收敛检测（含指纹插件）。内部会使用 `createLogger` 输出诊断日志（`runtime/analysis/*`）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `behavior-fingerprint.js` | 行为签名与循环/重复序列检测（BehaviorFingerprint） |
| `convergence-detector.js` | 语义收敛检测（ConvergenceDetector：熵/相似度） |
| `fingerprint.js` | BehaviorFingerprint 的插件封装（kernel.use） |
| `index.js` | 模块导出 |

## 行为指纹

```javascript
import { BehaviorFingerprint } from 'js/agents/plugins/analysis';

const fingerprint = new BehaviorFingerprint({
  historySize: 100,
  minPatternLength: 2,
  maxPatternLength: 10,
  loopThreshold: 3,
});

const { loopDetected, loopInfo } = fingerprint.recordAction({
  type: 'tool:call',
  params: { query: 'foo', limit: 10 },
});

if (loopDetected) {
  console.warn('Agent may be stuck in a loop', loopInfo);
}

const suggestion = fingerprint.getSuggestion();
```

说明：
- 指纹签名默认只使用 `type/name` 与 `params/args` 的键结构（不包含具体值），用于降低敏感信息泄露风险并提高泛化能力。

## 上下文蒸馏

```javascript
import { ContextDistiller } from 'js/agents/plugins/analysis';

const distiller = new ContextDistiller({
  maxTokens: 2000,
  relevanceThreshold: 0.3,
});

const distilled = distiller.distill(parentContext, 'Summarize user intent');
```

如果当前模块未导出 `ContextDistiller`，请以 `index.js` 的实际导出为准。

## 收敛检测

检测输出是否语义收敛（内部会自动对旧浏览器降级分词/正则能力）：

```javascript
import { ConvergenceDetector } from 'js/agents/plugins/analysis';

const detector = new ConvergenceDetector({
  windowSize: 5,
  entropyThreshold: 0.3,
  similarityThreshold: 0.85,
});

const { converged, metrics } = detector.addSample(stepText);

if (converged || detector.isConverged()) {
  console.warn('Output converged', metrics);
}

const suggestion = detector.getSuggestion();
```

## 指纹插件

```javascript
import { fingerprintPlugin } from 'js/agents/plugins/analysis';

await kernel.use(fingerprintPlugin, {
  windowSize: 3,
  similarityThreshold: 0.5,
  maxHistory: 50,
});
... (12 more lines)
```
