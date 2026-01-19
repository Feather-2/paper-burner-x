// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import katex from 'katex';

import { MathConverter } from '../../../../js/ppt/core/math-converter.js';

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
const OMML_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const PPT_A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function parseXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const errors = doc.getElementsByTagName('parsererror');
  expect(errors.length).toBe(0);
  return doc;
}

describe('MathConverter', () => {
  let converter;
  let previousKatex;

  beforeEach(() => {
    converter = new MathConverter();
    previousKatex = globalThis.katex;
  });

  afterEach(() => {
    if (previousKatex === undefined) {
      delete globalThis.katex;
    } else {
      globalThis.katex = previousKatex;
    }
  });

  describe('latexToMathML()', () => {
    it('returns null for empty input', () => {
      globalThis.katex = katex;
      expect(converter.latexToMathML('')).toBeNull();
      expect(converter.latexToMathML(null)).toBeNull();
    });

    it('extracts <math> from KaTeX MathML output', () => {
      globalThis.katex = katex;

      const mathml = converter.latexToMathML('\\frac{1}{2}');

      expect(mathml).toMatch(/^<math[\s\S]*<\/math>$/i);
      expect(mathml).toContain('<mfrac');

      const doc = parseXml(mathml);
      expect(doc.documentElement.localName).toBe('math');
      expect(doc.documentElement.namespaceURI).toBe(MATHML_NS);
      expect(doc.getElementsByTagName('mfrac').length).toBeGreaterThan(0);
    });

    it('returns null when KaTeX is unavailable', () => {
      delete globalThis.katex;
      expect(converter.latexToMathML('x')).toBeNull();
    });
  });

  describe('mathMLToOMML()', () => {
    it('returns null for empty or invalid MathML', () => {
      expect(converter.mathMLToOMML('')).toBeNull();
      expect(converter.mathMLToOMML(null)).toBeNull();
      expect(converter.mathMLToOMML('<not-math></not-math>')).toBeNull();
    });

    it('converts common MathML nodes to OMML', () => {
      const mathml = `<math xmlns="${MATHML_NS}"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>`;
      const omml = converter.mathMLToOMML(mathml);

      expect(omml).toContain('<m:oMath');
      expect(omml).toContain('<m:f>');
      expect(omml).toContain('<m:num>');
      expect(omml).toContain('<m:den>');
      expect(omml).toContain('<m:sty m:val="i"');

      const doc = parseXml(omml);
      expect(doc.documentElement.localName).toBe('oMath');
      expect(doc.documentElement.namespaceURI).toBe(OMML_NS);
      expect(doc.getElementsByTagNameNS(OMML_NS, 'f').length).toBe(1);
    });

    it('handles msup and mfenced attributes', () => {
      const mathml = `<math xmlns="${MATHML_NS}"><mrow><mfenced open="[" close="]"><msup><mi>x</mi><mn>2</mn></msup></mfenced></mrow></math>`;
      const omml = converter.mathMLToOMML(mathml);

      expect(omml).toContain('<m:sSup>');
      expect(omml).toContain('<m:dPr>');
      expect(omml).toContain('m:begChr m:val="["');
      expect(omml).toContain('m:endChr m:val="]"');

      parseXml(omml);
    });
  });

  describe('latexToOMML()', () => {
    it('uses direct fallback when KaTeX is unavailable', () => {
      delete globalThis.katex;

      expect(converter.latexToMathML('x')).toBeNull();

      const omml = converter.latexToOMML('\\alpha + \\beta');
      expect(omml).toContain('<m:oMath');
      expect(omml).toContain('α');
      expect(omml).toContain('β');

      parseXml(omml);
    });

    it('uses MathML path when KaTeX is available (italic mi)', () => {
      globalThis.katex = katex;

      const omml = converter.latexToOMML('x');
      expect(omml).toContain('<m:oMath');
      expect(omml).toContain('<m:sty m:val="i"');
      expect(omml).toContain('<m:t>x</m:t>');

      parseXml(omml);
    });

    it('escapes XML characters in fallback output', () => {
      delete globalThis.katex;
      const omml = converter.latexToOMML('a & b < c');
      expect(omml).toContain('a &amp; b &lt; c');
    });
  });

  describe('generateOMLParagraph()', () => {
    it('returns null when OMML conversion fails', () => {
      globalThis.katex = katex;
      expect(converter.generateOMLParagraph('')).toBeNull();
      expect(converter.generateOMLParagraph(null)).toBeNull();
    });

    it('wraps OMML into a PowerPoint paragraph snippet', () => {
      globalThis.katex = katex;

      const xml = converter.generateOMLParagraph('x', { align: 'l' });

      expect(xml).toContain('<a:p>');
      expect(xml).toContain('algn="l"');
      expect(xml).toContain('<a14:m ');
      expect(xml).toContain('<m:oMathPara ');
      expect(xml).toContain('m:jc m:val="l"');
      expect(xml).not.toContain('\n');

      // Provide the missing `a` namespace for standalone XML parsing.
      parseXml(`<root xmlns:a="${PPT_A_NS}">${xml}</root>`);
    });
  });
});

