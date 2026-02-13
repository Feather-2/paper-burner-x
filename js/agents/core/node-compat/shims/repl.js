/**
 * repl shim - REPL module stub
 * Not supported in browser environment
 */

const noop = () => {};
const noopStub = new Proxy({}, { get: () => noop });

export default noopStub;
