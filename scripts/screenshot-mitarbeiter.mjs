// Screenshots der Mitarbeiter-App via lokalem Chrome (puppeteer-core)
// Voraussetzung: Test-Worker mit code TESTSC liegt in der DB.

import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

const BASE = "https://leuschner-stundenzettel.pages.dev";
const CODE = "TESTSC";
const WORKER_ID = "11111111-1111-1111-1111-111111111111";
const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const PROJECT_REF = "vejhsyrxpveunygyhqlo";
const OUT  = "E:\\Leuschner APP\\Mitarbeiter-Doku_Screenshots";

// PAT aus KeePass holen
function getPat() {
  if (process.env.SUPABASE_PAT) return process.env.SUPABASE_PAT;
  const cli = "C:\\Program Files\\KeePassXC\\keepassxc-cli.exe";
  const kdbx = "E:\\Leuschner APP\\_Sicherheit\\Leuschners-KeyPass.kdbx";
  const out = execSync(
    `cmd /c "echo Istso| \\"${cli}\\" show -q -s -a Password \\"${kdbx}\\" \\"Supabase PAT Leuschner\\""`,
    { encoding: "utf8" }
  );
  return out.trim();
}

async function dbQuery(sql) {
  const pat = getPat();
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`DB ${r.status}: ${await r.text()}`);
  return r.json();
}

// Reset: Test-Worker (idempotent) + frische Invitation. Wenn das Cleanup-SQL
// nach einem früheren Lauf den Worker komplett entfernt hat, legen wir ihn
// hier wieder an — sonst FK-Verletzung beim Invitation-Insert.
console.log("Reset Test-Worker und Invitation …");
await dbQuery(`
  INSERT INTO workers (id, company_id, initials, first_name, last_name, role, is_admin)
  VALUES ('${WORKER_ID}', '${COMPANY_ID}', 'TS', 'Test', 'Doku', 'Screenshot-Bot', false)
  ON CONFLICT (id) DO UPDATE SET auth_user_id = NULL, first_name = EXCLUDED.first_name;
  DELETE FROM invitations WHERE worker_id = '${WORKER_ID}';
  INSERT INTO invitations (code, worker_id, expires_at)
    VALUES ('${CODE}', '${WORKER_ID}', now() + interval '6 hours');
`);
console.log("Reset OK");

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find(p => existsSync(p));
if (!CHROME) { console.error("Keine Chrome/Edge gefunden"); process.exit(1); }

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  defaultViewport: {
    width: 412, height: 892, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  },
});

const page = await browser.newPage();
page.on("console", msg => {
  const t = msg.text();
  if (t.includes("[auth]") || t.includes("[entry]") || t.includes("error")) {
    console.log("  page:", t);
  }
});
page.on("pageerror", err => console.log("  page ERROR:", err.message));
await page.setUserAgent(
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
);

async function shot(name) {
  await page.screenshot({ path: `${OUT}\\${name}`, fullPage: false });
  console.log("OK", name);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function clickByText(rx) {
  // retry mit kurzem Polling, weil React-States manchmal noch ankommen
  for (let i = 0; i < 20; i++) {
    const result = await page.evaluate((rxStr, flags) => {
      const re = new RegExp(rxStr, flags);
      const buttons = [...document.querySelectorAll("button")];
      const all = buttons.map(b => ({ t: b.innerText.trim(), d: b.disabled }));
      const btn = buttons.find(b => re.test(b.innerText.trim()) && !b.disabled);
      if (btn) { btn.click(); return { ok: true }; }
      return { ok: false, all };
    }, rx.source, (rx.flags || "") + (rx.flags.includes("i") ? "" : "i"));
    if (result.ok) return;
    await sleep(250);
    if (i === 19) {
      console.error("Verfügbare Buttons:", JSON.stringify(result.all));
      throw new Error(`Button nicht gefunden: ${rx}`);
    }
  }
}

async function dismissInstallBanner() {
  // klickt „Später" am InstallPrompt, falls sichtbar
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const later = buttons.find(b => /Später|Spaeter/i.test(b.innerText));
    if (later) later.click();
  });
}

// 1) Onboarding · Code-Schritt
await page.goto(`${BASE}/onboarding`, { waitUntil: "networkidle2", timeout: 30000 });
await sleep(900);
await shot("03-onboarding-code.png");

// Code eintippen — keyboard.type damit React den onChange-State updated
await page.click('input[placeholder="Code eingeben"]');
await page.keyboard.type(CODE, { delay: 60 });
await sleep(600);
// Install-Banner ausblenden, damit der Button nicht überlagert wird
await dismissInstallBanner();
await sleep(200);
await shot("04-onboarding-code-eingegeben.png");

// "Code einlösen" — ASCII-Match, weil ö in Selektor manchmal falsch escaped
await clickByText(/Code einl/);
await sleep(1500);

// 2) Profil-Schritt
try {
  await page.waitForFunction(
    () => /bist du das/i.test(document.body.innerText),
    { timeout: 15000 }
  );
} catch (e) {
  await shot("DEBUG-after-code.png");
  const txt = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.error("Profil-Schritt nicht erreicht. Body-Text:", txt);
  throw e;
}
await sleep(700);
await dismissInstallBanner();
await sleep(200);
await shot("05-onboarding-profil.png");

// "Ja, das bin ich"
await clickByText(/Ja, das bin ich/);

// 3) DoneStep
await page.waitForFunction(
  () => /los geht|bin drin/i.test(document.body.innerText),
  { timeout: 10000 }
);
await sleep(700);
await dismissInstallBanner();
await sleep(200);
await shot("06-onboarding-fertig.png");

// Loslegen klicken
await clickByText(/Los geht|Bin drin/);

// 4) Home / Wochenübersicht
await page.waitForFunction(
  () => location.pathname === "/" || location.pathname === "",
  { timeout: 15000 }
);
await sleep(3000); // Daten laden
await dismissInstallBanner();
await sleep(300);
await shot("07-home.png");

// 5) Entry — Typ-Auswahl
await page.goto(`${BASE}/entry`, { waitUntil: "networkidle2" });
await sleep(1800);
await dismissInstallBanner();
await sleep(200);
await shot("08-entry-typ.png");

// 6) Entry — Arbeit-Flow
await clickByText(/Arbeit\b/);
await sleep(1800);
await shot("09-entry-arbeit.png");

// 7) Tagesdetail
const today = new Date().toISOString().slice(0, 10);
await page.goto(`${BASE}/day/${today}`, { waitUntil: "networkidle2" });
await sleep(2200);
await dismissInstallBanner();
await sleep(200);
await shot("10-day.png");

await browser.close();
console.log("FERTIG · Screenshots in", OUT);
