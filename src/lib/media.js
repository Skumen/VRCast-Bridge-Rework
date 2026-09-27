// Разбор сведений о медиафайлах (ffprobe) и подписи для прямых ссылок.

// Обложка альбома лежит в файле как «видео» из одного кадра. Считать её видео
// нельзя: у музыкального файла тогда выбиралась картинка вместо звуковой
// дорожки, эфир получал один кадр и обрывался, а у фильма с постером первым
// потоком в эфир уходил постер вместо самого фильма.
export function настоящееВидео(stream) {
  return stream.codec_type === 'video' && !stream.disposition?.attached_pic;
}

export function parseMediaInfo(stdout) {
  const data = JSON.parse(stdout);
  const videoCodec = data.streams?.find(настоящееВидео)?.codec_name || '';
  const audioCodec = data.streams?.find(stream => stream.codec_type === 'audio')?.codec_name || '';
  const mp4Container = String(data.format?.format_name || '').split(',').some(name => ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'].includes(name));
  return {
    duration: Number(data.format?.duration) || null,
    hasVideo: data.streams?.some(настоящееВидео) || false,
    hasAudio: data.streams?.some(stream => stream.codec_type === 'audio') || false,
    videoCodec, audioCodec,
    unityCompatible: mp4Container && videoCodec === 'h264' && (!audioCodec || audioCodec === 'aac'),
  };
}

// Имя файла в прямой ссылке часто ничего не значит: у кинохостингов это
// «720.mp4» или «index.m3u8» — по такой подписи в списке не найдёшь ничего.
// Берём название из самого файла, а если его нет — имя сайта и качество.
export const БЕЗЛИКИЕ_ИМЕНА = /^(\d{3,4}p?|video|movie|index|master|playlist|stream|out|file|media)$/i;

export function directTitle(rawUrl, сведения) {
  const адрес = new URL(rawUrl);
  const файл = decodeURIComponent(адрес.pathname.split('/').filter(Boolean).pop() || '');
  const основа = файл.replace(/\.[a-z0-9]{2,5}$/i, '');
  const изФайла = String(сведения?.title || '').trim();
  if (изФайла && !БЕЗЛИКИЕ_ИМЕНА.test(изФайла)) return изФайла.slice(0, 200);
  if (основа && !БЕЗЛИКИЕ_ИМЕНА.test(основа)) return файл.slice(0, 200);
  const сайт = адрес.hostname.replace(/^www\./i, '').split('.').slice(0, -1).join('.') || адрес.hostname;
  const качество = сведения?.height ? ` ${сведения.height}p` : (основа ? ` ${основа}` : '');
  return `Видео с ${сайт}${качество}`.slice(0, 200);
}
