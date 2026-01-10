/**
 * @file tests/core/file-utils.test.js
 * @description core/file/file-utils.js unit tests
 */

import { describe, expect, it } from 'vitest';

import {
  SUPPORTED_ARCHIVES,
  SUPPORTED_EXTENSIONS,
  annotateFileMetadata,
  deriveExtension,
  getDisplayName,
  getFileIdentifier,
  isSupportedArchive,
  isSupportedFileExtension,
  shouldProcessFile,
} from '../../js/core/file/file-utils.js';

describe('core/file/file-utils.js', () => {
  describe('deriveExtension', () => {
    it('returns empty string for invalid inputs', () => {
      expect(deriveExtension()).toBe('');
      expect(deriveExtension(null)).toBe('');
      expect(deriveExtension(123)).toBe('');
      expect(deriveExtension('')).toBe('');
    });

    it('extracts the last extension segment and lowercases it', () => {
      expect(deriveExtension('report.PDF')).toBe('pdf');
      expect(deriveExtension('a.b.c')).toBe('c');
    });

    it('returns empty string when filename has no extension', () => {
      expect(deriveExtension('README')).toBe('');
    });

    it('treats dotfiles as having an extension (current behavior)', () => {
      expect(deriveExtension('.bashrc')).toBe('bashrc');
    });
  });

  describe('isSupportedFileExtension / isSupportedArchive', () => {
    it('is case-insensitive and uses the built-in allowlists', () => {
      expect(SUPPORTED_EXTENSIONS.length).toBeGreaterThan(0);
      expect(SUPPORTED_ARCHIVES.length).toBeGreaterThan(0);

      expect(isSupportedFileExtension('pdf')).toBe(true);
      expect(isSupportedFileExtension('PDF')).toBe(true);
      expect(isSupportedFileExtension('exe')).toBe(false);
      expect(isSupportedFileExtension('')).toBe(false);

      expect(isSupportedArchive('zip')).toBe(true);
      expect(isSupportedArchive('ZIP')).toBe(true);
      expect(isSupportedArchive('rar')).toBe(false);
      expect(isSupportedArchive('')).toBe(false);
    });
  });

  describe('getFileIdentifier', () => {
    it('builds a stable identifier from name/size/lastModified', () => {
      expect(getFileIdentifier({ name: 'a.pdf', size: 100, lastModified: 123 })).toBe('a.pdf_100_123');
      expect(getFileIdentifier(null)).toBe('');
    });
  });

  describe('annotateFileMetadata', () => {
    it('sets relativePath to provided value or falls back to file.name', () => {
      const file1 = { name: 'a.pdf' };
      annotateFileMetadata(file1, 'folder/a.pdf');
      expect(file1.relativePath).toBe('folder/a.pdf');

      const file2 = { name: 'b.pdf' };
      annotateFileMetadata(file2);
      expect(file2.relativePath).toBe('b.pdf');
    });

    it('does not throw when the file is read-only/non-extensible', () => {
      const frozen = Object.freeze({ name: 'a.pdf' });
      expect(() => annotateFileMetadata(frozen, 'x')).not.toThrow();
      expect(frozen.relativePath).toBeUndefined();
    });
  });

  describe('shouldProcessFile', () => {
    it('accepts supported files and archives', () => {
      expect(shouldProcessFile({ name: 'a.pdf' })).toBe(true);
      expect(shouldProcessFile({ name: 'b.ZIP' })).toBe(true);
      expect(shouldProcessFile({ name: 'c.exe' })).toBe(false);
      expect(shouldProcessFile(null)).toBe(false);
    });

    it('respects excludedExtensions', () => {
      const excluded = new Set(['pdf']);
      expect(shouldProcessFile({ name: 'a.pdf' }, excluded)).toBe(false);
      expect(shouldProcessFile({ name: 'a.PDF' }, excluded)).toBe(false);
    });
  });

  describe('getDisplayName', () => {
    it('returns relativePath when present, otherwise file.name', () => {
      expect(getDisplayName(null)).toBe('');
      expect(getDisplayName({ name: 'a.pdf' })).toBe('a.pdf');
      expect(getDisplayName({ name: 'a.pdf', relativePath: 'folder/a.pdf' })).toBe('folder/a.pdf');
    });
  });
});

