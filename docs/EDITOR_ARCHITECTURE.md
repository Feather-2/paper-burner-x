# PPT 编辑器架构设计

> 版本: 1.0 | 日期: 2024-12-03

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              应用层 (Application)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Editor    │  │   Panels    │  │   Toolbar   │  │   AI Assistant      │ │
│  │  (编辑器)   │  │  (面板)     │  │  (工具栏)   │  │   (AI 助手)         │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                │                    │            │
├─────────┴────────────────┴────────────────┴────────────────────┴────────────┤
│                              核心层 (Core)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Document   │  │   History   │  │  Selection  │  │   Task Queue        │ │
│  │  (文档)     │  │  (历史)     │  │  (选择)     │  │   (任务队列)        │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                │                    │            │
├─────────┴────────────────┴────────────────┴────────────────────┴────────────┤
│                              数据层 (Data)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Slide[]    │  │   Assets    │  │  Projects   │  │   Cloud Sync        │ │
│  │  (幻灯片)   │  │  (资源)     │  │  (项目)     │  │   (云同步-预留)     │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                │                    │            │
├─────────┴────────────────┴────────────────┴────────────────────┴────────────┤
│                              存储层 (Storage)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────┐  ┌─────────────────────────────────────┐   │
│  │        IndexedDB            │  │           File System API           │   │
│  │  (项目/资源/历史)           │  │         (大文件-预留)               │   │
│  └─────────────────────────────┘  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 文件结构

```
js/ppt/
├── core/                           # 核心数据层
│   ├── document.js                 # 文档管理（Slide[] 数据源）
│   ├── slide-schema.js             # Slide/Element 类型定义
│   ├── element-factory.js          # 元素创建工厂
│   └── serializer.js               # JSON/HTML 序列化
│
├── storage/                        # 存储层
│   ├── storage-manager.js          # 存储统一入口
│   ├── project-store.js            # 项目存储 (IndexedDB)
│   ├── asset-store.js              # 资源存储 (IndexedDB + 分块)
│   ├── history-store.js            # 历史存储 (操作日志)
│   └── cache-manager.js            # 缓存管理 (LRU)
│
├── editor/                         # 编辑器层
│   ├── slide-editor.js             # 编辑器主类
│   ├── selection-manager.js        # 选择管理
│   ├── transform-controller.js     # 变换控制
│   ├── clipboard.js                # 剪贴板
│   ├── keyboard-shortcuts.js       # 快捷键
│   └── panels/                     # 面板
│       ├── layer-panel.js          # 图层面板
│       ├── property-panel.js       # 属性面板
│       ├── asset-panel.js          # 资源面板
│       └── history-panel.js        # 历史面板
│
├── history/                        # 历史管理
│   ├── history-manager.js          # 撤销/重做管理
│   ├── operation.js                # 操作定义
│   ├── snapshot-manager.js         # 快照管理
│   └── conflict-resolver.js        # 冲突解决（预留）
│
├── tasks/                          # 任务系统（长时间任务）
│   ├── task-queue.js               # 任务队列
│   ├── task-runner.js              # 任务执行器
│   ├── task-progress.js            # 进度管理
│   └── tasks/                      # 具体任务
│       ├── image-generation.js     # 图片生成任务
│       ├── export-task.js          # 导出任务
│       └── ai-request.js           # AI 请求任务
│
├── ai/                             # AI 集成
│   ├── ai-controller.js            # AI 控制器
│   ├── context-builder.js          # 上下文构建
│   ├── response-parser.js          # 响应解析
│   └── providers/                  # AI 提供商（可扩展）
│       ├── base-provider.js        # 基础接口
│       ├── text-provider.js        # 文本生成
│       └── image-provider.js       # 图片生成
│
├── renderers/                      # 渲染器（已有，整理）
│   ├── html-renderer.js            # HTML 预览
│   ├── pptx-renderer.js            # PPTX 导出
│   ├── pdf-renderer.js             # PDF 导出
│   └── thumbnail-renderer.js       # 缩略图
│
└── utils/                          # 工具
    ├── event-emitter.js            # 事件系统
    ├── geometry.js                 # 几何计算
    ├── image-utils.js              # 图片处理
    └── id-generator.js             # ID 生成
```

