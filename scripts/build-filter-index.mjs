#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const dataDir = path.resolve(process.argv[2] || "dist/data");
const outputPath = path.join(dataDir, "filter-index.json.gz");
const index = JSON.parse(fs.readFileSync(path.join(dataDir, "drivers.json"), "utf8"));

const schema = [
  "driverId", "city", "company", "product", "dataDate", "isOrganized", "age",
  "consecutive_days", "server_dur_hour", "order_cnt_21_09_7d_rate", "sleep_deprivation_days",
  "riskTierRank", "riskTierScore", "tiredScore", "avgOnlineDuration7d", "strategyKeys",
];
const dictionaryFields = {
  city: "cities",
  company: "companies",
  product: "products",
  dataDate: "dates",
  isOrganized: "isOrganized",
};
const dictionaries = Object.fromEntries(Object.values(dictionaryFields).map((key) => [key, new Set()]));
dictionaries.strategyKeys = new Set();
const records = [];

function finiteNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function averageOnlineDuration7d(value) {
  const number = finiteNumber(value);
  return number === null ? null : number / 7;
}

for (const daily of index.files || []) {
  const payload = JSON.parse(fs.readFileSync(path.join(dataDir, daily.path), "utf8"));
  const fieldIndex = Object.fromEntries((payload.schema || []).map((field, index) => [field, index]));
  const sourceDict = payload.dict || {};
  for (const sourceRow of payload.rows || []) {
    const record = {};
    for (const field of schema) {
      if (field === "dataDate") {
        record[field] = payload.date || daily.date || "";
      } else if (field === "strategyKeys") {
        record[field] = (sourceRow[fieldIndex[field]] || [])
          .map((keyIndex) => sourceDict.strategyKeys?.[keyIndex])
          .filter(Boolean);
      } else if (dictionaryFields[field]) {
        record[field] = sourceDict[dictionaryFields[field]]?.[sourceRow[fieldIndex[field]]] || "";
      } else {
        record[field] = sourceRow[fieldIndex[field]] ?? null;
      }
    }
    record.avgOnlineDuration7d = averageOnlineDuration7d(
      sourceRow[fieldIndex.lately_7d_except_sub_online_dur_hour],
    );
    for (const [field, dictionary] of Object.entries(dictionaryFields)) dictionaries[dictionary].add(record[field]);
    for (const key of record.strategyKeys) dictionaries.strategyKeys.add(key);
    records.push(record);
  }
}

const dict = Object.fromEntries(Object.entries(dictionaries).map(([key, values]) => [key, [...values].filter(Boolean).sort()]));
const positions = Object.fromEntries(Object.entries(dict).map(([key, values]) => [key, new Map(values.map((value, index) => [value, index]))]));
const rows = records.map((record) => schema.map((field) => {
  if (field === "strategyKeys") return record[field].map((key) => positions.strategyKeys.get(key));
  if (dictionaryFields[field]) return positions[dictionaryFields[field]].get(record[field]);
  return record[field];
}));

const json = `${JSON.stringify({ mode: "driver-filter-index-compact", schema, dict, rows })}\n`;
fs.writeFileSync(outputPath, zlib.gzipSync(json, { level: 6 }));
const legacyPath = path.join(dataDir, "filter-index.json");
if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
console.log(`组合筛选索引：${records.length} 条快照，${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(1)} MB`);
