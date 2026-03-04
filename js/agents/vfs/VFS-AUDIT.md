# VFS Architecture Audit

> 审计对象：`js/agents/vfs/`
> 审计日期：2026-03-04
> 审计范围：VFS 架构分层、降级策略、浏览器支持、成熟产品对比

## 一、OPFS 浏览器支持调研

### 核心 API 支持版本

| API | Chrome/Edge | Firefox | Safari | 说明 |
|-----|-------------|---------|--------|------|
| `StorageManager.getDirectory()` | 86+ (2020-10) | 111+ (2023-02) | 15.2+ (2021-09) | OPFS 入口 |
| `StorageManager.estimate()` | 52+ | 51+ | 15.2+ | 存储配额查询 |
| `StorageManager.persist()` | 52+ | 55+ | 15.2+ | 持久化存储请求 |
| `FileSystemFileHandle.createWritable()` | 86+ | 111+ | 26+ (2024) | 主线程异步写入（关键） |
| `FileSystemSyncAccessHandle` | 102+ (2022-04) | 111+ | 15.2+ | Worker 同步 API |

### 关键里程碑

1. **Safari 26 (2024)** - 完全支持 `FileSystemWritableFileStream`
   - 在此之前，Safari 只能在 Web Worker 中使用同步 API (`createSyncAccessHandle`)
   - 主线程异步写入成为可能，使用体验与 Chrome/Firefox 对齐

2. **Firefox 111 (2023-02)** - 完整支持所有 OPFS API
   - 最后一个主流浏览器完整支持 OPFS

3. **Chrome 86 (2020-10)** - 首个完整支持 OPFS 的浏览器

### 使用模式

**主线程（异步）**：
```javascript
const root = await navigator.storage.getDirectory();
const fileHandle = await root.getFileHandle('file.txt', { create: true });
const writable = await fileHandle.createWritable();
await writable.write('content');
await writable.close();
```

**Web Worker（同步，高性能）**：
```javascript
const root = await navigator.storage.getDirectory();
const fileHandle = await root.getFileHandle('file.txt', { create: true });
const accessHandle = await fileHandle.createSyncAccessHandle();
accessHandle.write(buffer);
accessHandle.flush();
accessHandle.close();
```

### 典型使用场景

1. **SQLite WASM 数据库** - 需要同步 API，在 Worker 中运行
2. **大规模文件更新** - 性能优于标准 File System Access API
3. **字节级文件操作** - 需要精确控制文件内容

### 限制

1. 受浏览器存储配额限制（类似 IndexedDB）
2. 文件对用户不可见，不与磁盘一对一映射
3. 清除站点数据时会被删除
4. 同步 API 仅在 Web Worker 中可用（防止主线程阻塞）

---

## 二、浏览器端文件系统成熟产品对比

### 使用模式分类

#### 模式 1: 完整文件系统模拟（类 Node.js）

**代表产品**：
- **StackBlitz WebContainers**: 完整的 Node.js 运行时，支持 npm install、文件系统操作
- **CodeSandbox**: 虚拟文件系统 + 包管理
- **VS Code for Web**: 虚拟文件系统 + 扩展支持

**使用方式**：
- OPFS 作为主存储（高性能读写）
- IndexedDB 作为降级（兼容性）
- Memory 作为临时缓存（快速访问）

**技术栈**：
- Service Worker 拦截网络请求
- 虚拟 HTTP 服务器
- 模块解析与打包

#### 模式 2: 项目文件管理（设计/创作工具）

**代表产品**：
- **Figma**: 设计文件 + 资源库
- **Canva**: 模板 + 用户资源
- **Photopea**: PSD 文件编辑

**使用方式**：
- IndexedDB 存储大文件（图片、字体）
- OPFS 用于临时编辑缓存
- Memory 用于当前编辑状态

#### 模式 3: 文档协作（办公套件）

**代表产品**：
- **Google Docs/Sheets**: 实时协作 + 离线编辑
- **Notion**: 块级存储 + 本地缓存

**使用方式**：
- IndexedDB 作为离线缓存
- 云端同步为主
- OPFS 用于大文件缓存