---

## 3. 核心数据结构

### 3.1 Slide Schema

```typescript
// 幻灯片
interface Slide {
  id: string;                       // 唯一标识
  type: 'freeform' | 'template';    // 类型
  background: string;               // 背景色
  backgroundGradient?: string;      // 渐变背景
  backgroundImage?: string;         // 背景图（assetId）
  elements: Element[];              // 元素列表
  notes?: string;                   // 备注
  transition?: Transition;          // 转场（预留）
}

// 元素基础
interface ElementBase {
  id: string;                       // 唯一标识
  type: ElementType;                // 元素类型
  x: number;                        // 位置 X (%)
  y: number;                        // 位置 Y (%)
  w: number;                        // 宽度 (%)
  h: number;                        // 高度 (%)
  z: number;                        // 层级
  rotation?: number;                // 旋转角度
  opacity?: number;                 // 不透明度 (0-1)
  blend?: BlendMode;                // 混合模式
  filter?: string;                  // CSS 滤镜
  locked?: boolean;                 // 锁定
  hidden?: boolean;                 // 隐藏
  groupId?: string;                 // 分组ID（预留）
}

// 元素类型
type ElementType = 
  | 'text' | 'image' | 'shape' | 'icon' 
  | 'svg' | 'chart' | 'formula' | 'table'
  | 'video' | 'audio';              // 预留多媒体

// 文本元素
interface TextElement extends ElementBase {
  type: 'text';
  content: string;                  // HTML 内容
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  color?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
}

// 图片元素
interface ImageElement extends ElementBase {
  type: 'image';
  assetId: string;                  // 资源引用
  objectFit?: 'cover' | 'contain' | 'fill';
  mask?: string;                    // 遮罩
  clipPath?: string;                // 裁剪路径
  // 原始图片变换参数（非破坏性）
  crop?: { x: number; y: number; w: number; h: number };
  adjustments?: {
    brightness?: number;
    contrast?: number;
    saturation?: number;
  };
}

// 图表元素
interface ChartElement extends ElementBase {
  type: 'chart';
  chartType: 'bar' | 'line' | 'pie' | 'doughnut';
  chartData: string;                // "Label:Value,Label:Value"
  title?: string;
  colors?: string;
  showLegend?: boolean;
  // 扩展选项
  options?: {
    direction?: 'horizontal' | 'vertical';
    stacked?: boolean;
    showValues?: boolean;
  };
}

// 公式元素
interface FormulaElement extends ElementBase {
  type: 'formula';
  latex: string;                    // LaTeX 源码
  displayMode?: boolean;            // 行内/块级
}
```

### 3.2 资源 Schema

```typescript
// 资源元数据
interface Asset {
  id: string;
  name: string;
  type: 'image' | 'svg' | 'video' | 'audio';
  mimeType: string;
  size: number;                     // 字节
  width?: number;                   // 图片宽度
  height?: number;                  // 图片高度
  created: number;
  
  // 存储信息
  storage: {
    type: 'blob' | 'chunks' | 'external';
    blobKey?: string;               // IndexedDB key
    chunkKeys?: string[];           // 分块存储 keys
    externalUrl?: string;           // 外部 URL
  };
  
  // 缩略图
  thumbnail?: {
    blobKey: string;
    width: number;
    height: number;
  };
  
  // 来源追踪
  source?: {
    type: 'upload' | 'ai-generated' | 'url' | 'paste';
    prompt?: string;                // AI 生成时的 prompt
    originalUrl?: string;
  };
}
```

### 3.3 操作 Schema（历史系统）

