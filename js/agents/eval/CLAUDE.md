# eval - 内容质量评估框架

可扩展的插件化内容评估系统，支持自定义评估器注册。

## 核心类

### EvaluateStage

```javascript
import { EvaluateStage } from 'js/agents/eval';

const stage = new EvaluateStage({
  passThreshold: 0.6,   // 通过阈值
  strict: false,        // 严格模式（有 error 即不通过）
  dimensions: null,     // 启用的维度（null = 全部）
  dimensionConfig: {    // 维度权重配置
    accuracy: { weight: 2 },
  },
});

const result = await stage.run(ctx, {
  content: '待评估内容',
  original: '原始输入（用于相关性评估）',
  context: { type: 'report' },
});

// result: { passed, score, issues, dimensions }
```

## 内置评估器

| 维度 | 评估内容 | 检测问题 |
|------|----------|----------|
| **completeness** | 完整性 | 内容过短、缺少结构（标题） |
| **accuracy** | 准确性 | 占位符 (TODO/TBD)、未完成句子 |
| **clarity** | 清晰度 | 段落过长、内容重复 |
| **relevance** | 相关性 | 与原始输入词汇重叠度低 |

## 自定义评估器

```javascript
stage.registerEvaluator('security', (content, input, config) => ({
  score: content.includes('password') ? 0.5 : 1.0,
  issues: content.includes('password')
    ? [{ type: 'sensitive_data', severity: 'error', message: 'Contains password' }]
    : [],
}));
```

## 类型定义

```typescript
interface EvaluationResult {
  passed: boolean;           // 是否通过
  score: number;             // 总分 (0-1)
  issues: EvaluationIssue[]; // 问题列表
  dimensions: Record<string, number>; // 各维度得分
}

interface EvaluationIssue {
  type: string;              // 问题类型
  severity: 'error' | 'warning' | 'info';
  message: string;
  location?: string;
}

type Evaluator = (
  content: string,
  input: EvaluationInput,
  config: EvaluatorConfig
) => EvaluatorResult | Promise<EvaluatorResult>;
```

## API

| 方法 | 说明 |
|------|------|
| `run(ctx, input)` | 执行评估 |
| `registerEvaluator(name, fn, config?)` | 注册自定义评估器 |
| `unregisterEvaluator(name)` | 移除评估器 |
| `getEvaluatorNames()` | 获取所有评估器名称 |

## 使用场景

- Agent 输出质量把关
- PPT 内容完整性检查
- 报告生成后自动审核
- 回归测试基准
