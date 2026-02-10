import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const adapterMocks = vi.hoisted(() => ({
    markdown: { parse: vi.fn() },
    rawText: { parse: vi.fn() },
    history: { parse: vi.fn() },
    pdf: { parse: vi.fn() },
    docx: { parse: vi.fn() },
    pptx: { parse: vi.fn() },
    html: { parse: vi.fn() },
    epub: { parse: vi.fn() },
    audio: { parse: vi.fn() },
    video: { parse: vi.fn() },
    code: { parse: vi.fn() }
}));

const codeIsSupportedMock = vi.hoisted(() => vi.fn());
const runAssetUnderstandingMock = vi.hoisted(() => vi.fn());
const validateFetchUrlMock = vi.hoisted(() => vi.fn((url) => url));
const normalizeTextMock = vi.hoisted(() =>
    vi.fn((text = '') => {
        const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
        const basis = normalized || 'empty';
        const hash = `sha256:${basis.length.toString(16)}${basis.slice(0, 6)}`;
        return { textNormalized: normalized, textHash: hash };
    })
);

const sharedMocks = vi.hoisted(() => {
    const isPlainObject = (v) => {
        if (v === null || typeof v !== 'object') return false;
        if (Array.isArray(v)) return false;
        const proto = Object.getPrototypeOf(v);
        return proto === Object.prototype || proto === null;
    };

    const toNonEmptyString = (v) => {
        if (v === null || v === undefined) return undefined;
        const s = String(v).trim();
        return s.length ? s : undefined;
    };

    const normalizeMaxBytes = (value, fallback) => {
        if (value === Infinity) return Infinity;
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n) || n <= 0) return fallback;
        return Math.floor(n);
    };

    const createResponseTooLargeError = (context, maxBytes, observedBytes) => {
        const err = new Error(`${context} exceeded ${maxBytes} bytes (got ${observedBytes})`);
        err.name = 'ResponseTooLargeError';
        return err;
    };

    const readTextWithLimit = vi.fn(async (resp) => {
        if (typeof resp?.text === 'function') return resp.text();
        return '';
    });

    return {
        isPlainObject,
        toNonEmptyString,
        normalizeMaxBytes,
        createResponseTooLargeError,
        readTextWithLimit
    };
});

const assetManagerMocks = vi.hoisted(() => {
    class AssetManager {
        constructor() {
            this.assets = [];
            this.counter = 0;
        }

        addAssets(list) {
            if (!Array.isArray(list)) throw new TypeError('AssetManager.addAssets(assets): assets must be an array');
            const ids = [];
            for (const asset of list) {
                const id = asset?.id || `asset_${++this.counter}`;
                this.assets.push({ ...asset, id });
                ids.push(id);
            }
            return ids;
        }

        listAssets() {
            return this.assets;
        }

        count() {
            return this.assets.length;
        }
    }

    return { AssetManager };
});

