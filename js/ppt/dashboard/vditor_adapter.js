(() => {
    const VDITOR_VERSION = '3.10.7';
    const VDITOR_CSS_HREF = `https://gcore.jsdelivr.net/npm/vditor@${VDITOR_VERSION}/dist/index.css`;
    const VDITOR_JS_SRC = `https://gcore.jsdelivr.net/npm/vditor@${VDITOR_VERSION}/dist/index.min.js`;

    function escapeTextareaValue(value) {
        return String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    }

    const VditorAdapter = {
        _instance: null,
        _containerId: null,
        _loaded: false,
        _loading: null,
        _onInput: null,

        isAvailable() {
            return typeof globalThis.Vditor !== 'undefined';
        },

        async load() {
            if (this._loaded || this.isAvailable()) {
                this._loaded = true;
                return true;
            }

            if (this._loading) return this._loading;

            if (typeof document === 'undefined') return false;

            const ensureLink = () => {
                const head = document.head || document.getElementsByTagName('head')[0];
                if (!head) return;
                const existing = head.querySelector(`link[rel="stylesheet"][href="${VDITOR_CSS_HREF}"]`);
                if (existing) return;
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = VDITOR_CSS_HREF;
                head.appendChild(link);
            };

            const ensureScript = () => {
                const head = document.head || document.getElementsByTagName('head')[0];
                if (!head) return null;
                const existing = head.querySelector(`script[src="${VDITOR_JS_SRC}"]`);
                if (existing) return existing;
                const script = document.createElement('script');
                script.src = VDITOR_JS_SRC;
                head.appendChild(script);
                return script;
            };

            this._loading = new Promise((resolve) => {
                try {
                    ensureLink();
                    const script = ensureScript();
                    if (!script) {
                        this._loading = null;
                        resolve(false);
                        return;
                    }

                    const finalize = (ok) => {
                        this._loaded = ok;
                        this._loading = null;
                        resolve(ok);
                    };

                    if (this.isAvailable()) {
                        finalize(true);
                        return;
                    }

                    const onLoad = () => finalize(this.isAvailable());
                    const onError = () => finalize(false);

                    script.addEventListener?.('load', onLoad, { once: true });
                    script.addEventListener?.('error', onError, { once: true });
                    script.onload = onLoad;
                    script.onerror = onError;
                } catch (e) {
                    this._loading = null;
                    resolve(false);
                }
            });

            return this._loading;
        },

        mount(options) {
            if (!options) return null;
            if (!this.isAvailable()) return null;

            const adapter = this;
            const containerOption = options.container;
            let containerId = null;

            if (typeof containerOption === 'string') {
                containerId = containerOption;
            } else if (containerOption && typeof containerOption === 'object') {
                if (!containerOption.id) containerOption.id = `vditor_${Math.random().toString(16).slice(2)}`;
                containerId = containerOption.id;
            }

            if (!containerId) return null;

            const el = typeof document !== 'undefined' ? document.getElementById(containerId) : null;
            if (!el) return null;

            adapter._onInput = typeof options.onInput === 'function' ? options.onInput : null;

            if (adapter._instance) {
                const stillMounted = adapter._containerId && typeof document !== 'undefined' && document.getElementById(adapter._containerId);
                if (adapter._containerId !== containerId || !stillMounted) {
                    adapter.destroy();
                } else {
                    if (typeof options.value === 'string') adapter.setValue(options.value);
                    return adapter._instance;
                }
            }

            const toolbar = [
                'headings',
                'bold',
                'italic',
                'strike',
                'list',
                'ordered-list',
                'check',
                'quote',
                'code',
                'inline-code',
                'link',
                'table',
                'undo',
                'redo'
            ];

            adapter._instance = new globalThis.Vditor(containerId, {
                mode: options.mode || 'ir',
                toolbar,
                cache: { enable: false },
                value: typeof options.value === 'string' ? options.value : '',
                input(value) {
                    if (adapter._onInput) adapter._onInput(value);
                }
            });

            adapter._containerId = containerId;
            adapter._loaded = true;
            return adapter._instance;
        },

        getValue() {
            return this._instance?.getValue?.() || '';
        },

        setValue(value) {
            this._instance?.setValue?.(value);
        },

        destroy() {
            if (!this._instance) return;
            try {
                this._instance.destroy?.();
            } finally {
                this._instance = null;
                this._containerId = null;
                this._onInput = null;
            }
        },

        renderFallbackTextarea(options) {
            const value = escapeTextareaValue(options?.value ?? '');
            const onInput = typeof options?.onInput === 'string' ? options.onInput : '';

            return `
                <textarea class="ppt-input-field" style="width: 100%; min-height: 360px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; line-height: 1.5;"
                    oninput="${onInput}">${value}</textarea>
            `.trim();
        }
    };

    globalThis.VditorAdapter = VditorAdapter;
    if (typeof module !== 'undefined' && module.exports) module.exports = VditorAdapter;
})();
