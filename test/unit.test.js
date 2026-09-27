// Быстрые проверки чистой логики: без ffmpeg, сети и запуска сервера.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_BURST, adaptFfmpegArgs, pickFfmpegAsset } from '../src/lib/ffmpeg-compat.js';
import { prepareLivePlaylist } from '../src/lib/hls.js';
import { directTitle, parseMediaInfo } from '../src/lib/media.js';
import { createPtsReader, packetPts } from '../src/lib/mpegts.js';
import { isPrivateIp } from '../src/lib/net.js';
import { judgeUpdateSignature, parseSignatureLine, versionIsNewer } from '../src/lib/update.js';

test('ffmpeg: опция очереди входа убирается только там, где её не понимают', () => {
  const args = ['-thread_queue_size', '1024', '-f', 'mpegts', '-i', 'pipe:0', '-c', 'copy', 'out.ts'];
  assert.deepEqual(adaptFfmpegArgs(args, { inputThreadQueue: true }), args);
  assert.deepEqual(adaptFfmpegArgs(args, { inputThreadQueue: false }), ['-f', 'mpegts', '-i', 'pipe:0', '-c', 'copy', 'out.ts']);
  // У выхода опция осталась и в master — её не трогаем.
  const output = ['-i', 'in.mp4', '-thread_queue_size', '64', '-f', 'null', '-'];
  assert.deepEqual(adaptFfmpegArgs(output, { inputThreadQueue: false }), output);
});

test('ffmpeg: у каждого -re выключается стартовый залп, и только один раз', () => {
  const args = ['-re', '-i', 'a.mp4', '-re', '-f', 'lavfi', '-i', 'anullsrc'];
  const adapted = adaptFfmpegArgs(args, { readrateBurst: true });
  assert.deepEqual(adapted, ['-re', '-readrate_initial_burst', NO_BURST, '-i', 'a.mp4',
    '-re', '-readrate_initial_burst', NO_BURST, '-f', 'lavfi', '-i', 'anullsrc']);
  assert.deepEqual(adaptFfmpegArgs(adapted, { readrateBurst: true }), adapted);
  assert.deepEqual(adaptFfmpegArgs(args, { readrateBurst: false }), args);
  assert.notEqual(NO_BURST, '0', 'ноль ffmpeg понимает как «по умолчанию» — залп остаётся');
});

test('ffmpeg: качается новейшая стабильная ветка, master — только если других нет', () => {
  const assets = ['ffmpeg-master-latest-win64-gpl.zip', 'ffmpeg-n7.1-latest-win64-gpl-7.1.zip',
    'ffmpeg-n8.1-latest-win64-gpl-8.1.zip', 'ffmpeg-n8.1-latest-win64-lgpl-8.1.zip', 'ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz',
    'ffmpeg-n8.0-latest-win64-gpl-shared-8.0.zip'].map(name => ({ name }));
  assert.equal(pickFfmpegAsset(assets).name, 'ffmpeg-n8.1-latest-win64-gpl-8.1.zip');
  assert.equal(pickFfmpegAsset([{ name: 'ffmpeg-n10.0-latest-win64-gpl-10.0.zip' }, { name: 'ffmpeg-n9.2-latest-win64-gpl-9.2.zip' }]).name,
    'ffmpeg-n10.0-latest-win64-gpl-10.0.zip', 'версии сравниваются числами, а не строками');
  assert.equal(pickFfmpegAsset([{ name: 'ffmpeg-master-latest-win64-gpl.zip' }]).name, 'ffmpeg-master-latest-win64-gpl.zip');
  assert.equal(pickFfmpegAsset([]), null);
  assert.equal(pickFfmpegAsset(undefined), null);
});

test('обновление: версии сравниваются по числам', () => {
  assert.equal(versionIsNewer('0.54.10', '0.54.9'), true);
  assert.equal(versionIsNewer('v1.0', '0.99.99'), true);
  assert.equal(versionIsNewer('0.54.10', '0.54.10'), false);
  assert.equal(versionIsNewer('0.54', '0.54.1'), false);
});

test('обновление: принимается только файл, подписанный тем же ключом', () => {
  const key = 'D1362EF20636769555791678' + '16AC5856633D3A94';
  assert.equal(judgeUpdateSignature({ status: 'UnknownError', thumbprint: key, currentThumbprint: key }).ok, true);
  assert.equal(judgeUpdateSignature({ status: 'Valid', thumbprint: key.toLowerCase(), currentThumbprint: key }).ok, true);
  assert.equal(judgeUpdateSignature({ status: 'UnknownError', thumbprint: 'ABCDEF', currentThumbprint: key }).ok, false, 'чужой самоподписанный «VRCast Bridge»');
  assert.equal(judgeUpdateSignature({ status: 'HashMismatch', thumbprint: key, currentThumbprint: key }).ok, false, 'файл изменён после подписи');
  assert.equal(judgeUpdateSignature({ status: 'NotTrusted', thumbprint: key, currentThumbprint: key }).ok, false);
  assert.equal(judgeUpdateSignature({ status: 'NotSigned' }).ok, false);
  assert.equal(judgeUpdateSignature({ status: 'Valid', thumbprint: key, currentThumbprint: '' }).ok, false);
  assert.equal(judgeUpdateSignature({}).ok, false);
  assert.deepEqual(parseSignatureLine(`UnknownError|${key}|${key}\r\n`), { status: 'UnknownError', thumbprint: key, currentThumbprint: key });
});

