# skills - 技能系统

Markdown 定义的指令包，支持多路径加载和沙箱执行。

## 核心文件

| 文件 | 职责 |
|------|------|
| `manager.js` | SkillsManager 主类 |
| `loader.js` | 技能加载器（repo > user > system） |
| `model.js` | SkillScope 枚举 |
| `render.js` | 渲染技能列表/区块 |
| `sandbox-adapter.js` | 沙箱执行适配器 |

## Skills vs Tools

| 维度 | Skills | Tools |
|------|--------|-------|
| 定义 | SKILL.md (Markdown) | JSON Schema |
| 调用 | 上层显式加载/展示 | 模型直接调用 |
| 本质 | 策略/知识包 | 原子执行单元 |

## 使用示例

```javascript
import { SkillsManager, loadAllSkills } from 'js/agents/skills';

const manager = new SkillsManager();
const skills = await loadAllSkills();
manager.register(skills);

// 渲染给用户
const section = renderSkillsSection(manager.list());
```

## 沙箱执行

```javascript
import { createSandboxedSkillsManager, analyzeSkillRisk } from 'js/agents/skills';

const risk = analyzeSkillRisk(skillContent);
if (risk.level === 'high') {
  const sandboxed = createSandboxedSkillsManager(manager);
  await sandboxed.execute(skillName);
}
```

## 加载路径优先级

1. `repo/.claude/skills/` - 仓库级
2. `~/.claude/skills/` - 用户级
3. 系统内置 - 框架级
