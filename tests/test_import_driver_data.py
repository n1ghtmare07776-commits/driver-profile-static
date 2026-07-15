import gzip
import json
import subprocess
import sys
import tempfile
from datetime import datetime
from importlib.machinery import SourceFileLoader
from pathlib import Path
from unittest.mock import patch

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "import-driver-data.py"


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


def test_import_driver_data_generates_stable_static_dataset():
    tmp_root = tempfile.TemporaryDirectory()
    tmp_path = Path(tmp_root.name)
    source = tmp_path / "司机库数据_20260706.xlsx"
    output_dir = tmp_path / "dist" / "data"
    frontend_path = output_dir.parent / "index.html"
    frontend_path.parent.mkdir(parents=True, exist_ok=True)
    frontend_path.write_text("x" * 8192, encoding="utf-8")
    stale_files = [
        output_dir / "drivers-2026-07-03-000.json",
        output_dir / "profiles-2026-07-03-000.json",
        output_dir / "profiles-2026-07-03-index.json",
        output_dir / "field-labels.json",
    ]
    output_dir.mkdir(parents=True)
    for stale_file in stale_files:
        stale_file.write_text("{}", encoding="utf-8")
    rows = [
        {
            "driver_id": "100000000001",
            "product_level2_name": "快车",
            "age": 56,
            "resident_city_name": "北京市",
            "city_level": "一线",
            "company_name": "示例公司A",
            "consecutive_days": 5,
            "consecutive_days_max": 12,
            "online_dur_hour": 11.5,
            "server_dur_hour": 9.5,
            "server_dur_hour_30d": 180,
            "order_cnt_21_09_7d_rate": 0.42,
            "sleep_deprivation_days": 2,
            "risk_tier_rank": 128,
            "risk_tier_score": 82.1,
            "tired_score": 76.3,
            "is_organized": "是",
            "dt": "2026-07-06",
        },
        {
            "driver_id": "100000000002",
            "product_level2_name": "专车",
            "age": 44,
            "resident_city_name": "上海市",
            "city_level": "一线",
            "company_name": "示例公司B",
            "consecutive_days": 1,
            "consecutive_days_max": 4,
            "online_dur_hour": 6.8,
            "server_dur_hour": 3.2,
            "server_dur_hour_30d": 80,
            "order_cnt_21_09_7d_rate": 0.13,
            "sleep_deprivation_days": 0,
            "risk_tier_rank": 980,
            "risk_tier_score": 45.4,
            "tired_score": 31.2,
            "is_organized": "否",
            "dt": "2026-06-29",
        },
    ]
    pd.DataFrame(rows).to_excel(source, index=False)

    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            str(source),
            "--out-dir",
            str(output_dir),
            "--upload-date",
            "2026-07-06",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr

    manifest = json.loads((output_dir / "manifest.json").read_text())
    assert manifest["upload_date"] == "2026-07-06"
    assert manifest["window_start"] == "2026-06-30"
    assert manifest["window_end"] == "2026-07-06"
    assert manifest["row_count"] == 1
    assert manifest["package_size_limit_mb"] == 800
    actual_size_mb = round(
        sum(path.stat().st_size for path in output_dir.parent.rglob("*") if path.is_file()) / 1024 / 1024,
        3,
    )
    assert abs(manifest["package_size_mb"] - actual_size_mb) <= 0.001

    drivers = json.loads((output_dir / "drivers.json").read_text())
    assert drivers["mode"] == "daily-static-index"
    assert drivers["latestDate"] == "2026-07-06"
    assert drivers["files"] == [
        {
            "date": "2026-07-06",
            "path": "daily/drivers-2026-07-06.json",
            "row_count": 1,
        }
    ]
    daily_path = output_dir / "daily" / "drivers-2026-07-06.json"
    daily_payload = json.loads(daily_path.read_text())
    daily_text = daily_path.read_text(encoding="utf-8")
    assert daily_payload["mode"] == "daily-static-compact"
    assert daily_payload["date"] == "2026-07-06"
    assert daily_payload["schema"][0] == "driverId"
    assert daily_payload["rows"][0][0] == "100000000001"
    assert daily_payload["dict"]["cities"] == ["北京市"]
    assert daily_payload["dict"]["companies"] == ["示例公司A"]
    assert "drivers" not in daily_payload
    assert "summary" not in daily_text
    assert "strategies" not in daily_text
    assert "高龄司机" not in daily_text
    assert "建议关注司机服务时长" not in daily_text
    assert (output_dir / "strategy-rules.json").exists()
    assert (output_dir / "filter-index.json.gz").exists()
    assert not (output_dir / "filter-index.json").exists()
    lookup_index = json.loads((output_dir / "driver-lookup-index.json").read_text())
    assert lookup_index["source_dates"] == ["2026-07-06"]
    assert lookup_index["driver_count"] == 1
    assert lookup_index["files"]
    assert all(path.endswith(".json.gz") for path in lookup_index["files"].values())
    sample_lookup_path = output_dir / next(iter(lookup_index["files"].values()))
    sample_lookup = json.loads(gzip.decompress(sample_lookup_path.read_bytes()))
    assert sample_lookup["mode"] == "driver-direct-lookup-compact"
    assert not (output_dir / "driver-index.json").exists()
    assert not (output_dir / "profiles").exists()
    for stale_file in stale_files:
        assert not stale_file.exists()

    import_module = load_import_module()
    driver = import_module.decode_daily_payload(daily_payload)[0]
    assert driver["driverId"] == "100000000001"
    assert driver["dataDate"] == "2026-07-06"
    assert driver["cityLevel"] == "一线"
    assert driver["isOrganized"] == "是"
    assert "summary" not in driver
    assert "strategies" not in driver
    assert "senior-driver" in driver["strategyKeys"]
    assert "service-duration-high" in driver["strategyKeys"]
    assert "night-work" in driver["strategyKeys"]
    assert "regular-care" not in driver["strategyKeys"]
    thresholds = json.loads((output_dir / "strategy-thresholds.json").read_text())
    assert any(rule["policy"] == "case_mean" for rule in thresholds["rules"])
    assert not any(rule.get("policy") == "manual_value" for rule in thresholds["rules"])
    assert not any("fallback_value" in rule for rule in thresholds["rules"])
    assert all(
        rule.get("threshold_label") == "case均值"
        for rule in thresholds["rules"]
        if rule.get("policy") == "case_mean"
    )
    for disallowed_wording in ["\u521d\u7248", "\u53c2\u8003\u9608\u503c"]:
        assert disallowed_wording not in json.dumps(thresholds, ensure_ascii=False)
    assert "case均值" in json.dumps(thresholds, ensure_ascii=False)
    tmp_root.cleanup()