vi.mock('../../../../js/agents/ingest/asset-manager.js', () => assetManagerMocks);
vi.mock('../../../../js/agents/ingest/asset-understanding.js', () => ({
    understandAssets: runAssetUnderstandingMock
}));
vi.mock('../../../../js/agents/ingest/adapters/markdown.js', () => ({
    MarkdownAdapter: class {
        constructor(opts) {
            this.opts = opts;
        }
        parse(...args) {
            return adapterMocks.markdown.parse(...args);
        }
    }
}));
vi.mock('../../../../js/agents/ingest/adapters/raw-text.js', () => ({
    RawTextAdapter: class {
        constructor(opts) {
            this.opts = opts;
        }
        parse(...args) {
            return adapterMocks.rawText.parse(...args);
        }
    }
}));
vi.mock('../../../../js/agents/ingest/adapters/history.js', () => ({
    HistoryAdapter: class {
        constructor(store, opts) {
            this.store = store;
            this.opts = opts;
        }
        parse(...args) {
            return adapterMocks.history.parse(...args);
        }
    }
}));
vi.mock('../../../../js/agents/ingest/adapters/pdf.js', () => ({
    PdfAdapter: class {
        constructor(opts) {
            this.opts = opts;
        }
        parse(...args) {
            return adapterMocks.pdf.parse(...args);
        }
    }
}));
vi.mock('../../../../js/agents/ingest/adapters/docx.js', () => ({
    DocxAdapter: class {
        constructor(opts) {
            this.opts = opts;
        }
        parse(...args) {
            return adapterMocks.docx.parse(...args);
        }
    }
}));
vi.mock('../../../../js/agents/ingest/adapters/pptx.js', () => ({
    PptxAdapter: class {
        constructor(opts) {
            this.opts = opts;
        }
        parse(...args) {
            return adapterMocks.pptx.parse(...args);
        }
    }
}));
vi.mock('../../../../js/agents/ingest/adapters/html.js', () => ({
    HtmlAdapter: class {
        constructor(opts) {
            this.opts = opts;
        }
        parse(...args) {
            return adapterMocks.html.parse(...args);
        }
    }
}));
vi.mock('../../../../js/agents/ingest/adapters/epub.js', () => ({
    EpubAdapter: class {
        constructor(opts) {
            this.opts = opts;
        }
        parse(...args) {
            return adapterMocks.epub.parse(...args);
        }
    }
}));
vi.mock('../../../../js/agents/ingest/adapters/audio.js', () => ({
    AudioAdapter: class {
        constructor(opts) {
            this.opts = opts;
        }
        parse(...args) {
            return adapterMocks.audio.parse(...args);
        }
    }
}));
vi.mock('../../../../js/agents/ingest/adapters/video.js', () => ({
    VideoAdapter: class {
        constructor(opts) {
            this.opts = opts;
        }
        parse(...args) {
            return adapterMocks.video.parse(...args);
        }
    }
}));
vi.mock('../../../../js/agents/ingest/adapters/code.js', () => ({
    CodeAdapter: class {
        constructor(opts) {
            this.opts = opts;
        }
        parse(...args) {
            return adapterMocks.code.parse(...args);
        }
        static isSupported(name) {
            return codeIsSupportedMock(name);
        }
    }
}));
vi.mock('../../../../js/agents/stages/textprep/normalize.js', () => ({
    normalizeText: normalizeTextMock
}));
vi.mock('../../../../js/agents/mcp/http-proxy.js', () => ({
    validateFetchUrl: validateFetchUrlMock
}));
vi.mock('../../../../js/agents/shared/index.js', () => ({
    isPlainObject: sharedMocks.isPlainObject,
    toNonEmptyString: sharedMocks.toNonEmptyString,
    normalizeMaxBytes: sharedMocks.normalizeMaxBytes,
    createResponseTooLargeError: sharedMocks.createResponseTooLargeError,
    readTextWithLimit: sharedMocks.readTextWithLimit
}));

import { INGEST_RESULT_ARTIFACT_TYPE, IngestStage } from '../../../../js/agents/ingest/ingest-stage.js';

const makeParsedDoc = ({ docId, sourceType, text, assets = [], chunks = [], metadata = {}, origin = {} } = {}) => {
    const normalized = normalizeTextMock(text);
    return {
        docId,
        sourceType,
        markdown: text,
        textNormalized: normalized.textNormalized,
        textHash: normalized.textHash,
        chunks,
        assets,
        metadata,
        origin
    };
};

