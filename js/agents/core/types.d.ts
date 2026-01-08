/**
 * Core Module Type Definitions
 *
 * 为 js/agents/core 提供 TypeScript 类型支持
 */

// ============================================================
// Kernel
// ============================================================

export type KernelStatusType = 'created' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export interface KernelOptions {
  id?: string;
  keepHistory?: boolean;
  maxHistory?: number;
  keepLog?: boolean;
  maxLog?: number;
  enableRetry?: boolean;
  maxRetries?: number;
  enableTimeout?: boolean;
  defaultTimeout?: number;
  pluginLoader?: (name: string) => Promise<Plugin>;
}

export interface KernelHealthCheck {
  kernelId: string;
  status: KernelStatusType;
  uptime: number;
  plugins: {
    total: number;
    active: number;
    errors: number;
  };
  services: {
    total: number;
    healthy: number;
    unhealthy: ServiceHealthResult[];
  };
}

export interface KernelSnapshot {
  kernelId: string;
  status: KernelStatusType;
  state: Record<string, unknown>;
  plugins: PluginEntry[];
  services: ServiceEntry[];
  timestamp: number;
}

export declare class Kernel {
  readonly id: string;
  readonly status: KernelStatusType;
  readonly events: EventBus;
  readonly state: StateBus;
  readonly services: ServiceBus;

  constructor(options?: KernelOptions);

  static create(preset?: string, config?: Record<string, unknown>): Promise<Kernel>;

  use(plugin: Plugin | string, config?: Record<string, unknown>): Promise<this>;
  usePreset(presetName: string, userConfig?: Record<string, unknown>): Promise<this>;

  registerService(name: string, service: unknown, options?: ServiceOptions): this;
  registerServiceFactory(name: string, factory: () => unknown | Promise<unknown>, options?: ServiceOptions): this;
  registerPluginLoader(prefix: string, loader: (name: string) => Promise<Plugin>): this;

  call<T = unknown>(serviceName: string, method: string, args?: unknown[], options?: CallOptions): Promise<T>;
  invoke<T = unknown>(path: string, ...args: unknown[]): Promise<T>;

  // Legacy API (deprecated)
  register(id: string, factoryOrValue: unknown, options?: Record<string, unknown>): this;
  getService<T = unknown>(id: string): T | null;
  emit(type: string, payload?: unknown): void;
  on(type: string, handler: EventHandler): () => void;
  schedule(task: (() => unknown) | DispatchTask, priority?: number): Promise<unknown>;

  start(): Promise<this>;
  stop(): Promise<this>;

  getPlugins(): PluginEntry[];
  getServices(): ServiceEntry[];
  healthCheck(): Promise<KernelHealthCheck>;
  snapshot(): KernelSnapshot;
  inspect(): KernelInspectResult;
}

// ============================================================
// EventBus
// ============================================================

export interface EventRecord {
  id: string;
  type: string;
  payload: unknown;
  timestamp: number;
  clock: LamportClockState;
}

export interface EventBusOptions {
  keepHistory?: boolean;
  maxHistory?: number;
  backpressure?: BackpressureOptions;
}

export interface BackpressureOptions {
  batchWindowMs?: number;
  maxQueueSize?: number;
  deferNonCoalesced?: boolean;
}

export type EventHandler = (event: EventRecord) => void | Promise<void>;

export interface LamportClockState {
  seq: number;
  ts: number;
  id: string;
}

export declare class EventBus {
  constructor(options?: EventBusOptions);

  on(pattern: string, handler: EventHandler, options?: { priority?: number }): () => void;
  once(pattern: string, handler: EventHandler): () => void;
  off(pattern: string, handler: EventHandler): void;

  emit(type: string, payload?: unknown): Promise<void>;
  emitSync(type: string, payload?: unknown): void;

  waitFor(pattern: string, options?: { timeout?: number; signal?: AbortSignal }): Promise<EventRecord>;

  getHistory(): EventRecord[];
  getClock(): LamportClockState;
  dispose(): void;
}

