(() => {
    const ctor =
        (typeof globalThis !== 'undefined' && globalThis.PPTGeneratorCtor?.prototype)
            ? globalThis.PPTGeneratorCtor
            : ((typeof PPTGenerator !== 'undefined' && PPTGenerator?.prototype) ? PPTGenerator : null);

    if (!ctor) {
        console.error('PPTGenerator class is not loaded.');
        return;
    }

    const root = (typeof window !== 'undefined') ? window : globalThis;
    if (!root.PPTGenerator) {
        root.PPTGenerator = new ctor();
    }

    // Mirror onto globalThis for Node/test shims where `window` is detached.
    try {
        if (typeof globalThis !== 'undefined' && globalThis !== root) {
            globalThis.PPTGenerator = root.PPTGenerator;
        }
    } catch {
        // ignore
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('DOMContentLoaded', () => {
            try {
                root.PPTGenerator?.init?.();
            } catch (e) {
                console.error('PPTGenerator init failed:', e);
            }
        });
    }
})();
