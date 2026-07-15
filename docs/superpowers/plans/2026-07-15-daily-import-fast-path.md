# Daily Import Fast Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce normal daily import time by eliminating repeated Python decoding of the retained daily JSON files while preserving every existing static-data and browser query contract.

**Architecture:** Add a `DatasetSummary` dictionary computed from the one in-memory window load. Static index and metadata writers consume that summary, and the under-limit size check returns it unchanged; only the existing over-800MB recovery path reloads remaining daily files after deleting an old date. The filter and direct lookup index builders remain untouched.

**Tech Stack:** Python 3, pytest-style assertion tests executed as Python scripts, Node.js contract/performance tests, compact JSON and gzip static artifacts.

---

## File Map

- Modify `scripts/import-driver-data.py`: create and validate the dataset summary, pass it through static-index writes and the size-limit fast path, and avoid repeat daily-file decoding.
- Modify `tests/test_import_driver_data.py`: add focused unit tests for summary correctness and read avoidance while retaining end-to-end import and over-limit coverage.
- Modify `docs/技术方案.md`: document the single-scan normal path and unchanged over-limit fallback.
- Modify `docs/每日更新说明.md`: document expected import stages and the performance regression checks for future updates.

### Task 1: Lock The Fast-Path Contract With Failing Tests

**Files:**
- Modify: `tests/test_import_driver_data.py`
- Test: `tests/test_import_driver_data.py`

- [ ] **Step 1: Add a reusable module loader and compact sample-driver helper**

```python
from importlib.machinery import SourceFileLoader
from datetime import datetime
from unittest.mock import patch


def load_import_module():
    return SourceFileLoader("import_driver_data_test", str(SCRIPT)).load_module()


def sample_driver(driver_id, data_date, city="北京市", company="示例公司", product="快车"):
    return {
        "driverId": driver_id,
        "dataDate": data_date,
        "city": city,
        "company": company,
        "product": product,
        "strategyKeys": ["regular-care"],
    }
```

- [ ] **Step 2: Add a failing summary correctness test**

```python
def test_build_dataset_summary_matches_loaded_window():
    module = load_import_module()
    drivers = [
        sample_driver("1001", "2026-07-14", company="公司A"),
        sample_driver("1002", "2026-07-15", city="上海市", company="公司B", product="专车"),
    ]

    summary = module.build_dataset_summary(Path("/tmp/data"), drivers)

    assert summary["row_count"] == 2
    assert summary["dates"] == ["2026-07-14", "2026-07-15"]
    assert sum(item["row_count"] for item in summary["daily_files"]) == 2
    assert summary["filter_options"] == {
        "cities": ["上海市", "北京市"],
        "companies": ["公司A", "公司B"],
        "products": ["专车", "快车"],
        "dates": ["2026-07-14", "2026-07-15"],
    }
```

- [ ] **Step 3: Add a failing no-reread writer test**

```python
def test_write_static_indexes_uses_summary_without_reading_daily_files(tmp_path):
    module = load_import_module()
    drivers = [sample_driver("1001", "2026-07-15")]
    summary = module.build_dataset_summary(tmp_path, drivers)

    with patch.object(module, "read_static_drivers_file", side_effect=AssertionError("daily file reread")):
        module.write_static_indexes(
            tmp_path,
            summary,
            "2026-07-15",
            datetime.strptime("2026-07-09", "%Y-%m-%d").date(),
            datetime.strptime("2026-07-15", "%Y-%m-%d").date(),
            800,
        )

    assert json.loads((tmp_path / "manifest.json").read_text())["row_count"] == 1
```

- [ ] **Step 4: Add a failing under-limit no-reload test**

