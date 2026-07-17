const stateBox = document.querySelector("#stateBox");
const profileEl = document.querySelector("#profile");
const listEl = document.querySelector("#driverList");
const metaText = document.querySelector("#metaText");
const windowText = document.querySelector("#windowText");
const driverIdInput = document.querySelector("#driverIdInput");
const citySelect = document.querySelector("#citySelect");
const companySelect = document.querySelector("#companySelect");
const productSelect = document.querySelector("#productSelect");
const dateSelect = document.querySelector("#dateSelect");
const isOrganizedSelect = document.querySelector("#isOrganizedSelect");
const advancedFilterInputs = Array.from(
  document.querySelectorAll("#advancedFilters input"),
);
const loadProgress = document.querySelector("#loadProgress");
const loadProgressBar = document.querySelector("#loadProgressBar");
const loadProgressText = document.querySelector("#loadProgressText");
const searchButton = document.querySelector("#searchButton");
const resetButton = document.querySelector("#resetButton");
const exportButton = document.querySelector("#exportButton");
const snapshotButton = document.querySelector("#snapshotButton");
const advancedCount = document.querySelector("#advancedCount");
const selectedCities = new Set();
const selectedCompanies = new Set();
const selectedProducts = new Set();
let selectedDate = "";
let allCities = [];
let allCompanies = [];
let allProducts = [];
let staticMeta = {};
let staticManifest = {};
let strategyRuleIndex = buildStrategyRuleIndex({});
let allDrivers = [];
let driverDataIndex = null;
let driverLookupIndex = null;
let filterWorker = null;
let filterWorkerReady = false;
let filterRequestId = 0;
const pendingFilterRequests = new Map();
let filterWorkerStartup = null;
let filterWorkerWaitTaskId = 0;
let loadTaskId = 0;
let loadProgressPercent = 0;
let loadProgressHideTimer = null;
let loadProgressShowFrame = null;
const loadedDriversByDate = new Map();
const loadedDriverLookupByPrefix = new Map();
let currentListRows = [];
let renderedListCount = 0;
let staticDataReady = false;
let userHasRenderedResults = false;
const tokenPickers = [];
const listPageSize = 50;
const accessLogStorageKey = "driver-profile-access-log-v1";

const advancedFilterFields = [
  "bestRiskTierRank",
  "age",
  "consecutive_days",
  "server_dur_hour",
  "order_cnt_21_09_7d_rate",
  "sleep_deprivation_days",
];

const commonCities = [
  "北京市",
  "上海市",
  "广州市",
  "深圳市",
  "杭州市",
  "成都市",
  "重庆市",
  "武汉市",
  "南京市",
  "天津市",
  "西安市",
  "苏州市",
];

const pinyinCollator = new Intl.Collator("zh-CN-u-co-pinyin", {
  sensitivity: "base",
  numeric: true,
});

function showState(message) {
  stateBox.innerHTML = `
    <div class="empty-illust" aria-hidden="true">
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
        <circle cx="28" cy="20" r="9" stroke="currentColor" stroke-width="2.2" />
        <path d="M10 46c0-10 8-14 18-14s18 4 18 14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        <circle cx="44" cy="14" r="6" fill="#e6f1fb" stroke="currentColor" stroke-width="1.8" />
        <text x="44" y="18" font-size="9" font-weight="700" fill="currentColor" text-anchor="middle">?</text>
      </svg>
    </div>
    <h2 class="empty-title">查询一位司机的画像</h2>
    <p class="empty-desc">${escapeHtml(message || "在左侧输入司机 ID，或通过城市、公司、产品线组合筛选定位司机。")}</p>
    <div class="empty-tips">
      <div class="tip-card">
        <div class="tip-icon">ID</div>
        <h4>按 ID 精确查询</h4>
        <p>输入完整司机 ID 直接定位</p>
      </div>
      <div class="tip-card">
        <div class="tip-icon">筛</div>
        <h4>组合筛选</h4>
        <p>城市 / 公司 / 产品线多选筛选</p>
      </div>
      <div class="tip-card">
        <div class="tip-icon">排</div>
        <h4>按排名筛选</h4>
        <p>参考近七天最高模型排名</p>
      </div>
    </div>`;
  stateBox.classList.add("empty-state");
  stateBox.classList.remove("hidden");
  profileEl.classList.add("hidden");
}

function setActionsEnabled(enabled) {
  searchButton.disabled = !enabled;
  exportButton.disabled = !enabled;
}

function startLoadTask(percent = 0, message = "正在读取数据...") {
  loadTaskId += 1;
  if (loadProgressHideTimer) {
    window.clearTimeout(loadProgressHideTimer);
    loadProgressHideTimer = null;
  }
  if (loadProgressShowFrame) {
    window.cancelAnimationFrame(loadProgressShowFrame);
    loadProgressShowFrame = null;
  }
  // Reset only while hidden so a completed bar never visibly runs backwards.
  loadProgress?.classList.add("hidden");
  if (loadProgressBar) {
    loadProgressBar.style.transition = "none";
    loadProgressBar.style.width = "0%";
    void loadProgressBar.offsetWidth;
  }
  loadProgressPercent = 0;
  updateLoadProgress(percent, message, loadTaskId);
  if (loadProgressBar) {
    void loadProgressBar.offsetWidth;
    loadProgressBar.style.transition = "";
  }
  loadProgressShowFrame = window.requestAnimationFrame(() => {
    loadProgress?.classList.remove("hidden");
    loadProgressShowFrame = null;
  });
  return loadTaskId;
}

function updateLoadProgress(percent, message, taskId = loadTaskId) {
  if (taskId !== loadTaskId) {
    return;
  }
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const monotonicPercent = Math.max(loadProgressPercent, safePercent);
  loadProgressPercent = monotonicPercent;
  if (loadProgressBar) {
    loadProgressBar.style.width = `${monotonicPercent}%`;
  }
  if (loadProgressText) {
    loadProgressText.textContent = message || `读取静态数据 ${Math.round(monotonicPercent)}%`;
  }
}

function hideLoadProgress(taskId = loadTaskId) {
  if (taskId !== loadTaskId) {
    return;
  }
  updateLoadProgress(100, dailyDataLoadedMessage(), taskId);
  if (loadProgressHideTimer) {
    window.clearTimeout(loadProgressHideTimer);
  }
  loadProgressHideTimer = window.setTimeout(() => {
    if (taskId === loadTaskId) {
      loadProgress?.classList.add("hidden");
      loadProgressHideTimer = null;
    }
  }, 350);
}

function getDateFilter() {
  return selectedDate;
}

function setDateFilter(value) {
  selectedDate = String(value || "").trim();
  if (dateSelect?.dataset) {
    dateSelect.dataset.value = selectedDate;
  }
}

function initialDateFilter() {
  return "";
}

function loadingDailyDataMessage() {
  return "正在读取数据...";
}

function dailyDataLoadedMessage() {
  return "数据读取完毕";
}

function valueText(item) {
  return item?.displayValue ?? "暂无数据";
}

function displayValue(value) {
  const text = String(value ?? "").trim();
  return text && !["nan", "nat", "none", "null", "undefined"].includes(text.toLowerCase())
    ? text
    : "暂无数据";
}

function displayableText(value) {
  const text = displayValue(value);
  return text === "暂无数据" ? "" : text;
}

function hasUsableRawValue(value) {
  const text = String(value ?? "").trim();
  return Boolean(text) && !["nan", "nat", "none", "null", "undefined"].includes(text.toLowerCase());
}

function summaryPhrase(value, { prefix = "", suffix = "" } = {}) {
  const text = displayableText(value);
  return text ? `${prefix}${text}${suffix}` : "";
}

function finiteMetricNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatAverageOnlineDuration(value) {
  const number = finiteMetricNumber(value);
  return number === null ? "" : Number(number.toFixed(2)).toString();
}

function formatMetricValue(value) {
  if (value === undefined || value === null || value === "") {
    return "暂无数据";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return displayValue(value);
  }
  return Number.isInteger(number)
    ? String(number)
    : number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readJsonStorage(key, fallback) {
  try {
    if (!window.localStorage) {
      return fallback;
    }
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    if (window.localStorage) {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  } catch (error) {
    // 本地留痕失败不应影响查询和画像展示。
  }
}

function formatLocalTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function compactTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  let data = null;
  try {
    data = await res.json();
  } catch (error) {
    throw new Error(`静态数据读取失败：${url}`);
  }
  if (!res.ok) {
    throw new Error(data?.message || data?.error || "请求失败");
  }
  return data;
}

function fetchJsonWithProgress(url, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.responseType = "text";
    request.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        const percent = (event.loaded / event.total) * 100;
        onProgress?.(percent, event.loaded, event.total);
      } else {
        onProgress?.(8, event.loaded || 0, 0);
      }
    };
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`静态数据读取失败：${url}`));
        return;
      }
      try {
        onProgress?.(98, request.responseText.length, request.responseText.length);
        resolve(JSON.parse(request.responseText));
      } catch (error) {
        reject(new Error(`静态数据解析失败：${url}`));
      }
    };
    request.onerror = () => reject(new Error(`静态数据读取失败：${url}`));
    request.send();
  });
}

async function fetchGzipJsonWithProgress(url, onProgress) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`静态数据读取失败：${url}`);
  }
  if (typeof DecompressionStream !== "function") {
    throw new Error("当前浏览器不支持压缩数据读取，请升级浏览器");
  }
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(total ? (loaded / total) * 75 : 35, loaded, total);
  }
  onProgress?.(82, loaded, total);
  const blob = new Blob(chunks);
  const magic = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const stream = magic[0] === 0x1f && magic[1] === 0x8b
    ? blob.stream().pipeThrough(new DecompressionStream("gzip"))
    : blob.stream();
  const text = await new Response(stream).text();
  onProgress?.(96, loaded, total);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`静态数据解析失败：${url}`);
  }
}

async function fetchOptionalJson(url) {
  try {
    return await fetchJson(url);
  } catch (error) {
    return {};
  }
}

