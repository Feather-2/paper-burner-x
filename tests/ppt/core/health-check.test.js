// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PPTHealthCheck } from '../../../js/ppt/core/health-check.js';

function resetTestEnvironment() {
  document.body.innerHTML = '';
  localStorage.clear();
  delete window.PPTModelConfigModal;
  delete window.PPTModelConfig;
  delete window.mcp_clients_count;
}

describe('PPTHealthCheck', () => {
  beforeEach(() => {
    resetTestEnvironment();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetTestEnvironment();
  });

  describe('checkAndShow()', () => {
    it('calls performCheck when no previous check is stored', async () => {
      const performCheck = vi.spyOn(PPTHealthCheck, 'performCheck').mockResolvedValue(true);

      await expect(PPTHealthCheck.checkAndShow()).resolves.toBe(true);
      expect(performCheck).toHaveBeenCalledTimes(1);
      expect(performCheck).toHaveBeenCalledWith(false);
    });

    it('skips performCheck when last check is within interval', async () => {
      localStorage.setItem(PPTHealthCheck.STORAGE_KEY, Date.now().toString());
      const performCheck = vi.spyOn(PPTHealthCheck, 'performCheck').mockResolvedValue(false);

      await expect(PPTHealthCheck.checkAndShow(false)).resolves.toBe(true);
      expect(performCheck).not.toHaveBeenCalled();
    });

    it('calls performCheck when forced even if within interval', async () => {
      localStorage.setItem(PPTHealthCheck.STORAGE_KEY, Date.now().toString());
      const performCheck = vi.spyOn(PPTHealthCheck, 'performCheck').mockResolvedValue(true);

      await expect(PPTHealthCheck.checkAndShow(true)).resolves.toBe(true);
      expect(performCheck).toHaveBeenCalledTimes(1);
      expect(performCheck).toHaveBeenCalledWith(true);
    });

    it('calls performCheck when the interval has elapsed', async () => {
      const now = 1_700_000_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(now);
      localStorage.setItem(PPTHealthCheck.STORAGE_KEY, (now - PPTHealthCheck.CHECK_INTERVAL - 1).toString());

      const performCheck = vi.spyOn(PPTHealthCheck, 'performCheck').mockResolvedValue(true);

      await expect(PPTHealthCheck.checkAndShow(false)).resolves.toBe(true);
      expect(performCheck).toHaveBeenCalledTimes(1);
      expect(performCheck).toHaveBeenCalledWith(false);
    });
  });

  describe('performCheck()', () => {
    it('stores timestamp and returns true when language model is ready', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

      vi.spyOn(PPTHealthCheck, '_checkModels').mockResolvedValue({
        lang: { ready: true, name: 'gpt-4', fullKey: 'gpt-4' },
        img: { ready: true, name: 'dalle-3', fullKey: 'dalle-3' },
        search: { ready: false, name: '未配置', fullKey: undefined },
      });
      vi.spyOn(PPTHealthCheck, '_checkMCP').mockResolvedValue({ gateway: false, clients: 0, active: true });
      const showCard = vi.spyOn(PPTHealthCheck, '_showHealthCard').mockImplementation(() => {});

      await expect(PPTHealthCheck.performCheck(false)).resolves.toBe(true);

      expect(localStorage.getItem(PPTHealthCheck.STORAGE_KEY)).toBe('1700000000000');
      expect(showCard).toHaveBeenCalledTimes(1);
      expect(showCard.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          models: expect.objectContaining({ lang: expect.objectContaining({ ready: true }) }),
          mcp: expect.objectContaining({ active: true }),
        })
      );
      expect(showCard.mock.calls[0][1]).toBe(false);
    });

    it('does not store timestamp and reports blocking state when forced but not ready', async () => {
      localStorage.setItem(PPTHealthCheck.STORAGE_KEY, '123');

      vi.spyOn(PPTHealthCheck, '_checkModels').mockResolvedValue({
        lang: { ready: false, name: '未配置', fullKey: undefined },
        img: { ready: false, name: '未配置', fullKey: undefined },
        search: { ready: false, name: '未配置', fullKey: undefined },
      });
      vi.spyOn(PPTHealthCheck, '_checkMCP').mockResolvedValue({ gateway: true, clients: 2, active: true });
      const showCard = vi.spyOn(PPTHealthCheck, '_showHealthCard').mockImplementation(() => {});

      await expect(PPTHealthCheck.performCheck(true)).resolves.toBe(false);

      // Existing value should remain untouched when not functional.
      expect(localStorage.getItem(PPTHealthCheck.STORAGE_KEY)).toBe('123');
      expect(showCard).toHaveBeenCalledTimes(1);
      expect(showCard.mock.calls[0][1]).toBe(true);
    });
  });

  describe('_checkModels()', () => {
    it('returns all roles as not ready when model config modal is missing', async () => {
      const status = await PPTHealthCheck._checkModels();

      expect(status).toEqual({
        lang: { ready: false, name: '未配置', fullKey: undefined },
        img: { ready: false, name: '未配置', fullKey: undefined },
        search: { ready: false, name: '未配置', fullKey: undefined },
      });
    });

    it('resolves custom source ids to human friendly names', async () => {
      const loadConfig = vi.fn((role) => {
        if (role === 'lang') return { modelKey: 'gpt-4' };
        if (role === 'img') return { modelKey: 'custom_source_alpha' };
        return null;
      });

      const getAllSources = vi.fn(() => [{ id: 'custom_source_alpha', name: 'Alpha Source' }]);

      window.PPTModelConfigModal = { loadConfig, getAllSources };

      const status = await PPTHealthCheck._checkModels();

      expect(loadConfig).toHaveBeenCalledWith('lang');
      expect(loadConfig).toHaveBeenCalledWith('img');
      expect(loadConfig).toHaveBeenCalledWith('search');

      expect(status.lang).toEqual({ ready: true, name: 'gpt-4', fullKey: 'gpt-4' });
      expect(status.img).toEqual({ ready: true, name: 'Alpha Source', fullKey: 'custom_source_alpha' });
      expect(status.search).toEqual({ ready: false, name: '未配置', fullKey: undefined });
    });
  });

  describe('_checkMCP()', () => {
    it('reports gateway disconnected by default', async () => {
      const status = await PPTHealthCheck._checkMCP();
      expect(status).toEqual({ gateway: false, clients: 0, active: true });
    });

    it('reports gateway connected when mcp config exists', async () => {
      localStorage.setItem('mcp_nexus_config', '{}');
      window.mcp_clients_count = 3;

      const status = await PPTHealthCheck._checkMCP();
      expect(status).toEqual({ gateway: true, clients: 3, active: true });
    });
  });

  describe('_showHealthCard()', () => {
    it('renders an overlay (and removes any existing one)', () => {
      const results = {
        models: {
          lang: { ready: true, name: 'Lang Model', fullKey: 'lang-key' },
          img: { ready: false, name: 'Img Model', fullKey: undefined },
          search: { ready: false, name: '未配置', fullKey: undefined },
        },
        mcp: { gateway: false, clients: 0, active: true },
      };

      PPTHealthCheck._showHealthCard(results, false);
      expect(document.querySelectorAll('.health-check-overlay').length).toBe(1);
      expect(document.querySelector('.quick-apply-btn')?.textContent).toContain('一键全同步');

      PPTHealthCheck._showHealthCard(results, false);
      expect(document.querySelectorAll('.health-check-overlay').length).toBe(1);
    });

    it('hides the "确认并进入" action when blocking and not ready', () => {
      const results = {
        models: {
          lang: { ready: false, name: '未配置', fullKey: undefined },
          img: { ready: false, name: '未配置', fullKey: undefined },
          search: { ready: false, name: '未配置', fullKey: undefined },
        },
        mcp: { gateway: false, clients: 0, active: true },
      };

      PPTHealthCheck._showHealthCard(results, true);

      const buttons = [...document.querySelectorAll('button')];
      const confirmButton = buttons.find((button) => button.textContent?.includes('确认并进入'));
      expect(confirmButton).toBeUndefined();
      expect(document.body.textContent).toContain('创作准备就绪？');
    });
  });

  describe('quickApplyModel()', () => {
    it('no-ops when fullKey is missing', async () => {
      window.PPTModelConfigModal = {};
      window.PPTModelConfig = { core: { saveConfig: vi.fn() } };

      const performCheck = vi.spyOn(PPTHealthCheck, 'performCheck').mockResolvedValue(true);

      await PPTHealthCheck.quickApplyModel('');
      await PPTHealthCheck.quickApplyModel(null);

      expect(window.PPTModelConfig.core.saveConfig).not.toHaveBeenCalled();
      expect(performCheck).not.toHaveBeenCalled();
    });

    it('applies the model key to all roles and agent priorities', async () => {
      window.PPTModelConfigModal = {};

      const saveConfig = vi.fn();
      const loadConfig = vi.fn(() => ({ analyst: ['old-model'], keep: ['x'] }));
      const normalizeRolePriorityConfig = vi.fn((cfg) => ({ ...cfg }));
      const showSaveSuccess = vi.fn();

      window.PPTModelConfig = {
        core: { saveConfig, loadConfig, showSaveSuccess },
        roles: { normalizeRolePriorityConfig },
      };

      const performCheck = vi.spyOn(PPTHealthCheck, 'performCheck').mockResolvedValue(true);

      await PPTHealthCheck.quickApplyModel('new-model');

      expect(saveConfig).toHaveBeenCalledWith('lang', { modelKey: 'new-model' });
      expect(saveConfig).toHaveBeenCalledWith('img', { modelKey: 'new-model' });
      expect(saveConfig).toHaveBeenCalledWith('vision', { modelKey: 'new-model' });
      expect(saveConfig).toHaveBeenCalledWith('search', { modelKey: 'new-model' });

      expect(loadConfig).toHaveBeenCalledWith('rolePriority');
      expect(normalizeRolePriorityConfig).toHaveBeenCalledTimes(1);

      const rolePriorityCall = saveConfig.mock.calls.find(([key]) => key === 'rolePriority');
      expect(rolePriorityCall).toEqual([
        'rolePriority',
        expect.objectContaining({
          analyst: ['new-model'],
          designer: ['new-model'],
          copywriter: ['new-model'],
          reviewer: ['new-model'],
          keep: ['x'],
        }),
      ]);

      expect(performCheck).toHaveBeenCalledWith(true);
      expect(showSaveSuccess).toHaveBeenCalledWith('已一键应用到所有角色');
    });
  });

  describe('ppt-model-config-updated event', () => {
    it('triggers a refresh when the overlay is open', () => {
      const performCheck = vi.spyOn(PPTHealthCheck, 'performCheck').mockResolvedValue(true);

      const overlay = document.createElement('div');
      overlay.className = 'health-check-overlay';
      document.body.appendChild(overlay);

      document.dispatchEvent(new Event('ppt-model-config-updated'));

      expect(performCheck).toHaveBeenCalledTimes(1);
      expect(performCheck).toHaveBeenCalledWith(false);
    });
  });
});