test('белым считается только адрес, видный из интернета', () => {
  for (const ip of ['10.0.0.5', '192.168.1.2', '172.20.0.1', '100.64.1.1', '198.18.0.1', '127.0.0.1', '169.254.3.3', '224.0.0.1', 'bad', '1.2.3']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['31.59.102.186', '8.8.8.8', '172.32.0.1', '100.128.0.1']) assert.equal(isPrivateIp(ip), false, ip);
});

test('плейлист: остаются последние куски, номер последовательности сдвигается', () => {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:1', '#EXT-X-MEDIA-SEQUENCE:100'];
  for (let index = 0; index < 6; index++) lines.push('#EXTINF:1.000000,', `segment-${100 + index}.ts`);
  const result = prepareLivePlaylist(lines.join('\n'), 4, 1.5);
  assert.match(result, /#EXT-X-START:TIME-OFFSET=-1.5,PRECISE=YES/);
  assert.match(result, /#EXT-X-MEDIA-SEQUENCE:102/);
  assert.deepEqual(result.split('\n').filter(line => line.endsWith('.ts')), ['segment-102.ts', 'segment-103.ts', 'segment-104.ts', 'segment-105.ts']);
});

// TS-пакет с PES-заголовком и заданным PTS (в секундах).
function tsPacketWithPts(seconds) {
  const packet = Buffer.alloc(188, 0xff);
  packet[0] = 0x47; packet[1] = 0x41; packet[2] = 0x00; packet[3] = 0x10; // начало PES, только полезная нагрузка
  const pts = Math.round(seconds * 90000);
  packet.set([0, 0, 1, 0xe0, 0, 0, 0x80, 0x80, 5], 4);
  packet[13] = 0x21 | (Math.floor(pts / 2 ** 30) & 0x07) << 1;
  packet[14] = (pts >> 22) & 0xff;
  packet[15] = ((pts >> 14) & 0xfe) | 1;
  packet[16] = (pts >> 7) & 0xff;
  packet[17] = ((pts << 1) & 0xfe) | 1;
  return packet;
}

test('MPEG-TS: PTS читается, даже когда кусок начинается не с границы пакета', () => {
  assert.equal(packetPts(tsPacketWithPts(12.5), 0), 12.5);
  assert.equal(packetPts(tsPacketWithPts(30000), 0), 30000, 'старший бит PTS учитывается');
  const stream = Buffer.concat([tsPacketWithPts(1), tsPacketWithPts(2), tsPacketWithPts(3), tsPacketWithPts(4)]);
  const read = createPtsReader();
  // Режем поток так, чтобы ни один кусок не начинался с 0x47.
  const seen = [read(stream.subarray(0, 100)), read(stream.subarray(100, 400)), read(stream.subarray(400, 700)), read(stream.subarray(700))];
  assert.deepEqual(seen, [null, 2, 3, 4]);
  // Мусор в начале (оборванный пакет) не ломает синхронизацию.
  const garbage = createPtsReader();
  assert.equal(garbage(Buffer.concat([Buffer.from([1, 2, 3, 0x47, 9]), tsPacketWithPts(7), tsPacketWithPts(8)])), 8);
});

test('ffprobe: обложка альбома не считается видео', () => {
  const info = parseMediaInfo(JSON.stringify({ format: { duration: '215.3', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
    streams: [{ codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } }, { codec_type: 'audio', codec_name: 'aac' }] }));
  assert.equal(info.hasVideo, false);
  assert.equal(info.hasAudio, true);
  assert.equal(info.duration, 215.3);
  const movie = parseMediaInfo(JSON.stringify({ format: { format_name: 'mov,mp4' }, streams: [{ codec_type: 'video', codec_name: 'h264' }, { codec_type: 'audio', codec_name: 'aac' }] }));
  assert.equal(movie.unityCompatible, true);
});

test('прямая ссылка получает осмысленное название', () => {
  assert.equal(directTitle('https://cdn.example.com/films/720.mp4', { height: 720 }), 'Видео с cdn.example 720p');
  assert.equal(directTitle('https://cdn.example.com/Мой%20фильм.mkv', null), 'Мой фильм.mkv');
  assert.equal(directTitle('https://cdn.example.com/index.m3u8', { title: 'Трансляция' }), 'Трансляция');
});