```typescript
// 操作类型
type OperationType = 
  | 'element.add'
  | 'element.delete'
  | 'element.update'
  | 'element.move'
  | 'element.reorder'
  | 'slide.add'
  | 'slide.delete'
  | 'slide.update'
  | 'slide.reorder'
  | 'batch';                        // 批量操作

// 操作记录
interface Operation {
  id: string;
  type: OperationType;
  timestamp: number;
  
  // 操作位置
  slideId?: string;
  elementId?: string;
  
  // 变更内容（用于撤销/重做）
  changes: Change[];
  
  // 批量操作
  operations?: Operation[];
}

// 单个变更
interface Change {
  path: string;                     // 'elements[0].x' 或 'background'
  oldValue: any;
  newValue: any;
}
```

---

## 4. 任务系统（长时间任务）

### 4.1 任务队列设计

```typescript
// 任务状态
type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

// 任务优先级
type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

// 任务定义
interface Task {
  id: string;
  type: string;                     // 'image-generation', 'export', etc.
  priority: TaskPriority;
  status: TaskStatus;
  
  // 进度
  progress: {
    current: number;
    total: number;
    message: string;
  };
  
  // 时间追踪
  created: number;
  started?: number;
  completed?: number;
  
  // 任务数据
  input: any;
  output?: any;
  error?: Error;
  
  // 回调
  onProgress?: (progress: Progress) => void;
  onComplete?: (result: any) => void;
  onError?: (error: Error) => void;
  
  // 控制
  cancellable: boolean;
  retryable: boolean;
  maxRetries: number;
  retryCount: number;
}

// 任务队列
class TaskQueue {
  private queue: Task[] = [];
  private running: Map<string, Task> = new Map();
  private maxConcurrent: number = 3;
  
  // 添加任务
  add(task: Task): string;
  
  // 取消任务
  cancel(taskId: string): boolean;
  
  // 暂停/恢复
  pause(taskId: string): void;
  resume(taskId: string): void;
  
  // 优先级调整
  prioritize(taskId: string, priority: TaskPriority): void;
  
  // 获取状态
  getStatus(taskId: string): TaskStatus;
  getProgress(taskId: string): Progress;
}
```

### 4.2 大文件处理

```typescript
// 分块存储配置
const CHUNK_CONFIG = {
  CHUNK_SIZE: 1024 * 1024,          // 1MB per chunk
  MAX_MEMORY_SIZE: 10 * 1024 * 1024, // 10MB 以上分块存储
  THUMBNAIL_SIZE: 200,               // 缩略图最大边
};

// 资源存储管理
class AssetStore {
  // 存储资源（自动判断分块）
  async save(blob: Blob, metadata: Partial<Asset>): Promise<string> {
    if (blob.size > CHUNK_CONFIG.MAX_MEMORY_SIZE) {
      return this.saveChunked(blob, metadata);
    }
    return this.saveBlob(blob, metadata);
  }
  
  // 分块存储
  async saveChunked(blob: Blob, metadata: Partial<Asset>): Promise<string> {
    const chunks: string[] = [];
    let offset = 0;
    
    while (offset < blob.size) {
      const chunk = blob.slice(offset, offset + CHUNK_CONFIG.CHUNK_SIZE);
      const chunkKey = await this.saveChunk(chunk);
      chunks.push(chunkKey);
      offset += CHUNK_CONFIG.CHUNK_SIZE;
    }
    
    // 保存元数据
    return this.saveMetadata({
      ...metadata,
      storage: { type: 'chunks', chunkKeys: chunks },
    });
  }
  
  // 流式读取（避免内存溢出）
  async *readStream(assetId: string): AsyncGenerator<Blob> {
    const asset = await this.getMetadata(assetId);
    
    if (asset.storage.type === 'chunks') {
      for (const chunkKey of asset.storage.chunkKeys) {
        yield await this.getChunk(chunkKey);
      }
    } else {
      yield await this.getBlob(asset.storage.blobKey);
    }
  }
  
  // 获取缩略图（不加载原图）
  async getThumbnail(assetId: string): Promise<Blob> {
    const asset = await this.getMetadata(assetId);
    if (asset.thumbnail) {
      return this.getBlob(asset.thumbnail.blobKey);
    }
    // 懒生成缩略图
    return this.generateThumbnail(assetId);
  }
}
```

