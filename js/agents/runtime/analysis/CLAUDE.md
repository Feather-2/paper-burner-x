# analysis - 行为分析

Agent 行为指纹和收敛检测。

## 核心文件

| 文件 | 职责 |
|------|------|
| `behavior-fingerprint.js` | 行为指纹生成 |
| `convergence-detector.js` | 收敛检测 (检测循环/卡住) |

## 行为指纹

```javascript
import { BehaviorFingerprint } from 'js/agents/runtime/analysis';

const fingerprint = new BehaviorFingerprint();
fingerprint.observe(agentActions);

const similarity = fingerprint.compare(otherFingerprint);
```

## 收敛检测

检测 Agent 是否陷入循环：

```javascript
import { ConvergenceDetector } from 'js/agents/runtime/analysis';

const detector = new ConvergenceDetector({
  windowSize: 5,
  threshold: 0.9,
});

detector.observe(step);
if (detector.isConverged()) {
  console.warn('Agent may be stuck in a loop');
}
```
