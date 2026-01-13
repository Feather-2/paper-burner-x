/**
 * @file tests/history/history-modules.test.js
 * @description 测试 js/history 拆分后的模块
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// utils.js
import {
    debounce,
    recordMatchesQuery,
    escapeHtml,
    escapeAttr,
    sanitizeId,
    sanitizeFileName,
    sanitizePath,
    formatDisplayTime,
    buildSnippetText,
    buildRelativePathLabel,
    isChunkFailed
} from '../../js/history/utils.js';

describe('js/history/utils.js', () => {
    describe('debounce', () => {
        it('should be a function', () => {
            expect(typeof debounce).toBe('function');
        });

        it('should return a function', () => {
            const debounced = debounce(() => {}, 100);
            expect(typeof debounced).toBe('function');
        });

        it('should delay function execution', async () => {
            vi.useFakeTimers();
            const fn = vi.fn();
            const debounced = debounce(fn, 100);

            debounced();
            expect(fn).not.toHaveBeenCalled();

            vi.advanceTimersByTime(50);
            expect(fn).not.toHaveBeenCalled();

            vi.advanceTimersByTime(60);
            expect(fn).toHaveBeenCalledTimes(1);

            vi.useRealTimers();
        });

        it('should only call once for multiple rapid calls', async () => {
            vi.useFakeTimers();
            const fn = vi.fn();
            const debounced = debounce(fn, 100);

            debounced();
            debounced();
            debounced();

            vi.advanceTimersByTime(150);
            expect(fn).toHaveBeenCalledTimes(1);

            vi.useRealTimers();
        });
    });

    describe('recordMatchesQuery', () => {
        it('should return true for empty query', () => {
            expect(recordMatchesQuery({}, '')).toBe(true);
            expect(recordMatchesQuery({}, null)).toBe(true);
        });

        it('should match by name', () => {
            const record = { name: 'Test Document' };
            expect(recordMatchesQuery(record, 'test')).toBe(true);
            expect(recordMatchesQuery(record, 'document')).toBe(true);
            expect(recordMatchesQuery(record, 'xyz')).toBe(false);
        });

        it('should match by relativePath', () => {
            const record = { relativePath: 'folder/subfolder/file.pdf' };
            expect(recordMatchesQuery(record, 'folder')).toBe(true);
            expect(recordMatchesQuery(record, 'subfolder')).toBe(true);
        });

        it('should match by batchId', () => {
            const record = { batchId: 'batch-12345' };
            expect(recordMatchesQuery(record, '12345')).toBe(true);
        });

        it('should be case insensitive', () => {
            const record = { name: 'UPPERCASE NAME' };
            expect(recordMatchesQuery(record, 'uppercase')).toBe(true);
        });
    });

    describe('escapeHtml', () => {
        it('should escape HTML special characters', () => {
            expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
            expect(escapeHtml('a & b')).toBe('a &amp; b');
            expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
            expect(escapeHtml("'single'")).toBe('&#39;single&#39;');
        });

        it('should handle null/undefined', () => {
            expect(escapeHtml(null)).toBe('');
            expect(escapeHtml(undefined)).toBe('');
        });

        it('should return same string if no special chars', () => {
            expect(escapeHtml('normal text')).toBe('normal text');
        });
    });

    describe('escapeAttr', () => {
        it('should escape for attribute context', () => {
            expect(escapeAttr('<"test">')).toBe('&lt;&quot;test&quot;&gt;');
        });
    });

    describe('sanitizeId', () => {
        it('should keep only alphanumeric, underscore, hyphen', () => {
            expect(sanitizeId('valid-id_123')).toBe('valid-id_123');
            expect(sanitizeId('invalid@#$%id')).toBe('invalid____id');
        });

        it('should handle null/undefined', () => {
            expect(sanitizeId(null)).toBe('');
            expect(sanitizeId(undefined)).toBe('');
        });
    });

    describe('sanitizeFileName', () => {
        it('should replace invalid filename characters', () => {
            expect(sanitizeFileName('file:name')).toBe('file_name');
            expect(sanitizeFileName('file/name')).toBe('file_name');
            expect(sanitizeFileName('file<name>test')).toBe('file_name_test');
        });

        it('should default to "document" for empty', () => {
            expect(sanitizeFileName('')).toBe('document');
            expect(sanitizeFileName(null)).toBe('document');
        });
    });

    describe('sanitizePath', () => {
        it('should sanitize each path segment', () => {
            expect(sanitizePath('folder/sub:folder/file')).toBe('folder/sub_folder/file');
        });

        it('should handle empty path', () => {
            // sanitizePath uses sanitizeFileName internally which defaults to 'document'
            const result = sanitizePath('');
            expect(typeof result).toBe('string');
        });
    });

    describe('formatDisplayTime', () => {
        it('should format valid date', () => {
            const date = new Date('2024-01-15T10:30:00');
            const result = formatDisplayTime(date);
            expect(result).not.toBe('未知时间');
        });

        it('should return "未知时间" for invalid input', () => {
            expect(formatDisplayTime(null)).toBe('未知时间');
            expect(formatDisplayTime('')).toBe('未知时间');
            expect(formatDisplayTime('invalid')).toBe('未知时间');
        });

        it('should handle timestamp number', () => {
            const result = formatDisplayTime(1705312200000);
            expect(result).not.toBe('未知时间');
        });
    });

    describe('buildSnippetText', () => {
        it('should return "无" for empty text', () => {
            expect(buildSnippetText('')).toBe('无');
            expect(buildSnippetText(null)).toBe('无');
        });

        it('should truncate long text', () => {
            const longText = 'a'.repeat(100);
            const result = buildSnippetText(longText);
            expect(result).toContain('...');
            expect(result.length).toBeLessThan(100);
        });

        it('should not truncate short text', () => {
            const shortText = 'short text';
            const result = buildSnippetText(shortText);
            expect(result).not.toContain('...');
        });

        it('should normalize whitespace', () => {
            const result = buildSnippetText('text  with   spaces');
            expect(result).toBe('text with spaces');
        });
    });

    describe('buildRelativePathLabel', () => {
        it('should return relativePath if present', () => {
            const record = { relativePath: 'path/to/file' };
            expect(buildRelativePathLabel(record)).toBe('path/to/file');
        });

        it('should fallback to file.pbxRelativePath', () => {
            const record = { file: { pbxRelativePath: 'fallback/path' } };
            expect(buildRelativePathLabel(record)).toBe('fallback/path');
        });

        it('should return empty string if no path', () => {
            expect(buildRelativePathLabel({})).toBe('');
        });
    });

    describe('isChunkFailed', () => {
        it('should return true for null/undefined', () => {
            expect(isChunkFailed(null)).toBe(true);
            expect(isChunkFailed(undefined)).toBe(true);
        });

        it('should return true for empty string', () => {
            expect(isChunkFailed('')).toBe(true);
            expect(isChunkFailed('   ')).toBe(true);
        });

        it('should return true for failure markers', () => {
            expect(isChunkFailed('[翻译失败]')).toBe(true);
            expect(isChunkFailed('[处理错误]')).toBe(true);
            expect(isChunkFailed('[翻译错误]')).toBe(true);
            expect(isChunkFailed('> **[翻译意外失败]**')).toBe(true);
        });

        it('should return true for "保留原文 Part" pattern', () => {
            expect(isChunkFailed('保留原文 Part 1')).toBe(true);
        });

        it('should return false for normal text', () => {
            expect(isChunkFailed('This is normal translated text.')).toBe(false);
            expect(isChunkFailed('正常翻译内容')).toBe(false);
        });
    });
});
