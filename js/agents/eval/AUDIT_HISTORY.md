# Audit History - eval

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:39:15.694Z*

- **File**: js/agents/eval/metrics.js:24
- **Description**: passAtK 缺少 @returns 注解，未满足项目对 JSDoc 完整性的约定。
- **Suggestion**: 在该 JSDoc 添加 `@returns {number}`。
```
 * @param {Trial[]} trials
 * @param {number} k
 */
export function passAtK(trials, k) {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:39:15.694Z*

- **File**: js/agents/eval/metrics.js:44
- **Description**: passExpK 缺少 @returns 注解，未满足项目对 JSDoc 完整性的约定。
- **Suggestion**: 在该 JSDoc 添加 `@returns {number}`。
```
 * @param {Trial[]} trials
 * @param {number} k
 */
export function passExpK(trials, k) {
```

### [RESOLVED] robustness
*Archived: 2026-01-18T21:39:15.694Z*

- **File**: js/agents/eval/harness.js:286
- **Description**: runSuite 未校验 tasks 项；当 task 为 null/非对象时，_runTrial 的异常路径仍直接访问 task.input/task.id，可能导致二次抛错并中断 suite。
- **Suggestion**: 在 runSuite 过滤无效 task，或在 _runTrial 中对 task 字段使用可选访问/默认值，保证异常路径不会再次抛错。
```
if (!recorder) {
  recorder = this._recordTranscript(null, task, trialIndex, options);
  recorder.record("input", task.input, { taskId: task.id, trialIndex, description: task.description });
}
```

---

