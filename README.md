# ClaudeClaw

A personal AI assistant that bridges the full power of Claude (via the Claude Code SDK) to Telegram. Send a text, voice note, photo, or document from your phone and get back a streaming Claude response with file access, bash execution, web search, and more. Optionally bridges to WhatsApp, supports scheduled tasks, persistent memory, voice replies, and per-user cost tracking.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone & Install](#2-clone--install)
3. [Create a Telegram Bot](#3-create-a-telegram-bot)
4. [Set Up Claude CLI Authentication](#4-set-up-claude-cli-authentication)
5. [Set Up Voice (Optional)](#5-set-up-voice-optional)
6. [Set Up WhatsApp Bridge (Optional)](#6-set-up-whatsapp-bridge-optional)
7. [Configure Environment Variables](#7-configure-environment-variables)
8. [Build & Test](#8-build--test)
9. [Run](#9-run)
10. [Get Your Chat ID & Lock Down Access](#10-get-your-chat-id--lock-down-access)
11. [Run as a Background Service (macOS)](#11-run-as-a-background-service-macos)
12. [Bot Commands Reference](#12-bot-commands-reference)
13. [Scheduled Tasks](#13-scheduled-tasks)
14. [Architecture Overview](#14-architecture-overview)
15. [Environment Variable Reference](#15-environment-variable-reference)
16. [File Structure](#16-file-structure)
17. [Security Model](#17-security-model)
18. [Troubleshooting](#18-troubleshooting)
19. [Cost Tracking](#19-cost-tracking)

---

## 1. Prerequisites

Before you begin, make sure you have:

| Requirement | Minimum Version | Check With |
|-------------|----------------|------------|
| **Node.js** | 20.0+ | `node --version` |
| **npm** | 9+ | `npm --version` |
| **Claude CLI** | Any | `claude --version` |
| **Anthropic API Key** | - | Set via `claude auth` or env var |

### Install Node.js

If you don't have Node.js 20+:

```bash
# macOS (Homebrew)
brew install node@22

# Or use nvm
nvm install 22
nvm use 22
```

### Install Claude CLI

ClaudeClaw uses the Claude Code SDK under the hood. The SDK requires the Claude CLI to be installed and authenticated:

```bash
npm install -g @anthropic-ai/claude-code
```

Then authenticate (you need an Anthropic API key from https://console.anthropic.com):

```bash
claude auth
```

Or set the key directly as an environment variable:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

> The Claude CLI is what gives ClaudeClaw its superpowers: file system access, bash execution, web search, multi-step reasoning, and more. Without it, the agent won't be able to do much.

---

## 2. Clone & Install

```bash
git clone <your-repo-url> ~/ClaudeClaw
cd ~/ClaudeClaw
npm install
```

This installs all dependencies:

| Package | Purpose |
|---------|---------|
| `@anthropic-ai/claude-code` | Claude agent SDK (streaming, tools, sessions) |
| `grammy` | Telegram bot framework |
| `@grammyjs/runner` | Non-blocking bot runner with sequentialization |
| `@grammyjs/auto-retry` | Automatic retry on Telegram API rate limits |
| `@grammyjs/transformer-throttler` | Outgoing request throttling |
| `better-sqlite3` | SQLite database (sessions, memory, costs) |
| `croner` | Cron expression parser for scheduled tasks |
| `pino` / `pino-pretty` | Structured logging with redaction |
| `elevenlabs` | Text-to-speech WebSocket streaming |
| `whatsapp-web.js` | WhatsApp Web protocol bridge |
| `qrcode-terminal` | QR code display for WhatsApp pairing |

---

## 3. Create a Telegram Bot

You need a Telegram bot token. Here's how to get one:

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a **name** (display name, e.g. "ClaudeClaw")
4. Choose a **username** (must end in `bot`, e.g. `claudeclaw_bot`)
5. BotFather replies with your **HTTP API token** — it looks like:
   ```
   7123456789:AAH1234567890abcdefghijklmnopqrstuv
   ```
6. Copy this token. You'll need it in step 7.

**Optional but recommended**: Send these commands to @BotFather to configure your bot:

```
/setdescription   → "Personal AI assistant powered by Claude"
/setabouttext     → "Send me anything — text, voice, photos, documents"
/setcommands      → Paste the following:
start - Welcome message
chatid - Show your chat ID
newchat - Start a fresh session
memory - Show memory stats
forget - Clear all memories
voice - Toggle voice mode
cost - Show usage costs
schedule - Manage scheduled tasks
```

---

## 4. Set Up Claude CLI Authentication

The Claude Code SDK needs to authenticate with Anthropic's API. You have two options:

### Option A: Interactive Login (Recommended)

```bash
claude auth
```

This opens a browser flow and stores credentials in `~/.claude/`. The SDK picks them up automatically.

### Option B: API Key Environment Variable

Get your API key from https://console.anthropic.com/settings/keys, then add it to your shell profile:

```bash
# In ~/.zshrc or ~/.bashrc
export ANTHROPIC_API_KEY=sk-ant-api03-...
```

> ClaudeClaw does NOT store or manage your Anthropic key. It delegates authentication entirely to the Claude CLI/SDK. Make sure `claude --version` works before proceeding.

---

## 5. Set Up Voice (Optional)

Voice support has two halves: speech-to-text (STT) for understanding voice notes, and text-to-speech (TTS) for replying with audio. Both are optional and independent.

### 5a. Speech-to-Text: Groq (Whisper)

Groq provides fast Whisper transcription. Free tier available.

1. Go to https://console.groq.com
2. Sign up or log in
3. Navigate to **API Keys** in the sidebar
4. Click **Create API Key**
5. Copy the key (starts with `gsk_...`)
6. You'll add it as `GROQ_API_KEY` in step 7

**What it does**: When you send a voice note on Telegram, ClaudeClaw downloads the audio, sends it to Groq's Whisper API, gets back the transcription, shows it to you, and then processes it as a regular text message.

### 5b. Text-to-Speech: ElevenLabs

ElevenLabs provides natural-sounding voice synthesis. Free tier includes ~10k characters/month.

1. Go to https://elevenlabs.io
2. Sign up or log in
3. Click your profile icon (top-right) > **Profile + API Key**
4. Copy your API key
5. You'll add it as `ELEVENLABS_API_KEY` in step 7

**Choosing a Voice**: The default voice is "Adam" (`pNInz6obpgDQGcFmaJgB`). To use a different voice:

1. Go to https://elevenlabs.io/voice-library
2. Find a voice you like and click on it
3. The voice ID is in the URL or details panel
4. Set it as `ELEVENLABS_VOICE_ID` in step 7

**What it does**: When voice mode is ON (toggle with `/voice`), ClaudeClaw streams Claude's text response through ElevenLabs' WebSocket API and sends back an audio message alongside the text response. It uses WebSocket streaming for low latency, with an HTTP fallback if the WebSocket connection fails.

---

## 6. Set Up WhatsApp Bridge (Optional)

The WhatsApp bridge uses `whatsapp-web.js` to connect via the WhatsApp Web protocol. No API key needed — it authenticates by scanning a QR code with your phone, just like WhatsApp Web.

**How it works**: On first run, a QR code appears in your terminal. You scan it with WhatsApp on your phone (Settings > Linked Devices > Link a Device). After pairing, the session is cached locally and auto-reconnects on restarts.

> Currently the WhatsApp bridge receives and stores incoming messages. Full Telegram-to-WhatsApp forwarding is planned. Set `WHATSAPP_ENABLED=true` in step 7 to activate it.

**Requirements**:
- A phone with WhatsApp installed
- The phone must stay connected to the internet (WhatsApp Web requirement)
- Chromium is auto-installed by Puppeteer (used internally by `whatsapp-web.js`)

---

## 7. Configure Environment Variables

### Quick Start: Interactive Setup Wizard

```bash
npm run setup
```

The wizard walks you through every option, validates your inputs, creates the `.env` file, and optionally installs the macOS background service. If you prefer to do it manually:

### Manual Setup

```bash
cp .env.example .env
```

Then edit `.env` with your values:

```env
# ─── REQUIRED ──────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=7123456789:AAH1234567890abcdefghijklmnopqrstuv

# ─── ACCESS CONTROL ───────────────────────────────────────
# Comma-separated Telegram chat IDs that are allowed to use the bot.
# Leave empty to allow ALL users (not recommended for production).
# Get your chat ID by running the bot and sending /chatid.
ALLOWED_CHAT_IDS=

# ─── AGENT LIMITS (optional, these are the defaults) ──────
MAX_TURNS=25              # Max agent turns per request
MAX_BUDGET_USD=2.0        # Max cost per request in USD
AGENT_TIMEOUT_MS=120000   # Timeout per request (120 seconds)

# ─── VOICE: Speech-to-Text (optional) ─────────────────────
GROQ_API_KEY=gsk_...

# ─── VOICE: Text-to-Speech (optional) ─────────────────────
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=pNInz6obpgDQGcFmaJgB

# ─── WHATSAPP BRIDGE (optional) ───────────────────────────
WHATSAPP_ENABLED=false
```

---

## 8. Build & Test

```bash
# Type-check without emitting
npm run typecheck

# Compile TypeScript to dist/
npm run build

# Run the full test suite (78 tests across 6 files)
npm test
```

Expected output:

```
 ✓ tests/env.test.ts        (10 tests)
 ✓ tests/db.test.ts         (8 tests)
 ✓ tests/formatter.test.ts  (19 tests)
 ✓ tests/memory.test.ts     (15 tests)
 ✓ tests/security.test.ts   (20 tests)
 ✓ tests/scheduler.test.ts  (6 tests)

 Test Files  6 passed (6)
      Tests  78 passed (78)
```

---

## 9. Run

### Development Mode (auto-reloads on file changes)

```bash
npm run dev
```

### Production Mode (from compiled output)

```bash
npm run build
node dist/index.js
```

You should see:

```
   ╔═══════════════════════════════════╗
   ║         ClaudeClaw v1.0           ║
   ║   Personal AI Assistant Bridge    ║
   ╚═══════════════════════════════════╝

[INFO] Database initialized
[INFO] Memory decay sweep
[INFO] Bot started with grammy runner
[INFO] ClaudeClaw is running. Press Ctrl+C to stop.
```

Send a message to your bot on Telegram. It should reply with "Thinking..." and then stream the response in real-time.

---

## 10. Get Your Chat ID & Lock Down Access

On first run, you likely left `ALLOWED_CHAT_IDS` empty. To secure your bot:

1. Open Telegram, find your bot
2. Send `/chatid`
3. The bot replies with something like:
   ```
   Your chat ID: 123456789
   ```
4. Copy the number
5. Edit `.env`:
   ```env
   ALLOWED_CHAT_IDS=123456789
   ```
   For multiple users, comma-separate:
   ```env
   ALLOWED_CHAT_IDS=123456789,987654321
   ```
6. Restart ClaudeClaw

Now only listed chat IDs can interact with the bot. Anyone else gets "Unauthorized."

---

## 11. Run as a Background Service (macOS)

The setup wizard (`npm run setup`) can install a macOS launchd service for you. If you skipped that step or want to do it manually:

### Create the plist

Create `~/Library/LaunchAgents/com.claudeclaw.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claudeclaw</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/YOUR_USERNAME/ClaudeClaw/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/YOUR_USERNAME/ClaudeClaw</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>/Users/YOUR_USERNAME/ClaudeClaw/store/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/YOUR_USERNAME/ClaudeClaw/store/stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
```

Replace `YOUR_USERNAME` with your actual username, and update the node path if needed (`which node`).

### Manage the service

```bash
# Start (also starts on boot)
launchctl load ~/Library/LaunchAgents/com.claudeclaw.plist

# Stop
launchctl unload ~/Library/LaunchAgents/com.claudeclaw.plist

# Check if running
launchctl list | grep claudeclaw

# View logs
tail -f ~/ClaudeClaw/store/stdout.log
tail -f ~/ClaudeClaw/store/stderr.log
```

The service auto-restarts on crash (`KeepAlive: true`) with a minimum 5-second gap between restarts (`ThrottleInterval: 5`).

---

## 12. Bot Commands Reference

| Command | What It Does |
|---------|-------------|
| `/start` | Shows welcome message and command list |
| `/chatid` | Displays your Telegram chat ID (for `ALLOWED_CHAT_IDS`) |
| `/newchat` | Clears your Claude session — starts a completely fresh conversation |
| `/memory` | Shows how many memory entries are stored for your chat |
| `/forget` | Deletes all stored memories for your chat |
| `/voice` | Toggles voice mode on/off. When ON, responses include audio |
| `/cost` | Shows your API usage: today's cost and all-time total |
| `/schedule` | Lists your scheduled tasks, or creates a new one (see below) |

### Supported Message Types

| Type | What Happens |
|------|-------------|
| **Text** | Sent directly to Claude as a prompt |
| **Voice note** | Transcribed via Groq Whisper, then sent to Claude. Transcription shown first. |
| **Photo** | Downloaded, file path sent to Claude (Claude can analyze if using vision) |
| **Document** | Downloaded with original filename, path sent to Claude |
| **Video** | Downloaded, file path sent to Claude |

---

## 13. Scheduled Tasks

Create recurring tasks with cron expressions:

```
/schedule <min> <hour> <day-of-month> <month> <day-of-week> <prompt>
```

### Examples

```
# Morning briefing at 9 AM every weekday
/schedule 0 9 * * 1-5 Give me a morning briefing with weather and top news

# Weekly project summary every Monday at 8 AM
/schedule 0 8 * * 1 Summarize my project progress this week

# Every 6 hours, check server status
/schedule 0 */6 * * * Check if my server at example.com is responding
```

All times default to **America/Chicago** timezone. Tasks are stored in the database and survive restarts. Manage via CLI:

```bash
# List all tasks
npm run schedule list

# Create from CLI
npm run schedule create <chat_id> "<cron>" "<timezone>" "<prompt>"

# Pause/resume/delete
npm run schedule pause <task_id>
npm run schedule resume <task_id>
npm run schedule delete <task_id>
```

---

## 14. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    Your Phone                        │
│  Telegram App ─────────────┐                         │
│  WhatsApp App ─────────────┤                         │
└────────────────────────────┼─────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────┐
│                   ClaudeClaw                         │
│                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  Grammy Bot  │  │ WhatsApp.js  │  │  Scheduler │  │
│  │  (Telegram)  │  │  (Bridge)    │  │  (Croner)  │  │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘  │
│         │                 │                │         │
│         ▼                 ▼                ▼         │
│  ┌───────────────────────────────────────────────┐   │
│  │              Message Pipeline                 │   │
│  │                                               │   │
│  │  Auth Check → Media Download → Memory Lookup  │   │
│  │       → Claude Agent SDK (streaming)          │   │
│  │       → Format Response → Send Back           │   │
│  │       → Save Memory → Log Cost                │   │
│  └──────────────────┬────────────────────────────┘   │
│                     │                                │
│         ┌───────────┼───────────┐                    │
│         ▼           ▼           ▼                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │  SQLite  │ │   Groq   │ │ElevenLabs│             │
│  │ (Memory, │ │  (STT)   │ │  (TTS)   │             │
│  │ Sessions,│ └──────────┘ └──────────┘             │
│  │  Costs)  │                                       │
│  └──────────┘                                       │
└──────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────┐
│              Claude Code SDK / CLI                   │
│                                                      │
│  File Access • Bash Execution • Web Search           │
│  Code Analysis • Multi-step Reasoning                │
│  MCP Servers • Skills                                │
└──────────────────────────────────────────────────────┘
                             │
                             ▼
                    Anthropic Claude API
```

### How Streaming Works

1. You send a message
2. Bot immediately replies with "Thinking..."
3. As Claude streams tokens, the "Thinking..." message is edited every 500ms with the latest content
4. When complete, the message is finalized with proper HTML formatting
5. If the response exceeds 4096 characters (Telegram's limit), it's split into multiple messages

### Memory System

ClaudeClaw has a dual-sector memory system:

- **Semantic memories**: Triggered when you say things like "my name is...", "I prefer...", "always...", "never...". These are facts about you.
- **Episodic memories**: Everything else. Conversation snippets stored for context.

Memories decay over time (2% per day). Frequently accessed memories get a salience boost (capped at 5.0). Memories below 0.1 salience are deleted. This means important, frequently-referenced memories persist while stale ones fade naturally.

On each message, ClaudeClaw searches memories via FTS5 (full-text search) and fetches recent ones, deduplicates, and prepends them as context to your prompt.

---

## 15. Environment Variable Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | - | Bot token from @BotFather |
| `ALLOWED_CHAT_IDS` | No | *(empty = allow all)* | Comma-separated chat IDs |
| `MAX_TURNS` | No | `25` | Max Claude agent turns per request |
| `MAX_BUDGET_USD` | No | `2.0` | Max cost per request (USD) |
| `AGENT_TIMEOUT_MS` | No | `120000` | Request timeout (ms) |
| `GROQ_API_KEY` | No | - | Groq API key for Whisper STT |
| `ELEVENLABS_API_KEY` | No | - | ElevenLabs API key for TTS |
| `ELEVENLABS_VOICE_ID` | No | `pNInz6obpgDQGcFmaJgB` | ElevenLabs voice ID |
| `WHATSAPP_ENABLED` | No | `false` | Enable WhatsApp bridge |

---

## 16. File Structure

```
ClaudeClaw/
├── src/
│   ├── index.ts            Entry point, startup orchestration
│   ├── agent.ts            Claude SDK wrapper (streaming, security, sessions)
│   ├── bot.ts              Telegram bot (commands, handlers, streaming UI)
│   ├── db.ts               SQLite database (7 tables, FTS5, WAL mode)
│   ├── memory.ts           Dual-sector memory (semantic/episodic, decay)
│   ├── formatter.ts        Markdown → Telegram HTML converter
│   ├── voice.ts            Groq STT + ElevenLabs TTS (WebSocket + HTTP)
│   ├── media.ts            Telegram file download + cleanup
│   ├── scheduler.ts        Croner-based scheduled tasks
│   ├── schedule-cli.ts     CLI for managing scheduled tasks
│   ├── whatsapp.ts         WhatsApp Web bridge + message queue
│   ├── security.ts         Security policy definitions
│   ├── config.ts           Configuration loader
│   ├── env.ts              .env file parser
│   ├── logger.ts           Pino logging (redaction, multi-target)
│   ├── types.ts            Shared TypeScript interfaces
│   └── declarations.d.ts   Module declarations
├── scripts/
│   ├── setup.ts            Interactive setup wizard
│   ├── status.ts           Health check script
│   └── notify.sh           macOS notification helper
├── tests/                  6 test files, 78 tests
├── store/                  Runtime data (auto-created, gitignored)
│   ├── claudeclaw.db       SQLite database
│   ├── claudeclaw.pid      Process lock file
│   ├── error.log           Error log
│   └── debug.log           Debug log
├── workspace/uploads/      Downloaded media (24h retention, gitignored)
├── CLAUDE.md               System prompt appended to every agent call
├── .env                    Your configuration (gitignored)
├── .env.example            Template for .env
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## 17. Security Model

### Access Control
- `ALLOWED_CHAT_IDS` whitelist restricts who can talk to the bot
- If empty, all users are allowed (only for testing — lock it down before exposing publicly)

### Agent Sandboxing
ClaudeClaw uses the SDK's `canUseTool` callback to enforce security policies:

**Blocked bash commands**:
- `rm -rf /` and variants
- `mkfs`, `dd if=`, `kill -9 1`
- `sudo rm`, `shutdown`, `reboot`
- Fork bombs
- `chmod 777 /`

**Blocked file writes**:
- System paths: `/etc/`, `/usr/`, `/System/`, `/Library/`, `/bin/`, `/sbin/`, `/var/`
- Sensitive files: `.env`, `credentials*`, `*.pem`, `*.key`, SSH keys

**Logging**:
- All tool denials are logged with full context
- Web access (fetch/search) is logged with URLs
- API keys are automatically redacted from all log output

### Budget Limits
- Per-request cost limit: `MAX_BUDGET_USD` (default $2.00)
- Per-request turn limit: `MAX_TURNS` (default 25)
- Per-request timeout: `AGENT_TIMEOUT_MS` (default 120 seconds)

---

## 18. Troubleshooting

### "Claude CLI not found"

The setup wizard warns about this but doesn't block. Install it:

```bash
npm install -g @anthropic-ai/claude-code
claude auth
```

### "Another instance is running"

ClaudeClaw uses a PID lock file to prevent duplicates:

```bash
# Check if it's actually running
cat ~/ClaudeClaw/store/claudeclaw.pid
ps aux | grep <pid>

# If the process doesn't exist, remove the stale lock
rm ~/ClaudeClaw/store/claudeclaw.pid
```

### Bot doesn't respond to messages

1. Check the token: `curl https://api.telegram.org/bot<YOUR_TOKEN>/getMe`
2. Check `ALLOWED_CHAT_IDS` — if set, make sure your ID is listed
3. Check logs: `tail -f ~/ClaudeClaw/store/debug.log`
4. Make sure only one instance is running (no duplicate bots polling)

### Voice transcription fails

- Verify `GROQ_API_KEY` is set in `.env`
- Check your Groq account has available quota at https://console.groq.com
- Look at `store/error.log` for the specific error

### TTS audio not playing

- Verify `ELEVENLABS_API_KEY` is set in `.env`
- Verify `ELEVENLABS_VOICE_ID` is a valid voice
- Check ElevenLabs character quota at https://elevenlabs.io
- The system falls back to HTTP if WebSocket fails — check logs

### WhatsApp QR code not showing / won't scan

- Make sure `WHATSAPP_ENABLED=true` in `.env`
- Run in a terminal that supports QR rendering (not piped to a log file)
- If stuck, delete the cache: `rm -rf .wwebjs_auth/ .wwebjs_cache/`
- Retry — a new QR will generate

### Database locked errors

SQLite has a 5-second busy timeout. If you're seeing lock errors:
- Make sure only one ClaudeClaw instance is running
- If the WAL file is corrupted: stop ClaudeClaw, delete `store/claudeclaw.db-wal` and `store/claudeclaw.db-shm`, restart

### Health Check

Run the built-in status script to diagnose issues:

```bash
npm run status
```

It checks: Node version, Claude CLI, .env presence, bot token, database, lock file, launchd service.

---

## 19. Cost Tracking

Every Claude API call is logged to the `cost_log` table with:
- Chat ID (who made the request)
- Cost in USD
- Number of agent turns
- Model used
- Timestamp

Check your costs anytime with the `/cost` command in Telegram:

```
Cost Summary
Today: $0.0432
All time: $1.2847
```

Budget limits prevent runaway costs. If a single request exceeds `MAX_BUDGET_USD` (default $2.00), the agent stops and notifies you. Adjust this in `.env` as needed.

> Note: These are Anthropic API costs only. Groq and ElevenLabs have their own billing — check their respective dashboards.

---

## Quick Start Summary

```bash
# 1. Clone and install
git clone <repo-url> ~/ClaudeClaw && cd ~/ClaudeClaw
npm install

# 2. Run the setup wizard (creates .env interactively)
npm run setup

# 3. Build and test
npm run build
npm test

# 4. Start
npm run dev

# 5. In Telegram: send /chatid to your bot, add ID to .env, restart

# 6. Start chatting!
```
