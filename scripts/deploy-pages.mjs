// Deploy-Helfer: holt den Cloudflare-Pages-Token aus dem KeePass-Tresor,
// setzt die (nicht geheime) Account-ID und ruft wrangler pages deploy auf.
// Account-ID nötig, weil der Token Pages-scoped ist (kein memberships-Listing).
import { spawnSync } from 'node:child_process';

const KP = 'C:\\Program Files\\KeePassXC\\keepassxc-cli.exe';
const VAULT = 'L:\\Leuschner APP\\_Sicherheit\\Leuschners-KeyPass.kdbx';

const tok = spawnSync(
  KP,
  ['show', '-s', '-a', 'Password', VAULT, 'Cloudflare Pages Leuschner'],
  { input: 'Istso\n', encoding: 'utf8' },
);
if (tok.status !== 0) {
  console.error('KeePass-Read fehlgeschlagen:', tok.stderr || tok.error);
  process.exit(1);
}
const token = (tok.stdout || '').trim().split(/\r?\n/).pop().trim();
console.log('[deploy] CF-Token gelesen, Länge:', token.length);

const env = {
  ...process.env,
  CLOUDFLARE_API_TOKEN: token,
  CLOUDFLARE_ACCOUNT_ID: 'bfa8b8ed7382cb2192ec94a609ff0a66',
};
const r = spawnSync(
  'npx',
  ['wrangler', 'pages', 'deploy', 'dist',
    '--project-name=leuschner-stundenzettel', '--branch=main', '--commit-dirty=true'],
  { stdio: 'inherit', env, shell: true },
);
process.exit(r.status ?? 1);