---

## 5. AI 集成

### 5.1 AI 控制器

```typescript
class AIController {
  private taskQueue: TaskQueue;
  private providers: Map<string, AIProvider>;
  
  // 注册 AI 提供商
  registerProvider(name: string, provider: AIProvider): void;
  
  // 文本生成（快速）
  async generateText(prompt: string, context?: any): Promise<string> {
    return this.providers.get('text').generate(prompt, context);
  }
  
  // 图片生成（长时间任务）
  async generateImage(prompt: string, options?: ImageGenOptions): Promise<string> {
    const task: Task = {
      id: generateId(),
      type: 'image-generation',
      priority: 'normal',
      input: { prompt, options },
      cancellable: true,
      retryable: true,
      maxRetries: 2,
    };
    
    // 加入队列
    const taskId = this.taskQueue.add(task);
    
    // 返回 Promise，任务完成时 resolve
    return new Promise((resolve, reject) => {
      task.onComplete = async (imageBlob) => {
        // 保存到资源库
        const assetId = await this.assetStore.save(imageBlob, {
          name: `AI Generated - ${prompt.slice(0, 30)}`,
          source: { type: 'ai-generated', prompt },
        });
        resolve(assetId);
      };
      task.onError = reject;
    });
  }
  
  // 元素修改（结构化输出）
  async modifyElement(element: Element, instruction: string): Promise<Partial<Element>> {
    const context = this.contextBuilder.buildElementContext(element);
    const response = await this.providers.get('text').generate(
      `修改以下元素：\n${JSON.stringify(element)}\n\n指令：${instruction}`,
      { responseFormat: 'json', context }
    );
    return this.responseParser.parseElementUpdate(response);
  }
}
```

### 5.2 图片生成任务

```typescript
class ImageGenerationTask implements TaskExecutor {
  async execute(task: Task): Promise<Blob> {
    const { prompt, options } = task.input;
    
    // 1. 发起请求
    task.progress = { current: 0, total: 100, message: '正在连接服务...' };
    
    const response = await this.provider.startGeneration(prompt, options);
    const jobId = response.jobId;
    
    // 2. 轮询进度
    while (true) {
      if (task.status === 'cancelled') {
        await this.provider.cancelJob(jobId);
        throw new Error('Task cancelled');
      }
      
      const status = await this.provider.checkStatus(jobId);
      
      task.progress = {
        current: status.progress,
        total: 100,
        message: status.message || '正在生成...',
      };
      
      if (status.completed) {
        // 3. 下载结果
        task.progress.message = '正在下载图片...';
        const imageUrl = status.resultUrl;
        const blob = await this.downloadImage(imageUrl, (downloaded, total) => {
          task.progress = {
            current: 90 + (downloaded / total) * 10,
            total: 100,
            message: `下载中 ${Math.round(downloaded / 1024)}KB / ${Math.round(total / 1024)}KB`,
          };
        });
        
        return blob;
      }
      
      // 等待后重试
      await sleep(2000);
    }
  }
  
  // 支持断点续传的下载
  async downloadImage(url: string, onProgress: ProgressCallback): Promise<Blob> {
    const response = await fetch(url);
    const total = parseInt(response.headers.get('content-length') || '0');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let downloaded = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      downloaded += value.length;
      onProgress(downloaded, total);
    }
    
    return new Blob(chunks);
  }
}
```

---

## 6. 编辑器核心

### 6.1 主编辑器类

