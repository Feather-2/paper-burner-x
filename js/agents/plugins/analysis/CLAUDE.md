# analysis - 行为分析

Agent 行为指纹、上下文蒸馏和语义收敛检测。

## 核心文件

| 文件 | 职责 |
|------|------|
| `behavior-fingerprint.js` | 行为指纹检测、上下文蒸馏 |
| `convergence-detector.js` | 语义收敛检测 (检测收敛/卡住) |

## 行为指纹

```javascript
import { BehaviorFingerprint } from 'js/agents/runtime/analysis';

const fingerprint = new BehaviorFingerprint({
  historySize: 100,
  loopThreshold: 3,
});

const { loopDetected, loopInfo } = fingerprint.recordAction({
  type: 'tool:call',
  params: { query: 'foo' },
});

if (loopDetected) {
  console.warn('Agent may be stuck in a loop', loopInfo);
}

const suggestion = fingerprint.getSuggestion();
```

## 上下文蒸馏

```javascript
import { ContextDistiller } from 'js/agents/runtime/analysis';

const distiller = new ContextDistiller({
  maxTokens: 2000,
  relevanceThreshold: 0.3,
});

const distilled = distiller.distill(parentContext, 'Summarize user intent');
```

## 收敛检测

检测输出是否语义收敛：

```javascript
import { ConvergenceDetector } from 'js/agents/runtime/analysis';

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
