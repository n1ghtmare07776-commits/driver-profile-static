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
const loadedDriversByDate = new Map();
let currentListRows = [];
let renderedListCount = 0;
let staticDataReady = false;
let userHasRenderedResults = false;
const tokenPickers = [];
const listPageSize = 50;

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
  stateBox.textContent = message;
  stateBox.classList.remove("hidden");
  profileEl.classList.add("hidden");
}

function setActionsEnabled(enabled) {
  searchButton.disabled = !enabled;
  exportButton.disabled = !enabled;
}

function updateLoadProgress(percent, message) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  if (loadProgressBar) {
    loadProgressBar.style.width = `${safePercent}%`;
  }
  if (loadProgressText) {
    loadProgressText.textContent = message || `读取静态数据 ${Math.round(safePercent)}%`;
  }
}

function hideLoadProgress() {
  updateLoadProgress(100, dailyDataLoadedMessage());
  window.setTimeout(() => loadProgress?.classList.add("hidden"), 500);
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
    request.setRequestHeader("Cache-Control", "no-store");
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
        onProgress?.(96, request.responseText.length, request.responseText.length);
        resolve(JSON.parse(request.responseText));
      } catch (error) {
        reject(new Error(`静态数据解析失败：${url}`));
      }
    };
    request.onerror = () => reject(new Error(`静态数据读取失败：${url}`));
    request.send();
  });
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
  updateLoadProgress(4, "正在读取司机静态数据...");
  return fetchJsonWithProgress("data/drivers.json", (percent, loaded, total) => {
    if (total > 0) {
      const loadedMb = loaded / 1024 / 1024;
      const totalMb = total / 1024 / 1024;
      updateLoadProgress(percent, `读取司机静态数据 ${Math.round(percent)}%（${loadedMb.toFixed(1)} / ${totalMb.toFixed(1)} MB）`);
    } else {
      updateLoadProgress(percent, "正在读取司机静态数据...");
    }
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

function resolveStaticProfile(driver, ruleIndex = strategyRuleIndex) {
  if (driver?.profile) {
    return driver.profile;
  }
  return buildProfileFromDriver(driver, ruleIndex);
}

async function loadStaticData() {
  setActionsEnabled(false);
  updateLoadProgress(2, "正在读取静态快照元信息...");
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
  const availableDates = Array.isArray(options.dates) ? options.dates : [];
  const latestDate = driverDataIndex?.latestDate || availableDates[availableDates.length - 1] || "";
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
  if (latestDate) {
    await ensureDriversForDate(latestDate);
  }
  staticDataReady = true;
  setActionsEnabled(true);
  hideLoadProgress();
}

function dailyFileForDate(dataDate) {
  const file = (driverDataIndex?.files || []).find((item) => item.date === dataDate);
  return file?.path || `daily/drivers-${dataDate}.json`;
}

async function ensureDriversForDate(dataDate) {
  if (!driverDataIndex || !dataDate) {
    return;
  }
  if (loadedDriversByDate.has(dataDate)) {
    allDrivers = loadedDriversByDate.get(dataDate);
    return;
  }
  const filePath = dailyFileForDate(dataDate);
  updateLoadProgress(8, loadingDailyDataMessage());
  loadProgress?.classList.remove("hidden");
  const payload = await fetchJsonWithProgress(`data/${filePath}`, (percent, loaded, total) => {
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
  updateLoadProgress(100, dailyDataLoadedMessage());
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
  return Array.from(bestByDriver.values());
}

async function ensureDriversForFilters(filters) {
  if (!driverDataIndex) {
    return;
  }
  const dates = driverDataIndex.dates || [];
  const all = [];
  for (const dataDate of dates) {
    await ensureDriversForDate(dataDate);
    appendDriverRows(all, loadedDriversByDate.get(dataDate) || []);
  }
  allDrivers = deduplicateBestRankedDrivers(all);
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
    .sort((left, right) => {
      return rankNumber(left.bestRiskTierRank || left.riskTierRank) -
        rankNumber(right.bestRiskTierRank || right.riskTierRank);
    })
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
    const item = document.createElement("button");
    item.className = `driver-card${driverKey(driver) === activeKey ? " active" : ""}`;
    item.dataset.driverKey = driverKey(driver);
    item.innerHTML = `<strong>${escapeHtml(driver.driverId)}</strong><span>${escapeHtml(driver.subtitle)}<br/>近七天最高排名 ${escapeHtml(displayValue(driver.bestRiskTierRank || driver.riskTierRank))} · 风险分 ${escapeHtml(driver.riskTierScore)} · 疲劳分 ${escapeHtml(driver.tiredScore)}</span>`;
    item.addEventListener("click", () => loadProfile(driver));
    listEl.appendChild(item);
  });
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
    empty.textContent = "输入司机ID，或选择城市、公司、产品线、排名范围后显示匹配结果。";
    listEl.appendChild(empty);
    return;
  }
  const summary = document.createElement("div");
  summary.className = "list-summary";
  summary.textContent = `匹配 ${drivers.length} 位司机，当前显示 ${Math.min(listPageSize, drivers.length)} 位`;
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
    summary.textContent = `匹配 ${currentListRows.length} 位司机，当前显示 ${renderedListCount} 位`;
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
  renderList(rows);
  if (!rows.length) {
    showState("当前条件没有匹配司机。");
    return;
  }
  try {
    loadProfile(rows[0]);
  } catch (error) {
    showState(`已匹配 ${rows.length} 位司机，但打开第一位画像失败：${error.message}`);
  }
}

function renderFieldList(items) {
  return `<div class="field-list">${items
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
    priority: 999,
  };
  return { rules, fallback };
}

function replaceTemplate(template = "", context = {}) {
  return String(template).replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) =>
    context[key] === undefined || context[key] === null ? "" : String(context[key]),
  );
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
  const thresholdOperator = firstCondition.threshold?.operator || rule.threshold?.operator || ">";
  const context = {
    driver_value: formatMetricValue(firstEvidence.driverValue),
    threshold_value: formatMetricValue(firstEvidence.thresholdValue),
    threshold_relation: thresholdRelationLabel(thresholdOperator),
    unit: firstCondition.unit || rule.unit || "",
    driver_metric_label: firstCondition.driver_metric_label || rule.driver_metric_label || "",
    matched_evidence: matchedEvidence || "暂无可展示依据",
    data_date: driver.dataDate || "",
  };
  return {
    key,
    title: rule.title || key,
    category: rule.category || "",
    priority: rule.priority || 999,
    priority_tier: rule.priority_tier || "",
    badges: Array.isArray(rule.badges) ? rule.badges : [],
    evidence: replaceTemplate(rule.evidence_template || "{{matched_evidence}}。", context),
    advice: replaceTemplate(rule.advice_template || "可做常规状态确认，保持关怀式沟通。", context),
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
  const base = [
    `${displayValue(driver.age)}岁`,
    displayValue(driver.city),
    displayValue(driver.product),
    displayValue(driver.company),
    `连续出车${displayValue(driver.consecutive_days)}天`,
    `当日服务${displayValue(driver.server_dur_hour)}小时`,
    `夜间出车占比${displayValue(driver.order_cnt_21_09_7d_rate)}`,
    `睡眠不足${displayValue(driver.sleep_deprivation_days)}天`,
    `数据日期${displayValue(driver.dataDate)}`,
  ].join("，");
  const titles = strategies
    .filter((strategy) => strategy.key !== "regular-care")
    .map((strategy) => strategy.title)
    .filter(Boolean)
    .slice(0, 6);
  return `${base}。${titles.length ? ` 重点关注：${titles.join("、")}。` : ""}`;
}

function renderStrategies(strategies = []) {
  const items = strategies.length
    ? strategies
    : [
        {
          title: "常规关怀",
          evidence: "当前没有策略指标超过配置阈值，或策略计算结果暂不可用。",
          advice: "可做常规状态确认，提醒司机保持安全驾驶、合理休息和规律作息。",
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
  return `<section class="strategy-list">${items
    .map(
      (strategy) => `
        <article class="strategy-card">
          <div class="strategy-card-heading">
            <h3>${escapeHtml(strategy.title || "常规关怀")}</h3>
            ${renderBadges(strategy.badges)}
          </div>
          <dl>
            <dt>依据</dt>
            <dd>${escapeHtml(strategy.evidence || strategy.reason || "暂无可展示依据")}</dd>
            <dt>建议</dt>
            <dd>${escapeHtml(strategy.advice || "可做常规状态确认，保持关怀式沟通。")}</dd>
          </dl>
        </article>`,
    )
    .join("")}</section>`;
}

function field(label, value) {
  return { displayLabel: label, displayValue: displayValue(value) };
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
      syncStatus: "静态快照",
    },
    header: {
      title: "司机画像",
      chips: headerChipsForDriver(driver, strategies),
    },
    strategies,
    groups: [
      {
        key: "basic",
        title: "基础资料",
        items: [
          field("城市 resident_city_name", driver.city),
          field("城市等级 city_level", driver.cityLevel),
          field("公司 company_name", driver.company),
          field("产品线 product_level2_name", driver.product),
          field("年龄 age", driver.age),
          field("是否组织化 is_organized", normalizeBooleanLabel(driver.isOrganized)),
        ],
      },
      {
        key: "workload",
        title: "出车/服务指标",
        items: [
          field("连续出车天数 consecutive_days", driver.consecutive_days),
          field("最高连日出车天数 consecutive_days_max", driver.consecutive_days_max),
          field("当日在线时长 online_dur_hour", driver.online_dur_hour),
          field("当日服务时长 server_dur_hour", driver.server_dur_hour),
          field("近7日非预约单在线时长 lately_7d_except_sub_online_dur_hour", driver.lately_7d_except_sub_online_dur_hour),
          field("近30天服务时长 server_dur_hour_30d", driver.server_dur_hour_30d || driver.server_dur_sum_30d),
          field("近30天在线时长 lately_30d_online_dur_hour", driver.lately_30d_online_dur_hour),
          field("是否长期连日出车 is_long_consecutive", driver.is_long_consecutive),
        ],
      },
      {
        key: "fatigue",
        title: "疲劳相关",
        items: [
          field("夜间出车占比 order_cnt_21_09_7d_rate", driver.order_cnt_21_09_7d_rate),
          field("是否常规夜班司机 is_regular_night", driver.is_regular_night),
          field("睡眠不足天数 sleep_deprivation_days", driver.sleep_deprivation_days),
          field("是否睡眠不足 is_sleep_deprived", driver.is_sleep_deprived),
          field("是否突然累 is_sudden_fatigue", driver.is_sudden_fatigue),
          field("近7天非听单时段 past_7_day_non_listening_period", driver.past_7_day_non_listening_period),
          field("疲劳分 tired_score", driver.tiredScore),
          field("近7天最高劳累指数 fatigue_index_7d", driver.fatigue_index_7d),
          field("最大疲劳风险分 max_improved_tired_risk_score", driver.max_improved_tired_risk_score),
        ],
      },
      {
        key: "health",
        title: "健康相关",
        items: [
          field("测量高压 high_pressure", driver.high_pressure),
          field("测量低压 diastolic_bp_measure", driver.diastolic_bp_measure || driver.low_pressure),
          field("健康拍高压 systolic_bp_health", driver.systolic_bp_health),
          field("身体基础系数 body_base_coeff", driver.body_base_coeff),
          field("身体风险因子 body_risk_factor", driver.body_risk_factor),
          field("血糖风险值 hyperglycemia_value", driver.hyperglycemia_value),
          field("血脂风险值 hyperlipidemia_value", driver.hyperlipidemia_value),
          field("整体血压风险 bp_risk_overall", driver.bp_risk_overall),
          field("是否高血压 is_hypertension_flag", driver.is_hypertension_flag),
          field("自评高血压 self_high_bp", driver.self_high_bp),
          field("自评高血糖 self_high_blood_sugar", driver.self_high_blood_sugar),
          field("自评高血脂 self_high_blood_lipid", driver.self_high_blood_lipid),
        ],
      },
    ],
  };
}

function renderSourceMeta(profile) {
  const source = profile.source || {};
  const meta = profile.meta || {};
  const dataDate = source.dataDate || meta.dt || "暂无数据";
  const syncStatus = source.syncStatus || meta.syncStatus || "静态快照";
  const generatedAt =
    source.generatedAt || meta.generatedAt || resolveStaticGeneratedAt(staticManifest, staticMeta) || "暂无数据";
  return `
    <section class="source-meta" aria-label="数据来源">
      <span>最高排名命中日期：${escapeHtml(dataDate)}</span>
      <span>同步状态：${escapeHtml(syncStatus)}</span>
      <span>快照生成：${escapeHtml(generatedAt)}</span>
    </section>`;
}

function renderProfile(profile) {
  profileEl.innerHTML = `
    <header class="profile-header">
      <div class="profile-title">
        <div>
          <span class="section-kicker">${escapeHtml(profile.header.title)}</span>
          <h2>司机ID ${escapeHtml(profile.driverId)}</h2>
          ${renderHeaderChips(profile.header.chips)}
        </div>
        <div class="risk-box"><span>近七天最高排名</span><b>${escapeHtml(profile.meta.bestRiskTierRank || profile.meta.riskTierRank)}</b></div>
      </div>
      ${renderSourceMeta(profile)}
    </header>
    ${renderSectionTitle(1, "综合画像")}
    <section class="summary">
      <p>${escapeHtml(profile.summary)}</p>
    </section>
    ${renderSectionTitle(2, "建议策略")}
    ${renderStrategies(Array.isArray(profile.strategies) ? profile.strategies : [])}
    ${renderSectionTitle(3, "司机资料")}
    <section class="cards-grid">
      ${profile.groups
        .filter((group) => group.key !== "summary")
        .map(
          (group) => `
        <article class="info-card">
          <h3>${escapeHtml(group.title)}</h3>
          ${renderFieldList(group.items)}
        </article>`,
        )
        .join("")}
    </section>
  `;
  stateBox.classList.add("hidden");
  profileEl.classList.remove("hidden");
  profileEl.dataset.driverKey = `${profile.driverId || ""}::${profile.meta?.dataDate || profile.source?.dataDate || ""}`;
  listEl.querySelectorAll(".driver-card").forEach((item) => item.classList.remove("active"));
  const active = listEl.querySelector(
    `.driver-card[data-driver-key="${CSS.escape(profileEl.dataset.driverKey)}"]`,
  );
  active?.classList.add("active");
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
  const driver = typeof driverOrId === "object" ? driverOrId : findBestDriver(driverOrId, dt);
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
  const lines = [
    ["司机id", "综合画像"].map(csvCell).join(","),
    ...rows.map((driver) => [driver.driverId, driver.summary || buildSummaryForDriver(driver)].map(csvCell).join(",")),
  ];
  const blob = new Blob([`\ufeff${lines.join("\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "司机画像_筛选结果.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
  await ensureDriversForFilters(filters);
  const rows = filteredDrivers(filters, allDrivers.length);
  if (!rows.length) {
    showState("当前条件没有可导出的司机。");
    return;
  }
  applyFilterResults(rows);
  downloadCsv(rows);
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
  await ensureDriversForFilters(filters);
  if (/^\d{6,}$/.test(filters.driver_id)) {
    const rows = filteredDrivers(filters, allDrivers.length);
    applyFilterResults(rows);
    return;
  }
  const rows = filteredDrivers(filters, allDrivers.length);
  applyFilterResults(rows);
});

driverIdInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    searchButton.click();
  }
});

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
  await ensureDriversForFilters(currentFilters());
  if (!userHasRenderedResults) {
    return;
  }
  loadList();
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
