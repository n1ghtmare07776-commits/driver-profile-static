let filterPayload = null;
let bestRowIndexes = [];
let dateRowIndexes = new Map();

function dictionaryValue(values = [], index) {
  return Number.isInteger(index) && index >= 0 && index < values.length ? values[index] : "";
}

function schemaIndex(payload) {
  return Object.fromEntries((payload?.schema || []).map((field, index) => [field, index]));
}

function decodeRecord(payload, indexes, row) {
  const dictionary = payload?.dict || {};
  return {
    driverId: String(row[indexes.driverId] || ""),
    city: dictionaryValue(dictionary.cities, row[indexes.city]),
    company: dictionaryValue(dictionary.companies, row[indexes.company]),
    product: dictionaryValue(dictionary.products, row[indexes.product]),
    dataDate: dictionaryValue(dictionary.dates, row[indexes.dataDate]),
    isOrganized: dictionaryValue(dictionary.isOrganized, row[indexes.isOrganized]),
    age: row[indexes.age],
    consecutive_days: row[indexes.consecutive_days],
    server_dur_hour: row[indexes.server_dur_hour],
    avgServiceDuration7d: row[indexes.avgServiceDuration7d],
    serviceDurationSampleDays: row[indexes.serviceDurationSampleDays],
    order_cnt_21_09_7d_rate: row[indexes.order_cnt_21_09_7d_rate],
    sleep_deprivation_days: row[indexes.sleep_deprivation_days],
    riskTierRank: row[indexes.riskTierRank],
    riskTierScore: row[indexes.riskTierScore],
    tiredScore: row[indexes.tiredScore],
    strategyKeys: (Array.isArray(row[indexes.strategyKeys]) ? row[indexes.strategyKeys] : [])
      .map((index) => dictionaryValue(dictionary.strategyKeys, index))
      .filter(Boolean),
  };
}

function decode(payload) {
  const schema = Array.isArray(payload?.schema) ? payload.schema : [];
  const dictionary = payload?.dict || {};
  return { payload, indexes: schemaIndex({ schema }), rows: Array.isArray(payload?.rows) ? payload.rows : [] };
}

function rankNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : Infinity;
}

function scoreNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : -Infinity;
}

function normalizedDate(value) {
  return String(value || "").split(" ")[0];
}

