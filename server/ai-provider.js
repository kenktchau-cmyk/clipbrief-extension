import { validateEndpoint } from '../core.js';

export const GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMMA_MODEL = 'gemma-4-26b-a4b-it';
export const DEFAULT_CONFIG = Object.freeze({ provider: 'google', endpoint: GOOGLE_API_BASE, model: GEMMA_MODEL, key: '', remember: false, jsonMode: false });

export function validateProviderConfig(value) {
  if (!value || !['google', 'openai'].includes(value.provider)) throw new Error('請選擇 Google 或 OpenAI 相容 API。');
  if (typeof value.endpoint !== 'string' || value.endpoint.length > 2048 || typeof value.model !== 'string' || !/^[\w./:-]{1,160}$/.test(value.model)) throw new Error('請填入有效嘅 API 網址同模型名稱。');
  if (typeof value.key !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(value.key)) throw new Error('請輸入供應商提供嘅 API Key，唔可以包含空格或換行。');
  if (value.provider === 'google' && !/^AIza[\w-]{35}$/.test(value.key)) throw new Error('Google API Key 格式無效。');
  const config = { provider: value.provider, endpoint: value.endpoint.replace(/\/+$/, ''), model: value.model, key: value.key, jsonMode: value.jsonMode === true };
  getApiTarget(config);
  return config;
}

export function publicProviderConfig(config) {
  return { provider: config.provider, endpoint: config.endpoint, model: config.model, jsonMode: config.jsonMode === true, ready: !!config.key };
}

export function getApiTarget(config) {
  if (!config.provider || config.provider === 'openai') return validateEndpoint(config.endpoint);
  if (config.provider !== 'google') throw new Error('未能辨認 AI 供應商，請重新設定。');
  if (config.endpoint.replace(/\/+$/, '') !== GOOGLE_API_BASE) throw new Error('Google 模式只可使用官方 Gemini API 網址。');
  const model = config.model?.trim().replace(/^models\//, '');
  if (!model || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model)) throw new Error('請填入有效嘅 Google 模型 ID。');
  return { url: `${GOOGLE_API_BASE}/models/${model}:generateContent`, origin: 'https://generativelanguage.googleapis.com/*' };
}

export function restoreConfig(saved, sessionKey = '') {
  if (!saved) return { ...DEFAULT_CONFIG };
  // Old versions only had Chat Completions. Preserve those settings on upgrade.
  return { ...DEFAULT_CONFIG, ...saved, provider: saved.provider || 'openai', key: saved.remember ? saved.key || '' : sessionKey };
}

export function buildApiRequest(config, messages) {
  const target = getApiTarget(config);
  if (!config.key?.trim() || !config.model?.trim()) throw new Error('請先設定 API Key 同模型名稱。');
  const headers = { 'Content-Type': 'application/json' };
  if (config.provider === 'google') {
    headers['x-goog-api-key'] = config.key.trim();
    const body = {
      contents: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: 4096 }
    };
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (config.model.replace(/^models\//, '').startsWith('gemma-4-')) body.generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
    if (config.jsonMode) body.generationConfig.responseMimeType = 'application/json';
    return { ...target, headers, body };
  }
  headers.Authorization = `Bearer ${config.key.trim()}`;
  const body = { model: config.model.trim(), messages, stream: false };
  if (config.jsonMode !== false) body.response_format = { type: 'json_object' };
  return { ...target, headers, body };
}

export function readCompletion(config, data) {
  if (config.provider === 'google') {
    if (data.promptFeedback?.blockReason) throw new Error('Google 未能處理呢段內容，請檢查字幕後再試。');
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('AI 回覆未完成；請用較短字幕或較精簡嘅摘要。');
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') throw new Error('Google 未能完成呢段內容，請檢查字幕後再試。');
    // Thought parts are not the final answer and must never become a summary.
    const content = candidate?.content?.parts?.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
    if (!content?.trim()) throw new Error('Google 未有回傳文字摘要，請重試。');
    return content;
  }
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) throw new Error('模型未能處理呢段內容。');
  if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new Error('AI 回覆未完成；請用較短字幕或調整模型。');
  if (typeof choice?.message?.content !== 'string') throw new Error('API 回傳格式不相容，需要 Chat Completions 文字回覆。');
  return choice.message.content;
}