const buildFingerprint = ({ files = [], urls = [], historyIds = [], rawTexts = [] } = {}) => {
    const fileMeta = (Array.isArray(files) ? files : []).map((f) => {
        if (typeof f === 'string') return { name: f, type: '', size: null };
        const name = sharedMocks.toNonEmptyString(f?.name) || sharedMocks.toNonEmptyString(f?.filename) || 'file';
        const type = sharedMocks.toNonEmptyString(f?.type) || sharedMocks.toNonEmptyString(f?.mimeType) || '';
        const size = Number.isFinite(f?.size) ? f.size : null;
        return { name, type, size };
    });

    const rawMeta = (Array.isArray(rawTexts) ? rawTexts : []).map((t) => {
        const text = typeof t === 'string' ? t : String(t?.text || '');
        const normalized = normalizeTextMock(text);
        const hash = normalized.textHash;
        const hex = String(hash || '').startsWith('sha256:') ? String(hash).slice('sha256:'.length) : String(hash || '');
        const short = hex.slice(0, 12) || 'unknown';
        const docId = `user_text_${short}`;
        return { origin: `raw:${docId}`, length: text.length };
    });

    const normalizeFingerprint = (fp) => {
        const src = fp && typeof fp === 'object' && !Array.isArray(fp) ? fp : {};
        const filesList = Array.isArray(src.files) ? src.files : [];
        const historyList = Array.isArray(src.historyIds) ? src.historyIds : [];
        const rawList = Array.isArray(src.rawTexts) ? src.rawTexts : [];
        const urlsList = Array.isArray(src.urls) ? src.urls : [];
        return {
            files: filesList
                .map((f) => ({
                    name: sharedMocks.toNonEmptyString(f?.name) || '',
                    type: sharedMocks.toNonEmptyString(f?.type) || '',
                    size: Number.isFinite(f?.size) ? f.size : null
                }))
                .filter((f) => f.name)
                .sort((a, b) => `${a.name}|${a.size ?? ''}|${a.type}`.localeCompare(`${b.name}|${b.size ?? ''}|${b.type}`)),
            historyIds: historyList.map((id) => sharedMocks.toNonEmptyString(id)).filter(Boolean).sort(),
            rawTexts: rawList
                .map((r) => ({
                    origin: sharedMocks.toNonEmptyString(r?.origin) || '',
                    length: Number.isFinite(r?.length) ? r.length : null
                }))
                .filter((r) => r.origin)
                .sort((a, b) => a.origin.localeCompare(b.origin)),
            urls: urlsList.map((u) => sharedMocks.toNonEmptyString(u)).filter(Boolean).sort()
        };
    };

    return normalizeFingerprint({
        files: fileMeta,
        urls,
        historyIds,
        rawTexts: rawMeta
    });
};

const buildRawTextOrigin = (input) => {
    const text = typeof input === 'string' ? input : String(input?.text || '');
    const normalized = normalizeTextMock(text);
    const hash = normalized.textHash;
    const hex = String(hash || '').startsWith('sha256:') ? String(hash).slice('sha256:'.length) : String(hash || '');
    const short = hex.slice(0, 12) || 'unknown';
    const docId = `user_text_${short}`;
    return `raw:${docId}`;
};