```typescript
class SlideEditor extends EventEmitter {
  // 核心模块
  private document: Document;
  private history: HistoryManager;
  private selection: SelectionManager;
  private transform: TransformController;
  private taskQueue: TaskQueue;
  private ai: AIController;
  
  // UI 模块
  private panels: {
    layer: LayerPanel;
    property: PropertyPanel;
    asset: AssetPanel;
  };
  
  // 渲染器
  private renderer: HTMLRenderer;
  private viewport: HTMLElement;
  
  // 初始化
  async init(containerId: string): Promise<void> {
    this.viewport = document.getElementById(containerId);
    this.setupEventListeners();
    this.setupKeyboardShortcuts();
    await this.loadLastProject();
  }
  
  // 文档操作
  async newProject(): Promise<void>;
  async openProject(projectId: string): Promise<void>;
  async saveProject(): Promise<void>;
  async exportAs(format: 'pptx' | 'pdf' | 'html' | 'images'): Promise<void>;
  
  // 元素操作
  addElement(type: ElementType, options?: Partial<Element>): Element;
  deleteElements(ids: string[]): void;
  duplicateElements(ids: string[]): Element[];
  groupElements(ids: string[]): string;
  ungroupElements(groupId: string): void;
  
  // 变换操作
  moveElements(ids: string[], dx: number, dy: number): void;
  resizeElements(ids: string[], scale: { x: number; y: number }): void;
  rotateElements(ids: string[], angle: number): void;
  
  // 属性操作
  updateElement(id: string, changes: Partial<Element>): void;
  updateElements(updates: { id: string; changes: Partial<Element> }[]): void;
  
  // 图层操作
  bringToFront(ids: string[]): void;
  sendToBack(ids: string[]): void;
  moveUp(ids: string[]): void;
  moveDown(ids: string[]): void;
  
  // AI 操作
  async aiGenerate(type: 'slide' | 'element' | 'image', prompt: string): Promise<void>;
  async aiModify(elementId: string, instruction: string): Promise<void>;
  
  // 历史操作
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}
```

### 6.2 选择管理

```typescript
class SelectionManager extends EventEmitter {
  private selected: Set<string> = new Set();
  private hovered: string | null = null;
  
  // 选择操作
  select(id: string, additive?: boolean): void {
    if (!additive) this.selected.clear();
    this.selected.add(id);
    this.emit('selection-change', this.getSelection());
  }
  
  selectMultiple(ids: string[]): void {
    this.selected = new Set(ids);
    this.emit('selection-change', this.getSelection());
  }
  
  selectAll(): void;
  deselect(id: string): void;
  deselectAll(): void;
  
  // 框选
  selectByRect(rect: Rect): void {
    const elements = this.document.getElementsInRect(rect);
    this.selectMultiple(elements.map(e => e.id));
  }
  
  // 获取选择
  getSelection(): Element[] {
    return [...this.selected].map(id => this.document.getElementById(id));
  }
  
  isSelected(id: string): boolean {
    return this.selected.has(id);
  }
}
```

### 6.3 变换控制

