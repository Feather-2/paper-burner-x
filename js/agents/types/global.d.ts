/**
 * Global type declarations for multi-runtime compatibility.
 * Declares Buffer, NodeJS.Process, Bun, Deno, and Worker types.
 */

export {};

interface BufferConstructor {
  from(data: string | ArrayBuffer | Uint8Array, encoding?: string): Uint8Array;
  alloc(size: number): Uint8Array;
  byteLength(string: string, encoding?: string): number;
  isBuffer(obj: unknown): boolean;
  concat(list: Uint8Array[], totalLength?: number): Uint8Array;
}

interface ProcessEnv {
  [key: string]: string | undefined;
}

declare namespace NodeJS {
  interface Process {
    env: ProcessEnv;
    platform: string;
    version: string;
    versions: Record<string, string>;
    argv: string[];
    execArgv: string[];
    cwd(): string;
    exit(code?: number): never;
    pid: number;
  }
}

interface DenoType {
  version: { deno: string };
  build: { os: string };
  env: { get(key: string): string | undefined };
  cwd(): string;
  exit(code?: number): never;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string): Promise<void>;
}

interface BunSpawnResult {
  exitCode: number | Promise<number>;
  exited: Promise<number>;
  stdout: ReadableStream;
  stderr: ReadableStream;
  kill(): void;
}

interface BunType {
  version: string;
  env: Record<string, string | undefined>;
  cwd(): string;
  exit(code?: number): never;
  file(path: string): { text(): Promise<string> };
  write(path: string, data: string): Promise<number>;
  spawn(cmd: string[], options?: object): BunSpawnResult;
}

declare global {
  var Buffer: BufferConstructor | undefined;
  var process: NodeJS.Process | undefined;
  var Deno: DenoType | undefined;
  var Bun: BunType | undefined;

  class WorkerGlobalScope {
    readonly self: WorkerGlobalScope;
    postMessage(message: unknown): void;
    addEventListener(type: string, listener: EventListener): void;
    removeEventListener(type: string, listener: EventListener): void;
  }

  class DedicatedWorkerGlobalScope extends WorkerGlobalScope {
    readonly name: string;
    onmessage: ((this: DedicatedWorkerGlobalScope, ev: MessageEvent) => void) | null;
    onmessageerror: ((this: DedicatedWorkerGlobalScope, ev: MessageEvent) => void) | null;
  }
}