export declare class LamportClock {
  constructor(nodeId?: string);
  tick(): LamportClockState;
  update(remote: LamportClockState): LamportClockState;
  get(): LamportClockState;
}

// ============================================================
// StateBus
// ============================================================

export interface StateBusOptions {
  events?: EventBus;
  keepLog?: boolean;
  maxLog?: number;
  maxSnapshots?: number;
}

export interface StateChangeRecord {
  path: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
  meta?: Record<string, unknown>;
}

export declare class StateBus {
  constructor(options?: StateBusOptions);

  get<T = unknown>(path: string): T | undefined;
  set(path: string, value: unknown, meta?: Record<string, unknown>): void;
  merge(path: string, updates: Record<string, unknown>, meta?: Record<string, unknown>): void;
  delete(path: string): boolean;

  subscribe(pattern: string, callback: (change: StateChangeRecord) => void): () => void;

  getChangeLog(): StateChangeRecord[];
  toJSON(): Record<string, unknown>;
}

// ============================================================
// ServiceBus
// ============================================================

export interface ServiceOptions {
  override?: boolean;
  healthCheck?: () => boolean | Promise<boolean>;
}

export interface CallOptions {
  timeout?: number;
  retry?: number;
  cache?: boolean | number;
}

export interface ServiceEntry {
  name: string;
  registeredAt: number;
  options: ServiceOptions;
}

export interface ServiceHealthResult {
  name: string;
  healthy: boolean;
  error?: string;
}

export interface ServiceStats {
  name: string;
  calls: number;
  errors: number;
  totalTime: number;
}

export type ServiceProxy = (ctx: CallContext, next: () => Promise<unknown>) => Promise<unknown>;

export interface CallContext {
  service: string;
  method: string;
  args: unknown[];
  options: CallOptions;
  startTime: number;
}

export declare class ServiceBus {
  constructor(options?: { events?: EventBus });

  register(name: string, service: unknown, options?: ServiceOptions): this;
  registerFactory(name: string, factory: () => unknown | Promise<unknown>, options?: ServiceOptions): this;
  unregister(name: string): boolean;

  get<T = unknown>(name: string): Promise<T | null>;
  has(name: string): boolean;
  list(): ServiceEntry[];

  call<T = unknown>(serviceName: string, method: string, args?: unknown[], options?: CallOptions): Promise<T>;
  invoke<T = unknown>(path: string, ...args: unknown[]): Promise<T>;

  useProxy(proxy: ServiceProxy): this;

  healthCheck(name: string): Promise<ServiceHealthResult>;
  healthCheckAll(): Promise<ServiceHealthResult[]>;
  getStats(): ServiceStats[];
}

export declare function createRetryProxy(options?: { maxRetries?: number; backoff?: number }): ServiceProxy;
export declare function createTimeoutProxy(options?: { timeout?: number }): ServiceProxy;
export declare function createCacheProxy(options?: { ttl?: number; maxSize?: number }): ServiceProxy;

// ============================================================
// Plugin
// ============================================================

export type PluginStatusType = 'pending' | 'installing' | 'active' | 'error' | 'uninstalled';

export interface Plugin {
  name: string;
  version?: string;
  description?: string;
  dependencies?: string[];
  defaultConfig?: Record<string, unknown>;

  install(ctx: PluginContext): void | Promise<void>;
  uninstall?(ctx: PluginContext): void | Promise<void>;
  onStart?(ctx: PluginContext): void | Promise<void>;
  onStop?(ctx: PluginContext): void | Promise<void>;
  onError?(ctx: PluginContext, error: Error): void | Promise<void>;
}

export interface PluginConfig {
  name: string;
  version?: string;
  description?: string;
  dependencies?: string[];
  defaultConfig?: Record<string, unknown>;
  install?: (ctx: PluginContext) => void | Promise<void>;
  uninstall?: (ctx: PluginContext) => void | Promise<void>;
  onStart?: (ctx: PluginContext) => void | Promise<void>;
  onStop?: (ctx: PluginContext) => void | Promise<void>;
  onError?: (ctx: PluginContext, error: Error) => void | Promise<void>;
}

