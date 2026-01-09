import './reference-doi-resolver.js';

const root = globalThis;
const api = root.DOIResolver;

if (root.window && !root.window.DOIResolver && api) {
  root.window.DOIResolver = api;
}

export const MultiSourceDOIResolver = api ? api.MultiSourceDOIResolver : undefined;
export const CrossRefResolver = api ? api.CrossRefResolver : undefined;
export const OpenAlexResolver = api ? api.OpenAlexResolver : undefined;
export const PubMedResolver = api ? api.PubMedResolver : undefined;
export const ArXivResolver = api ? api.ArXivResolver : undefined;
export const SemanticScholarResolver = api ? api.SemanticScholarResolver : undefined;
export const create = api ? api.create : undefined;
export const version = api ? api.version : undefined;

export default api;

