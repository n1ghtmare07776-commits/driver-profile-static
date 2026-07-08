import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const appSource = fs.readFileSync("reference/current-cdn-frontend/app.js", "utf8");
const indexSource = fs.readFileSync("reference/current-cdn-frontend/index.html", "utf8");

assert.doesNotMatch(indexSource, /id="dateSelect"/);
assert.doesNotMatch(indexSource, /<select id="dateSelect"/);

const sandbox = {
  document: {
    querySelector() {
      return {
        addEventListener() {},
        appendChild() {},
        classList: { add() {}, remove() {} },
        dataset: {},
        innerHTML: "",
        value: "",
        textContent: "",
      };
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
    createElement() {
      return {
        addEventListener() {},
        appendChild() {},
        classList: { add() {}, remove() {}, toggle() {} },
        dataset: {},
        innerHTML: "",
        textContent: "",
        value: "",
      };
    },
  },
  window: {},
  Intl,
  fetch() {},
  URLSearchParams,
  Blob,
};

vm.createContext(sandbox);
vm.runInContext(appSource, sandbox);

assert.equal(
  sandbox.formatStaticGeneratedAt("2026-07-06T13:30:56+08:00"),
  "2026/07/06 13:30",
);

assert.equal(
  sandbox.resolveStaticGeneratedAt(
    { generated_at: "2026-07-06T13:30:56+08:00" },
    { static_generated_at: "2026/07/05 09:10" },
  ),
  "2026/07/06 13:30",
);

assert.equal(
  sandbox.resolveStaticGeneratedAt({}, { static_generated_at: "2026/07/05 09:10" }),
  "2026/07/05 09:10",
);

assert.equal(
  sandbox.formatDateWindow(["2026-07-03", "2026-07-07", "2026-07-08"]),
  "2026/07/03-2026/07/08",
);
assert.equal(sandbox.formatDateWindow(["2026-07-08"]), "2026/07/08");
assert.equal(sandbox.formatDateWindow([]), "暂无日期");

assert.equal(
  sandbox.initialDateFilter({
    latestDate: "2026-07-07",
    dates: ["2026-07-03", "2026-07-07"],
  }),
  "",
);
assert.equal(sandbox.loadingDailyDataMessage("2026-07-07"), "正在读取数据...");
assert.equal(sandbox.dailyDataLoadedMessage("2026-07-07"), "数据读取完毕");

const decodedCompactDrivers = sandbox.resolveDailyDriversPayload({
    mode: "daily-static-compact",
    date: "2026-07-06",
    schema: [
      "driverId",
      "city",
      "cityLevel",
      "company",
      "product",
      "isOrganized",
      "age",
      "riskTierRank",
      "riskTierScore",
      "tiredScore",
      "strategyKeys",
      "strategyEvidence",
    ],
    dict: {
      cities: ["北京市"],
      cityLevels: ["一线"],
      companies: ["示例公司A"],
      products: ["快车"],
      isOrganized: ["是"],
      strategyKeys: ["senior-driver"],
    },
    rows: [
      [
        "100000000001",
        0,
        0,
        0,
        0,
        0,
        56,
        128,
        82.1,
        76.3,
        [0],
        [[["age", 56, 52.5]]],
      ],
    ],
  });
assert.deepEqual(
  JSON.parse(JSON.stringify(decodedCompactDrivers)),
  [
    {
      driverId: "100000000001",
      dataDate: "2026-07-06",
      city: "北京市",
      cityLevel: "一线",
      company: "示例公司A",
      product: "快车",
      isOrganized: "是",
      age: 56,
      riskTierRank: 128,
      riskTierScore: 82.1,
      tiredScore: 76.3,
      strategyKeys: ["senior-driver"],
      strategyEvidence: {
        "senior-driver": [["age", 56, 52.5]],
      },
      subtitle: "北京市 · 快车 · 示例公司A",
    },
  ],
);

const largeDriverBatch = Array.from({ length: 250000 }, (_, index) => ({ driverId: String(index) }));
const mergedDriverRows = [];
sandbox.appendDriverRows(mergedDriverRows, largeDriverBatch);
assert.equal(mergedDriverRows.length, largeDriverBatch.length);
assert.equal(mergedDriverRows[249999].driverId, "249999");

const weeklyBestRows = sandbox.deduplicateBestRankedDrivers([
  { driverId: "100000000001", dataDate: "2026-07-03", riskTierRank: 120, city: "北京市" },
  { driverId: "100000000001", dataDate: "2026-07-08", riskTierRank: 8, city: "上海市" },
  { driverId: "100000000002", dataDate: "2026-07-07", riskTierRank: 50001, city: "广州市" },
  { driverId: "100000000002", dataDate: "2026-07-08", riskTierRank: "", city: "深圳市" },
]);
assert.deepEqual(
  JSON.parse(JSON.stringify(weeklyBestRows.map((driver) => ({
    driverId: driver.driverId,
    dataDate: driver.dataDate,
    riskTierRank: driver.riskTierRank,
    bestRiskTierRank: driver.bestRiskTierRank,
  })))),
  [
    {
      driverId: "100000000001",
      dataDate: "2026-07-08",
      riskTierRank: 8,
      bestRiskTierRank: 8,
    },
    {
      driverId: "100000000002",
      dataDate: "2026-07-07",
      riskTierRank: 50001,
      bestRiskTierRank: 50001,
    },
  ],
);
assert.equal(
  sandbox.matchesAdvancedFilters({ bestRiskTierRank: 50000 }, { bestRiskTierRank_max: "50000" }),
  true,
);
assert.equal(
  sandbox.matchesAdvancedFilters({ bestRiskTierRank: 50001 }, { bestRiskTierRank_max: "50000" }),
  false,
);

assert.deepEqual(
  sandbox.resolveStaticProfile({
    driverId: "100000000001",
    profile: { driverId: "100000000001", summary: "完整静态档案" },
  }),
  { driverId: "100000000001", summary: "完整静态档案" },
);

const strategyIndex = sandbox.buildStrategyRuleIndex({
  rules: [
    {
      key: "senior-driver",
      title: "高龄司机",
      category: "health",
      priority: 60,
      driver_metric: "age",
      driver_metric_label: "年龄",
      unit: "岁",
      evidence_template: "司机年龄{{driver_value}}岁，高于case均值{{threshold_value}}岁。",
      advice_template: "沟通时关注身体承受情况。",
      tags: ["高龄"],
    },
  ],
  fallbackRule: {
    key: "regular-care",
    title: "常规关怀",
    evidence: "当前没有任何指标高于case均值。",
    advice: "可做常规状态确认。",
    priority: 999,
  },
});

const compactProfile = sandbox.resolveStaticProfile({
  driverId: "100000000001",
  dataDate: "2026-07-06",
  city: "北京市",
  cityLevel: "一线",
  company: "示例公司A",
  product: "快车",
  age: 56,
  riskTierRank: 128,
  riskTierScore: 82.1,
  tiredScore: 76.3,
  isOrganized: "是",
  strategyKeys: ["senior-driver"],
  strategyEvidence: {
    "senior-driver": [["age", 56, 52.5]],
  },
}, strategyIndex);
assert.equal(compactProfile.driverId, "100000000001");
assert.equal(compactProfile.meta.dataDate, "2026-07-06");
assert.equal(compactProfile.groups[0].items[0].displayValue, "北京市");
assert.equal(compactProfile.groups[0].items[5].displayValue, "是");
assert.equal(compactProfile.strategies[0].title, "高龄司机");
assert.equal(compactProfile.strategies[0].evidence, "司机年龄56岁，高于case均值52.5岁。");
assert.match(compactProfile.summary, /56岁，北京市，快车，示例公司A/);
assert.match(compactProfile.summary, /重点关注：高龄司机。/);

const fallbackStrategies = sandbox.resolveStrategiesForDriver(
  { strategyKeys: ["regular-care"] },
  strategyIndex,
);
assert.equal(fallbackStrategies[0].title, "常规关怀");

const singleCityMatch = sandbox.typedTokenCandidate(["北京市", "上海市"], "北京");
assert.equal(singleCityMatch.value, "北京市");
assert.equal(singleCityMatch.ambiguous, false);

const ambiguousCityMatch = sandbox.typedTokenCandidate(["北京市", "北京公司"], "北京");
assert.equal(ambiguousCityMatch.value, "");
assert.equal(ambiguousCityMatch.ambiguous, true);

sandbox.setDateFilter("2026-07-03");
assert.equal(sandbox.getDateFilter(), "2026-07-03");
sandbox.setDateFilter("");
assert.equal(sandbox.getDateFilter(), "");
