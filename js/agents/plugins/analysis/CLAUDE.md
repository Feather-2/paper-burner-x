# analysis - 行为分析

Agent 行为指纹 / 循环检测 与语义收敛检测（含指纹插件）。内部会使用 `createLogger` 输出诊断日志（`runtime/analysis/*`）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `behavior-fingerprint.js` | 行为签名与循环/重复序列检测（BehaviorFingerprint） |
| `convergence-detector.js` | 语义收敛检测（ConvergenceDetector：熵/相似度） |
| `fingerprint.js` | BehaviorFingerprint 的插件封装（基于 `createPlugin`） |
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
- 行为签名默认只使用 `type/name` 与 `params/args` 的键结构（不包含具体值），用于降低敏感信息泄露风险并提高泛化能力。
- 建议保持 `historySize` 在合理范围（默认 100），避免模式检测在极端配置下造成卡顿。

## 收敛检测

检测输出是否语义收敛（内部会对旧浏览器降级 Unicode 属性正则与分词能力）：

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

说明：
- 输入应为字符串；非字符串会被当作空样本处理（tokenize 返回空数组）。
- `metrics` 用于调参与自动停止建议；对用户可见输出时避免直接暴露原始文本/堆栈。

## 指纹插件

将 `BehaviorFingerprint` 以插件形式接入内核（`createPlugin` 封装）。当检测到循环/重复模式时，插件通常会：
- 在 `PluginContext` 中记录统计信息
- 输出诊断日志（不应包含敏感参数值）
- 提供停止/改写建议（`getSuggestion()`）

示例（为避免 `index.js` 导出名变更导致文档失真，优先按文件路径导入；也可按项目习惯从 `index.js` 导出导入）：

```javascript
import fingerprintPlugin from 'js/agents/plugins/analysis/fingerprint.js';

kernel.use(
  fingerprintPlugin({
    historySize: 100,
    minPatternLength: 2,
    maxPatternLength: 10,
    loopThreshold: 3,
  })
);
```

如果项目采用命名导出，请以 `index.js` 的实际导出为准（例如 `import { fingerprintPlugin } from 'js/agents/plugins/analysis'`）。