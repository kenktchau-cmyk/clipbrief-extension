export const MAX_TRANSCRIPT = 180000;
export const CHUNK_SIZE = 12000;

export function formatTime(value) {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  const m = Math.floor(n / 60);
  return n >= 3600 ? `${Math.floor(n / 3600)}:${String(m % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}` : `${m}:${String(n % 60).padStart(2, '0')}`;
}

export function parseTime(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const s = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?::\d{1,2}){1,2}(?:\.\d+)?$/.test(s)) return null;
  const parts = s.split(':').map(Number);
  if (parts.slice(1).some(n => n >= 60)) return null;
  return parts.reduce((a, b) => a * 60 + b, 0);
}

function decodeText(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, e) => {
    if (e[0] !== '#') return named[e.toLowerCase()] ?? _;
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  }).replace(/\s+/g, ' ').trim();
}

export function normalizeSegments(input) {
  if (!Array.isArray(input)) return [];
  const result = [];
  for (const item of input) {
    const text = decodeText(item?.text);
    if (!text) continue;
    const start = parseTime(item.start);
    const previous = result.at(-1);
    if (previous?.text === text && previous?.start === start) continue;
    result.push({ start, text });
  }
  return result;
}

export function parseCaptions(raw) {
  const text = String(raw ?? '').trim();
  if (text.length > MAX_TRANSCRIPT * 8) throw new Error('字幕檔太大，請分成較短片段。');
  if (!text) return [];
  if (text.startsWith('{') || (text.startsWith('[') && !/^\[\d+(?::\d{1,2}){1,2}(?:\.\d+)?\]\s/.test(text))) {
    let json;
    try { json = JSON.parse(text); } catch { throw new Error('字幕 JSON 格式無效。'); }
    if (json.events) return normalizeSegments(json.events.map(e => ({ start: typeof e.tStartMs === 'number' ? e.tStartMs / 1000 : null, text: (e.segs ?? []).map(s => s.utf8 ?? '').join('') })));
    if (json.body) return normalizeSegments(json.body.map(e => ({ start: e.from, text: e.content })));
    if (Array.isArray(json)) return normalizeSegments(json);
    throw new Error('未能辨認字幕 JSON；請用 SRT、VTT 或純文字。');
  }
  if (/<(?:transcript|timedtext)[\s>]/i.test(text)) {
    const entries = [...text.matchAll(/<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map(m => {
      const seconds = m[2].match(/\bstart="([\d.]+)"/);
      const millis = m[2].match(/\bt="([\d.]+)"/);
      return { start: seconds ? Number(seconds[1]) : millis ? Number(millis[1]) / 1000 : null, text: m[3] };
    });
    return normalizeSegments(entries);
  }
  if (text.includes('-->')) {
    const segments = [];
    for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
      const lines = block.split('\n');
      const idx = lines.findIndex(line => line.includes('-->'));
      if (idx < 0 || /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
      const start = parseTime(lines[idx].split('-->')[0].trim());
      if (start !== null) segments.push({ start, text: lines.slice(idx + 1).join(' ') });
    }
    return normalizeSegments(segments);
  }
  return normalizeSegments(text.split(/\r?\n/).filter(Boolean).map(line => {
    const match = line.match(/^\[?(\d+(?::\d{1,2}){1,2}(?:\.\d+)?)\]?\s+(.+)$/);
    return match ? { start: parseTime(match[1]), text: match[2] } : { start: null, text: line };
  }));
}

export function transcriptLength(segments) { return segments.reduce((n, s) => n + s.text.length, 0); }

export function chunkTranscript(segments, size = CHUNK_SIZE) {
  if (!Number.isInteger(size) || size < 100) throw new Error('Invalid chunk size');
  const length = transcriptLength(segments);
  if (length < 40) throw new Error('字幕內容太少，請提供至少 40 個字元。');
  if (length > MAX_TRANSCRIPT) throw new Error('字幕超過 180,000 字元，請分成較短片段再處理。');
  const chunks = [];
  let current = '', currentSegments = [];
  for (const segment of segments) {
    for (let i = 0; i < segment.text.length; i += size - 30) {
      const text = segment.text.slice(i, i + size - 30);
      const line = `${segment.start === null ? '' : `[${formatTime(segment.start)}] `}${text}\n`;
      if (current && current.length + line.length > size) {
        chunks.push({ text: current, segments: currentSegments }); current = ''; currentSegments = [];
      }
      current += line; currentSegments.push({ start: segment.start, text });
    }
  }
  if (current) chunks.push({ text: current, segments: currentSegments });
  return chunks;
}

export function validateEndpoint(input) {
  let url;
  try { url = new URL(String(input).trim()); } catch { throw new Error('請填入有效嘅 API 網址。'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('API 網址唔可以包含帳密、查詢參數或 #。');
  const loopback = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('API 須使用 HTTPS；只有 localhost 可用 HTTP。');
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '') + '/chat/completions';
  return { url: url.href, origin: `${url.protocol}//${url.hostname}/*` };
}

export function normalizeSummary(raw, segments) {
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
    catch { throw new Error('AI 回傳格式無效，請確認模型支援 JSON 輸出後再試。'); }
  }
  if (!data || typeof data.brief !== 'string' || !data.brief.trim() || !Array.isArray(data.keyPoints) || !data.keyPoints.some(p => typeof p === 'string' && p.trim())) throw new Error('AI 摘要缺少簡介或重點，請再試一次。');
  const anchors = segments.map(s => s.start).filter(s => s !== null);
  const chapters = (Array.isArray(data.chapters) ? data.chapters : []).flatMap(ch => {
    if (!ch || typeof ch.title !== 'string') return [];
    const t = parseTime(ch.start);
    if (t === null || !anchors.length) return [];
    const nearest = anchors.reduce((a, b) => Math.abs(b - t) < Math.abs(a - t) ? b : a);
    if (Math.abs(nearest - t) > 1) return [];
    return [{ start: nearest, title: ch.title.slice(0, 200), description: String(ch.description ?? '').slice(0, 600) }];
  }).sort((a, b) => a.start - b.start).filter((c, i, all) => !i || c.start !== all[i - 1].start).slice(0, 12);
  return { brief: data.brief.slice(0, 6000), keyPoints: data.keyPoints.filter(p => typeof p === 'string' && p.trim()).slice(0, 12).map(p => p.slice(0, 2000)), chapters };
}

export function summaryMarkdown(video, summary) {
  const lines = [`# ${video.title}`, '', video.url ? `來源：${video.url}` : '來源：手動提供字幕', '', '## 簡介', '', summary.brief, '', '## 重點', '', ...summary.keyPoints.map(p => `- ${p}`)];
  if (summary.chapters.length) lines.push('', '## 時間軸', '', ...summary.chapters.map(c => `- ${formatTime(c.start)} ${c.title}${c.description ? `：${c.description}` : ''}`));
  return lines.join('\n');
}
