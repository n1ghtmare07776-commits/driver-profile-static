import gzip
import json
import subprocess
import sys
import tempfile
from importlib.machinery import SourceFileLoader
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IMPORT_SCRIPT = ROOT / "scripts" / "import-driver-data.py"
BACKFILL_SCRIPT = ROOT / "scripts" / "backfill-seven-day-online-duration.py"


def load_import_module():
    return SourceFileLoader("service_average_import", str(IMPORT_SCRIPT)).load_module()


def sample_driver(driver_id, rolling_online_duration, rank):
    item = {
        "driverId": driver_id,
        "city": "北京市",
        "cityLevel": "一线",
        "company": "示例公司",
        "product": "快车",
        "riskTierRank": rank,
        "strategyKeys": ["regular-care"],
    }
    if rolling_online_duration is not None:
        item["lately_7d_except_sub_online_dur_hour"] = rolling_online_duration
    return item


def decode_lookup_rows(data_dir):
    index = json.loads((data_dir / "driver-lookup-index.json").read_text(encoding="utf-8"))
    decoded = []
    for relative_path in index["files"].values():
        payload = json.loads(gzip.decompress((data_dir / relative_path).read_bytes()))
        schema = payload["schema"]
        dictionary = payload.get("dict", {})
        for row in payload["rows"]:
            raw = dict(zip(schema, row))
            decoded.append(
                {
                    "driverId": str(raw.get("driverId") or ""),
                    "avgOnlineDuration7d": raw.get("avgOnlineDuration7d"),
                    "dataDate": dictionary.get("dates", [])[raw["dataDate"]],
                }
            )
    return decoded


def test_derived_indexes_use_rolling_seven_day_online_duration():
    temp_root = tempfile.TemporaryDirectory()
    data_dir = Path(temp_root.name) / "dist" / "data"
    daily_dir = data_dir / "daily"
    daily_dir.mkdir(parents=True)
    import_module = load_import_module()
    dates_and_drivers = [
        (
            "2026-07-13",
            [
                sample_driver("1001", 14, 30),
                sample_driver("1002", None, 60),
                sample_driver("1003", 14, 5),
            ],
        ),
        (
            "2026-07-14",
            [
                sample_driver("1001", 21, 20),
                sample_driver("1002", None, 50),
            ],
        ),
        (
            "2026-07-15",
            [
                sample_driver("1001", 0, 10),
                sample_driver("1002", None, 40),
            ],
        ),
    ]

    files = []
    for data_date, drivers in dates_and_drivers:
        relative_path = f"daily/drivers-{data_date}.json"
        import_module.write_json(
            data_dir / relative_path,
            import_module.encode_daily_payload(data_date, drivers),
        )
        files.append({"date": data_date, "path": relative_path, "row_count": len(drivers)})
    import_module.write_json(
        data_dir / "drivers.json",
        {
            "mode": "daily-static-index",
            "latestDate": "2026-07-15",
            "dates": [item["date"] for item in files],
            "files": files,
        },
    )

    subprocess.run(
        ["node", str(ROOT / "scripts" / "build-filter-index.mjs"), str(data_dir)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
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
        capture_output=True,
        text=True,
    )

    filter_payload = json.loads(gzip.decompress((data_dir / "filter-index.json.gz").read_bytes()))
    filter_schema = filter_payload["schema"]
    driver_id_index = filter_schema.index("driverId")
    average_index = filter_schema.index("avgOnlineDuration7d")
    driver_1001_rows = [row for row in filter_payload["rows"] if str(row[driver_id_index]) == "1001"]
    driver_1002_rows = [row for row in filter_payload["rows"] if str(row[driver_id_index]) == "1002"]

    assert len(driver_1001_rows) == 3
    assert sorted(row[average_index] for row in driver_1001_rows) == [0, 2, 3]
    assert len(driver_1002_rows) == 3
    assert all(row[average_index] is None for row in driver_1002_rows)
    assert "avgServiceDuration7d" not in filter_schema
    assert "serviceDurationSampleDays" not in filter_schema

    lookup_rows = decode_lookup_rows(data_dir)
    driver_1001_lookup = next(item for item in lookup_rows if item["driverId"] == "1001")
    driver_1002_lookup = next(item for item in lookup_rows if item["driverId"] == "1002")
    driver_1003_lookup = next(item for item in lookup_rows if item["driverId"] == "1003")
    assert driver_1001_lookup["avgOnlineDuration7d"] == 0
    assert driver_1001_lookup["dataDate"] == "2026-07-15"
    assert driver_1002_lookup["avgOnlineDuration7d"] is None
    assert driver_1003_lookup["avgOnlineDuration7d"] == 2
    temp_root.cleanup()


def test_backfill_preserves_rows_and_adds_rolling_online_field():
    temp_root = tempfile.TemporaryDirectory()
    root = Path(temp_root.name)
    data_dir = root / "dist" / "data"
    daily_dir = data_dir / "daily"
    daily_dir.mkdir(parents=True)
    source_path = root / "source.csv"
    source_path.write_text(
        "司机id,近7日非预约单在线时长（小时）\n1001,14\n1002,0\n",
        encoding="utf-8",
    )
    daily_path = daily_dir / "drivers-2026-07-15.json"
    daily_path.write_text(
        json.dumps(
            {
                "mode": "daily-static-compact",
                "date": "2026-07-15",
                "schema": ["driverId", "riskTierRank"],
                "dict": {},
                "rows": [["1001", 1], ["1002", 2], ["1003", 3]],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    subprocess.run(
        [
            sys.executable,
            str(BACKFILL_SCRIPT),
            "--data-dir",
            str(data_dir),
            "--date-source",
            f"2026-07-15={source_path}",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    payload = json.loads(daily_path.read_text(encoding="utf-8"))
    assert len(payload["rows"]) == 3
    value_index = payload["schema"].index("lately_7d_except_sub_online_dur_hour")
    assert [row[value_index] for row in payload["rows"]] == [14, 0, None]
    temp_root.cleanup()


if __name__ == "__main__":
    test_derived_indexes_use_rolling_seven_day_online_duration()
    test_backfill_preserves_rows_and_adds_rolling_online_field()