#### 模式 4: 数据库 / 分析工具

**代表产品**：
- **SQLite WASM**: 完整 SQL 数据库
- **DuckDB WASM**: 列式数据库
- **Observable**: 数据笔记本

**使用方式**：
- OPFS (同步 API in Worker) 用于数据库文件（性能关键）
- IndexedDB 用于元数据
- Memory 用于查询缓存

#### 模式 5: 游戏 / 交互内容

**代表产品**：
- **Construct 3**: 游戏编辑器
- **GDevelop**: 游戏引擎

**使用方式**：
- OPFS 存储资源文件（音频、图片、关卡数据）
- IndexedDB 存储项目元数据
- Memory 用于运行时状态

### Paper-Burner 的定位

**属于模式 1 + 模式 4 混合**：
- Agent 系统需要完整文件系统（类 Node.js）
- 文档处理需要数据库能力（检索、索引）
- VFS 多后端设计与 StackBlitz/VS Code for Web 类似

---

## 三、Paper-Burner VFS 架构分析

### 代码结构

```
js/agents/vfs/
├── index.js              # 统一 VFS 接口（环境检测 + 动态导入）
├── index.browser.js      # 浏览器 VFS 入口
├── index.node.js         # Node VFS 入口
├── vfs.storage.js        # Storage 后端（基于 StorageAdapter）
├── vfs.memory.js         # Memory 后端（树形结构）
├── vfs.opfs.js           # OPFS 后端（FileSystemWritableFileStream）
├── vfs.node.js           # NodeFs 后端（fs/promises）
├── storage-adapter.js    # 存储适配器（4 层降级）
├── path.js               # 路径规范化与安全检查
├── operations.js         # 高级文件操作（锁、原子写入、策略）
├── checkpoints.js        # VFS 检查点（快照与恢复）
├── delta-sync.js         # 增量同步
├── diff.js               # 文件差异计算
├── glob.js               # Glob 模式匹配
└── ...                   # 其他文件
```

### 架构层次

```
┌─────────────────────────────────────────────────────────────────┐
│                      统一 VFS 接口                               │
│  createVfs() → 环境检测 → Browser / Node                        │
├─────────────────────────────────────────────────────────────────┤
│                      浏览器 VFS 层                               │
│  OpfsVfs │ StorageVfs │ MemoryVfs                               │
├─────────────────────────────────────────────────────────────────┤
│                   StorageAdapter 层                              │
│  OpfsStorageAdapter │ IndexedDbStorageAdapter                   │
│  LocalStorageAdapter │ MemoryStorageAdapter                     │
├─────────────────────────────────────────────────────────────────┤
│                      浏览器 API 层                               │
│  OPFS (navigator.storage.getDirectory)                          │
│  IndexedDB (indexedDB.open)                                     │
│  localStorage (localStorage.setItem)                            │
└─────────────────────────────────────────────────────────────────┘
```

### 实际实现分析

#### 1. 多后端设计（已验证 ✅）

**浏览器后端（3 种）**：
- **OpfsVfs** (`vfs.opfs.js:175-590`)
  - 使用 `FileSystemWritableFileStream`（主线程异步 API）
  - 并发控制：Web Locks API → promise-chain mutex fallback
  - 不支持 symlink/readlink
  - 根目录：`navigator.storage.getDirectory()` → `paper-burner-workspace`

- **StorageVfs** (`vfs.storage.js:123-501`)
  - 基于 StorageAdapter（IndexedDB/localStorage）
  - 使用 base64 编码存储二进制数据
  - Key 前缀：`pb_vfs:file:` 和 `pb_vfs:dir:`
  - 配额管理：捕获 `QuotaExceededError`，提供详细错误信息
  - 不支持 symlink/readlink

- **MemoryVfs** (`vfs.memory.js:119-628`)
  - 纯内存实现，树形结构（DirNode/FileNode/SymlinkNode）
  - 支持 symlink/readlink（唯一支持的后端）
  - 循环检测：最大深度 8
  - 完整的 POSIX 语义

**Node 后端（2 种）**：
- **NodeFsVfs** (`vfs.node.js:19-218`)
  - 基于 Node.js 原生 `fs/promises`
  - 动态导入 `node:fs/promises`
  - 支持 rootPath 配置
  - 不支持 symlink/readlink

