import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
const html = readFileSync('L:\\Leuschner APP\\Leuschner_Rechnungspositionen.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('no script block'); process.exit(1); }
// Wrap DOM refs so node --check (syntax only) is enough; but also try to parse JSON arrays.
const js = m[1];
writeFileSync('_tmp_script.mjs', js);
try {
  execSync('node --check _tmp_script.mjs', { stdio: 'pipe' });
  console.log('node --check: OK (JS-Syntax gültig)');
} catch (e) {
  console.error('SYNTAX ERROR:', e.stderr?.toString() || e.message);
  process.exit(1);
}
// Validate the three data consts as JSON by extracting their literals
for (const name of ['META', 'POSITIONEN', 'RECHNUNGEN']) {
  const re = new RegExp('const ' + name + ' = ([\\s\\S]*?);\\n');
  const mm = js.match(re);
  JSON.parse(mm[1]);
  console.log(name, 'JSON OK');
}
unlinkSync('_tmp_script.mjs');
console.log('ALLE CHECKS BESTANDEN');