def test_build_dataset_summary_matches_loaded_window():
    tmp_root = tempfile.TemporaryDirectory()
    tmp_path = Path(tmp_root.name)
    module = load_import_module()
    drivers = [
        sample_driver("1001", "2026-07-14", company="公司A"),
        sample_driver("1002", "2026-07-15", city="上海市", company="公司B", product="专车"),
    ]

    summary = module.build_dataset_summary(tmp_path, drivers)

    assert summary["row_count"] == 2
    assert summary["dates"] == ["2026-07-14", "2026-07-15"]
    assert sum(item["row_count"] for item in summary["daily_files"]) == 2
    assert summary["filter_options"] == {
        "cities": ["上海市", "北京市"],
        "companies": ["公司A", "公司B"],
        "products": ["专车", "快车"],
        "dates": ["2026-07-14", "2026-07-15"],
    }
    tmp_root.cleanup()


def test_write_static_indexes_uses_summary_without_reading_daily_files():
    tmp_root = tempfile.TemporaryDirectory()
    tmp_path = Path(tmp_root.name)
    module = load_import_module()
    summary = module.build_dataset_summary(
        tmp_path,
        [sample_driver("1001", "2026-07-15")],
    )

    with patch.object(module, "read_static_drivers_file", side_effect=AssertionError("daily file reread")):
        module.write_static_indexes(
            tmp_path,
            summary,
            "2026-07-15",
            datetime.strptime("2026-07-09", "%Y-%m-%d").date(),
            datetime.strptime("2026-07-15", "%Y-%m-%d").date(),
            800,
        )

    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["row_count"] == 1
    assert manifest["daily_files"][0]["row_count"] == 1
    tmp_root.cleanup()