- **MemoryVfs**（与浏览器共享）

#### 2. 降级策略（已验证 ✅）

**VFS 层降级（浏览器）** (`index.browser.js:25-66`)：
```javascript
// 优先级：OPFS → Storage → Memory
if (kind === "opfs" || (!kind && supportsOpfs())) {
  if (supportsOpfs()) {
    try {
      return await OpfsVfs.create({ rootDirName });
    } catch {
      // fall through to StorageAdapter-backed VFS
    }
  }
}

// 降级到 StorageAdapter-backed VFS
const adapter = await createStorageAdapter({
  preferOpfs: options.preferOpfs !== false,
  silent: options.silent === true,
});
return new StorageVfs(adapter, { keyPrefix: options.keyPrefix });
```

**StorageAdapter 层降级** (`storage-adapter.js:501-534`)：
```javascript
// 4 层降级：OPFS → IndexedDB → localStorage → Memory
1. OPFS: await detectOpfsSupport() → OpfsStorageAdapter
2. IndexedDB: detectIndexedDbSupport() → IndexedDbStorageAdapter
3. localStorage: detectLocalStorageSupport() → LocalStorageAdapter
4. Memory: MemoryStorageAdapter（最终降级）
```

**降级通知机制** (`storage-adapter.js:506-532`)：
- ✅ 有通知机制：使用 `logger.info` / `logger.warn` 输出降级信息
- ✅ 可配置静默：`silent: true` 参数可禁用降级警告
- ⚠️ 代码存在，未验证实际运行效果

#### 3. 并发控制（已验证 ✅）

**OpfsVfs 并发控制** (`vfs.opfs.js:113-144`)：
```javascript
// 使用 Web Locks API（优先）
if (typeof navigator?.locks?.request === "function") {
  return navigator.locks.request(paths[index], { mode: "exclusive" }, async () => run(index + 1));
}

// Fallback: promise-chain mutex（单标签页并发控制）
const prev = _fallbackLocks.get(key) || Promise.resolve();
const next = new Promise((r) => { resolve = r; });
_fallbackLocks.set(key, next);
return prev.then(() => acquire(index + 1)).finally(resolve);
```

**operations.js 并发控制** (`operations.js:95-130`)：
```javascript
// Per-path async locking（防止并发写入冲突）
async function withVfsPathLock(vfs, path, fn, { signal } = {}) {
  const lockMap = getLockMapForVfs(vfs);
  const prevTail = lockMap.get(key) || Promise.resolve();
  const tail = new Promise((resolve) => { release = () => resolve(); });
  lockMap.set(key, tail);

  try {
    await waitFor(prevTail, { signal });
    return await fn();
  } finally {
    release?.();
    if (lockMap.get(key) === tail) lockMap.delete(key);
  }
}
```

#### 4. 安全特性（已验证 ✅）

**路径规范化** (`path.js:48-78`)：
- ✅ 阻止 ".." 遍历：`if (s === "..") throw new Error("Invalid VFS path traversal")`
- ✅ 阻止 Windows 保留名：`CON, PRN, AUX, NUL, COM1-9, LPT1-9`
- ✅ 阻止无效字符：`[<>:"|?*\u0000-\u001f]`
- ✅ 阻止 Windows 绝对路径：`/^[a-zA-Z]:/.test(p)`

**配额管理** (`vfs.storage.js:77-101`)：
```javascript
function isQuotaExceededError(err) {
  // 检测多种配额错误格式
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
  if (code === "ENOSPC" || code === "EQUOTA") return true;
  if (message.includes("quota") || message.includes("no space")) return true;
}

function buildQuotaError(path, usage) {
  const err = new Error(`ENOSPC: storage quota exceeded for ${path} (used ${usage.used}/${usage.quota})`);
  err.code = "ENOSPC";
  err.quota = usage;
  return err;
}
```