function formatStaticGeneratedAt(value) {
  if (!value) {
    return "";
  }
  const text = String(value).trim();
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function resolveStaticGeneratedAt(manifest, meta) {
  return formatStaticGeneratedAt(
    manifest?.generated_at ||
      manifest?.generatedAt ||
      meta?.generated_at ||
      meta?.generatedAt ||
      meta?.static_generated_at,
  );
}

function formatWindowDate(value) {
  const dateText = normalizedDate(value);
  const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : dateText;
}

function formatDateWindow(dates = []) {
  const normalizedDates = (Array.isArray(dates) ? dates : [])
    .map((date) => normalizedDate(date))
    .filter(Boolean)
    .sort();
  if (!normalizedDates.length) {
    return "暂无日期";
  }
  const start = formatWindowDate(normalizedDates[0]);
  const end = formatWindowDate(normalizedDates[normalizedDates.length - 1]);
  return start === end ? start : `${start}-${end}`;
}

async function fetchDriversPayload() {
  updateLoadProgress(6, "正在读取数据索引...");
  return fetchJsonWithProgress("data/drivers.json", (percent, loaded, total) => {
    updateLoadProgress(Math.min(14, 6 + percent * 0.08), "正在读取数据索引...");
  });
}

function resolveDriversPayload(payload) {
  if (payload?.mode === "daily-static-index") {
    driverDataIndex = payload;
    return [];
  }
  if (Array.isArray(payload?.drivers)) {
    return payload.drivers;
  }
  return Array.isArray(payload) ? payload : [];
}

function decodeDirectLookupPayload(payload) {
  const schema = Array.isArray(payload?.schema) ? payload.schema : [];
  const dictionary = payload?.dict || {};
  return (Array.isArray(payload?.rows) ? payload.rows : []).map((row) => {
    const raw = Object.fromEntries(schema.map((field, index) => [field, row[index]]));
    const strategyKeys = (Array.isArray(raw.strategyKeys) ? raw.strategyKeys : [])
      .map((index) => dictionaryValue(dictionary.strategyKeys, index))
      .filter(Boolean);
    return {
      driverId: String(raw.driverId || ""),
      city: dictionaryValue(dictionary.cities, raw.city),
      cityLevel: dictionaryValue(dictionary.cityLevels, raw.cityLevel),
      company: dictionaryValue(dictionary.companies, raw.company),
      product: dictionaryValue(dictionary.products, raw.product),
      dataDate: dictionaryValue(dictionary.dates, raw.dataDate),
      isOrganized: dictionaryValue(dictionary.isOrganized, raw.isOrganized),
      age: raw.age,
      consecutive_days: raw.consecutive_days,
      server_dur_hour: raw.server_dur_hour,
      avgOnlineDuration7d: raw.avgOnlineDuration7d,
      server_dur_hour_30d: raw.server_dur_hour_30d,
      server_dur_sum_30d: raw.server_dur_sum_30d,
      order_cnt_21_09_7d_rate: raw.order_cnt_21_09_7d_rate,
      sleep_deprivation_days: raw.sleep_deprivation_days,
      past_7_day_non_listening_period: raw.past_7_day_non_listening_period,
      riskTierRank: raw.riskTierRank,
      riskTierScore: raw.riskTierScore,
      tiredScore: raw.tiredScore,
      strategyKeys,
      strategyEvidence: Object.fromEntries(
        strategyKeys
          .map((key, index) => [key, raw.strategyEvidence?.[index]])
          .filter(([, evidence]) => evidence),
      ),
      directLookup: true,
    };
  });
}

async function loadDriverLookupIndex() {
  if (driverLookupIndex) {
    return driverLookupIndex;
  }
  try {
    driverLookupIndex = await fetchJson("data/driver-lookup-index.json");
  } catch (error) {
    driverLookupIndex = null;
  }
  return driverLookupIndex;
}

function directLookupShard(driverId, lookupIndex) {
  if (lookupIndex?.shardMode === "fnv1a32-modulo") {
    const bucketCount = Number(lookupIndex.bucketCount) || 0;
    if (!bucketCount) return "";
    let hash = 2166136261;
    for (const character of String(driverId || "")) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return String(hash % bucketCount);
  }
  const prefixLength = Number(lookupIndex?.prefixLength) || 0;
  return String(driverId || "").slice(0, prefixLength);
}

async function findDirectDriverLocation(driverId) {
  const taskId = loadTaskId;
  const lookupIndex = await loadDriverLookupIndex();
  const shard = directLookupShard(driverId, lookupIndex);
  const filePath = lookupIndex?.files?.[shard];
  if (!filePath) {
    return null;
  }
  if (!loadedDriverLookupByPrefix.has(shard)) {
    updateLoadProgress(10, "正在定位司机快照...", taskId);
    loadProgress?.classList.remove("hidden");
    const fetchLookup = filePath.endsWith(".gz") ? fetchGzipJsonWithProgress : fetchJsonWithProgress;
    const payload = await fetchLookup(`data/${filePath}`, (percent, loaded, total) => {
      const sizeText = total > 0 ? `（${(loaded / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB）` : "";
      updateLoadProgress(10 + percent * 0.1, `正在定位司机快照${sizeText}`, taskId);
    });
    if (taskId !== loadTaskId) {
      return null;
    }
    loadedDriverLookupByPrefix.set(shard, decodeDirectLookupPayload(payload));
  }
  return loadedDriverLookupByPrefix.get(shard).find((item) => item.driverId === String(driverId)) || null;
}

function hasDirectSearchOnly(filters) {
  if (!/^\d{6,}$/.test(String(filters.driver_id || ""))) {
    return false;
  }
  return !filters.dt;
}

async function runDirectDriverSearch(driverId, requestedDate = "") {
  const taskId = loadTaskId;
  const location = await findDirectDriverLocation(driverId);
  if (taskId !== loadTaskId) {
    return false;
  }
  if (!location?.dataDate || (requestedDate && location.dataDate !== requestedDate)) {
    showState("未找到该司机。请确认司机 ID 是否存在于当前数据窗口。");
    renderList([]);
    hideLoadProgress(taskId);
    return true;
  }
  location.bestRiskTierRank = location.riskTierRank;
  location.subtitle = [location.city, location.product, location.company].filter(Boolean).join(" · ");
  allDrivers = [location];
  applyFilterResults([location]);
  hideLoadProgress(taskId);
  return true;
}

function resolveStaticProfile(driver, ruleIndex = strategyRuleIndex) {
  if (driver?.profile) {
    return driver.profile;
  }
  return buildProfileFromDriver(driver, ruleIndex);
}

async function loadStaticData() {
  setActionsEnabled(false);
  const taskId = startLoadTask(2, "正在读取静态快照元信息...");
  const [meta, options, driversPayload, manifest, strategyRules] = await Promise.all([
    fetchJson("data/meta.json"),
    fetchJson("data/filter-options.json"),
    fetchDriversPayload(),
    fetchOptionalJson("data/manifest.json"),
    fetchOptionalJson("data/strategy-rules.json"),
  ]);
  staticMeta = meta || {};
  staticManifest = manifest || {};
  strategyRuleIndex = buildStrategyRuleIndex(strategyRules || {});
  allDrivers = resolveDriversPayload(driversPayload);
  initializeFilterWorker();
  const availableDates = Array.isArray(options.dates) ? options.dates : [];
  const sourceDates = Array.isArray(staticManifest.actual_dates) && staticManifest.actual_dates.length
    ? staticManifest.actual_dates
    : staticMeta.data_dates;
  const windowDates = formatDateWindow(sourceDates);
  const generatedAt = resolveStaticGeneratedAt(staticManifest, staticMeta);
  metaText.textContent = generatedAt
    ? `静态站点生成时间： ${generatedAt}`
    : `${staticMeta.row_count || allDrivers.length}位司机`;
  if (windowText) {
    windowText.textContent = `近7天窗口：${windowDates}`;
  }

  allCities = sortByPinyin(Array.isArray(options.cities) ? options.cities : []);
  allCompanies = sortByPinyin(Array.isArray(options.companies) ? options.companies : []);
  allProducts = sortByPinyin(Array.isArray(options.products) ? options.products : []);
  renderTokenPicker({
    containerEl: citySelect,
    options: allCities,
    selectedSet: selectedCities,
    placeholder: "搜索城市，点击加入",
    emptyText: "没有匹配城市",
    defaultOptions: cityDefaultOptions(allCities),
  });
  renderTokenPicker({
    containerEl: companySelect,
    options: allCompanies,
    selectedSet: selectedCompanies,
    placeholder: "输入公司关键词，点击加入",
    emptyText: "输入公司关键词后选择",
    defaultOptions: [],
  });
  renderTokenPicker({
    containerEl: productSelect,
    options: allProducts,
    selectedSet: selectedProducts,
    placeholder: "输入产品线关键词，点击加入",
    emptyText: "没有匹配产品线",
    defaultOptions: allProducts,
  });
  setDateFilter("");
  renderDatePicker([], getDateFilter());
  staticDataReady = true;
  setActionsEnabled(true);
  hideLoadProgress(taskId);
}

function initializeFilterWorker() {
  if (!window.Worker || filterWorker) {
    return filterWorkerStartup;
  }
  filterWorkerStartup = new Promise((resolve, reject) => {
    filterWorker = new Worker("filter-worker.js?v=20260713-performance-v3");
    filterWorker.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.type === "ready") {
        filterWorkerReady = true;
        filterWorkerWaitTaskId = 0;
        resolve();
        return;
      }
      if (message.type === "startup-progress") {
        if (!filterWorkerWaitTaskId || filterWorkerWaitTaskId !== loadTaskId) {
          return;
        }
        updateLoadProgress(message.percent, message.message, filterWorkerWaitTaskId);
        return;
      }
      if (message.type === "result") {
        const pending = pendingFilterRequests.get(message.requestId);
        pendingFilterRequests.delete(message.requestId);
        pending?.resolve({ rows: message.rows || [], totalCount: message.totalCount });
        return;
      }
      if (message.type === "error") {
        const error = new Error(message.message);
        pendingFilterRequests.forEach(({ reject: rejectPending }) => rejectPending(error));
        pendingFilterRequests.clear();
        filterWorker = null;
        reject(error);
      }
    });
    filterWorker.addEventListener("error", () => {
      const error = new Error("筛选加速器启动失败");
      pendingFilterRequests.forEach(({ reject: rejectPending }) => rejectPending(error));
      pendingFilterRequests.clear();
      filterWorker = null;
      reject(error);
    });
    filterWorker.postMessage({ type: "init", url: "data/filter-index.json.gz" });
  });
  return filterWorkerStartup;
}

function filterWithWorker(filters, limit = 5000) {
  if (!filterWorker || !filterWorkerReady) {
    return null;
  }
  const requestId = ++filterRequestId;
  return new Promise((resolve, reject) => {
    pendingFilterRequests.set(requestId, { resolve, reject });
    filterWorker.postMessage({ type: "filter", requestId, filters, limit });
  });
}

function dailyFileForDate(dataDate) {
  const file = (driverDataIndex?.files || []).find((item) => item.date === dataDate);
  return file?.path || `daily/drivers-${dataDate}.json`;
}