beforeEach(() => {
    for (const adapter of Object.values(adapterMocks)) {
        adapter.parse.mockReset();
    }
    codeIsSupportedMock.mockReset();
    runAssetUnderstandingMock.mockReset();
    validateFetchUrlMock.mockReset();
    sharedMocks.readTextWithLimit.mockReset();
    normalizeTextMock.mockClear();

    codeIsSupportedMock.mockImplementation((name) => String(name).endsWith('.js'));

    adapterMocks.rawText.parse.mockImplementation((input) => {
        const text = typeof input === 'string' ? input : String(input?.text || '');
        const title = typeof input === 'object' && input ? input.title : undefined;
        return Promise.resolve(
            makeParsedDoc({
                docId: `raw_${text.length}`,
                sourceType: 'rawText',
                text,
                assets: [],
                metadata: title ? { title } : {},
                origin: { title: title || '' },
                chunks: []
            })
        );
    });

    adapterMocks.history.parse.mockImplementation((hid) =>
        Promise.resolve(makeParsedDoc({ docId: `history_${hid}`, sourceType: 'history', text: String(hid || '') }))
    );

    adapterMocks.markdown.parse.mockImplementation((file) =>
        Promise.resolve(makeParsedDoc({ docId: `md_${file?.name || String(file)}`, sourceType: 'markdown', text: 'md' }))
    );

    adapterMocks.pdf.parse.mockImplementation((file) =>
        Promise.resolve(makeParsedDoc({ docId: `pdf_${file?.name || String(file)}`, sourceType: 'pdf', text: 'pdf' }))
    );

    adapterMocks.docx.parse.mockImplementation((file) =>
        Promise.resolve(makeParsedDoc({ docId: `docx_${file?.name || String(file)}`, sourceType: 'docx', text: 'docx' }))
    );

    adapterMocks.pptx.parse.mockImplementation((file) =>
        Promise.resolve(makeParsedDoc({ docId: `pptx_${file?.name || String(file)}`, sourceType: 'pptx', text: 'pptx' }))
    );

    adapterMocks.html.parse.mockImplementation((file) =>
        Promise.resolve(makeParsedDoc({ docId: `html_${file?.name || String(file)}`, sourceType: 'html', text: 'html' }))
    );

    adapterMocks.epub.parse.mockImplementation((file) =>
        Promise.resolve(makeParsedDoc({ docId: `epub_${file?.name || String(file)}`, sourceType: 'epub', text: 'epub' }))
    );

    adapterMocks.audio.parse.mockImplementation((file) =>
        Promise.resolve(makeParsedDoc({ docId: `audio_${file?.name || String(file)}`, sourceType: 'audio', text: 'audio' }))
    );

    adapterMocks.video.parse.mockImplementation((file) =>
        Promise.resolve(makeParsedDoc({ docId: `video_${file?.name || String(file)}`, sourceType: 'video', text: 'video' }))
    );

    adapterMocks.code.parse.mockImplementation((file) =>
        Promise.resolve(makeParsedDoc({ docId: `code_${file?.name || String(file)}`, sourceType: 'code', text: 'code' }))
    );
});

afterEach(() => {
    vi.useRealTimers();
});

describe('INGEST_RESULT_ARTIFACT_TYPE', () => {
    it('exports the expected artifact type', () => {
        expect(INGEST_RESULT_ARTIFACT_TYPE).toBe('ingest_result.json');
    });
});

