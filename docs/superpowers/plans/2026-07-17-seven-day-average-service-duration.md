# Seven-Day Average Service Duration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the selected snapshot's daily service duration with an available-snapshot seven-day average in the profile header and summary, and remove the sync-status source item.

**Architecture:** Aggregate `server_dur_hour` by driver while rebuilding the existing filter and direct-lookup derived indexes. Carry `avgServiceDuration7d` and `serviceDurationSampleDays` through both query paths, then render one shared two-decimal display value in the profile UI without changing daily files, strategy rules, ranking, or filters.

**Tech Stack:** Python 3, Node.js ES modules, Web Worker, compact JSON + gzip, static HTML/CSS/JavaScript.

---

## File Map

- Create `tests/test_service_duration_average.py`: fixture-based end-to-end contract test for both derived indexes.
- Modify `scripts/build-filter-index.mjs`: aggregate valid service durations and add two fields to each compact snapshot row.
- Modify `scripts/build-direct-driver-lookup.py`: aggregate the same values per driver before encoding the best-rank direct lookup record.
- Modify `dist/filter-worker.js`: decode and return the two aggregate fields.
- Modify `reference/current-cdn-frontend/app.js`: decode direct lookup aggregates, format the average, update header/summary copy, and remove sync status.
- Modify `tests/static-generated-time.test.mjs`: lock the new wording, formatting, fallback, and removed source item.
- Modify `tests/filter-index-contract.mjs` and `tests/lookup-index-contract.mjs`: require the new fields in production artifacts.
- Modify `docs/数据与接口契约.md`, `docs/UI优化记录_20260709.md`, and `docs/发布记录.md`: document the field contract and release result.

### Task 1: Add Failing Aggregate Contract Tests

**Files:**
- Create: `tests/test_service_duration_average.py`
- Modify: `tests/static-generated-time.test.mjs`

- [ ] **Step 1: Create a temporary-data index contract test**

The test loads `scripts/import-driver-data.py`, writes three compact daily files, then invokes both builders. Driver `1001` has valid service durations `2`, `4`, and `0`; driver `1002` has no valid duration.

```python
import gzip
import json
import subprocess
import sys
import tempfile
from importlib.machinery import SourceFileLoader
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IMPORT_SCRIPT = ROOT / "scripts" / "import-driver-data.py"


def load_import_module():
    return SourceFileLoader("service_average_import", str(IMPORT_SCRIPT)).load_module()


def driver(driver_id, data_date, service_duration):
    item = {
        "driverId": driver_id,
        "dataDate": data_date,
        "city": "北京市",
        "cityLevel": "一线",
        "company": "示例公司",
        "product": "快车",
        "riskTierRank": 10,
        "strategyKeys": ["regular-care"],
    }
    if service_duration is not None:
        item["server_dur_hour"] = service_duration
    return item
```

The test writes `drivers.json`, then runs the builders with the temporary path:

```python
subprocess.run(
    ["node", str(ROOT / "scripts" / "build-filter-index.mjs"), str(data_dir)],
    cwd=ROOT,
    check=True,
)
subprocess.run(
    [
        sys.executable,
        str(ROOT / "scripts" / "build-direct-driver-lookup.py"),
        "--data-dir",
        str(data_dir),
        "--bucket-count",
        "4",
    ],
    cwd=ROOT,
    check=True,
)
```

It asserts:

```python
assert "avgServiceDuration7d" in filter_schema
assert "serviceDurationSampleDays" in filter_schema
assert all(row[average_index] == 2 for row in driver_1001_filter_rows)
assert all(row[sample_days_index] == 3 for row in driver_1001_filter_rows)
assert driver_1002_filter_row[average_index] is None
assert driver_1002_filter_row[sample_days_index] == 0
assert driver_1001_lookup_row[lookup_average_index] == 2
assert driver_1001_lookup_row[lookup_sample_days_index] == 3
```

- [ ] **Step 2: Add failing frontend assertions**

Update the guarded summary fixture to use:

```javascript
avgServiceDuration7d: 3.1911,
serviceDurationSampleDays: 4,
```

Assert:

```javascript
assert.equal(guardedSummary, "快车，周平均服务时长3.19小时/日，数据日期2026-07-09。");
assert.equal(compactProfile.header.subtitle, "北京市 · 快车 · 示例公司A · 56岁 · 七天平均时长 3.19h/日");
assert.doesNotMatch(appSource, /同步状态：/);
```