async function ensureDriversForDate(dataDate, { onProgress } = {}) {
  if (!driverDataIndex || !dataDate) {
    return;
  }
  if (loadedDriversByDate.has(dataDate)) {
    allDrivers = loadedDriversByDate.get(dataDate);
    onProgress?.(100, 0, 0);
    return;
  }
  const filePath = dailyFileForDate(dataDate);
  const payload = await fetchJsonWithProgress(`data/${filePath}`, (percent, loaded, total) => {
    if (onProgress) {
      onProgress(percent, loaded, total);
      return;
    }
    if (total > 0) {
      const loadedMb = loaded / 1024 / 1024;
      const totalMb = total / 1024 / 1024;
      updateLoadProgress(percent, `读取数据 ${Math.round(percent)}%（${loadedMb.toFixed(1)} / ${totalMb.toFixed(1)} MB）`);
    } else {
      updateLoadProgress(percent, loadingDailyDataMessage());
    }
  });
  const drivers = resolveDailyDriversPayload(payload);
  loadedDriversByDate.set(dataDate, drivers);
  allDrivers = drivers;
  if (onProgress) {
    onProgress(100, 0, 0);
  } else {
    updateLoadProgress(100, dailyDataLoadedMessage());
  }
}

async function loadDriverDates(dates, { startPercent = 8, endPercent = 96, label = "正在读取数据" } = {}) {
  const pendingDates = (Array.isArray(dates) ? dates : []).filter(
    (dataDate) => dataDate && !loadedDriversByDate.has(dataDate),
  );
  if (!pendingDates.length) {
    return;
  }

  loadProgress?.classList.remove("hidden");
  updateLoadProgress(startPercent, `${label} 0/${pendingDates.length}`);
  for (let index = 0; index < pendingDates.length; index += 1) {
    const dataDate = pendingDates[index];
    await ensureDriversForDate(dataDate, {
      onProgress: (filePercent, loaded, total) => {
        const completion = (index + Math.min(100, Math.max(0, filePercent)) / 100) / pendingDates.length;
        const overallPercent = startPercent + (endPercent - startPercent) * completion;
        const fileInfo = total > 0
          ? `（${(loaded / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB）`
          : "";
        updateLoadProgress(overallPercent, `${label} ${index + 1}/${pendingDates.length}${fileInfo}`);
      },
    });
  }
}

function resolveDailyDriversPayload(payload) {
  if (payload?.mode === "daily-static-compact") {
    return decodeCompactDailyPayload(payload);
  }
  if (Array.isArray(payload?.drivers)) {
    return payload.drivers;
  }
  return Array.isArray(payload) ? payload : [];
}

function dictionaryValue(values = [], index) {
  return Number.isInteger(index) && index >= 0 && index < values.length ? values[index] : "";
}

function decodeCompactDailyPayload(payload) {
  const schema = Array.isArray(payload?.schema) ? payload.schema : [];
  const dict = payload?.dict || {};
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const dictFields = {
    city: "cities",
    cityLevel: "cityLevels",
    company: "companies",
    product: "products",
    isOrganized: "isOrganized",
  };
  const availableFields = new Set();
  schema.forEach((field, index) => {
    if (field === "strategyEvidence") {
      return;
    }
    if (field in dictFields) {
      if (Array.isArray(dict[dictFields[field]]) && dict[dictFields[field]].length) {
        availableFields.add(field);
      }
      return;
    }
    if (field === "strategyKeys") {
      if (Array.isArray(dict.strategyKeys) && dict.strategyKeys.length) {
        availableFields.add(field);
      }
      return;
    }
    if (rows.some((row) => hasUsableRawValue(row[index]))) {
      availableFields.add(field);
    }
  });
  return rows.map((row) => {
    const raw = Object.fromEntries(schema.map((field, index) => [field, row[index]]));
    const driver = {};
    schema.forEach((field) => {
      const value = raw[field];
      if (field in dictFields) {
        driver[field] = dictionaryValue(dict[dictFields[field]], value);
      } else if (field === "strategyKeys") {
        driver.strategyKeys = (Array.isArray(value) ? value : [])
          .map((index) => dictionaryValue(dict.strategyKeys, index))
          .filter(Boolean);
      } else if (field !== "strategyEvidence" && value !== null && value !== undefined) {
        driver[field] = value;
      }
    });
    driver.dataDate = driver.dataDate || payload.date || "";
    const evidenceValues = Array.isArray(raw.strategyEvidence) ? raw.strategyEvidence : [];
    const evidence = {};
    (driver.strategyKeys || []).forEach((key, index) => {
      if (evidenceValues[index]) {
        evidence[key] = evidenceValues[index];
      }
    });
    if (Object.keys(evidence).length) {
      driver.strategyEvidence = evidence;
    }
    driver.subtitle = [driver.city, driver.product, driver.company].filter(Boolean).join(" · ");
    Object.defineProperty(driver, "__availableFields", {
      value: availableFields,
      enumerable: false,
    });
    return driver;
  });
}

function appendDriverRows(target, rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return target;
  }
  for (const row of rows) {
    target.push(row);
  }
  return target;
}

function rankNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Infinity;
}

function scoreNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

function strategyHitCount(driver) {
  if (Array.isArray(driver.strategyKeys)) {
    return driver.strategyKeys.filter((key) => key && key !== "regular-care").length;
  }
  if (Array.isArray(driver.strategies)) {
    return driver.strategies.filter((strategy) => strategy?.key !== "regular-care").length;
  }
  return 0;
}

function priorityMeta(priority) {
  const value = Number(priority);
  if (Number.isFinite(value) && value <= 20) {
    return { kind: "primary", label: "优先沟通" };
  }
  if (Number.isFinite(value) && value <= 50) {
    return { kind: "secondary", label: "次要补充" };
  }
  return { kind: "reference", label: "参考信息" };
}

function priorityMetasForStrategies(strategies = []) {
  const metas = strategies.map((strategy) => priorityMeta(strategy.priority));
  if (metas.some((meta) => meta.kind === "primary")) {
    return metas;
  }
  const promotedIndex = metas.findIndex((meta, index) => {
    const strategy = strategies[index] || {};
    return strategy.key !== "regular-care" && meta.kind === "secondary";
  });
  const fallbackIndex = promotedIndex >= 0
    ? promotedIndex
    : metas.findIndex((meta, index) => (strategies[index] || {}).key !== "regular-care");
  if (fallbackIndex >= 0) {
    metas[fallbackIndex] = { kind: "primary", label: "优先沟通" };
  }
  return metas;
}

function compareFilteredDrivers(left, right) {
  const rankDiff =
    rankNumber(left.bestRiskTierRank || left.riskTierRank) -
    rankNumber(right.bestRiskTierRank || right.riskTierRank);
  if (rankDiff !== 0) {
    return rankDiff;
  }
  const tiredScoreDiff = scoreNumber(right.tiredScore) - scoreNumber(left.tiredScore);
  if (tiredScoreDiff !== 0) {
    return tiredScoreDiff;
  }
  const riskScoreDiff = scoreNumber(right.riskTierScore) - scoreNumber(left.riskTierScore);
  if (riskScoreDiff !== 0) {
    return riskScoreDiff;
  }
  const dateDiff = normalizedDate(right.dataDate).localeCompare(normalizedDate(left.dataDate));
  if (dateDiff !== 0) {
    return dateDiff;
  }
  return String(left.driverId || "").localeCompare(String(right.driverId || ""), "zh-Hans-CN", {
    numeric: true,
  });
}

function deduplicateBestRankedDrivers(rows) {
  const bestByDriver = new Map();
  (Array.isArray(rows) ? rows : []).forEach((driver) => {
    const driverId = String(driver?.driverId || "").trim();
    if (!driverId) {
      return;
    }
    const currentRank = rankNumber(driver.riskTierRank);
    const existing = bestByDriver.get(driverId);
    const existingRank = rankNumber(existing?.riskTierRank);
    const isBetterRank = currentRank < existingRank;
    const isSameRankNewerDate =
      currentRank === existingRank && normalizedDate(driver.dataDate) > normalizedDate(existing?.dataDate);
    if (!existing || isBetterRank || isSameRankNewerDate) {
      bestByDriver.set(driverId, {
        ...driver,
        bestRiskTierRank: Number.isFinite(currentRank) ? currentRank : driver.riskTierRank,
      });
    }
  });
  return Array.from(bestByDriver.values()).map((driver) => {
    const rollingOnlineDuration = finiteMetricNumber(driver.lately_7d_except_sub_online_dur_hour);
    return {
      ...driver,
      avgOnlineDuration7d: rollingOnlineDuration === null ? null : rollingOnlineDuration / 7,
    };
  });
}

async function ensureDriversForFilters(filters) {
  if (!driverDataIndex) {
    return;
  }
  const dates = driverDataIndex.dates || [];
  await loadDriverDates(dates, {
    startPercent: 6,
    endPercent: 94,
    label: "正在读取近7天数据",
  });
  const all = [];
  dates.forEach((dataDate) => appendDriverRows(all, loadedDriversByDate.get(dataDate) || []));
  allDrivers = deduplicateBestRankedDrivers(all);
}

async function filteredDriversForQuery(filters, { limit = 5000 } = {}) {
  const taskId = loadTaskId;
  if (!filterWorkerReady && filterWorkerStartup) {
    filterWorkerWaitTaskId = taskId;
    try {
      await filterWorkerStartup;
    } catch (error) {
      // Older CDN releases can still fall back to the legacy daily-file path.
    }
    if (filterWorkerWaitTaskId === taskId) {
      filterWorkerWaitTaskId = 0;
    }
    if (taskId !== loadTaskId) {
      return null;
    }
  }
  const workerResult = filterWithWorker(filters, limit);
  if (workerResult) {
    loadProgress?.classList.remove("hidden");
    updateLoadProgress(25, "正在快速筛选近7天数据...", taskId);
    const result = await workerResult;
    if (taskId !== loadTaskId) {
      return null;
    }
    updateLoadProgress(92, "正在整理筛选结果...", taskId);
    const rows = (result.rows || []).map((driver) => ({
      ...driver,
      subtitle: [driver.city, driver.product, driver.company].filter(Boolean).join(" · "),
      filterIndex: true,
    }));
    rows.matchCount = result.totalCount ?? rows.length;
    return rows;
  }
  await ensureDriversForFilters(filters);
  return taskId === loadTaskId ? filteredDrivers(filters, allDrivers.length) : null;
}

function sortByPinyin(options) {
  return [...options].sort((left, right) => pinyinCollator.compare(left, right));
}

function appendOptions(selectEl, options, emptyLabel) {
  selectEl.innerHTML = `<option value="">${escapeHtml(emptyLabel)}</option>`;
  sortByPinyin(options).forEach((option) => {
    const item = document.createElement("option");
    item.value = option;
    item.textContent = option;
    selectEl.appendChild(item);
  });
}