describe('IngestStage', () => {
    it('returns empty output for null/undefined and empty inputs', async () => {
        const stage = new IngestStage();

        const outputNull = await stage.execute({}, null, {});
        const outputEmpty = await stage.execute({}, { files: {}, urls: {}, historyIds: {}, rawTexts: {} }, {});

        for (const output of [outputNull, outputEmpty]) {
            expect(output.sources).toEqual([]);
            expect(output.assets).toEqual([]);
            expect(output.parseErrors).toEqual([]);
            expect(output.warnings).toEqual([]);
            expect(output.metrics.totalDocs).toBe(0);
            expect(output.metrics.successDocs).toBe(0);
            expect(output.metrics.failedDocs).toBe(0);
        }

        expect(adapterMocks.rawText.parse).not.toHaveBeenCalled();
        expect(adapterMocks.markdown.parse).not.toHaveBeenCalled();
        expect(adapterMocks.history.parse).not.toHaveBeenCalled();
    });

    it('ingests raw texts with assets, long strings, and deep nested inputs', async () => {
        const stage = new IngestStage();
        const bigText = 'x'.repeat(10000);
        const nestedInput = { text: 'hello', title: 'Nested', extra: { deep: { level: { value: 1 } } } };

        adapterMocks.rawText.parse.mockImplementation((input) => {
            const text = typeof input === 'string' ? input : String(input?.text || '');
            const assets = text.length > 50 ? [{ id: 'asset_big', mimeType: 'image/png', data: 'abc' }] : [];
            return Promise.resolve(
                makeParsedDoc({
                    docId: `raw_${text.length}`,
                    sourceType: 'rawText',
                    text,
                    assets,
                    metadata: { title: 'Raw Title' },
                    origin: { title: 'Origin Title' },
                    chunks: [{ text: 'chunk', locator: { start: 0 } }]
                })
            );
        });

        const output = await stage.execute({}, { rawTexts: [bigText, nestedInput] }, {});

        expect(output.sources).toHaveLength(2);
        expect(output.assets).toHaveLength(1);
        expect(output.sources[0].assetIds).toEqual(['asset_big']);
        expect(output.metrics.totalDocs).toBe(2);
        expect(output.metrics.successDocs).toBe(2);
        expect(output.metrics.failedDocs).toBe(0);
    });

    it('sanitizes parse errors, truncates long messages, and handles blank errors', async () => {
        const stage = new IngestStage();
        const longMessage = `  failure   here ${'x'.repeat(260)}  `;

        adapterMocks.rawText.parse.mockImplementation((input) => {
            if (String(input).includes('long')) throw new Error(longMessage);
            throw new Error('   ');
        });

        const output = await stage.execute({}, { rawTexts: ['long', 'blank'] }, {});

        expect(output.parseErrors).toHaveLength(2);
        const longError = output.parseErrors.find((e) => e.origin.includes('raw:'))?.error;
        expect(longError).toMatch(/failure here/);
        expect(longError.endsWith('...')).toBe(true);
        expect(longError.length).toBe(200);

        const unknownError = output.parseErrors.find((e) => e.error === 'Unknown error');
        expect(unknownError).toBeTruthy();
    });

    it('ingests history ids and records parse failures', async () => {
        const stage = new IngestStage();

        adapterMocks.history.parse.mockImplementation((hid) => {
            if (hid === 'bad') throw new Error('history broken');
            return Promise.resolve(makeParsedDoc({ docId: `history_${hid}`, sourceType: 'history', text: hid }));
        });

        const output = await stage.execute({}, { historyIds: ['good', 'bad'] }, {});

        expect(output.sources).toHaveLength(1);
        expect(output.parseErrors).toHaveLength(1);
        expect(output.parseErrors[0].error).toContain('history broken');
        expect(output.metrics.successDocs).toBe(1);
        expect(output.metrics.failedDocs).toBe(1);
    });

    it('falls back to sequential processing for non-positive concurrency (0 and -1)', async () => {
        const stage = new IngestStage();

        const runSequential = async (maxConcurrentDocs) => {
            adapterMocks.rawText.parse.mockReset();
            let active = 0;
            let maxActive = 0;
            adapterMocks.rawText.parse.mockImplementation(async () => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await Promise.resolve();
                active -= 1;
                return makeParsedDoc({ docId: `seq_${active}_${maxActive}`, sourceType: 'rawText', text: 'x' });
            });

            const output = await stage.execute({}, { input: { rawTexts: ['a', 'b'] }, config: { maxConcurrentDocs } }, {});
            expect(output.sources).toHaveLength(2);
            expect(adapterMocks.rawText.parse).toHaveBeenCalledTimes(2);
            expect(maxActive).toBe(1);
        };

        await runSequential(0);
        await runSequential(-1);
    });

    it('caps concurrency at MAX_DOC_CONCURRENCY for huge values', async () => {
        const stage = new IngestStage();
        const rawTexts = Array.from({ length: 20 }, (_, i) => `doc-${i}`);
        const resolvers = [];
        let active = 0;
        let maxActive = 0;

        adapterMocks.rawText.parse.mockImplementation(
            () =>
                new Promise((resolve) => {
                    active += 1;
                    maxActive = Math.max(maxActive, active);
                    resolvers.push(() => {
                        active -= 1;
                        resolve(makeParsedDoc({ docId: `cap_${active}_${resolvers.length}`, sourceType: 'rawText', text: 'cap' }));
                    });
                })
        );

        const execPromise = stage.execute({}, { input: { rawTexts }, config: { maxConcurrentDocs: Number.MAX_SAFE_INTEGER } }, {});
        await Promise.resolve();

        expect(resolvers.length).toBe(16);
        expect(maxActive).toBe(16);

        while (resolvers.length) {
            resolvers.shift()();
            await Promise.resolve();
        }

        const output = await execPromise;
        expect(output.sources).toHaveLength(20);
        expect(output.metrics.successDocs).toBe(20);
    });

    it('handles parallel execute calls without leaking state', async () => {
        const stage = new IngestStage();

        adapterMocks.rawText.parse.mockImplementation((input) => {
            const text = typeof input === 'string' ? input : String(input?.text || '');
            return Promise.resolve(makeParsedDoc({ docId: `doc_${text}`, sourceType: 'rawText', text }));
        });

        const [outOne, outTwo] = await Promise.all([
            stage.execute({ runId: 'run-1' }, { rawTexts: ['one'] }, {}),
            stage.execute({ runId: 'run-2' }, { rawTexts: ['two'] }, {})
        ]);

        expect(outOne.sources[0].sourceId).toBe('doc_one');
        expect(outTwo.sources[0].sourceId).toBe('doc_two');
        expect(outOne.assets).toEqual([]);
        expect(outTwo.assets).toEqual([]);
    });

    it('selects adapters for file types and reports unsupported files', async () => {
        const stage = new IngestStage();

        const files = [
            { name: 'doc.pdf', type: 'application/pdf', size: Number.MAX_SAFE_INTEGER },
            { name: 'slides.pptx' },
            { name: 'report.docx' },
            { name: 'index.html', type: 'text/html' },
            { name: 'book.epub' },
            { name: 'song.mp3', type: 'audio/mpeg' },
            { name: 'movie.mp4', type: 'video/mp4' },
            { name: 'code.js' },
            { name: 'notes.md' },
            { name: 'unknown.bin' },
            { name: 'file', type: '' },
            'plain.txt'
        ];

        const output = await stage.execute({}, { files }, {});

        expect(adapterMocks.pdf.parse).toHaveBeenCalledTimes(1);
        expect(adapterMocks.docx.parse).toHaveBeenCalledTimes(1);
        expect(adapterMocks.pptx.parse).toHaveBeenCalledTimes(1);
        expect(adapterMocks.html.parse).toHaveBeenCalledTimes(1);
        expect(adapterMocks.epub.parse).toHaveBeenCalledTimes(1);
        expect(adapterMocks.audio.parse).toHaveBeenCalledTimes(1);
        expect(adapterMocks.video.parse).toHaveBeenCalledTimes(1);
        expect(adapterMocks.code.parse).toHaveBeenCalledTimes(1);
        expect(adapterMocks.markdown.parse).toHaveBeenCalledTimes(2);

        expect(output.sources).toHaveLength(10);
        expect(output.parseErrors).toHaveLength(2);
        expect(output.parseErrors.find((e) => e.error.includes('.bin'))).toBeTruthy();
        expect(output.parseErrors.find((e) => e.error.includes('(none)'))).toBeTruthy();
    });

    it('ingests urls with urlFetcher, html detection, fallback, and empty url handling', async () => {
        const stage = new IngestStage();

        const urlFetcher = vi.fn(async (url) => {
            if (url.includes('html-fail')) {
                return { text: '<html><body>fail</body></html>', contentType: 'text/html', title: 'Fail' };
            }
            if (url.includes('example')) {
                return { text: '<!doctype html><html></html>', contentType: 'text/html', title: 'Example' };
            }
            if (url.includes('text')) {
                return { text: 'plain text', contentType: 'text/plain', title: 'Text' };
            }
            return '';
        });

        adapterMocks.html.parse.mockImplementation((file) => {
            if (file?.name?.includes('html-fail')) throw new Error('html parse failed');
            return Promise.resolve(makeParsedDoc({ docId: `html_${file?.name}`, sourceType: 'html', text: 'html' }));
        });

        adapterMocks.rawText.parse.mockImplementation((input) => {
            const text = typeof input === 'string' ? input : String(input?.text || '');
            return Promise.resolve(makeParsedDoc({ docId: `raw_${text}`, sourceType: 'rawText', text }));
        });

        const output = await stage.execute(
            {},
            { urls: [' https://example.com ', 'https://text.local', 'https://html-fail.local', '   '] },
            { urlFetcher }
        );

        expect(urlFetcher).toHaveBeenCalledTimes(3);
        expect(adapterMocks.html.parse).toHaveBeenCalledTimes(2);
        expect(adapterMocks.rawText.parse).toHaveBeenCalledTimes(2);
        expect(output.sources).toHaveLength(3);
        expect(output.parseErrors).toHaveLength(1);
        expect(output.parseErrors[0].error).toBe('URL is empty');
    });

    it('reports oversized url responses using maxUrlBytes', async () => {
        const stage = new IngestStage();
        const urlFetcher = vi.fn(async () => '123456');

        const output = await stage.execute({}, { urls: ['https://big.local'] }, { urlFetcher, maxUrlBytes: 5 });

        expect(output.sources).toHaveLength(0);
        expect(output.parseErrors).toHaveLength(1);
        expect(output.parseErrors[0].error).toContain('exceeded 5 bytes');
    });

    it('resumes from cached artifact when fingerprint matches and skips processing', async () => {
        const stage = new IngestStage();
        const input = { rawTexts: ['resume me'] };
        const writerStore = {
            getArtifact: vi.fn(async () => null),
            saveArtifact: vi.fn(async () => true)
        };

        await stage.execute({ runId: 'run-123' }, input, { runStore: writerStore });
        const cachedArtifact = {
            ...(writerStore.saveArtifact.mock.calls.at(-1)?.[2] || {}),
            processedOrigins: [buildRawTextOrigin('resume me')]
        };
        expect(cachedArtifact?.kind).toBe('ingest_result');
        expect(cachedArtifact?.output).toBeTruthy();

        adapterMocks.rawText.parse.mockClear();

        const runStore = {
            getArtifact: vi.fn(async () => JSON.stringify(cachedArtifact)),
            saveArtifact: vi.fn(async () => true)
        };
        const stage2 = new IngestStage();
        const output = await stage2.execute({ runId: 'run-123' }, input, { runStore });

        expect(output.sources).toEqual(cachedArtifact.output.sources);
        expect(output.assets).toEqual(cachedArtifact.output.assets);
        expect(runStore.getArtifact).toHaveBeenCalled();
        expect(runStore.saveArtifact).toHaveBeenCalled();
    });

    it('adds understanding results to assets when enabled', async () => {
        const stage = new IngestStage();
        adapterMocks.rawText.parse.mockImplementation(() =>
            Promise.resolve(
                makeParsedDoc({
                    docId: 'doc-assets',
                    sourceType: 'rawText',
                    text: 'assets',
                    assets: [{ id: 'asset-1', mimeType: 'image/png', docId: 'doc-assets', understanding: { a: 1 } }]
                })
            )
        );

        runAssetUnderstandingMock.mockResolvedValue([{ b: 2 }]);

        const output = await stage.execute(
            {},
            { input: { rawTexts: ['assets'] }, config: { understandAssets: true, visionApi: { name: 'vision' }, modelRouter: { name: 'router' } } },
            {}
        );

        expect(runAssetUnderstandingMock).toHaveBeenCalledTimes(1);
        expect(output.assets[0].understanding).toEqual({ a: 1, b: 2 });
    });

    it('times out document parsing when docTimeoutMs is exceeded', async () => {
        vi.useFakeTimers();
        const stage = new IngestStage();

        adapterMocks.rawText.parse.mockImplementation(() => new Promise(() => {}));

        const execPromise = stage.execute({}, { input: { rawTexts: ['slow'] }, config: { docTimeoutMs: 5 } }, {});
        await vi.advanceTimersByTimeAsync(5);
        const output = await execPromise;

        expect(output.parseErrors).toHaveLength(1);
        expect(output.parseErrors[0].error).toContain('Timeout after 5ms');
    });

    it('throws when stageApi signal is already aborted', async () => {
        const stage = new IngestStage();
        const controller = new AbortController();
        controller.abort('Stop');

        await expect(stage.execute({}, { rawTexts: ['a'] }, { signal: controller.signal })).rejects.toThrow('Stop');
        expect(adapterMocks.rawText.parse).not.toHaveBeenCalled();
    });
});
