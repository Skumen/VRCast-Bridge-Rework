// Адреса и сеть.

// «Белым» считаем только адрес, по которому машину реально видно из интернета.
// Кроме RFC1918 отсекаем и то, что наружу не выходит: CGNAT провайдера,
// тестовые диапазоны (в них часто сидят адаптеры VPN — тот же Koala Clash),
// multicast и прочее зарезервированное. Иначе адрес VPN выдавался бы за белый.
export function isPrivateIp(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT провайдера
  if (a === 198 && (b === 18 || b === 19)) return true; // тестовый диапазон / VPN
  if (a >= 224) return true; // multicast и зарезервированное
  return false;
}
