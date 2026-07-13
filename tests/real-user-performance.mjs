import { chromium } from "/Users/didi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const baseUrl = process.env.DRIVER_PROFILE_URL || "http://127.0.0.1:8766";
const baseOrigin = new URL(baseUrl).origin;

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const requests = [];
const errors = [];
page.on("response", (response) => {
  const url = new URL(response.url());
  if (url.origin === baseOrigin) requests.push(url.pathname);
});
page.on("pageerror", (error) => errors.push(error.message));

await page.addInitScript(() => {
  window.__progressLog = [];
  const observer = new MutationObserver(() => {
    const bar = document.querySelector("#loadProgressBar");
    const text = document.querySelector("#loadProgressText");
    const panel = document.querySelector("#loadProgress");
    if (!bar || !text || !panel) return;
    window.__progressLog.push({
      at: performance.now(),
      width: Number.parseFloat(bar.style.width || "0"),
      text: text.textContent,
      hidden: panel.classList.contains("hidden"),
    });
  });
  document.addEventListener("DOMContentLoaded", () => {
    observer.observe(document.documentElement, { subtree: true, attributes: true, childList: true, characterData: true });
  });
});

const startedAt = performance.now();
await page.goto(`${baseUrl}/index.html`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !document.querySelector("#searchButton")?.disabled, null, { timeout: 60000 });
const startupMs = performance.now() - startedAt;

const startupDailyRequests = requests.filter((path) => path.includes("/data/daily/"));
if (startupDailyRequests.length) throw new Error(`首页预加载了日明细：${startupDailyRequests.join(",")}`);

await page.locator("#citySelect .token-input").fill("北京");
await page.locator("#citySelect .token-option", { hasText: "北京市" }).click();
const beijingStartedAt = performance.now();
await page.locator("#searchButton").click();
await page.waitForFunction(() => document.querySelectorAll(".driver-card").length > 0, null, { timeout: 60000 });
const beijingMs = performance.now() - beijingStartedAt;
const driverId = await page.locator(".driver-card .driver-id").first().textContent();

await page.locator("#driverIdInput").fill(driverId.trim());
const directStartedAt = performance.now();
await page.locator("#searchButton").click();
await page.waitForFunction((id) => document.querySelector(".profile-id")?.textContent.includes(id), driverId.trim(), { timeout: 30000 });
const directMs = performance.now() - directStartedAt;

await page.locator("#driverIdInput").fill("");
await page.locator("#searchButton").click();
await page.locator("#driverIdInput").fill(driverId.trim());
await page.locator("#searchButton").click();
await page.waitForFunction((id) => document.querySelector(".profile-id")?.textContent.includes(id), driverId.trim(), { timeout: 30000 });

const progress = await page.evaluate(() => window.__progressLog || []);
const backwards = [];
let previousVisible = null;
for (const current of progress) {
  if (current.hidden) {
    previousVisible = null;
    continue;
  }
  if (!Number.isFinite(current.width)) continue;
  if (previousVisible && current.width + 0.01 < previousVisible.width) {
    backwards.push({ previous: previousVisible, current });
  }
  previousVisible = current;
}

console.log(JSON.stringify({
  startupMs: Math.round(startupMs),
  beijingFilterMs: Math.round(beijingMs),
  directDriverMs: Math.round(directMs),
  driverId: driverId.trim(),
  requestCount: requests.length,
  requestedDailyFiles: [...new Set(requests.filter((path) => path.includes("/data/daily/")))],
  requestedLookupFiles: [...new Set(requests.filter((path) => path.includes("/data/lookup/")))],
  requestedFilterIndex: requests.includes("/data/filter-index.json.gz"),
  progressSamples: progress.length,
  suspiciousBackwards: backwards.length,
  pageErrors: errors,
}, null, 2));

if (errors.length) throw new Error(`页面错误：${errors.join(" | ")}`);
if (!requests.includes("/data/filter-index.json.gz")) throw new Error("未读取压缩筛选索引");
if (requests.filter((path) => path.includes("/data/lookup/")).some((path) => !path.endsWith(".json.gz"))) {
  throw new Error("单司机查询读取了未压缩索引");
}
if (backwards.length) throw new Error(`发现进度条倒退：${JSON.stringify(backwards.slice(0, 3))}`);

await browser.close();
