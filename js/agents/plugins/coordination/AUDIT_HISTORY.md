# Audit History - coordination

Archived issues from security audits.

---

## Archived: 2026-01-20

### [RESOLVED] Test coverage gap
*Archived: 2026-01-20T00:14:50.868Z*

- **File**: `tests/`:1
- **Description**: No unit/integration tests found for TabCoordinator/ProcessCoordinator, so coverage likely falls below the 70% minimum and anti-pattern checks cannot be validated.
- **Suggestion**: Add focused tests for message parsing, leader election, and cluster IPC routing; verify coverage meets the 70% minimum and 90% target.
```
No matches for TabCoordinator/ProcessCoordinator in tests/ (rg search).
```

### [RESOLVED] JSDoc any type
*Archived: 2026-01-20T00:14:50.868Z*

- **File**: `js/agents/plugins/coordination/tab-coordinator.js`:35
- **Description**: JSDoc uses `any`, violating the project rule that forbids `any` in type annotations (multiple occurrences in this file).
- **Suggestion**: Replace `any` with specific unions or `unknown` plus runtime narrowing.
```
 * @param {any} value
```

### [RESOLVED] JSDoc any type
*Archived: 2026-01-20T00:14:50.868Z*

- **File**: `js/agents/plugins/coordination/process-coordinator.js`:72
- **Description**: JSDoc uses `any` in params/casts, violating the no-`any` rule (multiple occurrences in this file).
- **Suggestion**: Use explicit types such as `Record<string, unknown>` or `unknown`, then narrow before use.
```
 * @param {any} mod
```

---

