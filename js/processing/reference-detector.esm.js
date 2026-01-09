import './reference-detector.js';

const root = globalThis;
const api = root.ReferenceDetector;

if (root.window && !root.window.ReferenceDetector && api) {
  root.window.ReferenceDetector = api;
}

export const detectReferenceSection = api ? api.detectReferenceSection : undefined;
export const parseReferenceEntries = api ? api.parseReferenceEntries : undefined;
export const isReferenceSectionTitle = api ? api.isReferenceSectionTitle : undefined;
export const isLikelyReferenceEntry = api ? api.isLikelyReferenceEntry : undefined;
export const analyzeReferenceFormats = api ? api.analyzeReferenceFormats : undefined;
export const getRecommendedFormat = api ? api.getRecommendedFormat : undefined;

export default api;