Also assert `formatAverageServiceDuration(3.5) === "3.5"`, `formatAverageServiceDuration(0) === "0"`, and invalid values return an empty string.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
python3 tests/test_service_duration_average.py
node tests/static-generated-time.test.mjs
```

Expected: both tests fail because aggregate index fields, formatter, new wording, and sync-status removal do not exist.

### Task 2: Aggregate Values In Both Derived Index Builders

**Files:**
- Modify: `scripts/build-filter-index.mjs`
- Modify: `scripts/build-direct-driver-lookup.py`
- Test: `tests/test_service_duration_average.py`

- [ ] **Step 1: Add shared semantics to the filter-index builder**

Add schema fields:

```javascript
"avgServiceDuration7d", "serviceDurationSampleDays"
```

Add numeric validation and accumulation:

```javascript
function finiteNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const serviceDurationStats = new Map();

function recordServiceDuration(driverId, value) {
  const number = finiteNumber(value);
  if (!driverId || number === null) return;
  const current = serviceDurationStats.get(driverId) || { sum: 0, count: 0 };
  current.sum += number;
  current.count += 1;
  serviceDurationStats.set(driverId, current);
}
```

After scanning all daily files, set:

```javascript
const stats = serviceDurationStats.get(record.driverId);
record.avgServiceDuration7d = stats?.count ? stats.sum / stats.count : null;
record.serviceDurationSampleDays = stats?.count || 0;
```

- [ ] **Step 2: Aggregate direct lookup records per stable shard**

Add both fields to `DIRECT_SCHEMA` and introduce:

```python
def finite_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None
```

While reading each shard JSONL, maintain:

```python
service_stats = {}
value = finite_number(record.get("server_dur_hour"))
if value is not None:
    stats = service_stats.setdefault(record["driverId"], {"sum": 0.0, "count": 0})
    stats["sum"] += value
    stats["count"] += 1
