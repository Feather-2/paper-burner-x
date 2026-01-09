/**
 * @file js/storage/repositories/settings-repository.js
 * @description
 * 用户设置仓库（localStorage 语义）。
 *
 * 参考实现：js/storage/storage.js:212-264 的 loadSettings/saveSettings
 * 默认值需与 storage.js 保持一致。
 */

import BaseRepository from "./base-repository.js";
import LocalStorageAdapter from "../adapters/local-storage-adapter.js";

const SETTINGS_KEY = "userSettings";

function createDefaultSettings() {
  return {
    maxTokensPerChunk: "2000",
    skipProcessedFiles: false,
    selectedTranslationModel: "none",
    concurrencyLevel: "1",
    translationConcurrencyLevel: "15",
    targetLanguage: "chinese",
    customTargetLanguageName: "",
    customModelSettings: {
      apiEndpoint: "",
      modelId: "",
      requestFormat: "openai",
      temperature: 0.5,
      max_tokens: 8000,
    },
    defaultSystemPrompt: "",
    defaultUserPromptTemplate: "",
    useCustomPrompts: false,
    enableGlossary: false,
    batchModeEnabled: false,
    batchModeTemplate: "{original_name}_{output_language}_{processing_time:YYYYMMDD-HHmmss}.{original_type}",
    batchModeFormats: ["original", "markdown"],
    batchModeZipEnabled: false,
  };
}

export class SettingsRepository extends BaseRepository {
  /**
   * @param {import("../adapters/base-adapter.js").BaseStorageAdapter} [adapter]
   */
  constructor(adapter = new LocalStorageAdapter()) {
    super(adapter);
  }

  getDefaultSettings() {
    return createDefaultSettings();
  }

  /**
   * 加载设置（带默认值合并）
   * @returns {Promise<Object>}
   */
  async loadSettings() {
    const defaults = createDefaultSettings();
    try {
      const stored = await this.adapter.get(SETTINGS_KEY);
      if (!stored || typeof stored !== "object") return defaults;

      const merged = { ...defaults, ...stored };
      if (stored.customModelSettings && typeof stored.customModelSettings === "object") {
        merged.customModelSettings = { ...defaults.customModelSettings, ...stored.customModelSettings };
      }
      return merged;
    } catch (e) {
      console.error("SettingsRepository.loadSettings: failed, using defaults:", e);
      return defaults;
    }
  }

  /**
   * 保存设置
   * @param {Object} settingsData
   * @returns {Promise<void>}
   */
  async saveSettings(settingsData) {
    try {
      await this.adapter.set(SETTINGS_KEY, settingsData);
    } catch (e) {
      console.error("SettingsRepository.saveSettings: failed:", e);
    }
  }
}

export default SettingsRepository;

