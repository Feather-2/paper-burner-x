import './reference-extractor.js';

const root = globalThis;
const api = root.ReferenceExtractor;

if (root.window && !root.window.ReferenceExtractor && api) {
  root.window.ReferenceExtractor = api;
}

export const extractReferenceInfo = api ? api.extractReferenceInfo : undefined;
export const batchExtract = api ? api.batchExtract : undefined;
export const extractDOI = api ? api.extractDOI : undefined;
export const extractURLs = api ? api.extractURLs : undefined;
export const extractYear = api ? api.extractYear : undefined;
export const extractAuthors = api ? api.extractAuthors : undefined;
export const extractTitle = api ? api.extractTitle : undefined;
export const extractJournal = api ? api.extractJournal : undefined;
export const extractVolume = api ? api.extractVolume : undefined;
export const extractIssue = api ? api.extractIssue : undefined;
export const extractPages = api ? api.extractPages : undefined;
export const calculateConfidence = api ? api.calculateConfidence : undefined;
export const generateTags = api ? api.generateTags : undefined;

export default api;

