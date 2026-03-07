# js/agents 修复回看审计（2026-03-07）

- **范围**: `b094426e` → `7b8d101b` 之间的 agents 修复提交，以及这些提交触及的 `js/agents/**`、对应 `tests/**`
- **目的**: 检查是否存在“拍平逻辑”“降低语义精度”“`any/unknown` 逃避问题”“测试迁就实现”等异味
- **假设**: 允许在边界层使用 `unknown` 做输入接收，但必须就地收窄；不接受把领域契约长期退化成 `any` 或宽泛 record

## 1. 审计对象

本次重点审计以下提交：

- `b094426e` `fix(agents): 降低首批 tsc 噪音`
- `fecf128d` `test(agents): 增加启动 smoke 与基础 e2e`
- `3274366d` `fix(agents): 打通 core 剩余失败测试`
- `2a1ed314` `fix(agents): 清理非 core 测试回归`
- `989b6704` `refactor(agents): 收紧回归修复的类型契约`
- `7b8d101b` `refactor(agents): 恢复 trace fallback 的精确语义`

## 2. 审计结论（先看）

结论很直接：**此前修复里确实出现过 4 处有异味的改动模式**，这 4 处都已修正；此外审计中又发现 3 处随机/ID fallback 的存量异味，现也已完成第二轮治理。

### 已确认并修正的问题

1. **`event-bus` 把 archive 契约拍平成 `any`**
   - 位置：`js/agents/core/event-bus.js:57-64,97,178`
   - 问题：为了压 TSC 噪音，把 archive 对象直接放宽成 `any`
   - 风险：`list/load/save/delete` 的真实契约消失，后续字段漂移很难暴露
   - 处理：已引入 `EventBusArchive` / `EventBusArchiveSnapshot`

2. **`state-bus` 把 archive 契约拍平成 `any`**
   - 位置：`js/agents/core/state-bus.js:44-58,187`
   - 问题：同样是把 archive 长期放宽成 `any`
   - 风险：状态快照恢复、持久化双写路径没有静态约束
   - 处理：已引入 `StateBusArchive` / `StateBusArchiveSnapshot`，并使用 `StateRecord` + `asStateRecord()` 收窄

3. **npm event payload map 被压扁成宽泛 record**
   - 位置：`js/agents/core/node-compat/npm/index.js:23-53,209-239`
   - 问题：`install:start/progress/complete/...` 的 payload 不再按事件区分
   - 风险：事件总线监听侧失去类型约束，错误更晚暴露
   - 处理：已恢复精确的 `EventPayloadMap` 与 `PackageManagerEventName`

4. **trace fallback 被拍平成 `Math.random()`**
   - 位置：`js/agents/plugins/telemetry/trace-context.js:20-21,46-75`
   - 问题：无 WebCrypto 时，fallback 从内部 PRNG + counter 退化成 `Math.random()`
   - 风险：降低 fallback 的可解释性和碰撞控制，属于行为语义降级
   - 处理：已恢复为 `xorshift32 + counter + 时间扰动` 的明确非加密 fallback

## 3. 审计后确认“可接受”的改动

这些改动看起来像“放松测试”，但审查后判断为**修正测试对实现细节的过度绑定**，不是降标：

1. **新增 compression 事件/阶段常量后，hook/middleware 测试同步扩容**
   - `tests/integration/agents/runtime/hooks/hook-event.test.js:10-11`
   - `tests/unit/agents/runtime/hooks/hook-registry.test.js:31-32`
   - `tests/unit/agents/runtime/core/middleware/middleware-chain.test.js:75,80`
   - 判断：这是公开枚举新增后的测试追认，不是放松标准

2. **`L3Storage` timeline 断言改为 `objectContaining`**
   - `tests/unit/agents/runtime/memory/l3-storage.test.js:78`
   - 原因：timeline 新增 `accessCount` 元数据
   - 判断：此处只放松了“必须字段完全相等”，保留了核心业务字段校验，合理

