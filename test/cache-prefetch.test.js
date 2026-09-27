import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Прогрев очереди: ролик, который начал качаться до эфира, обязан доиграть из
// кеша. Раньше «Начать эфир» убивал его загрузку, отмена засчитывалась как
// сбой, и первый же трек играл напрямую из сети. Вместо настоящего yt-dlp —
// подставной: он медленно «качает» заранее сделанный файл и записывает, как
// его вызывали.

const port = 48917;
const skip = process.platform === 'win32' ? 'подставной yt-dlp — скрипт с shebang, только для Unix' : false;
let server, dataDirectory, callsFile;

const FAKE_YTDLP = `#!/usr/bin/env node
const { appendFileSync, copyFileSync, readFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const args = process.argv.slice(2);
const here = dirname(process.argv[1]);
appendFileSync(join(here, 'calls.log'), JSON.stringify(args) + '\\n');
const source = readFileSync(join(here, 'fake-source.txt'), 'utf8').trim();
const url = args.at(-1);
if (args.includes('--flat-playlist')) {
  process.stdout.write(JSON.stringify({ id: 'fake', title: 'Подставной ролик', webpage_url: url, duration: 12 }));
} else if (args.includes('-o')) {
  const target = args[args.indexOf('-o') + 1].replace('%(ext)s', 'mp4');
  setTimeout(() => copyFileSync(source, target), 2500);
} else if (args.includes('--dump-single-json')) {
  process.stdout.write(JSON.stringify({ title: 'Подставной ролик', duration: 12, url: source, vcodec: 'h264', acodec: 'aac' }));
}
`;

async function status() {
  return fetch(`http://127.0.0.1:${port}/api/status`).then(response => response.json());
}

async function calls() {
  const text = await readFile(callsFile, 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test.before(async () => {
  if (skip) return;
  dataDirectory = await mkdtemp(join(tmpdir(), 'vrcast-cache-'));
  const toolDirectory = join(dataDirectory, 'VRCastBridge', 'tools');
  await mkdir(toolDirectory, { recursive: true });
  const source = join(dataDirectory, 'source.mp4');
  const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '12', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'aac', '-y', source]);
  assert.equal(made.status, 0);
  const fake = join(toolDirectory, 'yt-dlp.exe');
  await writeFile(fake, FAKE_YTDLP);
  await chmod(fake, 0o755);
  await writeFile(join(toolDirectory, 'fake-source.txt'), source);
  callsFile = join(toolDirectory, 'calls.log');
  server = spawn(process.execPath, ['src/server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, VRCAST_PORT: String(port), LOCALAPPDATA: dataDirectory, VRCAST_OFFLINE: '1' },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/status`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Тестовый сервер не запустился');
});

test.after(async () => {
  server?.kill();
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true }).catch(() => {});
});

test('старт эфира не обрывает прогрев: первый трек играет из кеша, а не из сети', { skip }, async () => {
  const added = await fetch(`http://127.0.0.1:${port}/api/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/watch?v=fake' }) });
  assert.equal(added.status, 201);
  // Ждём, пока прогрев начнёт качать, и сразу жмём «Начать эфир».
  const downloadDeadline = Date.now() + 5000;
  while (!(await calls()).some(args => args.includes('-o')) && Date.now() < downloadDeadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok((await calls()).some(args => args.includes('-o')), 'прогрев должен начать загрузку сам');
  const started = await fetch(`http://127.0.0.1:${port}/api/start/queue`, { method: 'POST' });
  assert.equal(started.status, 200);

  let state;
  const playDeadline = Date.now() + 15000;
  while (Date.now() < playDeadline) {
    state = await status();
    if (state.currentId && state.playback.busy === false && state.cache.ready === 1) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal(state.running, true, 'эфир должен идти');
  assert.equal(state.cache.ready, 1, 'трек должен лечь в кеш');
  const resolves = (await calls()).filter(args => args.includes('--dump-single-json') && !args.includes('--flat-playlist'));
  assert.equal(resolves.length, 0, 'трек не должен уходить в прямое воспроизведение из сети');
  const downloads = (await calls()).filter(args => args.includes('-o'));
  assert.equal(downloads.length, 1, 'загрузка не должна перезапускаться');
  await fetch(`http://127.0.0.1:${port}/api/stop`, { method: 'POST' });
});
