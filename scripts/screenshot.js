import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:3000";
const outPath = process.argv[3] || "scratch/screenshot.png";
const clickSelector = process.argv[4]; // optional: click this before shooting

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector(".card, .empty-note", { timeout: 10000 }).catch(() => {});
if (clickSelector) {
  await page.click(clickSelector);
  await page.waitForTimeout(300);
}
await page.screenshot({ path: outPath, fullPage: true });

console.log("Console errors:", consoleErrors.length ? consoleErrors : "none");
await browser.close();
