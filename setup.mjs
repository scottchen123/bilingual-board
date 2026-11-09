// One-time setup for the FREE offline checker: downloads llama.cpp's llama-server and the Qwen3 4B model into ./llm.
// Works on Windows (x64) and macOS (Apple Silicon or Intel). No other programs needed besides Node 18+.
//   node setup.mjs
// 第一次使用免费本地模型前运行一次：下载 llama-server（约 15–40 MB）和 Qwen3 4B 模型（约 2.4 GB）到 llm 文件夹。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LLM = process.env.LOCAL_LLM_DIR ? path.resolve(process.env.LOCAL_LLM_DIR) : path.join(HERE, 'llm');
const LLAMA_TAG = 'b12197'; // the llama.cpp build this app was tested with
const MODEL_FILE = 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf';
const MODEL_URL = `https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/${MODEL_FILE}`;
const EXE = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

const ASSETS = { 'win32-x64': 'win-vulkan-x64.zip', 'darwin-arm64': 'macos-arm64.tar.gz', 'darwin-x64': 'macos-x64.tar.gz' };

const mb = n => (n / 1048576).toFixed(0) + ' MB';
function findExe(dir, depth = 3) {
  if (!fs.existsSync(dir)) return null;
  if (fs.existsSync(path.join(dir, EXE))) return path.join(dir, EXE);
  if (depth === 0) return null;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) if (d.isDirectory()) { const f = findExe(path.join(dir, d.name), depth - 1); if (f) return f; }
  return null;
}
const onPath = () => (process.env.PATH || '').split(path.delimiter).some(p => p && fs.existsSync(path.join(p, EXE)));

async function download(url, dest, label) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`Download failed (${r.status}): ${url}`);
  const total = Number(r.headers.get('content-length')) || 0;
  let got = 0, last = 0;
  const body = Readable.fromWeb(r.body);
  body.on('data', c => {
    got += c.length;
    if (Date.now() - last > 1000) { last = Date.now(); process.stdout.write(`\r  ${label}: ${mb(got)}${total ? ' / ' + mb(total) + ` (${Math.floor(got / total * 100)}%)` : ''}   `); }
  });
  await pipeline(body, fs.createWriteStream(dest + '.part'));
  fs.renameSync(dest + '.part', dest);
  process.stdout.write(`\r  ${label}: done, ${mb(got)}                    \n`);
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 18) throw new Error('Please install Node.js 18 or newer (https://nodejs.org).');
  fs.mkdirSync(LLM, { recursive: true });
  const needModel = !fs.existsSync(path.join(LLM, MODEL_FILE));
  const needServer = !findExe(path.join(LLM, 'llama')) && !onPath();

  if (needModel && fs.statfsSync) {
    const s = fs.statfsSync(LLM), free = s.bavail * s.bsize;
    if (free < 2.8 * 1024 ** 3) throw new Error(`Not enough disk space: ${mb(free)} free, about 2.8 GB needed. 磁盘空间不够。`);
  }

  if (needServer) {
    const asset = ASSETS[`${process.platform}-${process.arch}`];
    if (!asset) throw new Error(`No ready-made llama-server for ${process.platform}-${process.arch}. Install llama.cpp yourself (e.g. "brew install llama.cpp") and run this again.`);
    const name = `llama-${LLAMA_TAG}-bin-${asset}`;
    const archive = path.join(LLM, name);
    console.log(`1/2  llama-server (${name})`);
    await download(`https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/${name}`, archive, 'llama-server');
    const out = path.join(LLM, 'llama'); fs.mkdirSync(out, { recursive: true });
    execFileSync('tar', ['-xf', archive, '-C', out], { stdio: 'inherit' }); // tar ships with Windows 10+ and macOS, and reads .zip too
    fs.rmSync(archive);
    const exe = findExe(out);
    if (!exe) throw new Error('llama-server was not found after unpacking.');
    if (process.platform !== 'win32') fs.chmodSync(exe, 0o755);
  } else console.log('1/2  llama-server: already installed');

  if (needModel) {
    console.log(`2/2  model ${MODEL_FILE} (about 2.4 GB, this can take a while)`);
    await download(MODEL_URL, path.join(LLM, MODEL_FILE), 'model');
  } else console.log('2/2  model: already downloaded');

  console.log('\nDone! Start the board (start.bat on Windows, start.command on Mac) and pick "🐱 本地 Qwen" in the bottom-right menu.');
  console.log('完成！启动聊天板，在右下角选择“🐱 本地 Qwen”。');
}

main().catch(e => { console.error('\n' + e.message); process.exit(1); });
