# Bilingual Board · 双语聊天板

A chat board for two people sharing one computer: a Chinese speaker who is learning English and an English speaker (who may be learning Chinese).
Each message is translated, and English mistakes are marked with a red pen, with the reasons explained in Chinese.
Works on **Windows** and **macOS**. No accounts and no cloud needed. Chats stay on your computer.

两个人用同一台电脑聊天：一位中文母语者（在学英语），一位英语母语者。消息自动翻译，英文错误用红笔改，并有中文解释。支持 Windows 和 macOS，聊天记录只存在你自己的电脑上。

![cats](img/fawn-step.png)

## Quick start · 快速开始

1. Install **Node.js 18 or newer**: https://nodejs.org · 安装 Node.js（18 或更新）
2. Download this project (green **Code** button → **Download ZIP**, then unzip), or `git clone` it. · 下载本项目（Code → Download ZIP，解压）
3. Start the board · 启动：
   - **Windows**: double-click `start.bat` · 双击 `start.bat`
   - **Mac**: double-click `start.command`. The first time, Mac may block it. Right-click it → **Open** → **Open**. If it still won't run, open Terminal in this folder and run `chmod +x start.command` once.
     第一次 Mac 可能会拦截：右键 → 打开 → 打开。
   - Or, in a terminal: `node server.mjs --open`

   The board opens at http://localhost:8765. Keep the black window open while you chat. Close it to stop the board.
   浏览器会打开 http://localhost:8765。聊天时别关黑色窗口，关掉它聊天板就停止。

### Optional: free offline English checker · 可选：免费离线批改

The best free checker is a small AI model (Qwen3 4B) that runs on your own computer. It needs no internet, no subscription and no API key.
最好的免费批改是在你电脑上运行的小模型 Qwen3 4B，不要网、不要订阅、不要 API key。

```bash
node setup.mjs
```

This downloads llama.cpp's `llama-server` (about 15–40 MB) and the model (about **2.4 GB**) into the `llm/` folder. It needs about 2.8 GB of free disk space.
Then pick **🐱 本地 Qwen** in the bottom-right menu.
会下载约 2.4 GB 到 `llm/` 文件夹（需要约 2.8 GB 空间）。之后在右下角选择“🐱 本地 Qwen”。

- Windows: uses the graphics card through Vulkan (an NVIDIA card is picked automatically when there are two). Mac: uses Apple Metal.
- Each check takes about 5–30 seconds, depending on your computer. The first check also starts the model (about 10 s).
- You can use your own llama.cpp instead (for example `brew install llama.cpp`). The board looks for `llama-server` on the PATH, and the model must be in `llm/`.

## Three checkers · 三种批改引擎 (bottom-right menu · 右下角切换)

| | Checker | What it does · 说明 |
|---|---|---|
| 🐱 | **Qwen3 4B, local** | Free, works offline. Reads the chat scene, rewrites the message the way a native speaker would say it, and explains why in Chinese. Needs `node setup.mjs`. · 免费、离线，看场景改地道说法，有中文解释 |
| 🔤 | **LanguageTool** | Free, online. Checks spelling and basic grammar only. Fast, but it doesn't understand the scene. · 免费、在线，只查拼写和基本语法 |
| 🤖 | **Claude** | The most accurate. Needs your own Anthropic API key from console.anthropic.com (paste it in ⚙️ Settings). Each check costs about 1–2 US cents. · 最准，需要自己的 API key，每句约 1–2 美分 |

Every correction shows which checker made it. · 每条批改都会标明是哪个引擎改的。

## Features · 功能

- Switch the speaker with the button or Alt+S. Person A (the Chinese speaker) is on the left; person B (the English speaker) is on the right.
- Automatic translation. In learning mode, the Chinese is blurred until you click it.
- **中→EN** turns a Chinese draft into English. **EN→中** (for B) gives natural Chinese with pinyin and a tip.
- Red-pen corrections that read the scene: a "This moment" version, plus an "only fix mistakes" version.
- ⭐ Vocabulary list with flashcards and CSV export. 🔊 Read aloud. 🎤 Voice input (Chrome and Edge).
- Message times for two places: A in Guangzhou time, B in this computer's time, with a city name you can change in ⚙️ Settings.
- Search, several conversations, Markdown export, JSON backup and restore, dark mode.

## Your data · 数据

- Chats are saved to `data/board-data.json`. There is a daily backup in `data/backups` (last 14 days).
- An API key, if you use one, is stored in `data/claude-key.txt`. It is used only by the local server and never reaches the browser.
- `data/` and `llm/` are never uploaded to git (see `.gitignore`).
- Translation: Chrome's built-in offline translator when available, otherwise the free MyMemory service. Don't type private things when using an online service.

聊天记录在 `data/` 文件夹，模型在 `llm/` 文件夹，这两个都不会上传到 GitHub。

## Files

`server.mjs` is the small local server; it has no dependencies. `index.html` is the whole app. `local.mjs` runs the free model, `claude.mjs` calls Claude, `merge.cjs` merges saved copies safely, and `setup.mjs` downloads the free model.
Pinyin comes from [pinyin-pro](https://github.com/zh-lx/pinyin-pro) (MIT), in `vendor/`.

Settings for advanced users (environment variables): `PORT` (default 8765), `BOARD_DATA_DIR`, `LOCAL_LLM_DIR`, `LOCAL_LLM_PORT` (default 8790).

## License

Code: [PolyForm Noncommercial 1.0.0](LICENSE). Free for personal and noncommercial use. Commercial use needs written permission from skot-chen. The cat illustrations in `img/` are © skot-chen and not covered by the license.