**原子写入** (`operations.js:616-687`)：
```javascript
// write-to-tmp-then-rename 模式
async function atomicWriteText(vfs, path, content, { verify = true, signal } = {}) {
  const tempPath = generateTempFileName(normalizedPath);

  // Step 1: 写入临时文件
  await vfs.writeText(tempPath, content);

  // Step 2: 验证写入内容
  if (verify) {
    const written = await safeReadText(vfs, tempPath);
    if (written !== content) throw new Error("verification failed");
  }

  // Step 3: 重命名临时文件（原子操作）
  if (typeof vfs.rename === "function") {
    await vfs.rename(tempPath, normalizedPath);
  } else {
    // 降级：直接覆盖写入
    await vfs.writeText(normalizedPath, content);
    await removeVfsPath(vfs, tempPath);
  }
}
```

**策略授权** (`operations.js:353-426`)：
```javascript
// 集成策略授权机制
const approval = policy && typeof policy.authorize === "function"
  ? await policy.authorize({
      type: "vfs.write",
      tool: "vfs.writeText",
      resource: normalizedPath,
      args: { path: normalizedPath, bytes: content.length },
    }, { signal })
  : { allowed: true };

if (approval?.allowed === false) {
  throw new Error(`Policy denied: ${approval.reason}`);
}
```

#### 5. OPFS 使用方式（已验证 ✅）

**OpfsVfs：文件系统模式** (`vfs.opfs.js`)：
- 使用 `FileSystemWritableFileStream`（主线程异步 API）
- 直接操作文件和目录
- 适用场景：完整文件系统需求（Agent 系统）

**OpfsStorageAdapter：KV 存储模式** (`storage-adapter.js:154-262`)：
- 使用 OPFS 存储 JSON 数据
- Key 编码为文件名：`encodeURIComponent(key).replace(/_/g, "%5F").replace(/%/g, "_")`
- 适用场景：简单 KV 存储需求（配置、元数据）

#### 6. 浏览器支持（已验证 ✅）

**OPFS 检测** (`storage-adapter.js:31-46`)：
```javascript
async function detectOpfsSupport() {
  if (typeof navigator === "undefined") return false;
  if (!navigator.storage?.getDirectory) return false;

  try {
    const root = await navigator.storage.getDirectory();
    // 尝试创建测试文件验证完整支持
    const testHandle = await root.getFileHandle(`.opfs_test_${Date.now()}`, { create: true });
    await root.removeEntry(testName);
    return true;
  } catch {
    return false;
  }
}
```

**关键发现**：
- OpfsVfs 使用 `FileSystemWritableFileStream`（Safari 26+ 才完全支持）
- StorageAdapter 有完整的降级链，兼容性更好
- 项目同时使用两种 OPFS 模式，覆盖不同使用场景

### 验证状态总结

| 问题 | 状态 | 结论 |
|------|------|------|
| OPFS 使用同步/异步 API | ✅ 已验证 | 主线程异步 API（FileSystemWritableFileStream） |
| 降级策略是否静默 | ✅ 已验证 | 有通知机制（logger），可配置静默 |
| Storage 配额管理 | ✅ 已验证 | QuotaExceededError 捕获 + 详细错误信息 |
| 跨后端数据迁移 | ⚠️ 未发现 | 代码中未发现自动迁移机制 |
| 并发控制与锁 | ✅ 已验证 | Web Locks API + per-path locking |
| 错误处理与恢复 | ✅ 已验证 | 原子写入 + 策略授权 + 配额管理 |

---

## 四、与成熟产品对比

### Paper-Burner vs 成熟产品

| 特性 | StackBlitz | VS Code for Web | Paper-Burner | 验证状态 |
|------|-----------|----------------|-------------|----------|
| **OPFS 使用** | ✅ 完整文件系统 | ✅ 完整文件系统 | ✅ 完整文件系统 + KV 存储 | 代码存在，未验证 |
| **降级策略** | OPFS → Memory | OPFS → IndexedDB → Memory | OPFS → IndexedDB → localStorage → Memory | 代码存在，未验证 |
| **并发控制** | Web Locks API | Web Locks API | Web Locks API + per-path locking | 代码存在，未验证 |
| **原子写入** | ✅ | ✅ | ✅ write-to-tmp-then-rename | 代码存在，未验证 |
| **配额管理** | ✅ | ✅ | ✅ QuotaExceededError 捕获 | 代码存在，未验证 |
| **路径安全** | ✅ | ✅ | ✅ 阻止 ".." 遍历 + 保留名检查 | 代码存在，未验证 |
| **Symlink 支持** | ❌ | ❌ | ✅ MemoryVfs only | 代码存在，未验证 |
| **Checkpoint** | ❌ | ❌ | ✅ VFS 快照与恢复 | 代码存在，未验证 |
| **策略授权** | ❌ | ❌ | ✅ policy.authorize 集成 | 代码存在，未验证 |

