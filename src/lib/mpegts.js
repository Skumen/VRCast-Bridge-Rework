// Метки времени кадров (PTS) из MPEG-TS, который продюсеры пишут в релей.
// Берём PTS из заголовка PES, а не PCR: служебные часы потока отстают от
// самих кадров примерно на треть секунды, и следующий ролик начинался ЗА уже
// показанным — в VRChat это выглядело как возврат старых кадров.

const PACKET = 188;
const SYNC = 0x47;

// PTS пакета в секундах или null, если в пакете его нет.
export function packetPts(data, offset) {
  if (data[offset] !== SYNC) return null;                    // не начало пакета
  if ((data[offset + 1] & 0x40) === 0) return null;          // не начало PES
  const adaptation = (data[offset + 3] & 0x30) >> 4;
  if (adaptation === 0 || adaptation === 2) return null;     // полезной нагрузки нет
  let payload = offset + 4;
  if (adaptation === 3) payload += 1 + data[offset + 4];     // пропускаем поле адаптации
  if (payload + 14 > offset + PACKET) return null;
  if (data[payload] !== 0 || data[payload + 1] !== 0 || data[payload + 2] !== 1) return null;
  if ((data[payload + 7] & 0x80) === 0) return null;         // метки времени нет
  const b = payload + 9;
  const pts = (data[b] & 0x0e) * 536870912
    + data[b + 1] * 4194304 + (data[b + 2] & 0xfe) * 16384
    + data[b + 3] * 128 + ((data[b + 4] & 0xfe) >> 1);
  return pts / 90000;
}

// Читатель одного потока. Куски из pipe не обязаны начинаться с границы
// пакета: раньше сдвинутый кусок пропускался целиком (ни одного 0x47 на
// месте), и часы эфира слепли. Теперь недочитанный хвост переносится в
// следующий кусок, а потерянная синхронизация ищется заново.
export function createPtsReader() {
  let rest = null;
  return chunk => {
    const data = rest ? Buffer.concat([rest, chunk]) : chunk;
    let offset = 0, latest = null;
    while (offset + PACKET <= data.length) {
      const synced = data[offset] === SYNC && (offset + PACKET >= data.length || data[offset + PACKET] === SYNC);
      if (!synced) { offset++; continue; }
      const pts = packetPts(data, offset);
      if (pts !== null && (latest === null || pts > latest)) latest = pts;
      offset += PACKET;
    }
    rest = offset < data.length ? Buffer.from(data.subarray(offset)) : null;
    return latest;
  };
}
