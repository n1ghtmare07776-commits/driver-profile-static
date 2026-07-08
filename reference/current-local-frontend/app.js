const stateBox = document.querySelector("#stateBox");
const profileEl = document.querySelector("#profile");
const listEl = document.querySelector("#driverList");
const metaText = document.querySelector("#metaText");
const driverIdInput = document.querySelector("#driverIdInput");
const citySelect = document.querySelector("#citySelect");
const companySelect = document.querySelector("#companySelect");
const productSelect = document.querySelector("#productSelect");
const dateSelect = document.querySelector("#dateSelect");
const advancedFilterInputs = Array.from(
  document.querySelectorAll("#advancedFilters input"),
);
const searchButton = document.querySelector("#searchButton");
const resetButton = document.querySelector("#resetButton");
const exportButton = document.querySelector("#exportButton");
const reimportButton = document.querySelector("#reimportButton");
const selectedCities = new Set();
const selectedCompanies = new Set();
const selectedProducts = new Set();
let allCities = [];
let allCompanies = [];
let allProducts = [];

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

function valueText(item) {
  return item?.displayValue ?? "暂无数据";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.error || "请求失败");
  }
  return data;
}

async function loadMeta() {
  const meta = await fetchJson("/api/meta");
  const dates = Array.isArray(meta.data_dates) ? meta.data_dates.join(", ") : "暂无日期";
  metaText.textContent = `${meta.row_count || 0}位司机 · ${dates}`;
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

async function loadFilterOptions() {
  const data = await fetchJson("/api/filter-options");
  allCities = sortByPinyin(Array.isArray(data.cities) ? data.cities : []);
  allCompanies = sortByPinyin(Array.isArray(data.companies) ? data.companies : []);
  allProducts = sortByPinyin(Array.isArray(data.products) ? data.products : []);
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
  appendOptions(dateSelect, Array.isArray(data.dates) ? data.dates : [], "全部日期");
}

function currentFilters() {
  return {
    driver_id: driverIdInput.value.trim(),
    city: Array.from(selectedCities),
    company: Array.from(selectedCompanies),
    product: Array.from(selectedProducts),
    dt: dateSelect.value,
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
}

function hasAnyFilter(filters) {
  return Object.values(filters).some((value) => (Array.isArray(value) ? value.length : value));
}

function filterParams(filters = currentFilters()) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    } else if (value) {
      params.set(key, value);
    }
  });
  return params;
}

function renderList(drivers) {
  listEl.innerHTML = "";
  if (!drivers.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = "输入司机ID，或选择城市、公司、产品线、日期后显示匹配结果。";
    listEl.appendChild(empty);
    return;
  }
  drivers.forEach((driver) => {
    const item = document.createElement("button");
    item.className = "driver-card";
    item.innerHTML = `<strong>${escapeHtml(driver.driverId)}</strong><span>${escapeHtml(driver.subtitle)}<br/>风险分 ${escapeHtml(driver.riskTierScore)} · 疲劳分 ${escapeHtml(driver.tiredScore)}</span>`;
    item.addEventListener("click", () => loadProfile(driver.driverId, driver.dataDate));
    listEl.appendChild(item);
  });
}

async function loadList(filters = currentFilters()) {
  const params = filterParams(filters);
  params.set("limit", "50");
  const data = await fetchJson(`/api/drivers?${params.toString()}`);
  renderList(data.drivers);
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

function renderProfile(profile) {
  profileEl.innerHTML = `
    <header class="profile-header">
      <div class="profile-title">
        <div>
          <span class="section-kicker">${escapeHtml(profile.header.title)}</span>
          <h2>司机ID ${escapeHtml(profile.driverId)}</h2>
          ${renderHeaderChips(profile.header.chips)}
        </div>
        <div class="risk-box"><span>分数排名</span><b>${escapeHtml(profile.meta.riskTierRank)}</b></div>
      </div>
    </header>
    ${renderSectionTitle(1, "综合画像")}
    <section class="summary">
      <p>${escapeHtml(profile.summary)}</p>
    </section>
    ${renderSectionTitle(2, "司机资料")}
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
}

async function loadProfile(driverId, dt = "") {
  if (!driverId || !/^\d+$/.test(driverId)) {
    showState("请输入纯数字司机ID。");
    return;
  }
  showState("正在查询司机档案...");
  try {
    const params = new URLSearchParams();
    if (dt) {
      params.set("dt", dt);
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const profile = await fetchJson(`/api/drivers/${driverId}${suffix}`);
    renderProfile(profile);
  } catch (error) {
    showState(error.message);
  }
}

searchButton.addEventListener("click", () => {
  const filters = currentFilters();
  if (!hasAnyFilter(filters)) {
    showState("请先输入司机ID，或选择城市、公司、产品线、日期。");
    renderList([]);
    return;
  }
  if (/^\d{6,}$/.test(filters.driver_id)) {
    loadProfile(filters.driver_id, filters.dt);
  }
  loadList(filters);
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
  dateSelect.value = "";
  resetAdvancedFilters();
  renderList([]);
  showState("请选择或输入一个司机ID。");
});

function filenameFromDisposition(disposition) {
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition || "");
  if (match) {
    return decodeURIComponent(match[1]);
  }
  return "司机画像_筛选结果.xlsx";
}

async function downloadCurrentFilter() {
  const filters = currentFilters();
  if (!hasAnyFilter(filters)) {
    showState("请先输入司机ID，或选择城市、公司、产品线、日期后再下载筛选名单。");
    renderList([]);
    return;
  }
  exportButton.disabled = true;
  const previousText = exportButton.textContent;
  exportButton.textContent = "生成中...";
  try {
    const params = filterParams(filters);
    const res = await fetch(`/api/drivers/export?${params.toString()}`);
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || "导出失败");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filenameFromDisposition(res.headers.get("Content-Disposition"));
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    showState(error.message);
  } finally {
    exportButton.disabled = false;
    exportButton.textContent = previousText;
  }
}

exportButton.addEventListener("click", () => {
  downloadCurrentFilter();
});

reimportButton.addEventListener("click", async () => {
  showState("正在重建SQLite数据...");
  try {
    await fetchJson("/api/reimport", { method: "POST" });
    await loadMeta();
    await loadFilterOptions();
    renderList([]);
    showState("SQLite数据已重建，请输入或选择司机ID。");
  } catch (error) {
    showState(error.message);
  }
});

Promise.all([loadMeta(), loadFilterOptions()])
  .then(() => renderList([]))
  .catch((error) => showState(error.message));
