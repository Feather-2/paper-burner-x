// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import JSZip from 'jszip';

import { exportAsDocx } from '../../js/history/exporter/history_exporter_docx.js';

function listZipFiles(zip) {
  return Object.keys(zip.files).sort();
}

async function blobToArrayBuffer(blob) {
  if (blob && typeof blob.arrayBuffer === 'function') {
    return await blob.arrayBuffer();
  }

  if (typeof FileReader === 'undefined') {
    if (typeof Response !== 'undefined') {
      return await new Response(blob).arrayBuffer();
    }
    throw new Error('Blob does not support arrayBuffer() and no fallback is available');
  }

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsArrayBuffer(blob);
  });
}

describe('history exporter (DOCX)', () => {
  let previousJSZip;
  let consoleSpies;

  beforeEach(() => {
    previousJSZip = window.JSZip;
    window.JSZip = JSZip;

    consoleSpies = ['log', 'warn', 'error'].map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    );
  });

  afterEach(() => {
    consoleSpies?.forEach((spy) => spy.mockRestore());
    consoleSpies = null;

    if (previousJSZip === undefined) {
      delete window.JSZip;
    } else {
      window.JSZip = previousJSZip;
    }
    previousJSZip = undefined;
  });

  it('throws when JSZip is not available', async () => {
    delete window.JSZip;

    await expect(
      exportAsDocx({ bodyHtml: '<p>hello</p>' }, { returnBlob: true, fileName: 'x.docx' })
    ).rejects.toThrow(/JSZip/);
  });

  it('exports a DOCX blob with required package parts', async () => {
    const payload = {
      bodyHtml: '<p>Hello & world</p>',
      data: { name: 'Sample' }
    };

    const { fileName, blob } = await exportAsDocx(payload, {
      returnBlob: true,
      fileName: 'history:export'
    });

    expect(fileName).toBe('history_export.docx');
    expect(blob).toBeInstanceOf(Blob);

    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
    const files = listZipFiles(zip);

    expect(files).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        '_rels/.rels',
        'docProps/app.xml',
        'docProps/core.xml',
        'word/document.xml',
        'word/footer1.xml',
        'word/styles.xml',
        'word/_rels/document.xml.rels'
      ])
    );

    const documentXml = await zip.file('word/document.xml').async('string');
    expect(documentXml).toContain('<w:document');
    expect(documentXml).toContain('<w:body>');
    expect(documentXml).toContain('Hello &amp; world');

    const relsXml = await zip.file('word/_rels/document.xml.rels').async('string');
    expect(relsXml).toContain('relationships/footer');
    expect(relsXml).toContain('footer1.xml');
  });

  it('respects includeBranding=false (no footer part or relationship)', async () => {
    const payload = { bodyHtml: '<p>Hi</p>' };

    const { blob } = await exportAsDocx(payload, {
      returnBlob: true,
      fileName: 'nobrand',
      includeBranding: false
    });

    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
    const files = listZipFiles(zip);

    expect(files).not.toContain('word/footer1.xml');

    const documentXml = await zip.file('word/document.xml').async('string');
    expect(documentXml).not.toContain('footerReference');

    const relsXml = await zip.file('word/_rels/document.xml.rels').async('string');
    expect(relsXml).not.toContain('relationships/footer');
  });
});
