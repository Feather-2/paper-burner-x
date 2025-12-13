export const TaskStatus = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

export class TaskManager {
  constructor({ runStore } = {}) {
    this.tasks = new Map();
    this.runStore = runStore; // Injectable storage
  }

  create({ runId, type = "deepsearch", metadata = {} }) {
    const task = {
      taskId: runId,
      type,
      status: TaskStatus.PENDING,
      progress: { iteration: 0, gapCount: 0, claimCount: 0 },
      metadata,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      completedAt: null,
      error: null,
    };
    this.tasks.set(runId, task);
    void this.persist(task);
    return task;
  }

  updateProgress(taskId, progress) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    Object.assign(task.progress, progress);
    if (task.status === TaskStatus.PENDING) task.status = TaskStatus.RUNNING;
    task.updatedAt = new Date().toISOString();
    void this.persist(task);
    return task;
  }

  complete(taskId, result) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = TaskStatus.COMPLETED;
    task.result = result;
    task.completedAt = new Date().toISOString();
    void this.persist(task);
    return task;
  }

  fail(taskId, error) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = TaskStatus.FAILED;
    task.error = { message: error?.message, stack: error?.stack };
    task.completedAt = new Date().toISOString();
    void this.persist(task);
    return task;
  }

  cancel(taskId, reason) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = TaskStatus.CANCELLED;
    task.error = reason ? { message: String(reason) } : null;
    task.completedAt = new Date().toISOString();
    void this.persist(task);
    return task;
  }

  get(taskId) {
    return this.tasks.get(taskId);
  }
  list() {
    return [...this.tasks.values()];
  }

  async persist(task) {
    if (this.runStore?.saveTask) await this.runStore.saveTask(task);
  }

  async load(taskId) {
    if (this.runStore?.loadTask) {
      const task = await this.runStore.loadTask(taskId);
      if (task) this.tasks.set(taskId, task);
      return task;
    }
    return null;
  }
}