3. **`DesignBlackboard` runId 改为前缀匹配**
   - `tests/unit/agents/stages/design/runtime/design-blackboard.test.js:141`
   - 原因：runId 生成增加了随机/后缀策略
   - 判断：如果外部契约只要求 `design_` 命名空间，测试不应写死整串值

4. **platform capability 在 Node 侧返回 true**
   - `js/agents/runtime/tools/platform/index.js:85-118`
   - 判断：这里不是把所有环境拍平成 true；当前行为是“Node 侧按平台工具抽象视为可提供该能力，Browser 仍保留运行时探测”。这是抽象层语义，不是简单拍平。

## 4. 第二轮治理：随机 / ID fallback 统一化

审计后继续治理了 3 个“不是这轮引入、但味道一致”的存量点，并统一到共享 fallback 策略：

1. **`trace-propagator` 的随机 ID fallback**
   - 位置：`js/agents/core/contracts/trace-propagator.js:68-82,240-241`
   - 原问题：直接使用 `Math.random()`
   - 处理：改为复用 `shared/utils/secure-id.js` 中的 `nonCryptoRandomHex()`

2. **`message-bus` 的 RPC/request ID**
   - 位置：`js/agents/core/message-bus.js:69-85,363`
   - 原问题：`createRpcId()` / `createReplyToEventName()` 直接使用 `Math.random()`
   - 处理：改为复用 `nonCryptoRandomHex()`，保留原命名结构但提升 fallback 一致性

3. **`plugins/context/io.js` 的 ULID fallback**
   - 位置：`js/agents/plugins/context/io.js:29,63`
   - 原问题：文档和实现都明确写了 `Math.random()` 回退
   - 处理：改为复用 `fillNonCryptoRandomBytes()`，并更新注释为“共享非加密 PRNG”

为支撑这轮统一化，还在：

- `js/agents/shared/utils/secure-id.js`

中新增了共享 fallback 能力：

- `fillNonCryptoRandomBytes(buf)`
- `nonCryptoRandomHex(bytes)`

## 5. 验证结果

本轮“回看并纠偏”后的验证：

- 类型与契约修复验证通过：
  - `tests/unit/agents/core/event-bus.test.js`
  - `tests/unit/agents/core/state-bus.test.js`
  - `tests/unit/agents/core/node-compat/npm/index.test.js`
- trace fallback 修复验证通过：
  - `tests/unit/agents/plugins/telemetry/trace-context.test.js`
  - `tests/integration/agents/runtime/telemetry.test.js`
- 第二轮随机/ID fallback 统一化验证通过：
  - `tests/unit/agents/shared/utils/secure-id.test.js`
  - `tests/unit/agents/core/contracts/trace-propagator.test.js`
  - `tests/unit/agents/core/message-bus.test.js`
  - `tests/unit/agents/plugins/context/io.test.js`
- `npx tsc -p js/agents/tsconfig.json --pretty false`
  - 仍未全绿，但上述审计修复涉及的文件已不再报错

## 6. 审计结论

这次完整回看后的判断：

- **用户的担忧成立**：之前的确出现过“为了先过关而拍平类型/行为”的修法
- **当前已纠正的部分**：7 处（首轮 4 处 + 第二轮 3 处）
- **当前保留但已审查为合理的测试修正**：4 处
- **本审计报告范围内剩余未处理的同类异味**：0 处

## 7. 建议的后续规则

后续修复 `js/agents` 时，执行以下硬规则：

1. 不允许把明确接口长期降成 `any`
2. 不允许把判别联合或事件 map 压扁成宽泛 record
3. 不允许为了兼容测试把 fallback 路径拍平成更弱实现
4. 测试允许去除“实现细节绑定”，但不允许降低业务契约覆盖
5. 涉及随机 ID/trace ID 的 fallback，优先统一到共享策略，避免模块间语义分叉

---

> 本文件是“修复回看审计”，不是全仓代码质量总审计。后续如继续推进，可按本报告第 4 节的 3 个存量异味继续开第二轮专项治理。