function renderDatePicker(options, selectedValue = getDateFilter()) {
  if (!dateSelect) {
    setDateFilter("");
    return;
  }
  setDateFilter(selectedValue);
  dateSelect.innerHTML = "";
  dateSelect.classList.remove("open");
  const selectedBox = document.createElement("div");
  selectedBox.className = "token-box";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "token-input";
  input.placeholder = selectedDate ? "搜索或切换日期" : "全部日期";

  const menu = document.createElement("div");
  menu.className = "token-menu";
  menu.setAttribute("role", "listbox");

  selectedBox.appendChild(input);
  dateSelect.appendChild(selectedBox);
  dateSelect.appendChild(menu);

  const repaint = () => {
    selectedBox.querySelectorAll(".token-chip").forEach((chip) => chip.remove());
    if (selectedDate) {
      const token = document.createElement("button");
      token.type = "button";
      token.className = "token-chip";
      token.title = "点击清除日期筛选";
      token.innerHTML = `<span>${escapeHtml(selectedDate)}</span><b aria-hidden="true">×</b>`;
      token.addEventListener("click", () => {
        setDateFilter("");
        input.value = "";
        repaint();
        dateSelect.dispatchEvent(new CustomEvent("date-filter-change"));
      });
      selectedBox.insertBefore(token, input);
    }
    renderDateMenu({
      menu,
      options,
      selectedValue: selectedDate,
      query: input.value.trim(),
      repaint,
    });
  };

  const openMenu = () => {
    dateSelect.classList.add("open");
    repaint();
  };
  input.addEventListener("focus", openMenu);
  input.addEventListener("input", openMenu);
  selectedBox.addEventListener("click", (event) => {
    event.stopPropagation();
    input.focus();
    openMenu();
  });
  menu.addEventListener("click", (event) => event.stopPropagation());
  repaint();
}

function renderDateMenu({ menu, options, selectedValue, query, repaint }) {
  const normalizedQuery = query.toLowerCase();
  const allOptions = ["", ...sortByPinyin(options)];
  const visibleOptions = allOptions
    .filter((value) => {
      const label = value || "全部日期";
      return !normalizedQuery || label.toLowerCase().includes(normalizedQuery);
    })
    .slice(0, 30);
  menu.innerHTML = "";
  visibleOptions.forEach((value) => {
    const label = value || "全部日期";
    const isSelected = value === selectedValue;
    const item = document.createElement("button");
    item.type = "button";
    item.className = `token-option${isSelected ? " selected" : ""}`;
    item.setAttribute("aria-selected", isSelected ? "true" : "false");
    item.innerHTML = `<span>${escapeHtml(label)}</span><b aria-hidden="true">✓</b>`;
    item.addEventListener("click", () => {
      setDateFilter(value);
      dateSelect.classList.remove("open");
      const input = dateSelect.querySelector(".token-input");
      if (input) {
        input.value = "";
      }
      repaint();
      dateSelect.dispatchEvent(new CustomEvent("date-filter-change"));
    });
    menu.appendChild(item);
  });
}

document.addEventListener("click", (event) => {
  document.querySelectorAll(".token-picker.open").forEach((picker) => {
    if (!picker.contains(event.target)) {
      picker.classList.remove("open");
    }
  });
});

function renderTokenPicker({
  containerEl,
  options,
  selectedSet,
  placeholder,
  emptyText,
  defaultOptions = [],
}) {
  containerEl.innerHTML = "";
  containerEl.classList.remove("open");
  const selectedBox = document.createElement("div");
  selectedBox.className = "token-box";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "token-input";
  input.placeholder = placeholder;
  const pickerState = { containerEl, input, options, selectedSet, repaint: null };
  const existingPickerIndex = tokenPickers.findIndex((picker) => picker.containerEl === containerEl);
  if (existingPickerIndex >= 0) {
    tokenPickers[existingPickerIndex] = pickerState;
  } else {
    tokenPickers.push(pickerState);
  }

  const menu = document.createElement("div");
  menu.className = "token-menu";
  menu.setAttribute("role", "listbox");

  selectedBox.appendChild(input);
  containerEl.appendChild(selectedBox);
  containerEl.appendChild(menu);

  const repaint = () => {
    renderSelectedTokens(selectedBox, input, selectedSet, repaint);
    renderTokenMenu({
      menu,
      options,
      selectedSet,
      query: input.value.trim(),
      defaultOptions,
      emptyText,
      repaint,
    });
  };
  pickerState.repaint = repaint;

  const openMenu = () => {
    containerEl.classList.add("open");
    repaint();
  };

  input.addEventListener("focus", openMenu);
  input.addEventListener("input", openMenu);
  selectedBox.addEventListener("click", (event) => {
    event.stopPropagation();
    input.focus();
    openMenu();
  });
  menu.addEventListener("click", (event) => event.stopPropagation());
  repaint();
}

function typedTokenCandidate(options, typedValue) {
  const query = String(typedValue || "").trim();
  if (!query) {
    return { value: "", ambiguous: false };
  }
  const normalizedQuery = query.toLowerCase();
  const exact = options.find((option) => option.toLowerCase() === normalizedQuery);
  if (exact) {
    return { value: exact, ambiguous: false };
  }
  const matches = options.filter((option) => option.toLowerCase().includes(normalizedQuery));
  if (matches.length === 1) {
    return { value: matches[0], ambiguous: false };
  }
  return { value: "", ambiguous: matches.length > 1 };
}

function syncTypedTokenInputs() {
  for (const picker of tokenPickers) {
    const typedValue = picker.input.value.trim();
    if (!typedValue) {
      continue;
    }
    const candidate = typedTokenCandidate(picker.options, typedValue);
    if (candidate.ambiguous) {
      return `“${typedValue}”匹配多个选项，请在下拉框中点击具体选项后再查询。`;
    }
    if (!candidate.value) {
      return `未找到“${typedValue}”对应的筛选项，请确认输入是否正确。`;
    }
    picker.selectedSet.add(candidate.value);
    picker.input.value = "";
    picker.containerEl.classList.remove("open");
    picker.repaint?.();
  }
  return "";
}

function renderSelectedTokens(selectedBox, input, selectedSet, repaint) {
  selectedBox.querySelectorAll(".token-chip").forEach((chip) => chip.remove());
  Array.from(selectedSet).forEach((value) => {
    const token = document.createElement("button");
    token.type = "button";
    token.className = "token-chip";
    token.title = `点击移除${value}`;
    token.innerHTML = `<span>${escapeHtml(value)}</span><b aria-hidden="true">×</b>`;
    token.addEventListener("click", () => {
      selectedSet.delete(value);
      repaint();
    });
    selectedBox.insertBefore(token, input);
  });
}

function renderTokenMenu({ menu, options, selectedSet, query, defaultOptions, emptyText, repaint }) {
  const normalizedQuery = query.toLowerCase();
  const source = query
    ? options.filter((option) => option.toLowerCase().includes(normalizedQuery))
    : defaultOptions;
  const visibleOptions = source.slice(0, 30);
  menu.innerHTML = "";
  if (!visibleOptions.length) {
    const empty = document.createElement("div");
    empty.className = "token-menu-empty";
    empty.textContent = emptyText;
    menu.appendChild(empty);
    return;
  }
  visibleOptions.forEach((value) => {
    const isSelected = selectedSet.has(value);
    const item = document.createElement("button");
    item.type = "button";
    item.className = `token-option${isSelected ? " selected" : ""}`;
    item.setAttribute("aria-selected", isSelected ? "true" : "false");
    item.innerHTML = `<span>${escapeHtml(value)}</span><b aria-hidden="true">✓</b>`;
    item.addEventListener("click", () => {
      if (isSelected) {
        selectedSet.delete(value);
      } else {
        selectedSet.add(value);
      }
      menu.closest(".token-picker")?.classList.add("open");
      repaint();
    });
    menu.appendChild(item);
  });
}

function cityDefaultOptions(cities) {
  const available = new Set(cities);
  const topCities = commonCities.filter((city) => available.has(city));
  const topCitySet = new Set(topCities);
  const otherCities = sortByPinyin(cities.filter((city) => !topCitySet.has(city)));
  return [...topCities, ...otherCities].slice(0, 30);
}

function currentFilters() {
  return {
    driver_id: driverIdInput.value.trim(),
    city: Array.from(selectedCities),
    company: Array.from(selectedCompanies),
    product: Array.from(selectedProducts),
    dt: getDateFilter(),
    is_organized: isOrganizedSelect?.value || "",
    ...currentAdvancedFilters(),
  };
}

function filtersSummary(filters = currentFilters()) {
  const parts = [];
  if (filters.driver_id) {
    parts.push(`司机ID包含${filters.driver_id}`);
  }
  if (filters.city?.length) {
    parts.push(`城市=${filters.city.join("/")}`);
  }
  if (filters.company?.length) {
    parts.push(`公司=${filters.company.join("/")}`);
  }
  if (filters.product?.length) {
    parts.push(`产品线=${filters.product.join("/")}`);
  }
  if (filters.dt) {
    parts.push(`日期=${filters.dt}`);
  }
  if (filters.is_organized) {
    parts.push(`是否组织化=${filters.is_organized}`);
  }
  advancedFilterFields.forEach((field) => {
    const minValue = filters[`${field}_min`];
    const maxValue = filters[`${field}_max`];
    if (minValue || maxValue) {
      parts.push(`${field}${minValue ? `≥${minValue}` : ""}${maxValue ? `≤${maxValue}` : ""}`);
    }
  });
  return parts.length ? parts.join("；") : "无筛选条件";
}

function logLocalAudit(action, detail = {}) {
  const logs = readJsonStorage(accessLogStorageKey, []);
  logs.unshift({
    ts: formatLocalTimestamp(),
    action,
    ...detail,
  });
  writeJsonStorage(accessLogStorageKey, logs.slice(0, 100));
}

function currentAdvancedFilters() {
  return Object.fromEntries(
    advancedFilterInputs
      .map((input) => [input.id, input.value.trim()])
      .filter(([, value]) => value !== ""),
  );
}

function resetAdvancedFilters() {
  advancedFilterInputs.forEach((input) => {
    input.value = "";
  });
  if (isOrganizedSelect) {
    isOrganizedSelect.value = "";
  }
  updateAdvancedCount();
}

function updateAdvancedCount() {
  if (!advancedCount) {
    return;
  }
  const filledCount =
    advancedFilterInputs.filter((input) => String(input.value || "").trim()).length +
    (isOrganizedSelect?.value ? 1 : 0);
  if (filledCount > 0) {
    advancedCount.textContent = String(filledCount);
    advancedCount.classList.add("show");
  } else {
    advancedCount.textContent = "";
    advancedCount.classList.remove("show");
  }
}

function hasAnyFilter(filters) {
  return Object.values(filters).some((value) => (Array.isArray(value) ? value.length : value));
}

function normalizedDate(value) {
  return String(value || "").split(" ")[0];
}

