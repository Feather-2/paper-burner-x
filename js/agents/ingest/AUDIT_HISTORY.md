# Audit History - ingest

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] JSDoc any usage
*Archived: 2026-01-19T20:50:41.747Z*

- **File**: js/agents/ingest/asset-understanding.js:4
- **Description**: Project conventions forbid `any`, but IngestAsset and several options types use `any` (also in video-frames and video adapter options).
- **Suggestion**: Replace `any` with explicit shapes (e.g., visionApi/modelRouter interfaces) and update related JSDoc option types.
```
/**
 * @typedef {Record<string, any> & { data: string, type: string }} IngestAsset
 */
```

---

## Archived: 2026-01-19

### [RESOLVED] unvalidated JSON.parse
*Archived: 2026-01-19T20:50:11.888Z*

- **File**: js/agents/ingest/asset-understanding.js:74
- **Description**: LLM responses are parsed with JSON.parse after regex extraction without size or schema validation, which can lead to memory/DoS or malformed outputs.
- **Suggestion**: Cap response length before parsing and validate the shape (e.g., schema check) to avoid oversized or malformed payloads.
```
const arrMatch = s.match(/\[[\s\S]*\]/);
if (arrMatch) {
  return JSON.parse(arrMatch[0]);
}
```

---

## Archived: 2026-01-19

### [RESOLVED] zip bomb / decompression DoS
*Archived: 2026-01-19T20:48:48.522Z*

- **File**: js/agents/ingest/adapters/epub.js:253
- **Description**: EPUB parsing loads the entire zip without limiting uncompressed size or entry count. Similar unbounded zip parsing happens in PPTX (via PPTXSlideParser/JSZip) and DOCX (mammoth). A crafted archive can exhaust memory/CPU.
- **Suggestion**: Enforce maxFileSize and total uncompressed byte limits; cap entry count and reject suspicious compression ratios before parsing.
```
const arrayBuffer = await file.arrayBuffer();
const zip = await JSZip.loadAsync(arrayBuffer);
```

---

## Archived: 2026-01-19

### [RESOLVED] unbounded file size / memory usage
*Archived: 2026-01-19T20:48:02.504Z*

- **File**: js/agents/ingest/adapters/html.js:124
- **Description**: HtmlAdapter reads full file content with no size cap or streaming; similar lack of max size limits exists for EPUB/PPTX/audio/video inputs. Large files can cause memory spikes and slowdowns.
- **Suggestion**: Introduce maxFileSize options for these adapters and/or stream large inputs via chunked processing.
```
const res = await readTextFromPath(input);
size = res.size;
html = res.text;
```

---

## Archived: 2026-01-19

### [RESOLVED] path traversal / local file read
*Archived: 2026-01-19T20:47:03.188Z*

- **File**: js/agents/ingest/adapters/docx.js:119
- **Description**: DocxAdapter accepts string paths and reads from disk without allowlist/allowPathRead gating. The same pattern exists in pdf/html/epub/audio/video/code adapters, so an untrusted caller can read arbitrary local files via IngestStage.files.
- **Suggestion**: Reject path-string inputs by default (require allowPathRead true), or validate against an allowlisted base directory; pass file-like objects only in browser builds.
```
if (typeof input === "string") {
  filename = await basenameOfPath(input);
  mimeType = guessMimeType(filename);
  file = await fileLikeFromPath(input, { maxBytes });
  size = file.size;
}
```

---

## Archived: 2026-01-18

### [RESOLVED] compatibility
*Archived: 2026-01-18T21:09:15.321Z*

- **File**: `js/agents/ingest/adapters/markdown.js:13`:13
- **Description**: Adapter relies on Node-only filesystem imports for string-path inputs, which breaks browser compatibility and violates the no Node-only API requirement.
- **Suggestion**: Move path-based reading into a Node-only adapter or gate it behind an explicit allowPathRead flag and require File/Blob inputs in browser builds.
```
const { readFile } = await import("node:fs/promises");
```

### [RESOLVED] compatibility
*Archived: 2026-01-18T21:09:15.321Z*

- **File**: `js/agents/ingest/adapters/pptx.js:66`:66
- **Description**: PptxAdapter loads the slide parser via Node's vm module, which is unavailable in browsers and violates the no Node-only API requirement.
- **Suggestion**: Require stageApi.pptxParser/globalThis.PPTXSlideParser for browser builds or move the vm-based loader into a Node-only entrypoint.
```
const vm = await import("node:vm");
```

### [RESOLVED] security
*Archived: 2026-01-18T21:09:15.321Z*

- **File**: `js/agents/ingest/adapters/markdown.js:54`:54
- **Description**: String inputs are treated as filesystem paths and read directly without an allowlist; if untrusted input reaches this adapter it can expose arbitrary local files.
- **Suggestion**: Reject path strings by default or enforce an allowlisted base directory before reading from disk.
```
if (typeof input === "string") {
  filename = await basenameOfPath(input);
  mimeType = guessMimeType(filename);
  const res = await readTextFromPath(input);
```

### [RESOLVED] convention
*Archived: 2026-01-18T21:09:15.321Z*

- **File**: `js/agents/ingest/ingest-stage.js:283`:283
- **Description**: Event names emitted by IngestStage use dot notation (e.g., ingest.started) instead of the required domain:action format.
- **Suggestion**: Rename events to domain:action (e.g., ingest:started) and update downstream listeners accordingly.
```
emit?.("ingest.started", { inputCount, runId: runContext?.runId }, { status: "started" });
```

### [RESOLVED] quality
*Archived: 2026-01-18T21:09:15.321Z*

- **File**: `js/agents/ingest/ingest-stage.js:261`:261
- **Description**: JSDoc references IngestInput/IngestStageOutput but no @typedef is defined in the module, reducing type clarity and tooling support.
- **Suggestion**: Add @typedef definitions for IngestInput, IngestStageOutput (and ParsedDocument) in a shared types section/file and reference them consistently.
```
* Stage interface (Runtime): execute(runContext, input) -> IngestStageOutput.
```

---

