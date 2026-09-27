// Плейлист живого эфира: отдаём последние segmentLimit кусков и подсказку
// плееру, с какого отступа от живого края начинать.

export function prepareLivePlaylist(raw, segmentLimit, startOffset) {
  const lines = raw.trimEnd().split(/\r?\n/);
  const uriIndexes = lines.map((line, index) => line && !line.startsWith('#') ? index : -1).filter(index => index >= 0);
  if (!uriIndexes.length) return raw;
  const keepFrom = Math.max(0, uriIndexes.length - segmentLimit);
  const firstSegmentTag = lines.findIndex(line => line.startsWith('#EXT-X-PROGRAM-DATE-TIME') || line.startsWith('#EXTINF'));
  const bodyStart = keepFrom === 0 ? firstSegmentTag : uriIndexes[keepFrom - 1] + 1;
  const header = lines.slice(0, Math.max(1, firstSegmentTag));
  const sequenceIndex = header.findIndex(line => line.startsWith('#EXT-X-MEDIA-SEQUENCE:'));
  if (sequenceIndex >= 0) {
    const sequence = Number(header[sequenceIndex].split(':')[1]) || 0;
    header[sequenceIndex] = `#EXT-X-MEDIA-SEQUENCE:${sequence + keepFrom}`;
  }
  header.splice(1, 0, `#EXT-X-START:TIME-OFFSET=-${startOffset},PRECISE=YES`);
  return [...header, ...lines.slice(bodyStart), ''].join('\n');
}
