// Free, offline English correction with a small open model (Qwen3 4B Instruct) running on this PC's graphics card
// through llama.cpp's llama-server (both in ./llm — run "node setup.mjs" once to download them).
// The model server is started on demand the first time a check is asked for, and stays running while the board runs.
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_DIR = path.resolve(HERE, '..', '..', 'tools', 'llm'); // older installs kept it two folders up
const LLM_DIR = process.env.LOCAL_LLM_DIR ? path.resolve(process.env.LOCAL_LLM_DIR)
  : !fs.existsSync(path.join(HERE, 'llm')) && fs.existsSync(LEGACY_DIR) ? LEGACY_DIR : path.join(HERE, 'llm');
export const MODEL_FILE = 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf';
const PORT = Number(process.env.LOCAL_LLM_PORT) || 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const EXE = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

// llama-server from setup.mjs (llm/llama, maybe a folder or two deeper), else one on the PATH (e.g. "brew install llama.cpp")
function findServer() {
  const walk = (dir, depth) => {
    if (fs.existsSync(path.join(dir, EXE))) return path.join(dir, EXE);
    if (depth === 0) return null;
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) if (d.isDirectory()) { const f = walk(path.join(dir, d.name), depth - 1); if (f) return f; }
    return null;
  };
  try { const root = path.join(LLM_DIR, 'llama'); const f = fs.existsSync(root) && walk(root, 3); if (f) return f; } catch {}
  for (const p of (process.env.PATH || '').split(path.delimiter)) if (p && fs.existsSync(path.join(p, EXE))) return path.join(p, EXE);
  return null;
}

