// Tiny zero-dependency server: serves the board and saves chat data to ../../data/
import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeClaude } from './claude.mjs';
import { makeLocal } from './local.mjs';
import { exec } from 'node:child_process';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
// Chats live in ./data next to this file (BOARD_DATA_DIR overrides). Older installs kept them two folders up in data/.
const legacyDir = path.resolve(here, '..', '..', 'data');
const dataDir = process.env.BOARD_DATA_DIR ? path.resolve(process.env.BOARD_DATA_DIR)
  : !existsSync(path.join(here, 'data')) && existsSync(path.join(legacyDir, 'board-data.json')) ? legacyDir : path.join(here, 'data');
// BOARD_DATA lets tests use a throwaway file (e.g. tmp/test-data.json) instead of the real chats.
const dataFile = process.env.BOARD_DATA ? path.resolve(process.env.BOARD_DATA) : path.join(dataDir, 'board-data.json');
const PORT = Number(process.env.PORT) || 8765;
const claude = makeClaude(dataDir);
const local = makeLocal(claude);
const { mergeBoard } = createRequire(import.meta.url)('./merge.cjs');

// One copy of the saved file per day in data/backups (keeps the last 14 days, a few KB each).
const backupDir = path.join(path.dirname(dataFile), 'backups');
async function dailyBackup() {
  const day = new Date().toISOString().slice(0, 10);
  const target = path.join(backupDir, `board-${day}.json`);
  if (await fs.stat(target).catch(() => null)) return;
  await fs.mkdir(backupDir, { recursive: true });
  await fs.copyFile(dataFile, target);
  const old = (await fs.readdir(backupDir)).filter(f => /^board-\d{4}-\d\d-\d\d\.json$/.test(f)).sort().slice(0, -14);
  for (const f of old) await fs.rm(path.join(backupDir, f));
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.cjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

async function readBody(req, limit = 20 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new Error('too large'); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/state') {
      if (req.method === 'GET') {
        const txt = await fs.readFile(dataFile, 'utf8').catch(() => 'null');
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end(txt);
      }
      if (req.method === 'PUT') {
        const incoming = JSON.parse(await readBody(req));
        const onDisk = JSON.parse(await fs.readFile(dataFile, 'utf8').catch(() => 'null'));
        const merged = mergeBoard(incoming, onDisk); // never lets one copy wipe the other
        await fs.mkdir(path.dirname(dataFile), { recursive: true });
        if (onDisk) {
          await fs.copyFile(dataFile, dataFile + '.bak').catch(() => {});
          await dailyBackup();
        }
        await fs.writeFile(dataFile + '.tmp', JSON.stringify(merged));
        await fs.rename(dataFile + '.tmp', dataFile);
        res.writeHead(204); return res.end();
      }
    }
    if (url.pathname === '/api/local/check' && req.method === 'POST') { // free model on this PC (local.mjs)
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      try {
        const { text, context } = JSON.parse(await readBody(req, 60000));
        if (!text || text.length > 2000) return send(400, { error: 'Text must be 1–2000 characters.' });
        return send(200, await local.check(text, Array.isArray(context) ? context : []));
      } catch (e) { return send(e.status && e.status < 600 ? e.status : 500, { error: e.message }); }
    }
    if (url.pathname === '/api/local/zh' && req.method === 'POST') { // English speaker: say it in Chinese
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      try {
        const { text, context } = JSON.parse(await readBody(req, 60000));
        if (!text || text.length > 2000) return send(400, { error: 'Text must be 1–2000 characters.' });
        return send(200, await local.toZh(text, Array.isArray(context) ? context : []));
      } catch (e) { return send(e.status && e.status < 600 ? e.status : 500, { error: e.message }); }
    }
    if (url.pathname === '/api/local/status') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ installed: local.installed(), running: await local.healthy() })); }
    if (url.pathname.startsWith('/api/claude/')) {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      try {
        if (url.pathname === '/api/claude/status' && req.method === 'GET') return send(200, await claude.status());
        if (url.pathname === '/api/claude/key' && req.method === 'PUT') { await claude.setKey(JSON.parse(await readBody(req)).key); return send(200, await claude.status()); }
        if (url.pathname === '/api/claude/check' && req.method === 'POST') {
          const { text, model, context } = JSON.parse(await readBody(req, 60000));
          if (!text || text.length > 4000) return send(400, { error: 'Text must be 1–4000 characters.' });
          return send(200, await claude.check(text, model, Array.isArray(context) ? context : []));
        }
        return send(404, { error: 'not found' });
      } catch (e) { return send(e.status && e.status < 600 ? e.status : 500, { error: e.message }); }
    }
    let file = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const full = path.join(here, path.normalize(file));
    if (!full.startsWith(here)) { res.writeHead(403); return res.end(); }
    const buf = await fs.readFile(full);
    res.writeHead(200, { 'content-type': types[path.extname(full)] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500); res.end(String(e.message));
  }
});

// --open: open the browser only once the server is really listening.
const openCmd = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
const openBrowser = () => { if (process.argv.includes('--open')) exec(`${openCmd} http://localhost:${PORT}`); };
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { // already running in another window → just open the page
    console.log(`Bilingual Board is already running at http://localhost:${PORT}`); openBrowser(); setTimeout(() => process.exit(0), 1500);
  } else { console.error(e); }
});
server.listen(PORT, '127.0.0.1', () => {
  openBrowser();
  console.log(`Bilingual Board running:  http://localhost:${PORT}`);
  console.log(`Chat data saved to:       ${dataFile}`);
  console.log('Close this window to stop.');
});
