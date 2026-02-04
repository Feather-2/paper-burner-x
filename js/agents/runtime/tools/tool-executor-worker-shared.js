/**
 * Tool Executor Worker 共享逻辑
 * 统一 Web Worker 和 Worker Threads 的执行逻辑
 */

/**
 * @typedef {object} MessagingAdapter
 * @property {(msg: any) => void} postMessage
 * @property {(cb: (data: any) => void) => void} onMessage
 * @property {() => void} [close]
 */

/**
 * 创建工具执行器处理器
 * @param {MessagingAdapter} adapter
 */
export function createToolExecutorHandler(adapter) {
  adapter.onMessage(async (data) => {
    if (data?.type !== 'execute') return;
    
    const { id, moduleUrl, handlerName, args } = data;
    
    try {
      const mod = await import(moduleUrl);
      const handler = handlerName ? mod[handlerName] : mod.default;
      
      if (typeof handler !== 'function') {
        throw new Error(`Handler "${handlerName || 'default'}" is not a function`);
      }
      
      const result = await handler(...(args || []));
      adapter.postMessage({ type: 'result', id, result });
    } catch (error) {
      adapter.postMessage({
        type: 'error',
        id,
        error: {
          message: error?.message || String(error),
          name: error?.name,
          stack: error?.stack,
        },
      });
    }
  });
  
  return { close: () => adapter.close?.() };
}