export function makeLocal(claude) {
  let starting = null, child = null;

  async function healthy() {
    try { const r = await fetch(BASE + '/health', { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
  }
  const installed = () => !!findServer() && fs.existsSync(path.join(LLM_DIR, MODEL_FILE));

  async function ensureServer() {
    if (await healthy()) return;
    if (!installed()) { const e = new Error(`Free model not found in ${LLM_DIR}. Run "node setup.mjs" first. 免费模型没有安装，请先运行 node setup.mjs。`); e.status = 503; throw e; }
    if (!starting) starting = (async () => {
      const exe = findServer();
      // Windows laptops often have two graphics chips; use only the NVIDIA one (sharing with the other is much slower).
      // Macs use Metal on their own.
      let dev = [];
      if (process.platform === 'win32') try { const list = execFileSync(exe, ['--list-devices'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        const m = list.match(/(Vulkan\d+): NVIDIA/); if (m) dev = ['-dev', m[1]]; } catch {}
      child = spawn(exe, ['-m', path.join(LLM_DIR, MODEL_FILE), '--host', '127.0.0.1', '--port', String(PORT), '-ngl', '99', '-c', '6144', '-fa', 'on', ...dev],
        { cwd: path.dirname(exe), stdio: 'ignore', windowsHide: true });
      child.on('exit', () => { child = null; });
      for (let i = 0; i < 90; i++) { if (await healthy()) return; await new Promise(r => setTimeout(r, 1000)); }
      throw Object.assign(new Error('The free model did not start. 免费模型没能启动。'), { status: 503 });
    })().finally(() => { starting = null; });
    return starting;
  }

  // A small model writes slowly (~15 words/s here), so it gets a shorter answer format and one worked example.
  const SYSTEM = `You are an English tutor. The learner is Chinese (English level B1) texting their English-speaking partner.
Look at the recent chat to understand the scene, then correct ONLY the learner's new message.
- corrected: fix EVERY grammar mistake (verb forms like "haven't seen", plurals, articles, there is/are, capital I, word order, punctuation). Keep the learner's words otherwise.
- natural: what a native speaker would really text in this moment, same meaning and feeling. Remove Chinese-style word-for-word phrasing. Use simple, common words.
- edits: each change from the message to corrected. natural_edits: each change from the message to natural.
  "original" = a short phrase copied EXACTLY from the learner's message. "why_zh" = short reason in simple Chinese (max 25 characters).
- scene_zh: the scene and tone in one short Chinese line.
- level: good / minor / major.`;
  const EXAMPLE_IN = `Recent conversation (oldest first):\n[Tom]: I made pasta for us tonight\n\nLearner's new message to correct:\ni very like your cooking, you are so good hand`;
  const EXAMPLE_OUT = JSON.stringify({ scene_zh: '晚饭时夸伴侣做的菜，语气亲密', level: 'major',
    corrected: 'I like your cooking very much. You are very good at it.',
    edits: [{ original: 'i very like your cooking,', fix: 'I like your cooking very much.', why_zh: 'very 不能直接修饰动词 like' }, { original: 'you are so good hand', fix: 'You are very good at it.', why_zh: '“好手”不能直译成 good hand' }],
    natural: 'I love your cooking. You’re so good at this!',
    natural_edits: [{ original: 'i very like your cooking,', fix: 'I love your cooking.', why_zh: '夸人时母语者常说 I love…' }, { original: 'you are so good hand', fix: 'You’re so good at this!', why_zh: '“手艺好”说 good at this' }] });
  const EDITS = { type: 'array', items: { type: 'object', additionalProperties: false, required: ['original', 'fix', 'why_zh'],
    properties: { original: { type: 'string' }, fix: { type: 'string' }, why_zh: { type: 'string' } } } };
  const SCHEMA = { type: 'object', additionalProperties: false, required: ['scene_zh', 'level', 'corrected', 'edits', 'natural', 'natural_edits'],
    properties: { scene_zh: { type: 'string' }, level: { type: 'string', enum: ['good', 'minor', 'major'] }, corrected: { type: 'string' }, edits: EDITS,
      natural: { type: 'string' }, natural_edits: EDITS } };

  async function check(text, context) {
    await ensureServer();
    const body = {
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: EXAMPLE_IN }, { role: 'assistant', content: EXAMPLE_OUT },
        { role: 'user', content: claude.prompt(text, (context || []).slice(-6)) }],
      temperature: 0.2, max_tokens: 900,
      response_format: { type: 'json_schema', json_schema: { name: 'correction', schema: SCHEMA } },
    };
    const r = await fetch(BASE + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error('Free model error: ' + (j?.error?.message || r.status)), { status: 502 });
    const res = JSON.parse(j.choices[0].message.content);
    const full = es => (es || []).map(e => ({ ...e, why_en: '' })); // same shape as the Claude answer
    return { model: 'qwen3-4b (free, local)', usd: 0, result: { ...res, edits: full(res.edits), natural_edits: full(res.natural_edits), feedback_zh: '' } };
  }

  // For the English speaker: how to say their English message in natural, everyday Chinese (+ pinyin, + a short tip).
  const ZH_SCHEMA = { type: 'object', additionalProperties: false, required: ['zh', 'tip_en'],
    properties: { zh: { type: 'string' }, tip_en: { type: 'string' } } };
  async function toZh(text, context) {
    await ensureServer();
    const lines = (context || []).slice(-6).map(c => `[${c.who}]: ${c.text}`).join('\n');
    const body = {
      messages: [{ role: 'system', content: `You help an English speaker who is learning Chinese write to their Chinese partner.
Turn their English message into the Chinese a native speaker would naturally text in this moment (simplified characters, casual and warm, not word-for-word).
zh: the Chinese message. tip_en: one short English tip about a useful word or pattern in zh (max 20 words).` },
        { role: 'user', content: (lines ? `Recent chat:\n${lines}\n\n` : '') + `Message to say in Chinese:\n${text}` }],
      temperature: 0.2, max_tokens: 500,
      response_format: { type: 'json_schema', json_schema: { name: 'zh', schema: ZH_SCHEMA } },
    };
    const r = await fetch(BASE + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error('Free model error: ' + (j?.error?.message || r.status)), { status: 502 });
    return JSON.parse(j.choices[0].message.content);
  }

  // stop the model when the board's server stops, so it doesn't keep graphics memory busy
  for (const sig of ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { try { child && child.kill(); } catch {} if (sig !== 'exit') process.exit(0); });

  return { check, toZh, installed, healthy };
}
