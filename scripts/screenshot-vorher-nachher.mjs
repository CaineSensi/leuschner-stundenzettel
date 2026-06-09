// Erzeugt zwei Login-Screenshots: "vorher" (ohne .on-dark Kontrast-Fix)
// und "nachher" (Live-Stand). Setzt beide per ImageMagick zusammen.

import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

const URL = "https://leuschner-stundenzettel.pages.dev/login";
const OUT = "E:\\Leuschner APP\\Mitarbeiter-Doku_Screenshots";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find(p => existsSync(p));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars"],
  defaultViewport: { width: 412, height: 892, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
});

async function shoot(name, killContrast) {
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36");
  if (killContrast) {
    // Vor dem Render: alle .on-dark-Remappings rückgängig, Body-Default dunkel
    await page.evaluateOnNewDocument(() => {
      const css = `
        body { color: #1A1C1E !important; }
        .on-dark, .on-dark .text-paper, .on-dark .text-ink-soft,
        .on-dark .text-ink-body, .on-dark .text-ink-2, .on-dark .text-ink-mute {
          color: #1A1C1E !important;
        }
      `;
      const inject = () => {
        const s = document.createElement("style");
        s.textContent = css;
        document.head.appendChild(s);
      };
      if (document.head) inject();
      else document.addEventListener("DOMContentLoaded", inject);
    });
  }
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 800));
  // Install-Banner ausblenden für sauberen Vergleich
  await page.evaluate(() => {
    document.querySelectorAll("button").forEach(b => {
      if (/Später|Spaeter/i.test(b.innerText)) b.click();
    });
  });
  await new Promise(r => setTimeout(r, 300));
  const path = `${OUT}\\contrast-${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log("OK", name);
  await page.close();
}

await shoot("vorher", true);
await shoot("nachher", false);
await browser.close();

// ImageMagick: nebeneinander mit Beschriftung
const magick = (cmd) => execSync(`magick ${cmd}`, { stdio: "inherit" });
magick(`"${OUT}\\contrast-vorher.png" -gravity south -background "#B91C1C" -splice 0x40 -font Arial-Bold -pointsize 22 -fill white -annotate +0+10 "VORHER · dunkel auf dunkel" "${OUT}\\contrast-vorher-label.png"`);
magick(`"${OUT}\\contrast-nachher.png" -gravity south -background "#15803D" -splice 0x40 -font Arial-Bold -pointsize 22 -fill white -annotate +0+10 "NACHHER · 09.06.2026 Fix" "${OUT}\\contrast-nachher-label.png"`);
magick(`"${OUT}\\contrast-vorher-label.png" "${OUT}\\contrast-nachher-label.png" +append -bordercolor white -border 10 "${OUT}\\KONTRAST-VERGLEICH.png"`);

console.log("FERTIG · KONTRAST-VERGLEICH.png in", OUT);