function numericBound(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesAdvancedFilters(driver, filters) {
  return advancedFilterFields.every((field) => {
    const minValue = numericBound(filters[`${field}_min`]);
    const maxValue = numericBound(filters[`${field}_max`]);
    if (minValue === null && maxValue === null) {
      return true;
    }
    const driverValue = numericBound(driver[field]);
    if (driverValue === null) {
      return false;
    }
    if (minValue !== null && driverValue < minValue) {
      return false;
    }
    if (maxValue !== null && driverValue > maxValue) {
      return false;
    }
    return true;
  });
}

function matchesFilters(driver, filters) {
  if (filters.driver_id && !String(driver.driverId).includes(filters.driver_id)) {
    return false;
  }
  if (filters.city.length && !filters.city.includes(driver.city)) {
    return false;
  }
  if (filters.company.length && !filters.company.includes(driver.company)) {
    return false;
  }
  if (filters.product.length && !filters.product.includes(driver.product)) {
    return false;
  }
  if (filters.dt && normalizedDate(driver.dataDate) !== filters.dt) {
    return false;
  }
  if (filters.is_organized && normalizeBooleanLabel(driver.isOrganized) !== filters.is_organized) {
    return false;
  }
  return matchesAdvancedFilters(driver, filters);
}

function activeFilterGroups(filters) {
  const groups = [];
  if (filters.driver_id) {
    groups.push({ key: "driver_id", label: "司机ID", clear: (copy) => { copy.driver_id = ""; } });
  }
  if (filters.city?.length) {
    groups.push({ key: "city", label: "城市", clear: (copy) => { copy.city = []; } });
  }
  if (filters.company?.length) {
    groups.push({ key: "company", label: "公司", clear: (copy) => { copy.company = []; } });
  }
  if (filters.product?.length) {
    groups.push({ key: "product", label: "产品线", clear: (copy) => { copy.product = []; } });
  }
  if (filters.is_organized) {
    groups.push({ key: "is_organized", label: "是否组织化", clear: (copy) => { copy.is_organized = ""; } });
  }
  advancedFilterFields.forEach((field) => {
    if (filters[`${field}_min`] || filters[`${field}_max`]) {
      groups.push({
        key: field,
        label: advancedFilterLabel(field),
        clear: (copy) => {
          copy[`${field}_min`] = "";
          copy[`${field}_max`] = "";
        },
      });
    }
  });
  return groups;
}

function advancedFilterLabel(field) {
  const labels = {
    bestRiskTierRank: "近七天最高排名",
    age: "年龄",
    consecutive_days: "连续出车天数",
    server_dur_hour: "服务时长",
    order_cnt_21_09_7d_rate: "夜间占比",
    sleep_deprivation_days: "睡眠不足天数",
  };
  return labels[field] || field;
}

function countMatchedDrivers(filters) {
  let count = 0;
  for (const driver of allDrivers) {
    if (matchesFilters(driver, filters)) {
      count += 1;
    }
  }
  return count;
}

function zeroResultHints(filters) {
  return activeFilterGroups(filters)
    .map((group) => {
      const relaxed = {
        ...filters,
        city: [...(filters.city || [])],
        company: [...(filters.company || [])],
        product: [...(filters.product || [])],
      };
      group.clear(relaxed);
      return { label: group.label, count: countMatchedDrivers(relaxed) };
    })
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 3);
}

function normalizeBooleanLabel(value) {
  const text = String(value ?? "").trim();
  if (["1", "true", "是", "Y", "y", "yes", "Yes", "TRUE"].includes(text)) {
    return "是";
  }
  if (["0", "false", "否", "N", "n", "no", "No", "FALSE"].includes(text)) {
    return "否";
  }
  return text;
}

function filteredDrivers(filters = currentFilters(), limit = Infinity) {
  if (!hasAnyFilter(filters)) {
    return [];
  }
  return allDrivers
    .filter((driver) => matchesFilters(driver, filters))
    .sort(compareFilteredDrivers)
    .slice(0, limit);
}

function activeDriverKey() {
  return profileEl.dataset.driverKey || "";
}

function driverKey(driver) {
  return `${driver.driverId || ""}::${driver.dataDate || ""}`;
}

function appendDriverCards(drivers) {
  if (!drivers.length) {
    return;
  }
  const activeKey = activeDriverKey();
  drivers.forEach((driver) => {
    const item = document.createElement("div");
    const strategyCount = strategyHitCount(driver);
    item.className = `driver-card${driverKey(driver) === activeKey ? " active" : ""}`;
    item.dataset.driverKey = driverKey(driver);
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.innerHTML = `
      <div class="driver-avatar">${escapeHtml(driverInitial(driver.driverId))}</div>
      <div class="driver-info">
        <div class="driver-id">${escapeHtml(driver.driverId)}</div>
        <div class="driver-sub">${escapeHtml(driver.subtitle || "暂无基础信息")}</div>
        <div class="driver-tags">
          <span class="badge badge-strategy">策略 ${escapeHtml(strategyCount)}</span>
        </div>
      </div>
      <div class="driver-metrics">
        <div class="metric-row">
          <span class="badge badge-num">排名 ${escapeHtml(displayValue(driver.bestRiskTierRank || driver.riskTierRank))}</span>
        </div>
        <div class="metric-label">风险 ${escapeHtml(displayValue(driver.riskTierScore))} · 疲劳 ${escapeHtml(displayValue(driver.tiredScore))}</div>
      </div>`;
    item.addEventListener("click", () => loadProfile(driver));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        loadProfile(driver);
      }
    });
    listEl.appendChild(item);
  });
}

function driverInitial(driverId) {
  const text = String(driverId || "").trim();
  return text ? text.slice(-2) : "司";
}

function profileAvatarLabel() {
  return "司";
}

function conciseProfileSubtitle(driver) {
  const averageOnlineDuration = formatAverageOnlineDuration(driver.avgOnlineDuration7d);
  return [
    displayableText(driver.city),
    displayableText(driver.product),
    displayableText(driver.company),
    summaryPhrase(driver.age, { suffix: "岁" }),
    averageOnlineDuration ? `近7天日均在线时长 ${averageOnlineDuration}h/日` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderList(drivers, options = {}) {
  const markUserAction = options.markUserAction !== false;
  if (markUserAction) {
    userHasRenderedResults = true;
  }
  currentListRows = drivers;
  renderedListCount = 0;
  listEl.innerHTML = "";
  if (!drivers.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.innerHTML = options.emptyHtml ||
      escapeHtml(options.emptyMessage || "输入司机ID，或选择城市、公司、产品线、排名范围后显示匹配结果。");
    listEl.appendChild(empty);
    return;
  }
  const summary = document.createElement("div");
  summary.className = "list-summary";
  const matchCount = Number(drivers.matchCount) || drivers.length;
  summary.textContent = `匹配 ${matchCount} 位司机，当前显示 ${Math.min(listPageSize, drivers.length)} 位`;
  listEl.appendChild(summary);
  renderMoreListItems();
}

function renderMoreListItems() {
  const nextRows = currentListRows.slice(renderedListCount, renderedListCount + listPageSize);
  renderedListCount += nextRows.length;
  appendDriverCards(nextRows);
  listEl.querySelector(".load-more")?.remove();
  if (renderedListCount < currentListRows.length) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "load-more ghost-button";
    button.textContent = `继续显示 ${Math.min(listPageSize, currentListRows.length - renderedListCount)} 位`;
    button.addEventListener("click", renderMoreListItems);
    listEl.appendChild(button);
  }
  const summary = listEl.querySelector(".list-summary");
  if (summary) {
    const matchCount = Number(currentListRows.matchCount) || currentListRows.length;
    const percent = currentListRows.length
      ? Math.round((renderedListCount / currentListRows.length) * 100)
      : 0;
    const cappedText = matchCount > currentListRows.length
      ? `，列表优先展示前 ${currentListRows.length} 位`
      : `（${percent}%）`;
    summary.textContent = `匹配 ${matchCount} 位司机，当前显示 ${renderedListCount} 位${cappedText}`;
  }
}

function loadList(filters = currentFilters()) {
  renderList(filteredDrivers(filters, allDrivers.length));
}

function showFirstMatchedProfile(rows) {
  if (!rows.length) {
    showState("当前条件没有匹配司机。");
    return;
  }
  loadProfile(rows[0]);
}

function applyFilterResults(rows) {
  if (!rows.length) {
    const hints = filterWorkerReady ? [] : zeroResultHints(currentFilters());
    const hintHtml = hints.length
      ? `<div class="empty-title-small">当前条件没有匹配司机</div><div class="empty-hints">${hints
          .map((hint) => `<div>去掉「${escapeHtml(hint.label)}」后约有 ${escapeHtml(hint.count)} 位匹配</div>`)
          .join("")}</div>`
      : "当前条件没有匹配司机。可以尝试放宽城市、产品线或高级筛选范围。";
    renderList(rows, { emptyHtml: hintHtml });
    showState("当前条件没有匹配司机。左侧已给出可尝试放宽的条件。");
    return;
  }
  renderList(rows);
  if (rows[0]?.filterIndex) {
    showState(`已筛出 ${Number(rows.matchCount) || rows.length} 位司机。点击左侧名单中的司机，按需读取详细画像。`);
    return;
  }
  try {
    loadProfile(rows[0]);
  } catch (error) {
    showState(`已匹配 ${rows.length} 位司机，但打开第一位画像失败：${error.message}`);
  }
}

function renderFieldList(items) {
  const visibleItems = (Array.isArray(items) ? items : []).filter((item) => !item.hidden);
  return `<div class="field-list">${visibleItems
    .map(
      (item) => `
    <div class="field-item">
      <div class="field-label">${escapeHtml(item.displayLabel)}</div>
      <div class="field-value">${escapeHtml(valueText(item))}</div>
    </div>`,
    )
    .join("")}</div>`;
}

function renderHeaderChips(chips) {
  return `<div class="chips">${chips
    .map(
      (chip) =>
        `<span class="chip chip-${escapeHtml(chip.kind)}">${escapeHtml(chip.label)}</span>`,
    )
    .join("")}</div>`;
}

function renderSectionTitle(number, title) {
  return `<h2 class="section-title"><span>${number}</span>${escapeHtml(title)}</h2>`;
}

function buildStrategyRuleIndex(config = {}) {
  const rules = new Map();
  (Array.isArray(config.rules) ? config.rules : []).forEach((rule) => {
    if (rule?.key) {
      rules.set(rule.key, rule);
    }
  });
  const fallback = config.fallbackRule || {
    key: "regular-care",
    title: "常规关怀",
    evidence: "当前没有策略指标超过配置阈值，或策略计算结果暂不可用。",
    advice: "可做常规状态确认，提醒司机保持安全驾驶、合理休息和规律作息。",
    translation: {
      driver_script: "师傅您好，例行关心一下您最近的出车和休息情况。请注意合理安排作息，感觉疲劳或身体不舒服时先休息。",
      action_advice: "可做常规状态确认，提醒保持安全驾驶、合理休息和规律作息。",
      communication_tip: "避免堆叠风险标签、说教或作出无法兑现的承诺；以感谢、关心和开放式提问为主，司机抵触时礼貌收尾，不强劝。",
    },
    priority: 999,
  };
  return { rules, fallback };
}

function replaceTemplate(template = "", context = {}) {
  return String(template).replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) =>
    context[key] === undefined || context[key] === null ? "" : String(context[key]),
  );
}