```python
def test_enforce_size_limit_reuses_summary_when_package_is_under_limit(tmp_path):
    module = load_import_module()
    summary = module.build_dataset_summary(
        tmp_path,
        [sample_driver("1001", "2026-07-15")],
    )

    with patch.object(module, "load_daily_static_drivers", side_effect=AssertionError("window reloaded")):
        returned_summary, size_control = module.enforce_size_limit(
            tmp_path,
            "2026-07-15",
            datetime.strptime("2026-07-09", "%Y-%m-%d").date(),
            datetime.strptime("2026-07-15", "%Y-%m-%d").date(),
            800,
            summary,
        )

    assert returned_summary is summary
    assert size_control["actual_dates"] == ["2026-07-15"]
```

- [ ] **Step 5: Run the focused tests and confirm they fail for missing interfaces**

Run:

```bash
python3 -m pytest tests/test_import_driver_data.py -q
```

Expected: the three new tests fail because `build_dataset_summary` and the summary-aware signatures do not exist; the three existing end-to-end tests remain otherwise valid.

- [ ] **Step 6: Commit the red tests**

```bash
git add tests/test_import_driver_data.py docs/superpowers/specs/2026-07-15-daily-import-fast-path-design.md docs/superpowers/plans/2026-07-15-daily-import-fast-path.md
git commit -m "test: define daily import fast path contract"
```

### Task 2: Implement Dataset Summary And Static Writer Reuse

**Files:**
- Modify: `scripts/import-driver-data.py:998-1089`
- Test: `tests/test_import_driver_data.py`

- [ ] **Step 1: Replace repeated daily indexing with an in-memory summary**

```python
def build_dataset_summary(out_dir, static_drivers):
    dates = sorted_unique(item["dataDate"] for item in static_drivers)
    row_counts = {data_date: 0 for data_date in dates}
    for driver in static_drivers:
        row_counts[driver["dataDate"]] += 1
    daily_files = [
        {
            "date": data_date,
            "path": f"daily/{daily_file_path(out_dir, data_date).name}",
            "row_count": row_counts[data_date],
        }
        for data_date in dates
    ]
    summary = {
        "row_count": len(static_drivers),
        "dates": dates,
        "daily_files": daily_files,
        "filter_options": build_filter_options(static_drivers, dates),
    }
    if summary["row_count"] != sum(item["row_count"] for item in daily_files):
        raise ValueError("数据摘要行数与每日文件行数不一致。")
    return summary
```

- [ ] **Step 2: Make metadata payload builders consume counts instead of driver lists**

```python
def build_meta_payload(summary, upload_date, window_start, window_end, size_control=None):
    payload = {
        "row_count": summary["row_count"],
        "data_dates": summary["dates"],
        "upload_date": upload_date,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "data_mode": "daily_static",
        "primary_data_file": "drivers.json",
        "daily_files": summary["daily_files"],
    }
    if size_control:
        payload.update(size_control)
    return payload


def build_manifest_payload(summary, upload_date, window_start, window_end, size_limit_mb, size_control=None):
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "upload_date": upload_date,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "row_count": summary["row_count"],
        "contains_queryable_driver_data": True,
        "data_mode": "daily_static",
        "primary_data_file": "drivers.json",
        "daily_files": summary["daily_files"],
        "package_size_limit_mb": size_limit_mb,
        "actual_dates": summary["dates"],
        "dropped_dates": [],
        "package_size_mb": 0,
    }
    if size_control:
        payload.update(size_control)
    return payload
```

- [ ] **Step 3: Make `write_static_indexes` write only from the summary**

```python
def write_static_indexes(out_dir, summary, upload_date, window_start, window_end, size_limit_mb, size_control=None):
    dates = summary["dates"]
    daily_files = summary["daily_files"]
    write_json(out_dir / "drivers.json", {
        "mode": "daily-static-index",
        "latestDate": dates[-1] if dates else "",
        "dates": dates,
        "files": daily_files,
    })
    write_pretty_json(out_dir / "filter-options.json", summary["filter_options"])
    write_pretty_json(out_dir / "meta.json", build_meta_payload(summary, upload_date, window_start, window_end, size_control))
    write_pretty_json(
        out_dir / "manifest.json",
        build_manifest_payload(summary, upload_date, window_start, window_end, size_limit_mb, size_control),
    )
    return daily_files
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
python3 -m pytest tests/test_import_driver_data.py -q
```