function numberBound(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanLabel(value) {
  const text = String(value ?? "").trim();
  if (["1", "true", "是", "Y", "y", "yes", "Yes", "TRUE"].includes(text)) return "是";
  if (["0", "false", "否", "N", "n", "no", "No", "FALSE"].includes(text)) return "否";
  return text;
}

function matches(driver, filters) {
  if (filters.driver_id && !driver.driverId.includes(filters.driver_id)) return false;
  if (filters.city?.length && !filters.city.includes(driver.city)) return false;
  if (filters.company?.length && !filters.company.includes(driver.company)) return false;
  if (filters.product?.length && !filters.product.includes(driver.product)) return false;
  if (filters.dt && normalizedDate(driver.dataDate) !== filters.dt) return false;
  if (filters.is_organized && booleanLabel(driver.isOrganized) !== filters.is_organized) return false;
  for (const field of ["bestRiskTierRank", "age", "consecutive_days", "server_dur_hour", "order_cnt_21_09_7d_rate", "sleep_deprivation_days"]) {
    const min = numberBound(filters[`${field}_min`]);
    const max = numberBound(filters[`${field}_max`]);
    if (min === null && max === null) continue;
    const value = numberBound(field === "bestRiskTierRank" ? driver.riskTierRank : driver[field]);
    if (value === null || (min !== null && value < min) || (max !== null && value > max)) return false;
  }
  return true;
}

function matchesRow(row, filters) {
  const indexes = filterPayload.indexes;
  const dictionary = filterPayload.payload.dict || {};
  const driverId = String(row[indexes.driverId] || "");
  if (filters.driver_id && !driverId.includes(filters.driver_id)) return false;
  if (filters.city?.length && !filters.city.includes(dictionaryValue(dictionary.cities, row[indexes.city]))) return false;
  if (filters.company?.length && !filters.company.includes(dictionaryValue(dictionary.companies, row[indexes.company]))) return false;
  if (filters.product?.length && !filters.product.includes(dictionaryValue(dictionary.products, row[indexes.product]))) return false;
  if (filters.is_organized && booleanLabel(dictionaryValue(dictionary.isOrganized, row[indexes.isOrganized])) !== filters.is_organized) return false;
  const numericFields = {
    bestRiskTierRank: "riskTierRank",
    age: "age",
    consecutive_days: "consecutive_days",
    server_dur_hour: "server_dur_hour",
    order_cnt_21_09_7d_rate: "order_cnt_21_09_7d_rate",
    sleep_deprivation_days: "sleep_deprivation_days",
  };
  for (const [filterField, rowField] of Object.entries(numericFields)) {
    const min = numberBound(filters[`${filterField}_min`]);
    const max = numberBound(filters[`${filterField}_max`]);
    if (min === null && max === null) continue;
    const value = numberBound(row[indexes[rowField]]);
    if (value === null || (min !== null && value < min) || (max !== null && value > max)) return false;
  }
  return true;
}

function buildBestRowIndexes(payload, indexes, rows) {
  const bestByDriver = new Map();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const driverId = String(row[indexes.driverId] || "");
    if (!driverId) continue;
    const currentIndex = bestByDriver.get(driverId);
    if (currentIndex === undefined) {
      bestByDriver.set(driverId, rowIndex);
      continue;
    }
    const existing = rows[currentIndex];
    const currentRank = rankNumber(row[indexes.riskTierRank]);
    const existingRank = rankNumber(existing[indexes.riskTierRank]);
    const currentDate = dictionaryValue(payload.dict?.dates, row[indexes.dataDate]);
    const existingDate = dictionaryValue(payload.dict?.dates, existing[indexes.dataDate]);
    if (currentRank < existingRank || (currentRank === existingRank && currentDate > existingDate)) {
      bestByDriver.set(driverId, rowIndex);
    }
  }
  return [...bestByDriver.values()];
}

function compare(left, right) {
  return rankNumber(left.bestRiskTierRank || left.riskTierRank) - rankNumber(right.bestRiskTierRank || right.riskTierRank)
    || scoreNumber(right.tiredScore) - scoreNumber(left.tiredScore)
    || scoreNumber(right.riskTierScore) - scoreNumber(left.riskTierScore)
    || normalizedDate(right.dataDate).localeCompare(normalizedDate(left.dataDate))
    || left.driverId.localeCompare(right.driverId, "zh-Hans-CN", { numeric: true });
}

function compareRowIndexes(leftIndex, rightIndex) {
  const left = filterPayload.rows[leftIndex];
  const right = filterPayload.rows[rightIndex];
  const indexes = filterPayload.indexes;
  const dictionary = filterPayload.payload.dict || {};
  return rankNumber(left[indexes.riskTierRank]) - rankNumber(right[indexes.riskTierRank])
    || scoreNumber(right[indexes.tiredScore]) - scoreNumber(left[indexes.tiredScore])
    || scoreNumber(right[indexes.riskTierScore]) - scoreNumber(left[indexes.riskTierScore])
    || dictionaryValue(dictionary.dates, right[indexes.dataDate]).localeCompare(
      dictionaryValue(dictionary.dates, left[indexes.dataDate]),
    )
    || String(left[indexes.driverId] || "").localeCompare(
      String(right[indexes.driverId] || ""),
      "zh-Hans-CN",
      { numeric: true },
    );
}

