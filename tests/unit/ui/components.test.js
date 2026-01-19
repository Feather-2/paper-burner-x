// @vitest-environment jsdom
/**
 * @file tests/ui/components.test.js
 * @description js/ui/components 纯逻辑单元测试（Modal / Notification / ProgressBar）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('js/ui/components/modal.js', () => {
  let modalModule;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.unstubAllGlobals();
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      cb();
      return 0;
    });

    document.body.innerHTML = '';

    vi.resetModules();
    modalModule = await import('../../js/ui/components/modal.js');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('createModal(): open/close updates stack and backdrop', async () => {
    const { createModal, getOpenCount } = modalModule;

    const onOpen = vi.fn();
    const onClose = vi.fn();

    const controller = createModal({
      title: 'Title',
      content: '<p>Hello</p>',
      onOpen,
      onClose
    });

    expect(getOpenCount()).toBe(0);

    controller.open();
    expect(getOpenCount()).toBe(1);
    expect(document.body.contains(controller.getElement())).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);

    const backdrop = document.querySelector('.modal-backdrop');
    expect(backdrop).not.toBeNull();
    expect(backdrop.style.display).toBe('block');
    expect(backdrop.style.opacity).toBe('1');

    controller.close();
    expect(getOpenCount()).toBe(1); // stack removal is delayed
    expect(onClose).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    expect(getOpenCount()).toBe(0);
    expect(document.body.contains(controller.getElement())).toBe(false);
    expect(backdrop.style.opacity).toBe('0');

    await vi.advanceTimersByTimeAsync(200);
    expect(backdrop.style.display).toBe('none');
  });

  it('createModal(): setTitle()/setContent() mutate DOM', () => {
    const { createModal } = modalModule;

    const controller = createModal({
      title: 'Old',
      content: '<p id="p">old</p>'
    });

    controller.open();
    controller.setTitle('New');
    expect(controller.getElement().querySelector('.modal-title')?.textContent).toBe('New');

    controller.setContent('<span id="s">str</span>');
    expect(controller.getBody().querySelector('#s')?.textContent).toBe('str');

    const node = document.createElement('div');
    node.id = 'node';
    node.textContent = 'node';
    controller.setContent(node);

    expect(controller.getBody().querySelector('#node')).toBe(node);
  });

  it('createModal(): backdrop click respects closeOnBackdrop', async () => {
    const { createModal, getOpenCount } = modalModule;

    const controller = createModal({
      title: 'No backdrop close',
      content: '<p>hi</p>',
      closeOnBackdrop: false
    });

    controller.open();
    expect(getOpenCount()).toBe(1);

    const backdrop = document.querySelector('.modal-backdrop');
    expect(backdrop).not.toBeNull();

    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.runOnlyPendingTimersAsync();
    expect(getOpenCount()).toBe(1);

    controller.close();
    await vi.runAllTimersAsync();
    expect(getOpenCount()).toBe(0);
  });

  it('createModal(): Escape closes only the top modal', async () => {
    const { createModal, getOpenCount } = modalModule;

    const a = createModal({ title: 'A', content: 'a' });
    const b = createModal({ title: 'B', content: 'b' });

    a.open();
    b.open();
    expect(getOpenCount()).toBe(2);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.advanceTimersByTimeAsync(200);
    expect(getOpenCount()).toBe(1);
    expect(document.body.contains(b.getElement())).toBe(false);
    expect(document.body.contains(a.getElement())).toBe(true);
  });

  it('confirm(): resolves true/false when buttons are clicked', async () => {
    const { confirm, getOpenCount } = modalModule;

    const p1 = confirm('Are you sure?');
    expect(getOpenCount()).toBe(1);

    const cancelBtn = document.querySelector('.modal-footer .btn.btn-secondary');
    expect(cancelBtn).not.toBeNull();
    cancelBtn.click();
    await expect(p1).resolves.toBe(false);
    await vi.runAllTimersAsync();
    expect(getOpenCount()).toBe(0);

    const p2 = confirm('Really?');
    const confirmBtn = document.querySelector('.modal-footer .btn.btn-primary');
    expect(confirmBtn).not.toBeNull();
    confirmBtn.click();
    await expect(p2).resolves.toBe(true);
    await vi.runAllTimersAsync();
    expect(getOpenCount()).toBe(0);
  });
});

describe('js/ui/components/notification.js', () => {
  let notificationModule;

  beforeEach(async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';

    vi.resetModules();
    notificationModule = await import('../../js/ui/components/notification.js');
  });

  afterEach(() => {
    notificationModule?.clearAll?.();
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('showNotification(): escapes HTML message and creates container', () => {
    const { showNotification } = notificationModule;

    const el = showNotification('<img src=x onerror=alert(1)>', 'info', 0);
    const container = document.querySelector('.notification-container');

    expect(container).not.toBeNull();
    expect(container.contains(el)).toBe(true);
    expect(el.querySelector('img')).toBeNull();
    expect(el.innerHTML).toContain('&lt;img');
  });

  it('configure(): maxVisible limits rendered notifications', () => {
    const { configure, showNotification } = notificationModule;

    configure({ maxVisible: 2, duration: 0 });

    const a = showNotification('a', 'info', 0);
    const b = showNotification('b', 'info', 0);
    const c = showNotification('c', 'info', 0);

    const container = document.querySelector('.notification-container');
    expect(container?.children).toHaveLength(2);
    expect(a.isConnected).toBe(false);
    expect(b.isConnected).toBe(true);
    expect(c.isConnected).toBe(true);
  });

  it('dismisses on click and via auto-dismiss duration', async () => {
    const { showNotification } = notificationModule;

    const clickEl = showNotification('click', 'info', 0);
    const container = document.querySelector('.notification-container');

    clickEl.click();
    expect(clickEl.style.opacity).toBe('0');
    await vi.advanceTimersByTimeAsync(300);
    expect(container?.contains(clickEl)).toBe(false);

    const autoEl = showNotification('auto', 'info', 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(autoEl.style.opacity).toBe('0');
    await vi.advanceTimersByTimeAsync(300);
    expect(container?.contains(autoEl)).toBe(false);
  });
});

describe('js/ui/components/progress-bar.js', () => {
  let progressModule;

  beforeEach(async () => {
    document.body.innerHTML = '<div id="root"></div>';
    vi.resetModules();
    progressModule = await import('../../js/ui/components/progress-bar.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('createProgressBar(): returns null and logs when container missing', () => {
    const { createProgressBar } = progressModule;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const bar = createProgressBar('#missing');
    expect(bar).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith('[ProgressBar] Container not found');
  });

  it('createProgressBar(): clamps progress and exposes controller methods', () => {
    const { createProgressBar } = progressModule;

    const root = document.querySelector('#root');
    const bar = createProgressBar(root, { color: 'red' });

    expect(bar).not.toBeNull();
    expect(root.querySelector('.progress-bar-wrapper')).not.toBeNull();
    expect(bar.getProgress()).toBe(0);

    bar.setProgress(150);
    expect(bar.getProgress()).toBe(100);
    expect(root.querySelector('.progress-bar-fill')?.style.width).toBe('100%');

    bar.setProgress(-10);
    expect(bar.getProgress()).toBe(0);
    expect(root.querySelector('.progress-bar-fill')?.style.width).toBe('0%');

    bar.increment(10);
    expect(bar.getProgress()).toBe(10);

    bar.complete();
    expect(bar.getProgress()).toBe(100);

    bar.reset();
    expect(bar.getProgress()).toBe(0);

    bar.setColor('rgb(1, 2, 3)');
    expect(root.querySelector('.progress-bar-fill')?.style.background).toBe('rgb(1, 2, 3)');

    bar.hide();
    expect(bar.getElement().style.display).toBe('none');
    bar.show();
    expect(bar.getElement().style.display).toBe('block');

    bar.destroy();
    expect(root.querySelector('.progress-bar-wrapper')).toBeNull();
  });

  it('createLabeledProgressBar() and createFileProgressBar() update labels/stats', () => {
    const { createLabeledProgressBar, createFileProgressBar } = progressModule;

    const root = document.querySelector('#root');

    const labeled = createLabeledProgressBar(root, { label: 'L' });
    labeled.setProgress(55.4);
    expect(labeled.getElement().querySelector('.progress-percent')?.textContent).toBe('55%');
    labeled.setLabel('NewLabel');
    expect(labeled.getElement().querySelector('.progress-label')?.textContent).toBe('NewLabel');
    labeled.destroy();
    expect(root.querySelector('.labeled-progress-bar')).toBeNull();

    const fileBar = createFileProgressBar(root, { label: 'Files' });
    fileBar.setTotal(4);
    expect(fileBar.getElement().querySelector('.progress-stats')?.textContent).toBe('完成: 0/4');

    fileBar.incrementCompleted();
    expect(fileBar.getStats()).toEqual({ total: 4, completed: 1, errors: 0 });
    expect(fileBar.getElement().querySelector('.progress-stats')?.textContent).toBe('完成: 1/4');

    fileBar.incrementErrors();
    expect(fileBar.getStats()).toEqual({ total: 4, completed: 1, errors: 1 });
    expect(fileBar.getElement().querySelector('.progress-stats')?.textContent).toBe('完成: 1/4 | 错误: 1');

    fileBar.reset();
    expect(fileBar.getStats()).toEqual({ total: 0, completed: 0, errors: 0 });
    expect(fileBar.getElement().querySelector('.progress-stats')?.textContent).toBe('完成: 0/0');
  });
});

