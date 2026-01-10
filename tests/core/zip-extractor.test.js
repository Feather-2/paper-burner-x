// @vitest-environment jsdom
/**
 * @file tests/core/zip-extractor.test.js
 * @description core/file/zip-extractor.js unit tests
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  extractFilesFromDataTransfer,
  extractFilesFromZip,
  getSourceArchive,
  isFromZip,
} from '../../js/core/file/zip-extractor.js';

const ORIGINAL_JSZIP_DESCRIPTOR = Object.getOwnPropertyDescriptor(globalThis, 'JSZip');

const restoreJSZip = () => {
  if (ORIGINAL_JSZIP_DESCRIPTOR) {
    Object.defineProperty(globalThis, 'JSZip', ORIGINAL_JSZIP_DESCRIPTOR);
    return;
  }
  Reflect.deleteProperty(globalThis, 'JSZip');
};

afterEach(() => {
  restoreJSZip();
});

function makeZipEntry(content, type = 'text/plain') {
  return {
    dir: false,
    async: async () => new Blob([content], { type }),
  };
}

describe('core/file/zip-extractor.js', () => {
  it('extractFilesFromZip throws when JSZip is not loaded', async () => {
    Reflect.deleteProperty(globalThis, 'JSZip');
    const zipFile = new File([new Blob(['zip'], { type: 'application/zip' })], 'archive.zip', {
      type: 'application/zip',
      lastModified: 123,
    });

    await expect(extractFilesFromZip(zipFile)).rejects.toThrow('JSZip library not loaded');
  });

  it('extractFilesFromZip extracts supported files and strips root folder by default', async () => {
    globalThis.JSZip = {
      loadAsync: async () => ({
        files: {
          'root/a.pdf': makeZipEntry('a', 'application/pdf'),
          'root/b.exe': makeZipEntry('b', 'application/octet-stream'),
          'root/dir/': { dir: true },
          'root/sub/readme.md': makeZipEntry('# hi', 'text/markdown'),
          'root\\notes.txt': makeZipEntry('notes', 'text/plain'),
        },
      }),
    };

    const zipFile = new File([new Blob(['zip'], { type: 'application/zip' })], 'archive.zip', {
      type: 'application/zip',
      lastModified: 456,
    });

    const out = await extractFilesFromZip(zipFile);

    const rels = out.map((f) => f.relativePath).sort();
    expect(rels).toEqual(['a.pdf', 'notes.txt', 'sub/readme.md']);

    expect(out.every(isFromZip)).toBe(true);
    expect(out.map(getSourceArchive)).toEqual(['archive.zip', 'archive.zip', 'archive.zip']);
    expect(out.every((f) => f.lastModified === 456)).toBe(true);
  });

  it('extractFilesFromZip filters by pathPrefix and rewrites relativePath', async () => {
    globalThis.JSZip = {
      loadAsync: async () => ({
        files: {
          'root/a.pdf': makeZipEntry('a', 'application/pdf'),
          'root/sub/readme.md': makeZipEntry('# hi', 'text/markdown'),
        },
      }),
    };

    const zipFile = new File([new Blob(['zip'], { type: 'application/zip' })], 'archive.zip', {
      type: 'application/zip',
      lastModified: 456,
    });

    const out = await extractFilesFromZip(zipFile, { pathPrefix: 'root/sub' });

    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('readme.md');
    expect(out[0].relativePath).toBe('readme.md');
  });

  it('extractFilesFromDataTransfer falls back to dataTransfer.files when entry API is unavailable', async () => {
    const a = { name: 'a.pdf' };
    const b = { name: 'b.txt', relativePath: 'old' };
    const dataTransfer = { items: [], files: [a, b] };

    const out = await extractFilesFromDataTransfer(dataTransfer);

    expect(out).toEqual([a, b]);
    expect(a.relativePath).toBe('a.pdf');
    expect(b.relativePath).toBe('b.txt');
  });

  it('extractFilesFromDataTransfer uses entry API for file entries', async () => {
    const fileObj = { name: 'a.pdf' };

    const fileEntry = {
      isFile: true,
      isDirectory: false,
      file: (onSuccess) => onSuccess(fileObj),
    };

    const dataTransfer = {
      items: [{ webkitGetAsEntry: () => fileEntry }],
      files: [{ name: 'fallback.pdf' }],
    };

    const out = await extractFilesFromDataTransfer(dataTransfer);
    expect(out).toEqual([fileObj]);
    expect(fileObj.relativePath).toBe('a.pdf');
  });

  it('extractFilesFromDataTransfer uses entry API for directory entries (recursive)', async () => {
    const innerFile = { name: 'b.pdf' };

    const innerFileEntry = {
      isFile: true,
      isDirectory: false,
      file: (onSuccess) => onSuccess(innerFile),
    };

    const dirEntry = {
      isFile: false,
      isDirectory: true,
      name: 'dir',
      createReader: () => ({
        readEntries: (onSuccess) => onSuccess([innerFileEntry]),
      }),
    };

    const dataTransfer = {
      items: [{ webkitGetAsEntry: () => dirEntry }],
      files: [{ name: 'fallback.pdf' }],
    };

    const out = await extractFilesFromDataTransfer(dataTransfer);
    expect(out).toEqual([innerFile]);
    expect(innerFile.relativePath).toBe('dir/b.pdf');
  });
});

