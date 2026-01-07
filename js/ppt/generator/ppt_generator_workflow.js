// ESM 导入核心类以确保 mixin 安装时类已存在
import PPTGeneratorCtor from './ppt_generator_core.js';

/**
 * PPT Generator Workflow - 组合入口
 * 使用动态 import 加载 mixin 模块，保持与现有非模块脚本的兼容性
 */

(function loadWorkflowMixins() {
    // 优先使用 ESM 导入的 PPTGeneratorCtor
    const GeneratorCtor = PPTGeneratorCtor ||
        (typeof globalThis !== 'undefined' && globalThis.PPTGeneratorCtor?.prototype)
            ? globalThis.PPTGeneratorCtor
            : (
                (typeof globalThis !== 'undefined' && globalThis.PPTGenerator?.prototype)
                    ? globalThis.PPTGenerator
                    : ((typeof PPTGenerator !== 'undefined' && PPTGenerator?.prototype) ? PPTGenerator : null)
            );
    const proto = GeneratorCtor?.prototype || null;

    let resolveReady = null;
    let rejectReady = null;
    const ready = new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });

    if (proto) proto.__pptWorkflowMixinsReady = ready;

    const isNode = typeof process !== 'undefined' && !!process.versions?.node;
    const keepAliveTimer = isNode ? setInterval(() => {}, 50) : null;
    const stopKeepAlive = () => {
        if (keepAliveTimer) clearInterval(keepAliveTimer);
    };

    function installAsyncStub(name) {
        if (!proto) return;
        if (typeof proto[name] === 'function') return;
        const stub = async function (...args) {
            await ready;
            const fn = proto[name];
            if (fn === stub || typeof fn !== 'function') throw new Error(`[PPTGeneratorWorkflow] ${name}() not ready`);
            return fn.apply(this, args);
        };
        proto[name] = stub;
    }

    // Provide minimal immediate APIs for test/browser calls that happen before dynamic imports resolve.
    installAsyncStub('_ensureRuntime');
    installAsyncStub('startFromPastedText');
    installAsyncStub('importPptxAsDeck');
    installAsyncStub('importPptxAsDeckFromPicker');

    (async () => {
    try {
        const [
            { checkpointMixin },
            { filesMixin },
            { phasesMixin },
            { deepsearchMixin },
            { runtimeMixin }
        ] = await Promise.all([
            import('../workflow/workflow-checkpoint.js'),
            import('../workflow/workflow-files.js'),
            import('../workflow/workflow-phases.js'),
            import('../workflow/workflow-deepsearch.js'),
            import('../workflow/workflow-runtime.js')
        ]);

        const PPTGeneratorWorkflow = {
            ...checkpointMixin,
            ...filesMixin,
            ...phasesMixin,
            ...deepsearchMixin,
            ...runtimeMixin,
        };

        const ctor =
            (typeof globalThis !== 'undefined' && globalThis.PPTGeneratorCtor?.prototype)
                ? globalThis.PPTGeneratorCtor
                : (
                    (typeof globalThis !== 'undefined' && globalThis.PPTGenerator?.prototype)
                        ? globalThis.PPTGenerator
                        : GeneratorCtor
                );
        if (!ctor?.prototype) throw new ReferenceError('PPTGenerator is not defined');
        Object.assign(ctor.prototype, PPTGeneratorWorkflow);

        // Recovery UI wrapper
        try {
            const proto = ctor.prototype;
            if (!proto.__pptRecoveryUiWrapped) {
                const original = proto.renderPreviewArea;
                if (typeof original === 'function') {
                    proto.renderPreviewArea = function (...args) {
                        try {
                            this._ensureRecoveryButton?.();
                            this._refreshRecoveryButton?.();
                        } catch {
                            // ignore
                        }
                        return original.apply(this, args);
                    };
                    proto.__pptRecoveryUiWrapped = true;
                }
            }
        } catch {
            // ignore
        }

        console.log('[PPTGeneratorWorkflow] Mixins loaded successfully');
        stopKeepAlive();
        resolveReady?.(true);
    } catch (err) {
        console.error('[PPTGeneratorWorkflow] Failed to load mixins:', err);
        stopKeepAlive();
        rejectReady?.(err);
    }
    })();
})();
