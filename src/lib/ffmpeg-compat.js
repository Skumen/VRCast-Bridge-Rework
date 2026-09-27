// Совместимость с разными сборками ffmpeg. Программа сама докачивает ffmpeg,
// а у человека в PATH может лежать любой другой — от старого 6.x до свежего
// master. В master «-thread_queue_size» перестал быть опцией входа: ffmpeg
// отказывается открывать вход вовсе («cannot be applied to input url»), и
// релей, захват и очередь падали на старте. Поэтому возможности конкретной
// сборки проверяем пробным запуском и подгоняем аргументы под неё.

// Стоит ли эта опция перед «-i» (то есть относится ко входу). У вывода она
// в master осталась, и там её трогать нельзя.
function isInputOption(args, index) {
  for (let cursor = index + 2; cursor < args.length; cursor++) {
    if (args[cursor] === '-i') return true;
    // Дошли до имени выхода раньше, чем до следующего входа.
    if (!String(args[cursor]).startsWith('-') && !String(args[cursor - 1]).startsWith('-')) return false;
  }
  return false;
}

// «-re» с ffmpeg 6.1 сначала выдаёт полсекунды входа залпом и только потом
// держит темп реального времени. Для одиночного файла это незаметно, а у нас
// продюсер перезапускается на каждом стыке (трек, повтор, перемотка, пауза),
// и каждый залп уводил живой край на 0,5 с вперёд настенных часов — задержка
// копилась до десятков секунд. Ноль ffmpeg понимает как «по умолчанию»,
// поэтому ставим одну миллисекунду.
export const NO_BURST = '0.001';

export function adaptFfmpegArgs(args, caps = {}) {
  const result = [];
  for (let index = 0; index < args.length; index++) {
    if (caps.inputThreadQueue === false && args[index] === '-thread_queue_size' && isInputOption(args, index)) { index++; continue; }
    result.push(args[index]);
    if (caps.readrateBurst && args[index] === '-re' && args[index + 1] !== '-readrate_initial_burst') result.push('-readrate_initial_burst', NO_BURST);
  }
  return result;
}

export const INPUT_QUEUE_PROBE = ['-hide_banner', '-loglevel', 'error', '-thread_queue_size', '8',
  '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '0.01', '-f', 'null', '-'];
export const READRATE_BURST_PROBE = ['-hide_banner', '-loglevel', 'error', '-re', '-readrate_initial_burst', NO_BURST,
  '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '0.01', '-f', 'null', '-'];

// Какую сборку ffmpeg качать. У BtbN в релизе «latest» лежат и катящийся
// master, и стабильные ветки (ffmpeg-n8.1-latest-win64-gpl-8.1.zip). Master
// ломает совместимость без предупреждения — берём самую свежую стабильную
// ветку, а master только если стабильных нет совсем.
export function pickFfmpegAsset(assets, platform = 'win64') {
  const list = Array.isArray(assets) ? assets : [];
  const stable = new RegExp(`^ffmpeg-n(\\d+)\\.(\\d+)-latest-${platform}-gpl-[\\d.]+\\.zip$`, 'i');
  const best = list
    .map(asset => ({ asset, match: stable.exec(String(asset?.name || '')) }))
    .filter(entry => entry.match)
    .sort((left, right) => (Number(right.match[1]) - Number(left.match[1])) || (Number(right.match[2]) - Number(left.match[2])))[0];
  if (best) return best.asset;
  return list.find(asset => new RegExp(`${platform}-gpl\\.zip$`, 'i').test(String(asset?.name || ''))) || null;
}