```

Before encoding each best record:

```python
stats = service_stats.get(record["driverId"], {"sum": 0.0, "count": 0})
record["avgServiceDuration7d"] = stats["sum"] / stats["count"] if stats["count"] else None
record["serviceDurationSampleDays"] = stats["count"]
```

- [ ] **Step 3: Run the aggregate contract test and verify GREEN**

Run:

```bash
python3 tests/test_service_duration_average.py
```

Expected: exit code 0 and both index formats report average `2` with sample count `3` for driver `1001`.

### Task 3: Carry Aggregate Fields Through Browser Query Paths

**Files:**
- Modify: `dist/filter-worker.js`
- Modify: `reference/current-cdn-frontend/app.js`
- Test: `tests/static-generated-time.test.mjs`

- [ ] **Step 1: Decode aggregate filter-index fields in the Worker**

Add to `decodeRecord`:

```javascript
avgServiceDuration7d: row[indexes.avgServiceDuration7d],
serviceDurationSampleDays: row[indexes.serviceDurationSampleDays],
```

No matching, sorting, ranking, or date-selection logic changes.

- [ ] **Step 2: Decode direct lookup aggregate fields**

Add to `decodeDirectLookupPayload`:

```javascript
avgServiceDuration7d: raw.avgServiceDuration7d,
serviceDurationSampleDays: raw.serviceDurationSampleDays,
```

- [ ] **Step 3: Add one display formatter and update profile copy**

```javascript
function formatAverageServiceDuration(value) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return Number(number.toFixed(2)).toString();
}
```

Use it in `conciseProfileSubtitle`:

```javascript
const averageServiceDuration = formatAverageServiceDuration(driver.avgServiceDuration7d);
averageServiceDuration ? `七天平均时长 ${averageServiceDuration}h/日` : ""
```

Use it in `buildSummaryForDriver`:

```javascript
averageServiceDuration ? `周平均服务时长${averageServiceDuration}小时/日` : ""
```

Remove the current single-day `server_dur_hour` phrase from both functions.

- [ ] **Step 4: Remove sync status from the source metadata row**

Delete sync-status resolution and this markup:

```html
<span>同步状态：${escapeHtml(syncStatus)}</span>
```

Keep ranking hit date, seven-day highest rank, and generated time unchanged.

- [ ] **Step 5: Run frontend tests and verify GREEN**

Run:

```bash
node tests/static-generated-time.test.mjs
```

Expected: exit code 0; header and summary use the new labels and source metadata has no sync status.

### Task 4: Synchronize Frontend Sources And Rebuild Production Artifacts

**Files:**
- Modify: `driver-profile-static-deploy/reference/current-cdn-frontend/app.js`
- Modify: `driver-profile-static-deploy/reference/current-cdn-frontend/filter-worker.js`
- Modify: `reference/current-cdn-frontend/app.js`
- Create/update generated: `dist/app.js`, `dist/app.<build-id>.js`, `dist/index.html`, `dist/filter-worker.js`
- Rebuild generated: `dist/data/filter-index.json.gz`, `dist/data/driver-lookup-index.json`, `dist/data/lookup/*.json.gz`

- [ ] **Step 1: Keep canonical frontend copies byte-identical**

Run from `/Users/didi/Desktop/司机画像多日测试版`:

```bash
cp driver-profile-static-deploy/reference/current-cdn-frontend/index.html reference/current-cdn-frontend/index.html
cp driver-profile-static-deploy/reference/current-cdn-frontend/app.js reference/current-cdn-frontend/app.js
cp driver-profile-static-deploy/reference/current-cdn-frontend/styles.css reference/current-cdn-frontend/styles.css
cp driver-profile-static-deploy/reference/current-cdn-frontend/filter-worker.js reference/current-cdn-frontend/filter-worker.js
shasum reference/current-cdn-frontend/app.js driver-profile-static-deploy/reference/current-cdn-frontend/app.js
shasum reference/current-cdn-frontend/filter-worker.js driver-profile-static-deploy/reference/current-cdn-frontend/filter-worker.js
```

Expected: each line within an app group and Worker group has the same hash.

- [ ] **Step 2: Generate new cache-busted frontend assets**

Run:

```bash
python3 driver-profile-static-deploy/scripts/prepare-static-site.py \
  --frontend-dir driver-profile-static-deploy/reference/current-cdn-frontend \
  --out-dir dist
```

Expected: `dist/index.html` references a new `app.<build-id>.js` and `styles.<build-id>.css`.

- [ ] **Step 3: Rebuild only derived data indexes**

Run:

```bash
node scripts/build-filter-index.mjs dist/data
python3 scripts/build-direct-driver-lookup.py --data-dir dist/data --bucket-count 128
```

Expected: daily files and snapshot counts remain unchanged; manifest package size is recalculated.

### Task 5: Contract, Performance, UI, Documentation, And Versioning

**Files:**
- Modify: `tests/filter-index-contract.mjs`
- Modify: `tests/lookup-index-contract.mjs`
- Modify: `docs/数据与接口契约.md`
- Modify: `docs/UI优化记录_20260709.md`
- Modify: `docs/发布记录.md`

- [ ] **Step 1: Require the new production fields**

Add assertions that both filter and direct lookup schemas contain:

```text
avgServiceDuration7d
serviceDurationSampleDays
```

- [ ] **Step 2: Run the full regression suite**

```bash
python3 tests/test_import_driver_data.py
python3 tests/test_service_duration_average.py
python3 tests/test_prepare_static_site.py
node tests/static-generated-time.test.mjs
node tests/progress-monotonic.test.mjs
node tests/filter-index-contract.mjs
node tests/lookup-index-contract.mjs
node tests/filter-worker-performance.mjs
```

Expected: every command exits 0, progress remains monotonic, Worker performance remains within its existing threshold, and direct shards remain below 2MB.

- [ ] **Step 3: Dogfood both query paths**

Validate in the local browser:

```text
北京组合筛选 -> 打开司机详情 -> 记录七天平均值
重置 -> 完整司机 ID 直达 -> 确认显示相同平均值
```

Also confirm the source row has exactly three items and browser error logs are empty.

- [ ] **Step 4: Update documentation with measured artifact impact**

Record aggregate semantics, package-size change, filter-index size, maximum lookup shard, Worker maximum query time, and UI validation.

- [ ] **Step 5: Commit, tag, and push**

```bash
git add .
git commit -m "feat: show seven-day average service duration"
git tag -a "风险前哨七天平均服务时长版-20260717" -m "展示七天平均时长并移除同步状态"
git push origin main
git push origin "风险前哨七天平均服务时长版-20260717"
```

Do not stage `dist/`, `data/incoming/`, real daily JSON, or real driver lookup shards.
