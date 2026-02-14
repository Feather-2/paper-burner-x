# analysis - 行为分析

Agent 行为指纹 / 循环检测 与语义收敛检测（含指纹插件）。内部使用 `createLogger` 输出诊断日志（`runtime/analysis/*`）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `behavior-fingerprint.js` | 行为签名生成、重复子序列检测、连续循环检测、行为多样性统计 |
| `convergence-detector.js` | 基于熵与相似度的语义收敛检测（含旧浏览器 Unicode/分词降级） |
| `fingerprint.js` | `BehaviorFingerprint` 的插件封装（`createPlugin`）与类型定义 |
| `index.js` | 模块导出 |

## 行为指纹（BehaviorFingerprint）

默认配置：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `historySize` | `100` | 历史行为窗口大小 |
| `minPatternLength` | `2` | 最小模式长度 |
| `maxPatternLength` | `10` | 最大模式长度 |
| `loopThreshold` | `3` | 连续重复达到该阈值判定为循环 |

检测策略：
- 行为签名由 `type/name` + `params/args` 的键结构组成（不含具体值）。
- 支持重复子序列检测（`pattern/count/positions`）。
- 支持连续循环检测（用于“卡住”判断）。
- 维护有限历史窗口，避免无限增长。

```javascript
import { BehaviorFingerprint } from 'js/agents/plugins/analysis';

const fingerprint = new BehaviorFingerprint({
  historySize: 100,
  minPatternLength: 2,
  maxPatternLength: 10,
  loopThreshold: 3,
});

const result = fingerprint.recordAction({
  type: 'tool:call',
  params: { query: 'foo', limit: 10 },
});

if (result.loopDetected) {
  console.warn('Agent may be stuck in a loop', result.loopInfo);
}

const suggestion = fingerprint.getSuggestion();
```

输出要点：
- `loopInfo` 可用于定位循环模式（如 `pattern`、`count`、`startPosition`）。
- 统计信息用于调参与自动中止策略，不建议直接向终端用户暴露内部细节。

## 收敛检测（ConvergenceDetector）

默认配置：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `windowSize` | `5` | 收敛判定窗口 |
| `entropyThreshold` | `0.3` | 熵阈值（越低越可能收敛） |
| `similarityThreshold` | `0.85` | 相似度阈值 |

实现要点：
- 优先使用 Unicode 属性正则；不支持时自动降级到兼容字符范围。
- 非字符串输入按空样本处理（`tokenize` 返回空数组）。
- 通过熵 + 相似度联合判断是否收敛，并提供建议。

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

## 指纹插件（fingerprint.js）

插件封装方式：
- 基于 `createPlugin` 注入微内核。
- 在插件上下文中记录行为统计与循环检测结果。
- 输出诊断日志时应避免打印敏感参数值。

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

## 安全与兼容性约定

- 不在签名中存储参数具体值，降低敏感信息暴露风险。
- 保持 `historySize`、`windowSize` 在合理范围，避免极端配置带来性能抖动。
- 用户可见错误信息应友好化，不直接暴露内部堆栈。
- 模块采用 ES Modules；不依赖 `require`、`__dirname`、`__filename` 等 Node-only 语法。
