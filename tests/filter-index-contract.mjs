import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";

const path = new URL("../dist/data/filter-index.json.gz", import.meta.url);
assert.equal(fs.existsSync(path), true, "缺少组合筛选轻量索引");

const payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(path)).toString("utf8"));
assert.equal(payload.mode, "driver-filter-index-compact");
assert.ok(Array.isArray(payload.schema));
assert.ok(Array.isArray(payload.rows));
for (const field of [
  "driverId",
  "dataDate",
  "city",
  "company",
  "product",
  "riskTierRank",
  "avgOnlineDuration7d",
]) {
  assert.ok(payload.schema.includes(field), `筛选索引缺少字段：${field}`);
}
assert.equal(payload.schema.includes("avgServiceDuration7d"), false);
assert.equal(payload.schema.includes("serviceDurationSampleDays"), false);

const appSource = fs.readFileSync(new URL("../dist/app.js", import.meta.url), "utf8");
assert.match(appSource, /new Worker\("filter-worker\.js\?v=20260713-performance-v3"\)/);

console.log(`筛选索引契约通过：${payload.rows.length} 条快照`);
