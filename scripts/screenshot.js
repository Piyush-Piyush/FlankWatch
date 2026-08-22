import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:3000";
const outPath = process.argv[3] || "scratch/screenshot.png";
const clickSelectors = (process.argv[4] || "").split(",").filter(Boolean); // optional: click these in order before shooting

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));
page.on("dialog", async (dialog) => {
  console.log("dialog:", dialog.type(), dialog.message());
  await dialog.accept();
});

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector(".card, .empty-note", { timeout: 10000 }).catch(() => {});
for (const sel of clickSelectors) {
  await page.click(sel);
  await page.waitForTimeout(300);
}
await page.screenshot({ path: outPath, fullPage: true });

console.log("Console errors:", consoleErrors.length ? consoleErrors : "none");
await browser.close();
