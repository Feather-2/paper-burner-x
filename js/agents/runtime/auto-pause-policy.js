/**
 * 自动暂停策略
 */

export const AutoPausePolicy = {
  // 默认超时（5分钟）
  DEFAULT_TIMEOUT: 5 * 60 * 1000,

  // 创建超时检测器
  createTimeoutChecker(timeout = this.DEFAULT_TIMEOUT) {
    const startTime = Date.now();
    return () => Date.now() - startTime > timeout;
  },

  // 创建信号监听器
  createSignalHandler(pauseCallback) {
    const handler = (signal) => {
      pauseCallback(`signal_${signal}`);
    };

    const onSigInt = () => handler("SIGINT");
    const onSigTerm = () => handler("SIGTERM");

    process.on("SIGINT", onSigInt);
    process.on("SIGTERM", onSigTerm);

    return () => {
      process.off("SIGINT", onSigInt);
      process.off("SIGTERM", onSigTerm);
    };
  },
};

export default AutoPausePolicy;