def test_enforce_size_limit_reuses_summary_when_package_is_under_limit():
    tmp_root = tempfile.TemporaryDirectory()
    tmp_path = Path(tmp_root.name)
    output_dir = tmp_path / "dist" / "data"
    output_dir.mkdir(parents=True)
    module = load_import_module()
    summary = module.build_dataset_summary(
        output_dir,
        [sample_driver("1001", "2026-07-15")],
    )

    with patch.object(module, "load_daily_static_drivers", side_effect=AssertionError("window reloaded")):
        returned_summary, size_control = module.enforce_size_limit(
            output_dir,
            "2026-07-15",
            datetime.strptime("2026-07-09", "%Y-%m-%d").date(),
            datetime.strptime("2026-07-15", "%Y-%m-%d").date(),
            800,
            summary,
        )

    assert returned_summary is summary
    assert size_control["actual_dates"] == ["2026-07-15"]
    assert size_control["dropped_dates"] == []
    tmp_root.cleanup()


def test_load_daily_static_drivers_rejects_file_date_mismatch():
    tmp_root = tempfile.TemporaryDirectory()
    tmp_path = Path(tmp_root.name)
    output_dir = tmp_path / "dist" / "data"
    daily_dir = output_dir / "daily"
    daily_dir.mkdir(parents=True)
    (daily_dir / "drivers-2026-07-14.json").write_text(
        json.dumps(
            {
                "mode": "daily-static",
                "date": "2026-07-15",
                "drivers": [sample_driver("1001", "2026-07-15")],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    module = load_import_module()

    try:
        module.load_daily_static_drivers(
            output_dir,
            datetime.strptime("2026-07-14", "%Y-%m-%d").date(),
            datetime.strptime("2026-07-15", "%Y-%m-%d").date(),
        )
    except ValueError as error:
        assert "drivers-2026-07-14.json" in str(error)
        assert "2026-07-15" in str(error)
    else:
        raise AssertionError("日文件名与司机数据日期不一致时应停止导入")
    tmp_root.cleanup()


def test_import_driver_data_preserves_independent_daily_files_in_window():
    tmp_root = tempfile.TemporaryDirectory()
    tmp_path = Path(tmp_root.name)
    output_dir = tmp_path / "dist" / "data"
    output_dir.mkdir(parents=True)
    old_daily_dir = output_dir / "daily"
    old_daily_dir.mkdir()
    (old_daily_dir / "drivers-2026-07-03.json").write_text(
        json.dumps(
            {
                "mode": "daily-static",
                "date": "2026-07-03",
                "drivers": [
                    {
                        "driverId": "100000000003",
                        "city": "北京市",
                        "company": "示例公司C",
                        "product": "快车",
                        "dataDate": "2026-07-03",
                        "strategyKeys": ["regular-care"],
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    source = tmp_path / "司机库数据_20260707.xlsx"
    pd.DataFrame(
        [
            {
                "driver_id": "100000000007",
                "product_level2_name": "快车",
                "age": 45,
                "resident_city_name": "北京市",
                "company_name": "示例公司D",
                "consecutive_days": 2,
                "server_dur_hour": 6,
                "server_dur_sum_30d": 120,
                "order_cnt_21_09_7d_rate": 0.2,
                "sleep_deprivation_days": 0,
                "is_organized": "否",
                "dt": "2026-07-07",
            }
        ]
    ).to_excel(source, index=False)

    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            str(source),
            "--out-dir",
            str(output_dir),
            "--upload-date",
            "2026-07-07",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert (old_daily_dir / "drivers-2026-07-03.json").exists()
    assert (old_daily_dir / "drivers-2026-07-07.json").exists()
    index = json.loads((output_dir / "drivers.json").read_text())
    assert index["mode"] == "daily-static-index"
    assert index["dates"] == ["2026-07-03", "2026-07-07"]
    assert index["latestDate"] == "2026-07-07"
    assert {item["date"]: item["row_count"] for item in index["files"]} == {
        "2026-07-03": 1,
        "2026-07-07": 1,
    }
    manifest = json.loads((output_dir / "manifest.json").read_text())
    assert manifest["row_count"] == 2
    assert manifest["data_mode"] == "daily_static"
    lookup_index = json.loads((output_dir / "driver-lookup-index.json").read_text())
    assert lookup_index["source_dates"] == ["2026-07-03", "2026-07-07"]
    tmp_root.cleanup()


def test_import_driver_data_drops_oldest_daily_files_when_package_exceeds_limit():
    tmp_root = tempfile.TemporaryDirectory()
    tmp_path = Path(tmp_root.name)
    output_dir = tmp_path / "dist" / "data"
    daily_dir = output_dir / "daily"
    daily_dir.mkdir(parents=True)
    large_summary = "旧日期数据" * 10000
    (daily_dir / "drivers-2026-07-03.json").write_text(
        json.dumps(
            {
                "mode": "daily-static",
                "date": "2026-07-03",
                "drivers": [
                    {
                        "driverId": "100000000003",
                        "city": "北京市",
                        "company": "示例公司C",
                        "product": "快车",
                        "dataDate": "2026-07-03",
                        "strategyKeys": ["regular-care"],
                        "strategyEvidence": {"regular-care": large_summary},
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    source = tmp_path / "司机库数据_20260707.xlsx"
    pd.DataFrame(
        [
            {
                "driver_id": "100000000007",
                "product_level2_name": "快车",
                "age": 45,
                "resident_city_name": "北京市",
                "company_name": "示例公司D",
                "consecutive_days": 2,
                "server_dur_hour": 6,
                "server_dur_sum_30d": 120,
                "order_cnt_21_09_7d_rate": 0.2,
                "sleep_deprivation_days": 0,
                "is_organized": "否",
                "dt": "2026-07-07",
            }
        ]
    ).to_excel(source, index=False)

    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            str(source),
            "--out-dir",
            str(output_dir),
            "--upload-date",
            "2026-07-07",
            "--size-limit-mb",
            "0.06",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert not (daily_dir / "drivers-2026-07-03.json").exists()
    assert (daily_dir / "drivers-2026-07-07.json").exists()
    index = json.loads((output_dir / "drivers.json").read_text())
    assert index["dates"] == ["2026-07-07"]
    manifest = json.loads((output_dir / "manifest.json").read_text())
    assert manifest["actual_dates"] == ["2026-07-07"]
    assert manifest["dropped_dates"] == ["2026-07-03"]
    assert manifest["drop_reason"] == "package_size_limit"
    assert manifest["package_size_mb"] <= manifest["package_size_limit_mb"]
    lookup_index = json.loads((output_dir / "driver-lookup-index.json").read_text())
    assert lookup_index["source_dates"] == ["2026-07-07"]
    tmp_root.cleanup()


if __name__ == "__main__":
    test_import_driver_data_generates_stable_static_dataset()
    test_build_dataset_summary_matches_loaded_window()
    test_write_static_indexes_uses_summary_without_reading_daily_files()
    test_enforce_size_limit_reuses_summary_when_package_is_under_limit()
    test_load_daily_static_drivers_rejects_file_date_mismatch()
    test_import_driver_data_preserves_independent_daily_files_in_window()
    test_import_driver_data_drops_oldest_daily_files_when_package_exceeds_limit()
