// Claude-powered English correction. Runs inside the local server so the API key never reaches the browser.
// Plain fetch (no SDK) to keep the app zero-dependency.
import fs from 'node:fs/promises';
import path from 'node:path';

export const MODELS = {
  'claude-opus-5-5':   { label: 'Opus 5.5 (best)',        inPrice: 4.00, outPrice: 20.00, fallback: true },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5 (balanced)',  inPrice: 2.00, outPrice: 10.00, fallback: true },
  'claude-haiku-5-5':  { label: 'Haiku 5.5 (cheapest)',   inPrice: 0.10, outPrice: 0.50,  fallback: false },
};
export const DEFAULT_MODEL = 'claude-opus-5-5';

export function makeClaude(dataDir) {
  const keyFile = process.env.CLAUDE_KEY_FILE ? path.resolve(process.env.CLAUDE_KEY_FILE) : path.join(dataDir, 'claude-key.txt');
  const usageFile = path.join(path.dirname(keyFile), 'claude-usage.json');
  const mock = process.env.CLAUDE_MOCK === '1'; // tests: canned answer, no network, no cost

  async function getKey() {
    const k = (await fs.readFile(keyFile, 'utf8').catch(() => '')).trim();
    return k || process.env.ANTHROPIC_API_KEY || '';
  }
  async function readUsage() { return JSON.parse(await fs.readFile(usageFile, 'utf8').catch(() => '{"checks":0,"usd":0}')); }
  async function addUsage(model, u) {
    const p = MODELS[model] || MODELS[DEFAULT_MODEL];
    const usd = ((u.input_tokens || 0) * p.inPrice + (u.output_tokens || 0) * p.outPrice) / 1e6;
    const cur = await readUsage(); cur.checks += 1; cur.usd = +(cur.usd + usd).toFixed(6);
    await fs.mkdir(path.dirname(usageFile), { recursive: true }); await fs.writeFile(usageFile, JSON.stringify(cur));
    return usd;
  }

  const SYSTEM = `You are a friendly English tutor. The learner is a native Chinese speaker at about CEFR B1, chatting (by text, on one shared computer) with their partner, a native English speaker.
You get the recent conversation for context, then the learner's new message. Correct only the new message.

First work out the scene: what they are talking about, the relationship (partners, close and casual), the mood, and what the learner is trying to DO with this message (ask, suggest, comfort, joke, apologise, say goodnight...).

Two levels of correction:
1. Accuracy — "corrected" + "edits": the smallest changes that make it grammatical and clear. Keep their meaning and voice.
2. Natural for this scene — "natural" + "natural_edits": what a native speaker would actually type to their partner in THIS moment, with the same intent and feeling.
   Go beyond grammar. Fix Chinglish: word-for-word translation from Chinese (e.g. "I very like", "open the light", "how to say", "you eat already?"),
   textbook or too-formal wording in a casual chat, wrong collocations, missing small softeners/fillers natives use ("kinda", "maybe we could", "just"),
   unnatural word order, missing contractions, and reply patterns that sound odd as an answer to what the partner just said.
   You may restructure the sentence; keep it at a level a B1 learner can reuse (common words, not slang that needs explaining). If the message is already natural, keep it.
- "edits" and "natural_edits": every change, in reading order, never overlapping. "original" must be copied EXACTLY from the learner's message (a short phrase, not the whole sentence) so it can be located; "fix" is the replacement ("" to delete). For natural_edits prefer whole phrases over single letters.
  "why_en": short plain-English reason (max 15 words). "why_zh": the same in simple Chinese; for natural_edits say why the original sounds Chinese-style or unnatural HERE (e.g. 直译了中文“…”, 太正式, 母语者聊天时会说…).
- "scene_zh": one short Chinese line: the scene and tone you inferred (e.g. 睡前和伴侣闲聊，语气轻松亲密).
- "feedback_zh": 1-2 encouraging sentences in Chinese about the main lesson. If the message contains a question in Chinese (e.g. asking whether the sentence is OK), answer it here.
- "level": "good" if no real errors, "minor" for small slips, "major" if meaning was unclear.
Ignore Chinese text when correcting; never translate it. If the English is already correct, return no edits and set corrected to the original.`;

  const EDITS = { type: 'array', items: { type: 'object', additionalProperties: false, required: ['original', 'fix', 'why_en', 'why_zh'],
    properties: { original: { type: 'string' }, fix: { type: 'string' }, why_en: { type: 'string' }, why_zh: { type: 'string' } } } };
  const SCHEMA = {
    type: 'object', additionalProperties: false,
    required: ['scene_zh', 'corrected', 'edits', 'natural', 'natural_edits', 'feedback_zh', 'level'],
    properties: {
      scene_zh: { type: 'string' }, corrected: { type: 'string' }, natural: { type: 'string' }, feedback_zh: { type: 'string' },
      level: { type: 'string', enum: ['good', 'minor', 'major'] },
      edits: EDITS, natural_edits: EDITS,
    },
  };

  // context: recent messages [{ who, learner, text }] (oldest first) so Claude can tell the scene and tone
  function prompt(text, context) {
    const lines = (context || []).slice(-8).map(c => `[${String(c.who || '?').slice(0, 30)}${c.learner ? ' (learner)' : ''}]: ${String(c.text || '').slice(0, 500)}`);
    return (lines.length ? `Recent conversation (oldest first):\n${lines.join('\n')}\n\n` : 'No earlier messages.\n\n') +
      `Learner's new message to correct:\n${text}`;
  }

  async function check(text, model, context) {
    if (!MODELS[model]) model = DEFAULT_MODEL;
    if (mock) return { model, usd: 0, result: { scene_zh: '下午和伴侣商量今天做什么，语气轻松。',
      corrected: 'I want to go to buy some vegetables today.', natural: 'I’m thinking of going grocery shopping today.',
      edits: [{ original: 'go buy vegetable', fix: 'go to buy some vegetables', why_en: 'Vegetable is countable; use the plural.', why_zh: 'vegetable 可数，要用复数。' }],
      natural_edits: [{ original: 'I want to go buy vegetable', fix: 'I’m thinking of going grocery shopping', why_en: 'Natives say "grocery shopping", not "buy vegetables".', why_zh: '“买菜”直译成 buy vegetable 很中式；母语者说 go grocery shopping。' }],
      feedback_zh: '意思很清楚！“买菜”这种日常说法记住 grocery shopping 就好。', level: 'minor' }, prompt: prompt(text, context) };
    const key = await getKey();
    if (!key) { const e = new Error('No API key yet. Add it in ⚙️ Settings. 还没有设置 API key。'); e.status = 400; throw e; }
    const useFallback = MODELS[model].fallback;
    const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2026-10-21' };
    if (useFallback) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    const body = {
      model, max_tokens: 4000, system: SYSTEM,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } }, // medium: reading the scene needs a little thought
      messages: [{ role: 'user', content: prompt(text, context) }],
    };
    if (useFallback) body.fallbacks = 'default';
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j?.error?.message || r.statusText;
      const e = new Error(r.status === 401 ? 'API key was rejected — check it in Settings. API key 无效。' : r.status === 429 ? 'Rate limited — wait a moment. 请求太频繁。' : `Claude API error ${r.status}: ${msg}`);
      e.status = r.status; throw e;
    }
    const usd = await addUsage(j.model || model, j.usage || {});
    if (j.stop_reason === 'refusal') { const e = new Error('Claude declined this message. 这条消息无法批改。'); e.status = 422; throw e; }
    const textBlock = (j.content || []).find(b => b.type === 'text');
    if (!textBlock) { const e = new Error('Empty reply from Claude.'); e.status = 502; throw e; }
    return { model: j.model || model, usd, result: JSON.parse(textBlock.text) };
  }

  return {
    async status() { const k = await getKey(); return { hasKey: !!k || mock, keyHint: k ? k.slice(0, 7) + '…' + k.slice(-4) : '', usage: await readUsage(), models: MODELS, defaultModel: DEFAULT_MODEL }; },
    async setKey(k) {
      k = String(k || '').trim();
      if (!k) { await fs.rm(keyFile, { force: true }); return; }
      if (!/^sk-ant-[\w-]{20,}$/.test(k)) { const e = new Error('That does not look like an Anthropic API key (starts with sk-ant-).'); e.status = 400; throw e; }
      await fs.mkdir(path.dirname(keyFile), { recursive: true }); await fs.writeFile(keyFile, k);
    },
    check,
    SYSTEM, SCHEMA, prompt, // shared with the free local model (local.mjs)
  };
}
