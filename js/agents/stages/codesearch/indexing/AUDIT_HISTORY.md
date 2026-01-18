# Audit History - indexing

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] error-handling
*Archived: 2026-01-18T21:50:10.757Z*

- **File**: js/agents/stages/codesearch/indexing/index-store.js:80
- **Description**: IndexedDB 打开失败会使 open() Promise 直接 reject，调用方未捕获将中断索引流程，无法回退到内存存储。
- **Suggestion**: 在 open()/get/put/list 中捕获 open 失败并将 _dbp 置空，回退到内存存储或返回 null；必要时处理 onblocked/版本冲突。
```
async open() {
  if (!hasIndexedDB()) return null;
  if (this._dbp) return this._dbp;

  this._dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(this.dbName, this.dbVersion);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return this._dbp;
}
```

### [RESOLVED] input-validation
*Archived: 2026-01-18T21:50:10.757Z*

- **File**: js/agents/stages/codesearch/indexing/symbol-indexer.js:23
- **Description**: extname() 假定 path 非空，toNonEmptyString 返回 undefined 时会导致 p.lastIndexOf 抛错；公开方法 extractSymbols() 若被传空 path 会崩溃。
- **Suggestion**: 在 extname 或 extractSymbols 中对空路径做保护（如 `if (!p) return ""`），避免 TypeError。
```
function extname(path) {
  const p = toNonEmptyString(path);
  const idx = p.lastIndexOf(".");
  return idx >= 0 ? p.slice(idx).toLowerCase() : "";
}
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:50:10.757Z*

- **File**: js/agents/stages/codesearch/indexing/index-store.js:159
- **Description**: `putSymbolRecord` 实际接受 params.hash 作为 sha256 回退值，但 `PutSymbolRecordParams` 未声明该字段，JSDoc 与实现不一致。
- **Suggestion**: 在 `PutSymbolRecordParams` 中补充 `@property {string=} hash` 或移除对 `hash` 的使用以保持一致。
```
sha256: typeof normalizedParams.sha256 === "string"
  ? normalizedParams.sha256
  : typeof normalizedParams.hash === "string"
    ? normalizedParams.hash
    : null,
```

---

