# DeepSearch Todo-First Migration

## Decisions (Locked)
- Replace gaps with todos as the primary planning and execution unit (no gap-compat layer).
- Todos come from user input plus LLM scan (fallback defaults if LLM unavailable).
- End when all todos are completed; a report is preferred but not required.
- If no report is available at completion, generate a placeholder report that marks the task as temporarily unfulfilled and includes the reason.
- Write feedback creates new todos (no reopen).
- Awaiting user feedback uses a real pause (StagePausedError).
- Awaiting user feedback can be triggered by LLM or external signals.

## Work Items

### 1) State + Model Changes
- Add todo-centric fields to state and normalize all internal helpers (ids, status, history).
- Introduce loop control flags in `state.L2` (e.g., `awaitUserFeedback`, `taskImpossible`, `reason`).
- Update serialization/deserialization and checkpoints to include new todo fields.

### 2) Replace Gaps Stage with Todo Stage
- Convert `deepsearch.gaps` stage to `deepsearch.todos` (LLM + fallback defaults).
- Ensure todos include priority, query hints, status, and optional evidence expectations.
- Emit todo lifecycle events (`deepsearch.todo.created`, `deepsearch.todo.status.changed`) for UI and tests.

### 3) Retrieval + Understanding
- Retrieval consumes open todos instead of gaps and attaches `todoId` to retrieved chunks.
- Understanding maps claims/evidence back to todoIds and marks todos completed/blocked.
- Replace gap-based validation logic with todo-based completion logic.

### 4) Writing + Backtrack
- Write feedback generates new todos (no reopen semantics).
- Write backtrack counter and event flow remain, but payloads use todo context.

### 5) Agent Loop Logic (AI-Driven)
- LLM decides next action, with hard guardrails:
  - `awaitUserFeedback` -> pause
  - `taskImpossible` -> complete with reason
  - todos complete -> finish (or generate placeholder report if missing)
- Update prompt options to include `await_user_feedback` and `complete_impossible`.

### 6) Output + Hard Gates
- Allow deepsearch completion without a real report by emitting a placeholder report.
- Ensure content package includes todos and completion reason metadata.

### 7) UI + Workflow
- Update workflow runtime and visualizer to show todos instead of gaps.
- Replace gap-progress handlers with todo-progress handlers.
- Adjust UI labels and summaries to reflect todo completion.

### 8) Tests + Fixtures
- Update deepsearch tests from gaps to todos.
- Replace gap-related event assertions with todo equivalents.
- Adjust mocks, fixtures, and prompts to align with todo IDs and statuses.

## Notes
- This is a breaking change to deepsearch internals and tests.
- Keep ASCII-only edits unless an existing file already uses non-ASCII.