function resolveTranslation(rawTranslation = {}, context = {}, fallbackAdvice = "") {
  const translation = rawTranslation && typeof rawTranslation === "object" ? rawTranslation : {};
  const driverScript = replaceTemplate(
    translation.driver_script ||
      "师傅您好，想关心一下您最近的出车和休息情况。若感觉疲劳或身体不适，建议先休息再继续出车。",
    context,
  );
  const actionAdvice = replaceTemplate(
    translation.action_advice || fallbackAdvice || "建议用关怀口径确认状态，并提醒合理安排休息。",
    context,
  );
  const communicationTip = replaceTemplate(
      translation.communication_tip || "避免恐吓、命令、诊断式表达或无法兑现的承诺；先听司机感受，再用商量口吻给出可选择的建议。",
    context,
  );
  return {
    driver_script: driverScript,
    action_advice: actionAdvice,
    communication_tip: communicationTip,
    copy_text: [driverScript, actionAdvice].filter(Boolean).join("\n"),
  };
}

function strategyConditions(rule = {}) {
  const compound = rule.condition || {};
  const items = [
    ...(Array.isArray(compound.any) ? compound.any : []),
    ...(Array.isArray(compound.all) ? compound.all : []),
  ];
  if (items.length) {
    return items;
  }
  return [
    {
      driver_metric: rule.driver_metric,
      driver_metric_label: rule.driver_metric_label,
      unit: rule.unit || "",
    },
  ];
}

function conditionForMetric(rule, metric) {
  return strategyConditions(rule).find((item) => item.driver_metric === metric) || {};
}

function thresholdRelationLabel(operator) {
  return operator === "<" || operator === "<=" ? "低于" : "高于";
}

function normalizeEvidenceItems(rawEvidence) {
  if (!rawEvidence) {
    return [];
  }
  if (Array.isArray(rawEvidence) && Array.isArray(rawEvidence[0])) {
    return rawEvidence.map(([driverMetric, driverValue, thresholdValue]) => ({
      driverMetric,
      driverValue,
      thresholdValue,
    }));
  }
  if (Array.isArray(rawEvidence)) {
    return rawEvidence
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        driverMetric: item.driverMetric,
        driverValue: item.driverValue,
        thresholdValue: item.thresholdValue,
      }));
  }
  if (typeof rawEvidence === "object") {
    return [rawEvidence];
  }
  return [];
}

function evidenceTextForItems(rule, evidenceItems) {
  return evidenceItems
    .map((item) => {
      const condition = conditionForMetric(rule, item.driverMetric);
      const label = condition.driver_metric_label || item.driverMetric || "指标";
      const unit = condition.unit || "";
      const operator = condition.threshold?.operator || rule.threshold?.operator || ">";
      if (item.thresholdValue === undefined || item.thresholdValue === null) {
        return `${label}${formatMetricValue(item.driverValue)}${unit}`;
      }
      const relation = thresholdRelationLabel(operator);
      return `${label}${formatMetricValue(item.driverValue)}${unit}，${relation}case均值${formatMetricValue(item.thresholdValue)}${unit}`;
    })
    .join("，");
}

function renderStrategyFromRule(key, driver, ruleIndex) {
  const fallback = ruleIndex?.fallback || buildStrategyRuleIndex({}).fallback;
  if (key === fallback.key || key === "regular-care") {
    return {
      key: fallback.key || "regular-care",
      title: fallback.title || "常规关怀",
      evidence: fallback.evidence || "当前没有策略指标超过配置阈值。",
      advice: fallback.advice || "可做常规状态确认，提醒司机保持安全驾驶、合理休息和规律作息。",
      translation: resolveTranslation(fallback.translation, {}, fallback.advice),
      priority: fallback.priority || 999,
      priority_tier: fallback.priority_tier || "",
      badges: Array.isArray(fallback.badges) ? fallback.badges : [],
      tags: fallback.tags || [],
    };
  }
  const rule = ruleIndex?.rules?.get(key);
  if (!rule) {
    return {
      key,
      title: key,
      evidence: "该策略命中，但当前静态规则文件缺少对应展示配置。",
      advice: "请先确认策略配置版本，再做关怀式沟通。",
      priority: 999,
      priority_tier: "",
      badges: [],
      tags: [],
    };
  }
  const evidenceItems = normalizeEvidenceItems(driver.strategyEvidence?.[key]);
  const firstEvidence = evidenceItems[0] || {};
  const firstCondition = conditionForMetric(rule, firstEvidence.driverMetric) || {};
  const matchedEvidence = evidenceTextForItems(rule, evidenceItems);
  const missingEvidenceNote = driver.directLookup
    ? "快速查询已定位策略命中；完整内部依据需在组合筛选后查看"
    : "暂无可展示依据";
  const thresholdOperator = firstCondition.threshold?.operator || rule.threshold?.operator || ">";
  const context = {
    driver_value: formatMetricValue(firstEvidence.driverValue),
    threshold_value: formatMetricValue(firstEvidence.thresholdValue),
    threshold_relation: thresholdRelationLabel(thresholdOperator),
    unit: firstCondition.unit || rule.unit || "",
    driver_metric_label: firstCondition.driver_metric_label || rule.driver_metric_label || "",
    matched_evidence: matchedEvidence || missingEvidenceNote,
    data_date: driver.dataDate || "",
  };
  return {
    key,
    title: rule.title || key,
    category: rule.category || "",
    priority: rule.priority || 999,
    priority_tier: rule.priority_tier || "",
    badges: Array.isArray(rule.badges) ? rule.badges : [],
    evidence: matchedEvidence
      ? replaceTemplate(rule.evidence_template || "{{matched_evidence}}。", context)
      : missingEvidenceNote,
    advice: replaceTemplate(rule.advice_template || "可做常规状态确认，保持关怀式沟通。", context),
    translation: resolveTranslation(
      rule.translation,
      context,
      replaceTemplate(rule.advice_template || "可做常规状态确认，保持关怀式沟通。", context),
    ),
    tags: Array.isArray(rule.tags) ? rule.tags : [],
  };
}

function strategyRiskRank(strategy) {
  const badges = Array.isArray(strategy.badges) ? strategy.badges : [];
  const hasHighRisk = badges.some((badge) => badge?.kind === "high-risk");
  const hasExplainable = badges.some((badge) => badge?.kind === "explainable");
  if (hasHighRisk && hasExplainable) {
    return 0;
  }
  if (hasHighRisk) {
    return 1;
  }
  if (hasExplainable) {
    return 2;
  }
  return 3;
}

function compareStrategies(left, right) {
  const riskRankDiff = strategyRiskRank(left) - strategyRiskRank(right);
  if (riskRankDiff !== 0) {
    return riskRankDiff;
  }
  const priorityDiff = (left.priority || 999) - (right.priority || 999);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  return String(left.key || "").localeCompare(String(right.key || ""), "zh-Hans-CN");
}

function resolveStrategiesForDriver(driver, ruleIndex = strategyRuleIndex) {
  if (!Array.isArray(driver.strategyKeys) && Array.isArray(driver.strategies) && driver.strategies.length) {
    return driver.strategies;
  }
  const keys = Array.isArray(driver.strategyKeys) && driver.strategyKeys.length ? driver.strategyKeys : [];
  const resolvedKeys = keys.length ? keys : ["regular-care"];
  return resolvedKeys
    .map((key) => renderStrategyFromRule(key, driver, ruleIndex))
    .sort(compareStrategies);
}

function buildSummaryForDriver(driver, strategies = resolveStrategiesForDriver(driver)) {
  const averageOnlineDuration = formatAverageOnlineDuration(driver.avgOnlineDuration7d);
  const base = [
    summaryPhrase(driver.age, { suffix: "岁" }),
    displayableText(driver.city),
    displayableText(driver.product),
    displayableText(driver.company),
    summaryPhrase(driver.consecutive_days, { prefix: "连续出车", suffix: "天" }),
    averageOnlineDuration ? `近7天日均在线时长${averageOnlineDuration}小时/日` : "",
    summaryPhrase(driver.order_cnt_21_09_7d_rate, { prefix: "夜间出车占比" }),
    summaryPhrase(driver.sleep_deprivation_days, { prefix: "睡眠不足", suffix: "天" }),
    summaryPhrase(driver.dataDate, { prefix: "数据日期" }),
  ].filter(Boolean);
  const titles = strategies
    .filter((strategy) => strategy.key !== "regular-care")
    .map((strategy) => strategy.title)
    .filter(Boolean)
    .slice(0, 6);
  const summary = base.length ? `${base.join("，")}。` : "暂无可展示画像信息。";
  return `${summary}${titles.length ? ` 重点关注：${titles.join("、")}。` : ""}`;
}

function renderStrategies(strategies = []) {
  const items = strategies.length
    ? strategies
    : [
        {
          title: "常规关怀",
          evidence: "当前没有策略指标超过配置阈值，或策略计算结果暂不可用。",
          advice: "可做常规状态确认，提醒司机保持安全驾驶、合理休息和规律作息。",
          translation: resolveTranslation(),
        },
      ];
  const renderBadges = (badges = []) => {
    const visibleBadges = Array.isArray(badges) ? badges.filter((badge) => badge?.label) : [];
    if (!visibleBadges.length) {
      return "";
    }
    return `<div class="strategy-badges">${visibleBadges
      .map(
        (badge) =>
          `<span class="strategy-badge strategy-badge-${escapeHtml(badge.kind || "default")}">${escapeHtml(badge.label)}</span>`,
      )
      .join("")}</div>`;
  };
  const renderInternalGuidance = (strategy) => {
    const translation = resolveTranslation(strategy.translation, {}, strategy.advice);
    return `
      <div class="strategy-internal">
        <div class="communication-note communication-note-strong">
          <span>沟通提醒</span>
          <p>${escapeHtml(translation.communication_tip)}</p>
        </div>
        <details class="strategy-internal-details">
          <summary>查看内部信息</summary>
          <div class="internal-block">
            <span>内部依据</span>
            <p>${escapeHtml(strategy.evidence || strategy.reason || "暂无可展示依据")}</p>
          </div>
          <div class="internal-block">
            <span>内部建议</span>
            <p>${escapeHtml(strategy.advice || "可做常规状态确认，保持关怀式沟通。")}</p>
          </div>
        </details>
      </div>`;
  };
  const priorityMetas = priorityMetasForStrategies(items);
  return `<section class="strategy-list">${items
    .map((strategy, index) => {
      const priority = priorityMetas[index] || priorityMeta(strategy.priority);
      const badges = [
        { kind: `priority-${priority.kind}`, label: priority.label },
        ...(Array.isArray(strategy.badges) ? strategy.badges : []),
      ];
      return `
        <article class="strategy-card strategy-priority-${escapeHtml(priority.kind)}">
          <div class="strategy-card-heading">
            <h3>${escapeHtml(strategy.title || "常规关怀")}</h3>
            ${renderBadges(badges)}
          </div>
          ${renderInternalGuidance(strategy)}
        </article>`;
    })
    .join("")}</section>`;
}

