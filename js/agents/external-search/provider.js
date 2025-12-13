function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

export function assertSearchResult(result, { allowFetchedAt = true } = {}) {
  if (!isPlainObject(result)) throw new TypeError("SearchResult must be an object");
  const url = toNonEmptyString(result.url);
  const title = toNonEmptyString(result.title);
  const snippet = toNonEmptyString(result.snippet);
  const source = toNonEmptyString(result.source);
  if (!url) throw new TypeError("SearchResult.url must be a non-empty string");
  if (!title) throw new TypeError("SearchResult.title must be a non-empty string");
  if (!snippet) throw new TypeError("SearchResult.snippet must be a non-empty string");
  if (!source) throw new TypeError("SearchResult.source must be a non-empty string");
  if (!allowFetchedAt && result.fetchedAt !== undefined) {
    throw new TypeError("SearchResult.fetchedAt is not allowed here");
  }
  if (result.fetchedAt !== undefined && !toNonEmptyString(result.fetchedAt)) {
    throw new TypeError("SearchResult.fetchedAt must be an ISO-like string when present");
  }
  if (result.metadata !== undefined && !isPlainObject(result.metadata)) {
    throw new TypeError("SearchResult.metadata must be an object when present");
  }
}

export function assertFetchResult(result) {
  if (!isPlainObject(result)) throw new TypeError("FetchResult must be an object");
  if (typeof result.content !== "string") throw new TypeError("FetchResult.content must be a string");
  if (typeof result.extractedText !== "string") throw new TypeError("FetchResult.extractedText must be a string");
  if (!isPlainObject(result.metadata)) throw new TypeError("FetchResult.metadata must be an object");
  if (result.attachments !== undefined && !Array.isArray(result.attachments)) {
    throw new TypeError("FetchResult.attachments must be an array when present");
  }
}

export class SearchProvider {
  constructor({ id, name } = {}) {
    this.id = toNonEmptyString(id) || "provider_unknown";
    this.name = toNonEmptyString(name) || this.id;
  }

  /**
   * SearchProvider interface
   * query({query, domain?, timeRange?, limit?, filters?}) -> Promise<SearchResult[]>
   *
   * @param {{query: string, domain?: string, timeRange?: string, limit?: number, filters?: object}} _input
   * @returns {Promise<Array<{url: string, title: string, snippet: string, source: string, fetchedAt?: string, metadata?: object}>>}
   */
  async query(_input) {
    throw new Error("SearchProvider.query() not implemented");
  }

  /**
   * fetch({url}) -> Promise<{content, extractedText, metadata, attachments?}>
   *
   * @param {{url: string}} _input
   * @returns {Promise<{content: string, extractedText: string, metadata: object, attachments?: Array}>}
   */
  async fetch(_input) {
    throw new Error("SearchProvider.fetch() not implemented");
  }
}

