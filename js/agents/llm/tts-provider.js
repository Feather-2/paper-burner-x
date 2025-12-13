/**
 * TTS Provider - 文本转语音适配器（占位）
 *
 * 未来支持：
 * - ElevenLabs TTS (eleven_multilingual_v2, eleven_turbo_v2_5)
 * - OpenAI TTS (tts-1, tts-1-hd)
 * - Azure Speech
 * - 本地模型 (Coqui, VITS)
 *
 * 接口设计：
 * - synthesize(text, opts) -> { audio: Blob, format, durationSec }
 * - streamSynthesize(text, opts) -> AsyncIterable<AudioChunk>
 */

// Placeholder - 待实现
export class TTSProvider {
  constructor(opts = {}) {
    this.provider = opts.provider || "elevenlabs";
    this.apiKey = opts.apiKey || "";
    this.voiceId = opts.voiceId || null;
    this.model = opts.model || null;
    this.id = `tts_${this.provider}`;
  }

  async synthesize(text, opts = {}) {
    throw new Error("TTSProvider.synthesize() not implemented yet");
  }

  async *streamSynthesize(text, opts = {}) {
    throw new Error("TTSProvider.streamSynthesize() not implemented yet");
  }

  async listVoices() {
    throw new Error("TTSProvider.listVoices() not implemented yet");
  }
}

export function createTTSProvider(config) {
  return new TTSProvider(config);
}

// ElevenLabs 支持的 TTS 模型（参考）
export const ELEVENLABS_TTS_MODELS = [
  { id: "eleven_multilingual_v2", name: "Multilingual v2", languages: 29, latency: "standard" },
  { id: "eleven_turbo_v2_5", name: "Turbo v2.5", languages: 32, latency: "low" },
  { id: "eleven_flash_v2_5", name: "Flash v2.5", languages: 32, latency: "ultra-low" },
  { id: "eleven_v3", name: "Eleven v3 (alpha)", languages: 70, latency: "standard" },
];

// OpenAI 支持的 TTS 模型
export const OPENAI_TTS_MODELS = [
  { id: "tts-1", name: "TTS-1", quality: "standard", latency: "low" },
  { id: "tts-1-hd", name: "TTS-1 HD", quality: "high", latency: "standard" },
];