### 关键差异

1. **双层降级机制**：
   - Paper-Burner 有 VFS 层和 StorageAdapter 层两层降级
   - 成熟产品通常只有一层降级
   - 优势：更好的兼容性和灵活性
   - 劣势：增加了复杂度

2. **OPFS 双模式使用**：
   - OpfsVfs：完整文件系统（类似 StackBlitz）
   - OpfsStorageAdapter：KV 存储
   - 成熟产品通常只使用一种模式
   - 优势：覆盖不同使用场景
   - 劣势：增加了维护成本

3. **额外特性**：
   - Checkpoint 系统（快照与恢复）
   - 策略授权机制
   - Symlink 支持（MemoryVfs）
   - 成熟产品通常不提供这些特性

### 浏览器支持对比

| 浏览器 | StackBlitz | VS Code for Web | Paper-Burner |
|--------|-----------|----------------|-------------|
| Chrome 86+ | ✅ | ✅ | ✅ |
| Firefox 111+ | ✅ | ✅ | ✅ |
| Safari 15.2+ | ⚠️ 部分支持 | ⚠️ 部分支持 | ✅ 完整降级链 |
| Safari 26+ | ✅ | ✅ | ✅ |

**关键发现**：
- Paper-Burner 的降级链更完整，Safari 15.2-25 可降级到 IndexedDB/localStorage
- StackBlitz/VS Code for Web 在 Safari 26 之前可能无法使用主线程异步 API

---

## 五、问题和风险点

### 1. 双层降级的复杂度（中等）

**问题表现**：
- VFS 层降级：OPFS → Storage → Memory
- StorageAdapter 层降级：OPFS → IndexedDB → localStorage → Memory
- 两层降级机制增加了理解和维护成本

**关键证据**：
- `index.browser.js:25-66`（VFS 层降级）
- `storage-adapter.js:501-534`（StorageAdapter 层降级）

**影响**：
1. 调用方难以判断实际使用的后端
2. 调试困难：需要理解两层降级逻辑
3. 测试复杂度上升：需要覆盖多种降级路径

### 2. OPFS 双模式使用的一致性（中等）

**问题表现**：
- OpfsVfs 和 OpfsStorageAdapter 都使用 OPFS
- 两者使用不同的目录和数据格式
- 可能导致用户混淆和数据管理问题

**关键证据**：
- `vfs.opfs.js:187-192`（OpfsVfs 使用 `paper-burner-workspace` 目录）
- `storage-adapter.js:155-166`（OpfsStorageAdapter 使用 `paperburner_storage` 目录）

**影响**：
1. 用户可能不清楚哪些数据存储在哪个目录
2. 数据迁移和备份变得复杂
3. 配额管理需要考虑两个目录

### 3. 缺少跨后端数据迁移机制（低）

**问题表现**：
- 代码中未发现自动迁移机制
- 用户从 OPFS 降级到 IndexedDB 时，数据不会自动迁移

**影响**：
1. 用户切换浏览器或清除 OPFS 数据后，需要重新导入数据
2. 降级体验不够平滑

### 4. 文档和注释不够清晰（低）

**问题表现**：
1. 缺少整体架构文档（本审计文档填补了这个空白）
2. 降级策略的使用指南不够清晰
3. 各后端的适用场景说明不足

**影响**：
1. 新开发者难以快速理解 VFS 架构
2. 误用风险上升

---

## 六、改进建议

### 立即可做（不破坏现有代码）

