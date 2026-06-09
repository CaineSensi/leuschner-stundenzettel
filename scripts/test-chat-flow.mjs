// Live-Test des Chat-Flows: loggt sich als Wolfgang ein, öffnet die
// Chat-Bubble, screenshottet was er sieht. Loggt Console-Errors.

import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const BASE = "https://leuschner-stundenzettel.pages.dev";
const OUT  = "E:\\Leuschner APP\\Mitarbeiter-Doku_Screenshots";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find(p => existsSync(p));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars"],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
page.on("console", msg => {
  const t = msg.text();
  if (t.includes("[auth]") || t.includes("[chat]") || t.includes("error") || msg.type() === "error") {
    console.log("  page:", msg.type(), t);
  }
});
page.on("pageerror", err => console.log("  page ERROR:", err.message));

const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log("1) Login als Wolfgang …");
await page.goto(`${BASE}/buero`, { waitUntil: "networkidle2", timeout: 30000 });
await sleep(800);

// Email + Passwort eingeben
await page.evaluate(() => {
  document.querySelectorAll('button').forEach(b => {
    if (/Später|Spaeter/i.test(b.innerText)) b.click();
  });
});

const EMAIL = process.env.TEST_EMAIL ?? 'leuschner.udo@gmx.de';
const PW    = process.env.TEST_PW    ?? 'Istso';
await page.type('input[type="email"]', EMAIL, { delay: 30 });
await page.type('input[type="password"]', PW, { delay: 30 });
await sleep(300);
await page.screenshot({ path: `${OUT}\\flow-01-login.png` });

// Submit
const submitOk = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const sub = btns.find(b => b.type === 'submit' || /Anmelden|Login|Einloggen/i.test(b.innerText));
  if (sub) { sub.click(); return true; }
  return false;
});
console.log("   Submit geklickt:", submitOk);

// Warten auf Redirect
await page.waitForFunction(
  () => location.pathname.startsWith("/admin") || /Anmeldung fehlgeschlagen/i.test(document.body.innerText),
  { timeout: 15000 }
).catch(() => null);
await sleep(2000);
console.log("2) URL nach Login:", page.url());
await page.screenshot({ path: `${OUT}\\flow-02-admin.png` });

// Chat-Bubble suchen + klicken
console.log("3) Chat-Bubble suchen …");
const bubbleInfo = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const bub = btns.find(b => /Chat öffnen|Chat schließen/i.test(b.getAttribute('aria-label') || ''));
  if (!bub) return { found: false };
  const rect = bub.getBoundingClientRect();
  bub.click();
  return { found: true, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
});
console.log("   Bubble:", JSON.stringify(bubbleInfo));
await sleep(1500);
await page.screenshot({ path: `${OUT}\\flow-03-chat-open.png` });

// Welche Peers sind in der Sidebar?
const peers = await page.evaluate(() => {
  const drawer = document.querySelector('aside[role="dialog"][aria-label="Chat"]');
  if (!drawer) return { error: "Modal nicht gefunden" };
  const buttons = [...drawer.querySelectorAll('button')];
  return buttons.map(b => b.innerText.trim().split('\n').slice(0, 2).join(' | ')).filter(t => t && !/^[✕⌕📎➤]$/.test(t)).slice(0, 20);
});
console.log("4) Sidebar-Inhalt:", JSON.stringify(peers, null, 2));

await browser.close();
console.log("FERTIG. Screenshots in:", OUT);
