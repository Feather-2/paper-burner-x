# skills - 技能系统

Markdown 定义的指令包（SKILL.md），支持多路径加载、Catalog 展示与可选沙箱执行。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 统一导出（默认导出 SkillsManager；并导出 SkillScope + loader/render/sandbox API） |
| `manager.js` | SkillsManager 主类：注册/查询/执行入口 |
| `loader.js` | 加载路由（Env Router）：Node 扫描目录 / Browser 读取 manifest；对外暴露 `loadSkills`/`loadSkillFromPath`/`loadSkillsFromNexus`/`loadAllSkills` |
| `loader.browser.js` | Browser 加载实现：fetch manifest（默认 `skills/manifest.json`，fallback `public/skills/manifest.json`）+ 体积限制（manifest/skill）+ manifest 缓存（in-memory, TTL 30s）+ 元数据 key 防护 |
| `user-store.js` | Browser 用户技能存储适配（user scope） |
| `model.js` | SkillScope 枚举与类型定义 |
| `render.js` | 渲染 Skills Catalog（列表/区块） |
| `sandbox-adapter.js` | 沙箱执行适配器（风险分析/限权执行） |

## Skills vs Tools

| 维度 | Skills | Tools |
|------|--------|-------|
| 定义 | SKILL.md (Markdown) | JSON Schema |
| 调用 | 上层显式加载/展示/选择 | 模型直接调用 |
| 本质 | 策略/知识包（可被审计与隔离执行） | 原子执行单元 |

## 使用示例

```javascript
import SkillsManager, { loadAllSkills, renderSkillsSection } from 'js/agents/skills';

const manager = new SkillsManager();

// Node：扫描 repo/user 目录；Browser：从 manifest + user-store 加载
const { skills, errors } = await loadAllSkills();
manager.register(skills);

// 渲染给用户（Catalog）
const section = renderSkillsSection(manager.list());
```

## 沙箱执行

```javascript
import { analyzeSkillRisk, createSandboxedSkillsManager } from 'js/agents/skills';

const risk = analyzeSkillRisk(skillContent);
const runner = risk.level === 'high' ? createSandboxedSkillsManager(manager) : manager;

await runner.execute(skillName);
```

## Browser 默认限制

- manifest 最大: 512 KiB
- 单个 skill 最大: 2 MiB
- manifest 缓存: in-memory（TTL 30s，降低重复 fetch）

## 加载路径优先级

### Node

1. `repo/.paper-burner/skills/` - 仓库级
2. `~/.paper-burner/skills/` - 用户级
3. 系统内置 - 框架级

### Browser

1. manifest（默认 `skills/manifest.json`；fallback `public/skills/manifest.json`）
2. `user-store` - 用户级（浏览器侧持久化）
3. 系统内置 - 框架级
