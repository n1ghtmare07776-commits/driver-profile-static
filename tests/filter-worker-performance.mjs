import fs from "node:fs";
import vm from "node:vm";
import zlib from "node:zlib";
import { performance } from "node:perf_hooks";

const source = fs.readFileSync(new URL("../dist/filter-worker.js", import.meta.url), "utf8");
const payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL("../dist/data/filter-index.json.gz", import.meta.url))).toString("utf8"));
let handler;
const messages = [];
const context = {
  self: { postMessage: (message) => messages.push(message), set onmessage(value) { handler = value; } },
  fetch: async () => { throw new Error("not used"); },
  DecompressionStream: globalThis.DecompressionStream,
  Response,
  Blob,
  Map,
  Set,
  Intl,
  Number,
  String,
};
vm.createContext(context);
vm.runInContext(source, context);

const initStart = performance.now();
await handler({ data: { type: "init", payload } });
const initMs = performance.now() - initStart;

const baseFilters = {
  driver_id: "", city: ["北京市"], company: [], product: [], dt: "", is_organized: "",
  bestRiskTierRank_min: "", bestRiskTierRank_max: "50000", age_min: "", age_max: "",
  consecutive_days_min: "", consecutive_days_max: "", server_dur_hour_min: "", server_dur_hour_max: "",
  order_cnt_21_09_7d_rate_min: "", order_cnt_21_09_7d_rate_max: "",
  sleep_deprivation_days_min: "", sleep_deprivation_days_max: "",
};
const queryTimes = [];
for (let requestId = 1; requestId <= 5; requestId += 1) {
  const start = performance.now();
  await handler({ data: { type: "filter", requestId, filters: baseFilters, limit: 5000 } });
  queryTimes.push(performance.now() - start);
}
const result = messages.findLast((message) => message.type === "result");
if (!result || result.rows.length > 5000 || result.totalCount < result.rows.length) throw new Error("Worker 返回结构错误");
console.log(JSON.stringify({
  initMs: Math.round(initMs),
  queryMs: queryTimes.map(Math.round),
  maxQueryMs: Math.round(Math.max(...queryTimes)),
  returnedRows: result.rows.length,
  totalCount: result.totalCount,
}, null, 2));