Expected: summary correctness and writer no-reread tests pass; size-limit test still fails until Task 3.

- [ ] **Step 5: Commit the summary writer change**

```bash
git add scripts/import-driver-data.py tests/test_import_driver_data.py
git commit -m "perf: reuse daily dataset summary for static indexes"
```

### Task 3: Add The Under-Limit Fast Path And Preserve Over-Limit Recovery

**Files:**
- Modify: `scripts/import-driver-data.py:1091-1281`
- Test: `tests/test_import_driver_data.py`

- [ ] **Step 1: Pass the current summary into `enforce_size_limit`**

```python
def enforce_size_limit(out_dir, upload_date, window_start, window_end, size_limit_mb, summary):
    limit_bytes = int(size_limit_mb * 1024 * 1024)
    total_size = directory_size(release_root(out_dir))
    if total_size <= limit_bytes:
        return summary, {
            "actual_dates": summary["dates"],
            "dropped_dates": [],
            "drop_reason": "",
            "package_size_mb": round(total_size / 1024 / 1024, 3),
            "package_size_limit_mb": size_limit_mb,
        }
```

- [ ] **Step 2: Rebuild summaries only after an over-limit date deletion**

```python
    dates = list(summary["dates"])
    dropped_dates = []
    for data_date in list(dates):
        if len(dates) <= 1:
            break
        daily_file_path(out_dir, data_date).unlink(missing_ok=True)
        dropped_dates.append(data_date)
        static_drivers = load_daily_static_drivers(out_dir, window_start, window_end)
        summary = build_dataset_summary(out_dir, static_drivers)
        dates = summary["dates"]
        size_control = {
            "actual_dates": dates,
            "dropped_dates": dropped_dates,
            "drop_reason": "package_size_limit",
            "package_size_mb": round(directory_size(release_root(out_dir)) / 1024 / 1024, 3),
            "package_size_limit_mb": size_limit_mb,
        }
        write_static_indexes(
            out_dir,
            summary,
            upload_date,
            window_start,
            window_end,
            size_limit_mb,
            size_control,
        )
        build_derived_indexes(out_dir)
        total_size = directory_size(release_root(out_dir))
        if total_size <= limit_bytes:
            break

    size_control = {
        "actual_dates": summary["dates"],
        "dropped_dates": dropped_dates,
        "drop_reason": "package_size_limit" if dropped_dates else "",
        "package_size_mb": round(total_size / 1024 / 1024, 3),
        "package_size_limit_mb": size_limit_mb,
    }
    if total_size > limit_bytes:
        size_control["drop_reason"] = "package_size_limit_latest_day_exceeds_limit"
        write_static_indexes(
            out_dir,
            summary,
            upload_date,
            window_start,
            window_end,
            size_limit_mb,
            size_control,
        )
        raise SystemExit(
            f"最新日期静态产物仍有 {total_size} bytes，超过限制 {limit_bytes} bytes；"
            "需要继续按城市/分片拆分或改用后端 API。"
        )
    return summary, size_control
```

- [ ] **Step 3: Update `main` to build one summary and reuse it through final metadata writes**

```python
    static_drivers = load_daily_static_drivers(out_dir, window_start, window_end)
    summary = build_dataset_summary(out_dir, static_drivers)
    write_static_indexes(out_dir, summary, upload_date, window_start, window_end, args.size_limit_mb)
    build_derived_indexes(out_dir)
    summary, size_control = enforce_size_limit(
        out_dir,
        upload_date,
        window_start,
        window_end,
        args.size_limit_mb,
        summary,
    )
    write_static_indexes(out_dir, summary, upload_date, window_start, window_end, args.size_limit_mb, size_control)
```

Also update console reporting to use `summary["row_count"]` and `summary["dates"]`, then `del static_drivers` after summary creation so the large decoded list can be reclaimed before subprocess index builders run.

- [ ] **Step 4: Run all Python import tests**

Run:

