/**
 * PPT Generator Workflow - 组合入口
 * 使用动态 import 加载 mixin 模块，保持与现有非模块脚本的兼容性
 */

(async function loadWorkflowMixins() {
    try {
        const [
            { checkpointMixin },
            { filesMixin },
            { phasesMixin },
            { deepsearchMixin },
            { runtimeMixin }
        ] = await Promise.all([
            import('./workflow/workflow-checkpoint.js'),
            import('./workflow/workflow-files.js'),
            import('./workflow/workflow-phases.js'),
            import('./workflow/workflow-deepsearch.js'),
            import('./workflow/workflow-runtime.js')
        ]);

        const PPTGeneratorWorkflow = {
            ...checkpointMixin,
            ...filesMixin,
            ...phasesMixin,
            ...deepsearchMixin,
            ...runtimeMixin,
        };

        Object.assign(PPTGenerator.prototype, PPTGeneratorWorkflow);

        // Recovery UI wrapper
        try {
            const proto = PPTGenerator.prototype;
            if (proto.__pptRecoveryUiWrapped) return;
            const original = proto.renderPreviewArea;
            if (typeof original !== 'function') return;

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
        } catch {
            // ignore
        }

        console.log('[PPTGeneratorWorkflow] Mixins loaded successfully');
    } catch (err) {
        console.error('[PPTGeneratorWorkflow] Failed to load mixins:', err);
    }
})();
