# refiner (design) - 精调

QA 验证和精调。

## 核心文件

| 文件 | 职责 |
|------|------|
| `qa-validator.js` | validateSlide - 质量验证 |
| `react-refiner.js` | runReactRefiner - ReAct 精调 |
| `react-refiner-tools.js` | 精调工具定义 |

## QA 验证

```javascript
import { validateSlide } from 'js/agents/stages/design/refiner';

const issues = validateSlide(slide, {
  checkContrast: true,
  checkTextLength: true,
  checkImageQuality: true,
});

if (issues.length > 0) {
  console.log('Issues found:', issues);
}
```

## ReAct 精调

```javascript
import { runReactRefiner } from 'js/agents/stages/design/refiner';

const refined = await runReactRefiner(slide, {
  llm,
  maxIterations: 3,
  qualityThreshold: 0.9,
});
```
