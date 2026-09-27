// Версия записана в трёх местах, и все три обязаны совпадать с тегом релиза:
// иначе программа из релиза v0.56.0 считала бы себя 0.55.0 и предлагала бы
// «обновиться» сама на себя.
//   node tools/check-version.mjs v0.55.0
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const found = {
  'package.json': JSON.parse(read('package.json')).version,
  'src/server.js (APP_VERSION)': /const APP_VERSION = '([^']+)'/.exec(read('src/server.js'))?.[1],
  'launcher/VRCastBridge.Launcher.csproj': /<Version>([^<]+)<\/Version>/.exec(read('launcher/VRCastBridge.Launcher.csproj'))?.[1],
};
const tag = process.argv[2] ? process.argv[2].replace(/^v/i, '') : found['package.json'];
const wrong = Object.entries(found).filter(([, version]) => version !== tag);
if (wrong.length) {
  console.error(`Версия ${tag} не совпадает:`);
  for (const [file, version] of wrong) console.error(`  ${file}: ${version ?? 'не найдена'}`);
  process.exit(1);
}
console.log(`Версия ${tag} совпадает во всех файлах`);