function renderSpeechTemplates(strategies = []) {
  const items = strategies.length
    ? strategies
    : [
        {
          title: "常规关怀",
          advice: "可做常规状态确认，提醒司机保持安全驾驶、合理休息和规律作息。",
          translation: resolveTranslation(),
        },
      ];
  const visibleItems = items.filter((strategy) => strategy?.key !== "regular-care").slice(0, 6);
  const speechItems = visibleItems.length ? visibleItems : items.slice(0, 1);
  const titles = speechItems
    .map((strategy) => strategy.title)
    .filter(Boolean)
    .slice(0, 6);
  const normalizeAdvicePhrase = (value) => String(value || "")
    .trim()
    .replace(/[。；;，,、.!！？?]+$/g, "");
  const adviceCategories = new Set();
  const advices = speechItems.reduce((items, strategy) => {
    const category = strategy.category || strategy.key || "general";
    if (adviceCategories.has(category)) {
      return items;
    }
    const advice = normalizeAdvicePhrase(
      resolveTranslation(strategy.translation, {}, strategy.advice).action_advice,
    );
    if (advice) {
      adviceCategories.add(category);
      items.push(advice);
    }
    return items;
  }, []).slice(0, 4);
  const focusText = titles.length
    ? `我们这边看到您近期有一些需要关注的情况，主要是${titles.join("、")}。这些信息只是基于平台数据做的关怀提醒，不是批评您，也不替代医生判断。`
    : "今天联系您主要是做一次常规关怀，想了解一下您最近的出车和休息情况。";
  const adviceText = advices.length
    ? `如果方便的话，建议您可以先考虑：${advices.join("；")}。这些建议不用一次全部做到，可以先选一项现在比较容易调整的。`
    : "如果感觉疲劳或身体不舒服，建议先休息再继续出车，尽量保持规律作息。";
  const fullSpeech = [
    "师傅您好，我是平台安全关怀客服，今天联系您主要是想关心一下您最近的出车和身体状态，请问现在方便简单聊两句吗？",
    focusText,
    "很多师傅都很辛苦，我们也理解跑车有现实压力，所以今天只是想跟您确认一下实际感受，看看最近有没有休息不足、犯困或身体不舒服的情况。",
    adviceText,
    "感谢您愿意听我说这些。希望您后续出车平安，也多照顾好自己的身体。",
  ].join("\n\n");
  return `
    <section class="speech-template-list">
      <article class="speech-template speech-template-combined">
        <div class="speech-template-heading">
          <div>
            <h3>综合关怀话术</h3>
            <p>${escapeHtml(titles.length ? titles.join(" / ") : "常规关怀")}</p>
          </div>
          <button class="strategy-copy" type="button" data-copy-strategy="true" data-copy-text="${escapeHtml(fullSpeech)}">复制话术</button>
        </div>
        <p class="speech-template-text">${escapeHtml(fullSpeech)}</p>
        <p class="speech-template-footnote">话术仅供客服参考，请结合司机实际回应灵活调整，避免直接照读内部指标或做医学判断。</p>
      </article>
    </section>`;
}

async function copyStrategySpeech(button) {
  const text = button?.dataset?.copyText || "";
  if (!text) {
    return;
  }
  const originalText = button.textContent;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    button.textContent = "已复制";
    window.setTimeout(() => {
      button.textContent = originalText;
    }, 1400);
  } catch (error) {
    button.textContent = "复制失败";
    window.setTimeout(() => {
      button.textContent = originalText;
    }, 1400);
  }
}

function driverHasField(driver, ...fieldNames) {
  const availableFields = driver?.__availableFields;
  if (availableFields instanceof Set) {
    return fieldNames.some((fieldName) => availableFields.has(fieldName));
  }
  return fieldNames.some((fieldName) => Object.prototype.hasOwnProperty.call(driver || {}, fieldName));
}

function firstAvailableValue(driver, ...fieldNames) {
  for (const fieldName of fieldNames) {
    if (driverHasField(driver, fieldName) && hasUsableRawValue(driver?.[fieldName])) {
      return driver[fieldName];
    }
  }
  for (const fieldName of fieldNames) {
    if (driverHasField(driver, fieldName)) {
      return driver?.[fieldName];
    }
  }
  return undefined;
}

function field(label, value) {
  return { displayLabel: label, displayValue: displayValue(value) };
}

function profileField(driver, label, fieldNames, value = firstAvailableValue(driver, ...fieldNames)) {
  return {
    displayLabel: label,
    displayValue: displayValue(value),
    hidden: !driverHasField(driver, ...fieldNames),
  };
}

function headerChipsForDriver(driver, strategies = []) {
  const chips = [];
  if (driver.city) {
    chips.push({ kind: "region", label: driver.city });
  }
  if (driver.product) {
    chips.push({ kind: "business", label: driver.product });
  }
  const tagMap = {
    高龄: "高龄",
    疲劳: "疲劳",
    健康: "健康",
    城市: "城市",
    节奏: "节奏",
  };
  strategies.forEach((strategy) => {
    (strategy.tags || []).forEach((tag) => {
      const label = tagMap[tag] || tag;
      if (!chips.some((chip) => chip.label === label)) {
        chips.push({ kind: "problem", label });
      }
    });
  });
  return chips;
}

function buildProfileFromDriver(driver, ruleIndex = strategyRuleIndex) {
  const strategies = resolveStrategiesForDriver(driver, ruleIndex);
  return {
    driverId: driver.driverId,
    summary: driver.summary || buildSummaryForDriver(driver, strategies),
    meta: {
      dataDate: driver.dataDate || "暂无数据",
      riskTierRank: displayValue(driver.riskTierRank),
      bestRiskTierRank: displayValue(driver.bestRiskTierRank || driver.riskTierRank),
      riskTierScore: displayValue(driver.riskTierScore),
      tiredScore: displayValue(driver.tiredScore),
    },
    source: {
      dataDate: driver.dataDate || "暂无数据",
    },
    header: {
      title: "风险前哨",
      subtitle: conciseProfileSubtitle(driver),
      chips: headerChipsForDriver(driver, strategies),
    },
    strategies,
    groups: [
      {
        key: "basic",
        title: "基础资料",
        items: [
          profileField(driver, "城市 resident_city_name", ["city"]),
          profileField(driver, "城市等级 city_level", ["cityLevel"]),
          profileField(driver, "公司 company_name", ["company"]),
          profileField(driver, "产品线 product_level2_name", ["product"]),
          profileField(driver, "年龄 age", ["age"]),
          profileField(driver, "是否组织化 is_organized", ["isOrganized"], normalizeBooleanLabel(driver.isOrganized)),
          profileField(driver, "近七天最高排名 risk_tier_rank", ["bestRiskTierRank", "riskTierRank"], driver.bestRiskTierRank || driver.riskTierRank),
        ],
      },
      {
        key: "workload",
        title: "出车/服务指标",
        items: [
          profileField(driver, "连续出车天数 consecutive_days", ["consecutive_days"]),
          profileField(driver, "最高连日出车天数 consecutive_days_max", ["consecutive_days_max"]),
          profileField(driver, "当日在线时长 online_dur_hour", ["online_dur_hour"]),
          profileField(driver, "当日服务时长 server_dur_hour", ["server_dur_hour"]),
          profileField(driver, "近7日非预约单在线时长 lately_7d_except_sub_online_dur_hour", ["lately_7d_except_sub_online_dur_hour"]),
          profileField(driver, "近30天服务时长 server_dur_hour_30d", ["server_dur_hour_30d", "server_dur_sum_30d"]),
          profileField(driver, "近30天在线时长 lately_30d_online_dur_hour", ["lately_30d_online_dur_hour"]),
          profileField(driver, "是否长期连日出车 is_long_consecutive", ["is_long_consecutive"]),
        ],
      },
      {
        key: "fatigue",
        title: "疲劳相关",
        items: [
          profileField(driver, "夜间出车占比 order_cnt_21_09_7d_rate", ["order_cnt_21_09_7d_rate"]),
          profileField(driver, "是否常规夜班司机 is_regular_night", ["is_regular_night"]),
          profileField(driver, "睡眠不足天数 sleep_deprivation_days", ["sleep_deprivation_days"]),
          profileField(driver, "是否睡眠不足 is_sleep_deprived", ["is_sleep_deprived"]),
          profileField(driver, "是否突然累 is_sudden_fatigue", ["is_sudden_fatigue"]),
          profileField(driver, "近7天非听单时段 past_7_day_non_listening_period", ["past_7_day_non_listening_period"]),
          profileField(driver, "疲劳分 tired_score", ["tiredScore", "tired_score"], driver.tiredScore),
          profileField(driver, "近7天最高劳累指数 fatigue_index_7d", ["fatigue_index_7d"]),
          profileField(driver, "最大疲劳风险分 max_improved_tired_risk_score", ["max_improved_tired_risk_score"]),
        ],
      },
      {
        key: "health",
        title: "健康相关",
        items: [
          profileField(driver, "测量高压 high_pressure", ["high_pressure"]),
          profileField(driver, "测量低压 diastolic_bp_measure", ["diastolic_bp_measure", "low_pressure"]),
          profileField(driver, "健康拍高压 systolic_bp_health", ["systolic_bp_health"]),
          profileField(driver, "身体基础系数 body_base_coeff", ["body_base_coeff"]),
          profileField(driver, "身体风险因子 body_risk_factor", ["body_risk_factor"]),
          profileField(driver, "血糖风险值 hyperglycemia_value", ["hyperglycemia_value"]),
          profileField(driver, "血脂风险值 hyperlipidemia_value", ["hyperlipidemia_value"]),
          profileField(driver, "整体血压风险 bp_risk_overall", ["bp_risk_overall"]),
          profileField(driver, "是否高血压 is_hypertension_flag", ["is_hypertension_flag"]),
          profileField(driver, "自评高血压 self_high_bp", ["self_high_bp"]),
          profileField(driver, "自评高血糖 self_high_blood_sugar", ["self_high_blood_sugar"]),
          profileField(driver, "自评高血脂 self_high_blood_lipid", ["self_high_blood_lipid"]),
        ],
      },
    ],
  };
}

function renderSourceMeta(profile) {
  const source = profile.source || {};
  const meta = profile.meta || {};
  const dataDate = source.dataDate || meta.dt || "暂无数据";
  const generatedAt =
    source.generatedAt || meta.generatedAt || resolveStaticGeneratedAt(staticManifest, staticMeta) || "暂无数据";
  return `
    <section class="source-meta" aria-label="数据来源">
      <span>原始模型排名命中日期：${escapeHtml(dataDate)}</span>
      <span>近七天最高排名：${escapeHtml(meta.bestRiskTierRank || meta.riskTierRank || "暂无数据")}</span>
      <span>快照生成：${escapeHtml(generatedAt)}</span>
    </section>`;
}