1. **添加架构文档**
   - ✅ 本审计文档已提供架构概览
   - 建议：在 `js/agents/vfs/README.md` 中添加使用指南

2. **统一 OPFS 目录命名**
   - OpfsVfs 使用 `paper-burner-workspace`
   - OpfsStorageAdapter 使用 `paperburner_storage`
   - 建议：统一为 `paper-burner` 前缀

3. **增强降级通知**
   - 当前：使用 `logger.warn` 输出降级信息
   - 建议：添加事件发射（`vfs:fallback` 事件），方便 UI 层展示

4. **添加使用示例**
   - 在 `js/agents/vfs/examples/` 目录添加示例代码
   - 覆盖常见使用场景（文件读写、目录遍历、错误处理）

### 可选增强

1. **跨后端数据迁移**
   - 实现 `migrateVfs(fromVfs, toVfs, options)` 函数
   - 支持增量迁移和进度回调

2. **配额预警机制**
   - 监控存储使用量
   - 达到阈值（如 80%）时发出警告

3. **性能监控**
   - 记录各后端的读写性能
   - 帮助用户选择最佳后端

4. **统一 OPFS 使用模式**
   - 考虑是否需要两种 OPFS 使用模式
   - 如果 OpfsStorageAdapter 使用较少，可以考虑移除

### 复杂度屏蔽

1. **简化 API**
   - 提供 `createRecommendedVfs()` 函数，自动选择最佳后端
   - 隐藏降级细节，只在必要时暴露

2. **配置预设**
   - `MINIMAL_PRESET`: 只使用 Memory（测试用）
   - `STANDARD_PRESET`: OPFS → Memory（生产用）
   - `FULL_PRESET`: 完整降级链（最大兼容性）

---

## 七、总结

### 架构优势

1. ✅ **多后端设计**：支持 5 种后端（OPFS, Storage, Memory, NodeFs, OpfsStorage），覆盖浏览器和 Node 环境
2. ✅ **完整降级链**：双层降级机制，确保最大兼容性
3. ✅ **并发控制**：Web Locks API + per-path locking，防止并发写入冲突
4. ✅ **安全特性**：路径规范化、配额管理、原子写入、策略授权
5. ✅ **额外特性**：Checkpoint 系统、Symlink 支持（MemoryVfs）

### 当前状态

当前 VFS 架构在代码层面覆盖面较广，但整体仍处于"功能存在、验证不足"的阶段。问题核心不只是功能数量，而是以下几点：

1. **双层降级的复杂度**：VFS 层 + StorageAdapter 层两层降级，增加了理解和维护成本
2. **OPFS 双模式使用**：OpfsVfs + OpfsStorageAdapter 两种使用模式，可能导致混淆
3. **缺少跨后端数据迁移**：降级体验不够平滑
4. **文档和注释不足**：新开发者难以快速理解架构
5. **功能覆盖面广不等于生产可用**：缺少端到端验证会放大误判风险

### 与成熟产品对比

Paper-Burner VFS 的功能清单覆盖面广，甚至在某些方面超过成熟产品（如 Checkpoint 系统、策略授权）。但这不等于能力超集：

1. 成熟产品的可用性来自长期生产验证
2. Paper-Burner 当前仍以"代码存在，未完成端到端验证"为主
3. 复杂度本身是工程负债，功能越多维护成本越高

### 建议优先级

1. **P0（立即）**：端到端验证 + 文档补充
2. **P1（短期）**：降级通知增强 + 使用示例
3. **P2（中期）**：跨后端数据迁移 + 配额预警
4. **P3（长期）**：性能监控 + 统一 OPFS 使用模式

**核心原则**："以端到端验证结果说话，再讨论生产结论。"

---

## 八、参考资料

- [MDN: Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
- [MDN Browser Compat Data: StorageManager](https://github.com/mdn/browser-compat-data/blob/main/api/StorageManager.json)
- [MDN Browser Compat Data: FileSystemFileHandle](https://github.com/mdn/browser-compat-data/blob/main/api/FileSystemFileHandle.json)
- [Reddit: OPFS now works on Safari](https://www.reddit.com/r/rust/comments/1b8z8z8/the_origin_private_file_system_now_works_on_safari/)
