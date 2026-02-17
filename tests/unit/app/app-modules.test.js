/**
 * @file tests/app/app-modules.test.js
 * @description 测试 js/app 拆分后的模块
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// state.js
import {
    MAX_RETRIES,
    DEFAULT_BATCH_TEMPLATE,
    SUPPORTED_FILE_EXTENSIONS,
    SUPPORTED_ARCHIVE_EXTENSIONS,
    pdfFiles,
    allResults,
    processedFilesRecord,
    isProcessing,
    activeProcessingCount,
    retryAttempts,
    batchModeEnabled,
    batchModeTemplate,
    batchModeFormats,
    batchModeZipEnabled,
    batchConfigCollapsed,
    excludedExtensions,
    activeBatchSession,
    setPdfFiles,
    setAllResults,
    setProcessedFilesRecord,
    setIsProcessing,
    setActiveProcessingCount,
    setBatchModeEnabled,
    setBatchModeTemplate,
    setBatchModeFormats,
    setBatchModeZipEnabled,
    setBatchConfigCollapsed,
    setActiveBatchSession
} from '../../../js/app/state.js';

// concurrency.js
import {
    translationSemaphore,
    acquireTranslationSlot,
    releaseTranslationSlot,
    resetTranslationSemaphore
} from '../../../js/app/concurrency.js';

// key-provider.js
import { KeyProvider } from '../../../js/app/key-provider.js';

describe('js/app/state.js', () => {
    describe('Constants', () => {
        it('should export MAX_RETRIES as 3', () => {
            expect(MAX_RETRIES).toBe(3);
        });

        it('should export DEFAULT_BATCH_TEMPLATE', () => {
            expect(DEFAULT_BATCH_TEMPLATE).toContain('{original_name}');
        });

        it('should export SUPPORTED_FILE_EXTENSIONS', () => {
            expect(SUPPORTED_FILE_EXTENSIONS).toContain('pdf');
            expect(SUPPORTED_FILE_EXTENSIONS).toContain('md');
            expect(SUPPORTED_FILE_EXTENSIONS).toContain('docx');
        });

        it('should export SUPPORTED_ARCHIVE_EXTENSIONS', () => {
            expect(SUPPORTED_ARCHIVE_EXTENSIONS).toContain('zip');
        });
    });

    describe('State Variables', () => {
        it('should export initial state values', () => {
            expect(Array.isArray(pdfFiles)).toBe(true);
            expect(Array.isArray(allResults)).toBe(true);
            expect(typeof processedFilesRecord).toBe('object');
            expect(typeof isProcessing).toBe('boolean');
            expect(typeof activeProcessingCount).toBe('number');
            expect(retryAttempts instanceof Map).toBe(true);
        });

        it('should export batch mode settings', () => {
            expect(typeof batchModeEnabled).toBe('boolean');
            expect(typeof batchModeTemplate).toBe('string');
            expect(Array.isArray(batchModeFormats)).toBe(true);
            expect(typeof batchModeZipEnabled).toBe('boolean');
            expect(typeof batchConfigCollapsed).toBe('boolean');
        });

        it('should export excludedExtensions as Set', () => {
            expect(excludedExtensions instanceof Set).toBe(true);
        });
    });

    describe('State Setters', () => {
        it('setPdfFiles should update pdfFiles', () => {
            const files = [{ name: 'test.pdf' }];
            setPdfFiles(files);
            expect(pdfFiles).toBe(files);
            setPdfFiles([]);
        });

        it('setAllResults should update allResults', () => {
            const results = [{ id: 1 }];
            setAllResults(results);
            expect(allResults).toBe(results);
            setAllResults([]);
        });

        it('setProcessedFilesRecord should update processedFilesRecord', () => {
            const record = { 'test.pdf': true };
            setProcessedFilesRecord(record);
            expect(processedFilesRecord).toBe(record);
            setProcessedFilesRecord({});
        });

        it('setIsProcessing should update isProcessing', () => {
            setIsProcessing(true);
            expect(isProcessing).toBe(true);
            setIsProcessing(false);
        });

        it('setActiveProcessingCount should update activeProcessingCount', () => {
            setActiveProcessingCount(3);
            expect(activeProcessingCount).toBe(3);
            setActiveProcessingCount(0);
        });

        it('setBatchModeEnabled should update batchModeEnabled', () => {
            setBatchModeEnabled(true);
            expect(batchModeEnabled).toBe(true);
            setBatchModeEnabled(false);
        });

        it('setBatchModeTemplate should update batchModeTemplate', () => {
            const template = '{name}.md';
            setBatchModeTemplate(template);
            expect(batchModeTemplate).toBe(template);
            setBatchModeTemplate(DEFAULT_BATCH_TEMPLATE);
        });

        it('setBatchModeFormats should update batchModeFormats', () => {
            const formats = ['original'];
            setBatchModeFormats(formats);
            expect(batchModeFormats).toBe(formats);
            setBatchModeFormats(['original', 'markdown']);
        });

        it('setBatchModeZipEnabled should update batchModeZipEnabled', () => {
            setBatchModeZipEnabled(true);
            expect(batchModeZipEnabled).toBe(true);
            setBatchModeZipEnabled(false);
        });

        it('setBatchConfigCollapsed should update batchConfigCollapsed', () => {
            setBatchConfigCollapsed(false);
            expect(batchConfigCollapsed).toBe(false);
            setBatchConfigCollapsed(true);
        });

        it('setActiveBatchSession should update activeBatchSession', () => {
            const session = {
                id: 'session-1',
                total: 1,
                template: '{name}.md',
                formats: ['original'],
                outputLanguage: 'en',
                startedAt: new Date().toISOString(),
                counter: 0
            };
            setActiveBatchSession(session);
            expect(activeBatchSession).toBe(session);
            setActiveBatchSession(null);
        });
    });
});

describe('js/app/concurrency.js', () => {
    beforeEach(() => {
        resetTranslationSemaphore(2);
    });

    describe('translationSemaphore', () => {
        it('should have default limit of 2', () => {
            expect(translationSemaphore.limit).toBe(2);
        });

        it('should have count starting at 0', () => {
            expect(translationSemaphore.count).toBe(0);
        });

        it('should have empty queue', () => {
            expect(translationSemaphore.queue).toEqual([]);
        });
    });

    describe('acquireTranslationSlot', () => {
        it('should acquire slot immediately when under limit', async () => {
            await acquireTranslationSlot();
            expect(translationSemaphore.count).toBe(1);
        });

        it('should allow acquiring up to limit', async () => {
            await acquireTranslationSlot();
            await acquireTranslationSlot();
            expect(translationSemaphore.count).toBe(2);
        });

        it('should queue when at limit', async () => {
            await acquireTranslationSlot();
            await acquireTranslationSlot();

            // This should be queued
            const promise = acquireTranslationSlot();
            expect(translationSemaphore.queue.length).toBe(1);

            // Release one slot to unqueue
            releaseTranslationSlot();
            await promise;
        });
    });

    describe('releaseTranslationSlot', () => {
        it('should decrement count', async () => {
            await acquireTranslationSlot();
            expect(translationSemaphore.count).toBe(1);
            releaseTranslationSlot();
            expect(translationSemaphore.count).toBe(0);
        });

        it('should process queued requests', async () => {
            await acquireTranslationSlot();
            await acquireTranslationSlot();

            const queuedPromise = acquireTranslationSlot();
            expect(translationSemaphore.queue.length).toBe(1);

            releaseTranslationSlot();
            await queuedPromise;

            expect(translationSemaphore.queue.length).toBe(0);
        });
    });

    describe('resetTranslationSemaphore', () => {
        it('should reset with new limit', () => {
            resetTranslationSemaphore(5);
            expect(translationSemaphore.limit).toBe(5);
            expect(translationSemaphore.count).toBe(0);
            expect(translationSemaphore.queue).toEqual([]);
        });
    });
});

describe('js/app/key-provider.js', () => {
    describe('KeyProvider', () => {
        it('should construct an instance', () => {
            const instance = new KeyProvider('test-model');
            expect(instance).toBeInstanceOf(KeyProvider);
        });

        it('should report no available keys by default', () => {
            const instance = new KeyProvider('test-model');
            const hasKeys = instance.hasAvailableKeys();
            expect(typeof hasKeys).toBe('boolean');
            expect(hasKeys).toBe(false);
        });

        it('should return null when no keys are available', () => {
            const instance = new KeyProvider('test-model');
            expect(instance.getNextKey()).toBeNull();
        });
    });
});