```typescript
class TransformController {
  private editor: SlideEditor;
  private handles: TransformHandles;
  
  // 拖拽状态
  private dragging: boolean = false;
  private dragStart: { mouse: Point; elements: Map<string, ElementState> };
  
  // 开始拖拽
  startDrag(mousePos: Point): void {
    const selected = this.editor.selection.getSelection();
    if (selected.length === 0) return;
    
    this.dragging = true;
    this.dragStart = {
      mouse: mousePos,
      elements: new Map(selected.map(el => [el.id, {
        x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation
      }])),
    };
  }
  
  // 拖拽中（基于起点计算，避免误差累积）
  onDrag(mousePos: Point): void {
    if (!this.dragging) return;
    
    const delta = {
      x: mousePos.x - this.dragStart.mouse.x,
      y: mousePos.y - this.dragStart.mouse.y,
    };
    
    // 批量更新（合并为一个操作）
    const updates = [...this.dragStart.elements].map(([id, start]) => ({
      id,
      changes: {
        x: start.x + delta.x,
        y: start.y + delta.y,
      },
    }));
    
    this.editor.updateElements(updates);
  }
  
  // 结束拖拽
  endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.editor.history.commit(); // 提交到历史
  }
  
  // 缩放（从锚点缩放）
  resize(handleType: HandleType, delta: Point, anchor: Point): void {
    // 根据手柄类型计算新尺寸
    // 保持宽高比（如果按住 Shift）
    // 从中心缩放（如果按住 Alt）
  }
  
  // 旋转（绕中心旋转）
  rotate(angle: number): void {
    const selected = this.editor.selection.getSelection();
    const center = this.calculateCenter(selected);
    
    // 计算每个元素相对中心的新位置
    // 直接存储角度值，不累积矩阵
  }
}
```

---

## 7. 存储系统

### 7.1 存储管理器

```typescript
class StorageManager {
  private db: IDBDatabase;
  private projectStore: ProjectStore;
  private assetStore: AssetStore;
  private historyStore: HistoryStore;
  
  // 初始化数据库
  async init(): Promise<void> {
    this.db = await this.openDatabase('ppt-editor', 3, (db, oldVersion) => {
      // 版本升级迁移
      if (oldVersion < 1) {
        db.createObjectStore('projects', { keyPath: 'id' });
        db.createObjectStore('assets', { keyPath: 'id' });
        db.createObjectStore('chunks', { keyPath: 'key' });
      }
      if (oldVersion < 2) {
        db.createObjectStore('history', { keyPath: 'id' });
      }
      if (oldVersion < 3) {
        db.createObjectStore('snapshots', { keyPath: 'id' });
      }
    });
  }
  
  // 存储配额管理
  async checkQuota(): Promise<StorageQuota> {
    if (navigator.storage?.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      return {
        used: usage,
        total: quota,
        available: quota - usage,
        percentUsed: (usage / quota) * 100,
      };
    }
    return null;
  }
  
  // 清理过期数据
  async cleanup(): Promise<void> {
    // 清理未引用的资源
    // 清理过期的历史记录
    // 压缩快照
  }
}
```

### 7.2 缓存管理

```typescript
class CacheManager {
  private memoryCache: LRUCache<string, any>;
  private thumbnailCache: LRUCache<string, Blob>;
  
  constructor() {
    // 内存缓存：最多 50MB
    this.memoryCache = new LRUCache({
      max: 50 * 1024 * 1024,
      sizeCalculation: (value) => this.calculateSize(value),
    });
    
    // 缩略图缓存：最多 100 张
    this.thumbnailCache = new LRUCache({
      max: 100,
    });
  }
  
  // 获取资源（带缓存）
  async getAsset(assetId: string): Promise<Blob> {
    // 1. 检查内存缓存
    if (this.memoryCache.has(assetId)) {
      return this.memoryCache.get(assetId);
    }
    
    // 2. 从存储加载
    const blob = await this.assetStore.get(assetId);
    
    // 3. 小于 5MB 的放入缓存
    if (blob.size < 5 * 1024 * 1024) {
      this.memoryCache.set(assetId, blob);
    }
    
    return blob;
  }
}
```

---

## 8. 事件系统

