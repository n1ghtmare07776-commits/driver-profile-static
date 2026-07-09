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
    bestWindowRank: driver.bestWindowRank,
  })))),
  [
    {
      driverId: "100000000001",
      dataDate: "2026-07-08",
      riskTierRank: 8,
      bestRiskTierRank: 8,
      bestWindowRank: 1,
    },
    {
      driverId: "100000000002",
      dataDate: "2026-07-07",
      riskTierRank: 50001,
      bestRiskTierRank: 50001,
      bestWindowRank: 2,
    },
  ],
);
assert.equal(
  sandbox.matchesAdvancedFilters({ bestWindowRank: 50000 }, { bestWindowRank_max: "50000" }),
  true,
);
assert.equal(
  sandbox.matchesAdvancedFilters({ bestWindowRank: 50001 }, { bestWindowRank_max: "50000" }),
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
      priority_tier: "P3",
      badges: [{ kind: "explainable", label: "可解释" }],
      driver_metric: "age",
      driver_metric_label: "年龄",
      unit: "岁",
      threshold: { operator: ">" },
      evidence_template: "司机年龄{{driver_value}}岁，高于case均值{{threshold_value}}岁。",
      advice_template: "沟通时关注身体承受情况。",
      tags: ["高龄"],
    },
    {
      key: "minimum-sleep-low",
      title: "最短睡眠时长偏低",
      category: "fatigue",
      priority: 10,
      priority_tier: "P0",
      badges: [
        { kind: "high-risk", label: "高风险" },
        { kind: "explainable", label: "可解释" },
      ],
      driver_metric: "min_sleep_duration",
      driver_metric_label: "最短睡眠时长",
      unit: "小时",
      threshold: { operator: "<" },
      evidence_template: "{{matched_evidence}}。",
      advice_template: "提醒司机优先保证连续睡眠。",
      tags: ["疲劳"],
    },
    {
      key: "service-duration-7d-high",
      title: "近7天服务时长偏高",
      category: "workload",
      priority: 1,
      priority_tier: "P1",
      badges: [{ kind: "high-risk", label: "高风险" }],
      driver_metric: "server_dur_sum_7d",
      driver_metric_label: "近7天服务时长总和",
      unit: "小时",
      threshold: { operator: ">" },
      evidence_template: "{{matched_evidence}}。",
      advice_template: "提醒司机安排休息。",
      tags: ["疲劳"],
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
assert.equal(compactProfile.strategies[0].badges[0].label, "可解释");
assert.match(compactProfile.summary, /56岁，北京市，快车，示例公司A/);
assert.match(compactProfile.summary, /重点关注：高龄司机。/);

const lowSleepProfile = sandbox.resolveStaticProfile({
  driverId: "100000000002",
  dataDate: "2026-07-06",
  min_sleep_duration: 3.5,
  strategyKeys: ["minimum-sleep-low"],
  strategyEvidence: {
    "minimum-sleep-low": [["min_sleep_duration", 3.5, 5.2]],
  },
}, strategyIndex);
assert.equal(lowSleepProfile.strategies[0].title, "最短睡眠时长偏低");
assert.equal(lowSleepProfile.strategies[0].evidence, "最短睡眠时长3.5小时，低于case均值5.2小时。");
assert.equal(lowSleepProfile.strategies[0].badges[0].label, "高风险");

const sortedStrategies = sandbox.resolveStrategiesForDriver(
  {
    strategyKeys: ["senior-driver", "service-duration-7d-high", "minimum-sleep-low"],
    strategyEvidence: {
      "senior-driver": [["age", 56, 52.5]],
      "service-duration-7d-high": [["server_dur_sum_7d", 80, 60]],
      "minimum-sleep-low": [["min_sleep_duration", 3.5, 5.2]],
    },
  },
  strategyIndex,
);
assert.deepEqual(
  sortedStrategies.map((strategy) => strategy.key),
  ["minimum-sleep-low", "service-duration-7d-high", "senior-driver"],
);

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