export interface PluginEntry {
  name: string;
  version: string;
  status: PluginStatusType;
  dependencies: string[];
}

export interface ScopedState {
  get<T = unknown>(path?: string): T | undefined;
  set(path: string, value: unknown, meta?: Record<string, unknown>): void;
  merge(path: string, updates: Record<string, unknown>, meta?: Record<string, unknown>): void;
  getGlobal<T = unknown>(path: string): T | undefined;
  subscribe(pattern: string, callback: (change: StateChangeRecord) => void): () => void;
}

export interface PluginLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export declare class PluginContext {
  readonly config: Record<string, unknown>;
  readonly events: EventBus;
  readonly state: ScopedState;
  readonly services: ServiceBus;
  readonly log: PluginLogger;

  registerService(name: string, service: unknown, options?: ServiceOptions): void;
  on(event: string, callback: EventHandler): () => void;
  cleanup(): void;
}

export declare class PluginManager {
  constructor(kernel: Kernel);

  register(plugin: Plugin, config?: Record<string, unknown>): this;
  install(pluginName: string): Promise<void>;
  installAll(): Promise<void>;
  uninstall(pluginName: string): Promise<boolean>;

  getStatus(pluginName: string): PluginStatusType | null;
  getContext(pluginName: string): PluginContext | undefined;
  list(): PluginEntry[];
}

export declare function createPlugin(config: PluginConfig): Plugin;

// ============================================================
// Presets
// ============================================================

export interface PresetDefinition {
  description: string;
  extends?: string;
  plugins: string[];
  config: Record<string, Record<string, unknown>>;
}

export interface ResolvedPreset {
  name: string;
  description: string;
  plugins: string[];
  config: Record<string, Record<string, unknown>>;
}

export interface PresetInfo {
  name: string;
  description: string;
  extends: string | null;
  pluginCount: number;
}

export declare const presets: Record<string, PresetDefinition>;
export declare function resolvePreset(presetName: string): ResolvedPreset;
export declare function mergePresetConfig(presetName: string, userConfig?: Record<string, unknown>): ResolvedPreset;
export declare function listPresets(): PresetInfo[];

// ============================================================
// CRDT
// ============================================================

export type OpType = 'set' | 'delete' | 'increment' | 'decrement' | 'add' | 'remove';

export interface CRDTOp {
  type: OpType;
  key: string;
  value: unknown;
  clock: LamportClockState;
  nodeId: string;
}

export declare class LWWRegister<T = unknown> {
  constructor(nodeId?: string);
  get(): T | undefined;
  set(value: T): CRDTOp;
  merge(op: CRDTOp): boolean;
}

export declare class GCounter {
  constructor(nodeId?: string);
  get(): number;
  increment(delta?: number): CRDTOp;
  merge(op: CRDTOp): boolean;
}

export declare class PNCounter {
  constructor(nodeId?: string);
  get(): number;
  increment(delta?: number): CRDTOp;
  decrement(delta?: number): CRDTOp;
  merge(op: CRDTOp): boolean;
}

export declare class LWWMap<V = unknown> {
  constructor(nodeId?: string);
  get(key: string): V | undefined;
  set(key: string, value: V): CRDTOp;
  delete(key: string): CRDTOp;
  has(key: string): boolean;
  keys(): string[];
  entries(): [string, V][];
  merge(op: CRDTOp): boolean;
}

export declare class ORSet<T = unknown> {
  constructor(nodeId?: string);
  add(value: T): CRDTOp;
  remove(value: T): CRDTOp;
  has(value: T): boolean;
  values(): T[];
  merge(op: CRDTOp): boolean;
}

export declare class CRDTDocument {
  constructor(nodeId?: string);
  getRegister<T = unknown>(name: string): LWWRegister<T>;
  getCounter(name: string): GCounter;
  getPNCounter(name: string): PNCounter;
  getMap<V = unknown>(name: string): LWWMap<V>;
  getSet<T = unknown>(name: string): ORSet<T>;
  merge(ops: CRDTOp[]): void;
  getPendingOps(): CRDTOp[];
  clearPendingOps(): void;
}

