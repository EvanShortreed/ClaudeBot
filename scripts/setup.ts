#!/usr/bin/env node
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> =>
  new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log('\n  ClaudeClaw Setup Wizard\n');

  // Check requirements
  console.log('Checking requirements...');

  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1));
  if (nodeMajor < 20) {
    console.error(`Node.js 20+ required (found ${nodeVersion})`);
    process.exit(1);
  }
  console.log(`  Node.js ${nodeVersion}`);

  try {
    execSync('claude --version', { stdio: 'pipe' });
    console.log('  Claude CLI installed');
  } catch {
    console.warn('  WARNING: Claude CLI not found. Install it for agent functionality.');
  }

  // Create .env
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    const overwrite = await ask('\n.env already exists. Overwrite? (y/N): ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Keeping existing .env');
      rl.close();
      return;
    }
  }

  console.log('\nEnter your configuration values (press Enter to skip optional ones):\n');

  const token = await ask('Telegram Bot Token (required): ');
  if (!token) {
    console.error('Bot token is required. Get one from @BotFather on Telegram.');
    process.exit(1);
  }

  const chatIds = await ask('Allowed Chat IDs (comma-separated, or empty for no restriction): ');
  const groqKey = await ask('Groq API Key (optional, for voice STT): ');
  const elevenKey = await ask('ElevenLabs API Key (optional, for voice TTS): ');
  const whatsapp = await ask('Enable WhatsApp bridge? (y/N): ');

  const envContent = [
    `TELEGRAM_BOT_TOKEN=${token}`,
    `ALLOWED_CHAT_IDS=${chatIds}`,
    '',
    '# Agent limits',
    'MAX_TURNS=25',
    'MAX_BUDGET_USD=2.0',
    'AGENT_TIMEOUT_MS=120000',
    '',
    '# Voice',
    `GROQ_API_KEY=${groqKey}`,
    `ELEVENLABS_API_KEY=${elevenKey}`,
    'ELEVENLABS_VOICE_ID=pNInz6obpgDQGcFmaJgB',
    '',
    '# WhatsApp',
    `WHATSAPP_ENABLED=${whatsapp.toLowerCase() === 'y' ? 'true' : 'false'}`,
  ].join('\n');

  writeFileSync(envPath, envContent + '\n');
  console.log('\n.env written successfully.');

  // Ensure directories exist
  mkdirSync(join(ROOT, 'store'), { recursive: true });
  mkdirSync(join(ROOT, 'workspace', 'uploads'), { recursive: true });

  // Get chat ID helper
  if (!chatIds) {
    console.log('\nTo get your chat ID:');
    console.log('  1. Run: npm run dev');
    console.log('  2. Send /chatid to your bot on Telegram');
    console.log('  3. Add the ID to ALLOWED_CHAT_IDS in .env');
  }

  // launchd plist for macOS
  if (process.platform === 'darwin') {
    const installLaunchd = await ask('\nInstall macOS launchd service? (y/N): ');
    if (installLaunchd.toLowerCase() === 'y') {
      const plistPath = join(
        process.env.HOME ?? '~',
        'Library/LaunchAgents/com.claudeclaw.plist',
      );

      const nodePath = execSync('which node', { encoding: 'utf-8' }).trim();

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claudeclaw</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${join(ROOT, 'dist', 'index.js')}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${join(ROOT, 'store', 'stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(ROOT, 'store', 'stderr.log')}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>`;

      writeFileSync(plistPath, plist);
      console.log(`\nlaunchd plist written to: ${plistPath}`);
      console.log('To start: launchctl load ' + plistPath);
      console.log('To stop:  launchctl unload ' + plistPath);
    }
  }

  console.log('\nSetup complete! Run: npm run dev');
  rl.close();
}

main().catch(console.error);
