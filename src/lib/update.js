// Автообновление: сравнение версий и вердикт по подписи скачанного файла.

export function versionIsNewer(candidate, current) {
  const parse = value => String(value).replace(/^v/i, '').split('.').map(part => Number(part) || 0);
  const [a, b] = [parse(candidate), parse(current)];
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0);
  }
  return false;
}

// Раньше годилась любая подпись, в имени издателя которой есть «VRCast
// Bridge». Сертификат самоподписанный — такой за минуту сделает кто угодно,
// а статус HashMismatch (файл изменён после подписи) не отсеивался вовсе.
// Теперь новый файл обязан быть подписан тем же ключом, что и запущенная
// программа: сравниваются отпечатки сертификатов. Годятся только статусы
// Valid и UnknownError — последний Windows ставит самоподписанному
// сертификату, которого нет в доверенных корневых; подпись при этом цела.
const ACCEPTED_STATUS = new Set(['Valid', 'UnknownError']);

export function judgeUpdateSignature({ status = '', thumbprint = '', currentThumbprint = '' } = {}) {
  const state = String(status).trim();
  const nextKey = String(thumbprint).trim().toUpperCase();
  const ownKey = String(currentThumbprint).trim().toUpperCase();
  if (!state) return { ok: false, reason: 'не удалось проверить подпись' };
  if (state === 'NotSigned' || !nextKey) return { ok: false, reason: 'файл не подписан' };
  if (!ACCEPTED_STATUS.has(state)) return { ok: false, reason: `подпись недействительна (${state})` };
  if (!ownKey) return { ok: false, reason: 'текущая версия не подписана — обновите программу вручную' };
  if (nextKey !== ownKey) return { ok: false, reason: 'файл подписан чужим ключом' };
  return { ok: true, reason: state };
}

// Разбор строки «Статус|ОтпечатокНового|ОтпечатокТекущего» из PowerShell.
export function parseSignatureLine(line) {
  const [status = '', thumbprint = '', currentThumbprint = ''] = String(line || '').trim().split('|');
  return { status, thumbprint, currentThumbprint };
}