export interface SyncTransport {
  send(ops: CRDTOp[]): void | Promise<void>;
  receive(callback: (ops: CRDTOp[]) => void): () => void;
}

export declare class CRDTSyncManager {
  constructor(doc: CRDTDocument, transport: SyncTransport, options?: { syncInterval?: number });
  start(): void;
  stop(): void;
  sync(): Promise<void>;
}

export declare function createMemoryTransport(): SyncTransport;
export declare function createOp(type: OpType, key: string, value: unknown, clock?: LamportClockState): CRDTOp;

// ============================================================
// Sandbox
// ============================================================

export type SandboxCapability = 'fs' | 'net' | 'env' | 'crypto' | 'timer';
export type SandboxPreset = 'minimal' | 'standard' | 'full';

export interface ResourceLimits {
  maxMemoryMB?: number;
  maxCpuMs?: number;
  maxOutputBytes?: number;
}

export interface SandboxOptions {
  capabilities?: SandboxCapability[];
  preset?: SandboxPreset;
  limits?: ResourceLimits;
  timeout?: number;
}

export interface SandboxResult {
  success: boolean;
  output?: unknown;
  error?: string;
  metrics?: {
    executionMs: number;
    memoryUsedBytes: number;
  };
}

export declare class WasmSandbox {
  constructor(options?: SandboxOptions);
  execute(code: string, context?: Record<string, unknown>): Promise<SandboxResult>;
  dispose(): void;
}

export declare class SandboxPool {
  constructor(options?: { maxSize?: number; idleTimeoutMs?: number });
  acquire(options?: SandboxOptions): Promise<WasmSandbox>;
  release(sandbox: WasmSandbox): void;
  dispose(): void;
}

export declare class SkillExecutor {
  constructor(pool?: SandboxPool);
  execute(skillCode: string, input: unknown, options?: SandboxOptions): Promise<SandboxResult>;
}

export declare function createSandbox(options?: SandboxOptions): Promise<WasmSandbox>;
export declare function createSkillExecutor(pool?: SandboxPool): SkillExecutor;
export declare function createSandboxPlugin(options?: SandboxOptions): Plugin;

// ============================================================
// Compat
// ============================================================

export interface ServiceProvider {
  register(kernel: Kernel): void | Promise<void>;
  start?(kernel: Kernel): void | Promise<void>;
  stop?(kernel: Kernel): void | Promise<void>;
}

export declare function isServiceProvider(value: unknown): value is ServiceProvider;
export declare function adaptProvider(provider: ServiceProvider): Plugin;
export declare function adaptProviders(providers: ServiceProvider[]): Plugin[];

// ============================================================
// Quick Functions
// ============================================================

export declare function quickKernel(preset?: string, config?: Record<string, unknown>): Promise<Kernel>;
export declare function minimalKernel(config?: Record<string, unknown>): Promise<Kernel>;
export declare function deepsearchKernel(config?: Record<string, unknown>): Promise<Kernel>;
export declare function productionKernel(config?: Record<string, unknown>): Promise<Kernel>;

// ============================================================
// KernelBuilder
// ============================================================

export declare class KernelBuilder {
  static create(): KernelBuilder;

  withPreset(preset: string): this;
  withPlugin(plugin: Plugin | string, config?: Record<string, unknown>): this;
  withPlugins(plugins: (Plugin | string | { plugin: Plugin | string; config?: Record<string, unknown> })[]): this;
  withService(name: string, service: unknown, options?: ServiceOptions): this;
  withServiceFactory(name: string, factory: () => unknown | Promise<unknown>, options?: ServiceOptions): this;
  withConfig(config: Record<string, unknown>): this;

  build(): Promise<Kernel>;
}

// ============================================================
// Internal Types
// ============================================================

interface DispatchTask {
  runtimeType?: string;
  type?: string;
  code: string;
  inputState?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

interface KernelInspectResult {
  id: string;
  status: KernelStatusType;
  eventHistory: EventRecord[];
  stateChangeLog: StateChangeRecord[];
  serviceStats: ServiceStats[];
}