```typescript
// 事件类型定义
interface EditorEvents {
  // 文档事件
  'document:change': { slides: Slide[] };
  'document:save': { projectId: string };
  
  // 选择事件
  'selection:change': { elements: Element[] };
  
  // 元素事件
  'element:add': { element: Element };
  'element:delete': { elementId: string };
  'element:update': { element: Element; changes: Partial<Element> };
  
  // 历史事件
  'history:push': { operation: Operation };
  'history:undo': { operation: Operation };
  'history:redo': { operation: Operation };
  
  // 任务事件
  'task:start': { task: Task };
  'task:progress': { task: Task; progress: Progress };
  'task:complete': { task: Task; result: any };
  'task:error': { task: Task; error: Error };
  
  // AI 事件
  'ai:request': { type: string; prompt: string };
  'ai:response': { type: string; result: any };
}

// 使用示例
editor.on('element:update', ({ element, changes }) => {
  console.log(`Element ${element.id} updated:`, changes);
  this.propertyPanel.refresh(element);
});

editor.on('task:progress', ({ task, progress }) => {
  this.taskPanel.updateProgress(task.id, progress);
});
```

---

## 9. 扩展点

### 9.1 插件系统（预留）

```typescript
interface EditorPlugin {
  name: string;
  version: string;
  
  // 生命周期
  onInit(editor: SlideEditor): void;
  onDestroy(): void;
  
  // 扩展点
  registerElements?(): ElementDefinition[];
  registerPanels?(): PanelDefinition[];
  registerTools?(): ToolDefinition[];
  registerExporters?(): ExporterDefinition[];
  registerAIProviders?(): AIProviderDefinition[];
}
```

### 9.2 自定义元素（预留）

```typescript
interface ElementDefinition {
  type: string;
  name: string;
  icon: string;
  
  // 创建默认实例
  create(options?: any): Element;
  
  // 渲染
  renderHTML(element: Element): string;
  renderPPTX(element: Element, slide: PptxSlide): void;
  
  // 属性面板
  getPropertyPanel(element: Element): PropertyPanelConfig;
  
  // 序列化
  serialize(element: Element): any;
  deserialize(data: any): Element;
}
```

---

## 10. 实现路线图

### Phase 1: 基础设施 (Week 1-2)
- [ ] 数据结构定义 (`slide-schema.js`)
- [ ] 存储系统 (`storage/`)
- [ ] 事件系统 (`event-emitter.js`)
- [ ] 基础编辑器框架 (`slide-editor.js`)

### Phase 2: 选择与变换 (Week 3-4)
- [ ] 选择管理 (`selection-manager.js`)
- [ ] 变换控制 (`transform-controller.js`)
- [ ] 快捷键 (`keyboard-shortcuts.js`)
- [ ] 基础 UI 交互

### Phase 3: 面板系统 (Week 5-6)
- [ ] 图层面板 (`layer-panel.js`)
- [ ] 属性面板 (`property-panel.js`)
- [ ] 资源面板 (`asset-panel.js`)

### Phase 4: 历史系统 (Week 7)
- [ ] 操作记录 (`operation.js`)
- [ ] 撤销/重做 (`history-manager.js`)
- [ ] 快照管理 (`snapshot-manager.js`)

### Phase 5: 任务系统 (Week 8)
- [ ] 任务队列 (`task-queue.js`)
- [ ] 进度管理 (`task-progress.js`)
- [ ] 大文件处理优化

### Phase 6: AI 集成 (Week 9-10)
- [ ] AI 控制器 (`ai-controller.js`)
- [ ] 图片生成任务
- [ ] 元素修改 AI

### Phase 7: 完善与优化 (Week 11-12)
- [ ] 性能优化
- [ ] 错误处理
- [ ] 测试覆盖
- [ ] 文档完善

---

## 11. 注意事项

### 11.1 性能考虑
- 大列表使用虚拟滚动
- 图片使用懒加载 + 缩略图
- 操作合并（拖拽中不立即提交历史）
- Web Worker 处理耗时计算

### 11.2 内存管理
- LRU 缓存限制
- 大文件分块存储
- 定期清理未引用资源
- 监控内存使用

### 11.3 错误恢复
- 自动保存（每 30 秒）
- 崩溃恢复（从最近快照）
- 操作日志用于调试

### 11.4 兼容性
- IndexedDB 配额处理
- 降级到 localStorage（小项目）
- 导出格式版本控制