function renderProfile(profile) {
  profileEl.innerHTML = `
    <div class="profile-workspace">
      <section class="profile-main-column">
        <header class="profile-header">
          <div class="profile-top profile-title">
            <div>
              <div class="profile-id-row">
                <div class="profile-avatar">${escapeHtml(profileAvatarLabel())}</div>
                <div>
                  <p class="profile-kicker">${escapeHtml(profile.header.title)} · ${escapeHtml(profile.meta.dataDate || profile.source?.dataDate || "暂无日期")} 快照</p>
                  <h2 class="profile-id">司机ID ${escapeHtml(profile.driverId)}</h2>
                  <p class="profile-sub">${escapeHtml(profile.header.subtitle || "")}</p>
                </div>
              </div>
              ${renderHeaderChips(profile.header.chips)}
            </div>
            <div class="risk-box"><span class="label">近七天最高排名</span><b class="value">${escapeHtml(profile.meta.bestRiskTierRank || profile.meta.riskTierRank || "暂无数据")}</b></div>
          </div>
          ${renderSourceMeta(profile)}
        </header>
        ${renderSectionTitle(1, "综合画像")}
        <section class="summary">
          <p>${escapeHtml(profile.summary)}</p>
        </section>
        ${renderSectionTitle(2, "话术指导")}
        ${renderSpeechTemplates(Array.isArray(profile.strategies) ? profile.strategies : [])}
      </section>
      <aside class="strategy-side-column">
        ${renderSectionTitle(3, "建议策略")}
        ${renderStrategies(Array.isArray(profile.strategies) ? profile.strategies : [])}
      </aside>
    </div>
  `;
  stateBox.classList.add("hidden");
  stateBox.classList.remove("empty-state");
  profileEl.classList.remove("hidden");
  profileEl.dataset.driverKey = `${profile.driverId || ""}::${profile.meta?.dataDate || profile.source?.dataDate || ""}`;
  listEl.querySelectorAll(".driver-card").forEach((item) => item.classList.remove("active"));
  const active = listEl.querySelector(
    `.driver-card[data-driver-key="${CSS.escape(profileEl.dataset.driverKey)}"]`,
  );
  active?.classList.add("active");
  logLocalAudit("view", {
    driverId: profile.driverId,
    dataDate: profile.meta?.dataDate || profile.source?.dataDate || "",
    filtersSummary: filtersSummary(),
  });
}

function findBestDriver(driverId, dt = "") {
  const matches = allDrivers.filter((driver) => {
    if (String(driver.driverId) !== String(driverId)) {
      return false;
    }
    return !dt || normalizedDate(driver.dataDate) === dt;
  });
  return matches[0] || null;
}

async function loadProfile(driverOrId, dt = "") {
  let driver = typeof driverOrId === "object" ? driverOrId : findBestDriver(driverOrId, dt);
  const driverId = typeof driverOrId === "object" ? driverOrId.driverId : driverOrId;
  if (!driverId || !/^\d+$/.test(String(driverId))) {
    showState("请输入纯数字司机ID。");
    return;
  }
  if (!driver) {
    showState("未找到该司机。请确认静态快照中包含该司机ID。");
    return;
  }
  showState("正在打开静态司机档案...");
  try {
    if (driver.filterIndex && driver.dataDate) {
      const taskId = startLoadTask(12, "正在定位该司机的详细画像...");
      const directDriver = await findDirectDriverLocation(driver.driverId);
      if (taskId !== loadTaskId) {
        return;
      }
      if (getDateFilter() && directDriver?.dataDate !== driver.dataDate) {
        updateLoadProgress(24, "正在读取所选日期的详细画像...", taskId);
        await ensureDriversForDate(driver.dataDate, {
          onProgress: (percent, loaded, total) => {
            const sizeText = total > 0
              ? `（${(loaded / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB）`
              : "";
            updateLoadProgress(24 + percent * 0.68, `正在读取所选日期的详细画像${sizeText}`, taskId);
          },
        });
        if (taskId !== loadTaskId) return;
        driver = (loadedDriversByDate.get(driver.dataDate) || []).find(
          (item) => String(item.driverId) === String(driver.driverId),
        ) || driver;
      } else {
        driver = directDriver || driver;
      }
      hideLoadProgress(taskId);
    }
    renderProfile(resolveStaticProfile(driver));
  } catch (error) {
    showState(error.message);
  }
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(rows) {
  const exportedAt = formatLocalTimestamp();
  const filterText = filtersSummary();
  const lines = [
    `# 导出时间: ${exportedAt}`,
    `# 筛选条件: ${filterText}`,
    `# 记录数: ${rows.length}`,
    `# 静态站点生成时间: ${resolveStaticGeneratedAt(staticManifest, staticMeta) || "暂无数据"}`,
    ["司机id", "综合画像"].map(csvCell).join(","),
    ...rows.map((driver) => [driver.driverId, driver.summary || buildSummaryForDriver(driver)].map(csvCell).join(",")),
  ];
  const blob = new Blob([`\ufeff${lines.join("\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `风险前哨_筛选结果_${compactTimestamp()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  logLocalAudit("export", {
    rowCount: rows.length,
    filtersSummary: filterText,
  });
}

async function downloadCurrentFilter() {
  if (!staticDataReady) {
    showState("静态数据仍在加载中，请稍后再下载筛选名单。");
    return;
  }
  const tokenMessage = syncTypedTokenInputs();
  if (tokenMessage) {
    showState(tokenMessage);
    renderList([]);
    return;
  }
  const filters = currentFilters();
  if (!hasAnyFilter(filters)) {
    showState("请先输入司机ID，或选择城市、公司、产品线、排名范围后再下载筛选名单。");
    renderList([]);
    return;
  }
  const taskId = startLoadTask(4, "正在准备导出名单...");
  const rows = await filteredDriversForQuery(filters, { limit: 0 });
  if (!rows || taskId !== loadTaskId) {
    return;
  }
  if (!rows.length) {
    showState("当前条件没有可导出的司机。");
    hideLoadProgress(taskId);
    return;
  }
  downloadCsv(rows);
  hideLoadProgress(taskId);
}

searchButton.addEventListener("click", async () => {
  if (!staticDataReady) {
    showState("静态数据仍在加载中，请稍后再查询。");
    return;
  }
  const tokenMessage = syncTypedTokenInputs();
  if (tokenMessage) {
    showState(tokenMessage);
    renderList([]);
    return;
  }
  const filters = currentFilters();
  if (!hasAnyFilter(filters)) {
    showState("请先输入司机ID，或选择城市、公司、产品线、排名范围。");
    renderList([]);
    return;
  }
  const taskId = startLoadTask(4, "正在准备查询...");
  if (hasDirectSearchOnly(filters)) {
    try {
      await runDirectDriverSearch(filters.driver_id, filters.dt);
    } catch (error) {
      showState(`司机快照读取失败：${error.message}`);
      hideLoadProgress(taskId);
    }
    return;
  }
  let rows;
  if (/^\d{6,}$/.test(filters.driver_id)) {
    rows = await filteredDriversForQuery(filters);
    if (!rows || taskId !== loadTaskId) return;
    applyFilterResults(rows);
    hideLoadProgress(taskId);
    return;
  }
  rows = await filteredDriversForQuery(filters);
  if (!rows || taskId !== loadTaskId) return;
  applyFilterResults(rows);
  hideLoadProgress(taskId);
});

driverIdInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    searchButton.click();
  }
});

listEl.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) {
    return;
  }
  const cards = Array.from(listEl.querySelectorAll(".driver-card"));
  const currentIndex = cards.indexOf(event.target.closest(".driver-card"));
  if (currentIndex < 0) {
    return;
  }
  event.preventDefault();
  const offset = event.key === "ArrowDown" ? 1 : -1;
  const next = cards[Math.max(0, Math.min(cards.length - 1, currentIndex + offset))];
  next?.focus();
});

document.addEventListener("keydown", (event) => {
  const tagName = event.target?.tagName?.toLowerCase();
  const isTyping = ["input", "textarea", "select"].includes(tagName) || event.target?.isContentEditable;
  if (event.key === "/" && !isTyping) {
    event.preventDefault();
    driverIdInput.focus();
  }
  if (event.key === "Escape") {
    document.querySelectorAll(".token-picker.open").forEach((picker) => picker.classList.remove("open"));
  }
});

profileEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-copy-strategy]");
  if (button && profileEl.contains(button)) {
    copyStrategySpeech(button);
  }
});

advancedFilterInputs.forEach((input) => input.addEventListener("input", updateAdvancedCount));
isOrganizedSelect?.addEventListener("change", updateAdvancedCount);
updateAdvancedCount();

resetButton.addEventListener("click", () => {
  driverIdInput.value = "";
  selectedCities.clear();
  selectedCompanies.clear();
  selectedProducts.clear();
  renderTokenPicker({
    containerEl: citySelect,
    options: allCities,
    selectedSet: selectedCities,
    placeholder: "搜索城市，点击加入",
    emptyText: "没有匹配城市",
    defaultOptions: cityDefaultOptions(allCities),
  });
  renderTokenPicker({
    containerEl: companySelect,
    options: allCompanies,
    selectedSet: selectedCompanies,
    placeholder: "输入公司关键词，点击加入",
    emptyText: "输入公司关键词后选择",
    defaultOptions: [],
  });
  renderTokenPicker({
    containerEl: productSelect,
    options: allProducts,
    selectedSet: selectedProducts,
    placeholder: "输入产品线关键词，点击加入",
    emptyText: "没有匹配产品线",
    defaultOptions: allProducts,
  });
  setDateFilter("");
  renderDatePicker([], getDateFilter());
  resetAdvancedFilters();
  userHasRenderedResults = false;
  renderList([]);
  showState("请选择或输入一个司机ID。");
});

exportButton.addEventListener("click", () => {
  downloadCurrentFilter();
});

dateSelect?.addEventListener("date-filter-change", async () => {
  if (!staticDataReady) {
    return;
  }
  if (!userHasRenderedResults) {
    return;
  }
  const taskId = startLoadTask(4, "正在切换数据日期...");
  const rows = await filteredDriversForQuery(currentFilters());
  if (!rows || taskId !== loadTaskId) return;
  applyFilterResults(rows);
  hideLoadProgress(taskId);
});

snapshotButton?.addEventListener("click", () => {
  showState(
    "当前页面为CDN稳定静态版：首页先读取 drivers.json 日期索引、筛选项和 manifest；司机数据按日保存在独立 daily/drivers-YYYY-MM-DD.json 中，查询时按近7天窗口去重并保留最高排名记录。",
  );
});

loadStaticData()
  .then(() => {
    if (!userHasRenderedResults) {
      renderList([], { markUserAction: false });
    }
  })
  .catch((error) => showState(error.message));