function pushTopIndex(heap, rowIndex, limit) {
  if (!limit) {
    heap.push(rowIndex);
    return;
  }
  if (heap.length < limit) {
    heap.push(rowIndex);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareRowIndexes(heap[parent], heap[index]) >= 0) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
    return;
  }
  if (compareRowIndexes(rowIndex, heap[0]) >= 0) return;
  heap[0] = rowIndex;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let worse = index;
    if (left < heap.length && compareRowIndexes(heap[left], heap[worse]) > 0) worse = left;
    if (right < heap.length && compareRowIndexes(heap[right], heap[worse]) > 0) worse = right;
    if (worse === index) break;
    [heap[index], heap[worse]] = [heap[worse], heap[index]];
    index = worse;
  }
}

function buildDateRowIndexes() {
  const grouped = new Map();
  for (let index = 0; index < filterPayload.rows.length; index += 1) {
    const row = filterPayload.rows[index];
    const date = dictionaryValue(filterPayload.payload.dict?.dates, row[filterPayload.indexes.dataDate]);
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date).push(index);
  }
  return grouped;
}

function deduplicate(rows) {
  const best = new Map();
  for (const driver of rows) {
    const existing = best.get(driver.driverId);
    if (!existing || rankNumber(driver.riskTierRank) < rankNumber(existing.riskTierRank)
      || (rankNumber(driver.riskTierRank) === rankNumber(existing.riskTierRank)
        && normalizedDate(driver.dataDate) > normalizedDate(existing.dataDate))) {
      best.set(driver.driverId, { ...driver, bestRiskTierRank: driver.riskTierRank });
    }
  }
  return [...best.values()];
}

self.onmessage = async (event) => {
  const { type, payload, url, filters, requestId, limit } = event.data || {};
  if (type === "init") {
    try {
      const source = payload || await fetch(url, { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error(`筛选索引读取失败：${response.status}`);
        if (typeof DecompressionStream !== "function") {
          throw new Error("当前浏览器不支持筛选索引解压，请升级浏览器");
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
          self.postMessage({
            type: "startup-progress",
            percent: total ? 8 + (loaded / total) * 42 : 25,
            message: "正在下载筛选索引...",
          });
        }
        self.postMessage({ type: "startup-progress", percent: 55, message: "正在解压筛选索引..." });
        const blob = new Blob(chunks);
        const magic = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
        const stream = magic[0] === 0x1f && magic[1] === 0x8b
          ? blob.stream().pipeThrough(new DecompressionStream("gzip"))
          : blob.stream();
        const text = await new Response(stream).text();
        self.postMessage({ type: "startup-progress", percent: 68, message: "正在解析筛选索引..." });
        return JSON.parse(text);
      });
      filterPayload = decode(source);
      self.postMessage({ type: "startup-progress", percent: 78, message: "正在准备近7天排名..." });
      bestRowIndexes = buildBestRowIndexes(
        filterPayload.payload,
        filterPayload.indexes,
        filterPayload.rows,
      );
      dateRowIndexes = buildDateRowIndexes();
      self.postMessage({ type: "startup-progress", percent: 92, message: "筛选索引准备完毕" });
      self.postMessage({ type: "ready", count: filterPayload.rows.length });
    } catch (error) {
      self.postMessage({ type: "error", message: error.message || "筛选索引读取失败" });
    }
    return;
  }
  if (type === "filter") {
    const resultIndexes = [];
    let totalCount = 0;
    const sourceIndexes = filters?.dt ? (dateRowIndexes.get(filters.dt) || []) : bestRowIndexes;
    for (const rowIndex of sourceIndexes) {
      const row = filterPayload.rows[rowIndex];
      if (matchesRow(row, filters || {})) {
        totalCount += 1;
        pushTopIndex(resultIndexes, rowIndex, limit);
      }
    }
    resultIndexes.sort(compareRowIndexes);
    const resultRows = resultIndexes.map((rowIndex) => {
      const driver = decodeRecord(filterPayload.payload, filterPayload.indexes, filterPayload.rows[rowIndex]);
      driver.bestRiskTierRank = driver.riskTierRank;
      return driver;
    });
    self.postMessage({ type: "result", requestId, rows: resultRows, totalCount });
  }
};