```bash
python3 -m pytest tests/test_import_driver_data.py -q
```

Expected: all tests pass, including the existing test that drops the oldest day under a tiny package limit.

- [ ] **Step 5: Commit the size-limit fast path**

```bash
git add scripts/import-driver-data.py tests/test_import_driver_data.py
git commit -m "perf: skip daily reload below CDN size limit"
```

### Task 4: Verify Static Contracts And Runtime Performance

**Files:**
- Verify: `scripts/import-driver-data.py`
- Verify: `scripts/build-filter-index.mjs`
- Verify: `scripts/build-direct-driver-lookup.py`
- Verify: `dist/data/` without committing it

- [ ] **Step 1: Run syntax checks**

```bash
python3 -m py_compile scripts/import-driver-data.py tests/test_import_driver_data.py
```

Expected: exit code 0 with no output.

- [ ] **Step 2: Run browser data-contract and progress tests**

```bash
node tests/progress-monotonic.test.mjs
node tests/filter-index-contract.mjs
node tests/lookup-index-contract.mjs
node tests/filter-worker-performance.mjs
```

Expected: every command exits 0; progress never decreases or restarts, static contracts match the frontend, and worker query time remains within the existing threshold.

- [ ] **Step 3: Benchmark a copied release directory with the same 07-15 source**

Run the current import command against a temporary copy of `dist/`, capture wall-clock duration, and confirm:

```text
manifest.actual_dates unchanged
manifest.row_count unchanged
drivers.json daily file list unchanged
filter-index row_count equals manifest.row_count
lookup source_dates equals manifest.actual_dates
lookup max shard remains below 2MB
```

Expected: the normal path performs one Python window decode and completes materially faster than the pre-change baseline without changing browser artifacts.

- [ ] **Step 4: Dogfood the realistic query sequence**

Open the local site and perform this sequence:

```text
load page -> filter 北京 -> clear filters -> enter a complete driver ID with a 2026-07-15 snapshot -> switch date -> return to all dates
```

Expected: no UI freeze, no progress regression or restart, Beijing filtering remains near the established sub-second result, and exact-ID lookup opens the correct driver.

### Task 5: Document And Version The Optimization

**Files:**
- Modify: `docs/技术方案.md`
- Modify: `docs/每日更新说明.md`
- Modify: `docs/发布记录.md`

- [ ] **Step 1: Document the stable performance architecture**

Add the following verified points:

```text
正常未超 800MB 时，Python 主流程只解码一次近七天日文件。
摘要复用于 drivers/filter-options/manifest/meta。
组合筛选与司机 ID 直达索引的生成器和前端格式未改。
超过 800MB 后仍按日期从旧到新删除并完整重建。
```

- [ ] **Step 2: Record measured validation results**

Update `docs/发布记录.md` with the measured import duration, retained dates, package size, snapshot count, deduplicated-driver count, worker benchmark, lookup shard maximum, and progress monotonic result.

- [ ] **Step 3: Review the final diff and ensure production data is excluded**

```bash
git status --short
git diff --check
git diff -- scripts/import-driver-data.py tests/test_import_driver_data.py docs/技术方案.md docs/每日更新说明.md docs/发布记录.md
```

Expected: only scripts, tests, and documentation are tracked; no `dist/`, real Excel, CSV, JSON driver details, or lookup shards are added.

- [ ] **Step 4: Commit and tag the verified optimization**

```bash
git add scripts/import-driver-data.py tests/test_import_driver_data.py docs/技术方案.md docs/每日更新说明.md docs/发布记录.md docs/superpowers
git commit -m "perf: accelerate seven-day daily imports"
git tag -a "风险前哨导入性能优化版-20260715" -m "优化近七天数据导入扫描次数，保持查询与 CDN 格式不变"
```

- [ ] **Step 5: Push when GitHub is reachable**

```bash
git push origin main
git push origin "风险前哨导入性能优化版-20260715"
```

Expected: both commands succeed; if the network is unavailable, retain the local commit and tag and report that push is pending.
