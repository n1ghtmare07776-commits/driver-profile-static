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


def sample_driver(driver_id, service_duration, rank):
    item = {
        "driverId": driver_id,
        "city": "北京市",
        "cityLevel": "一线",
        "company": "示例公司",
        "product": "快车",
        "riskTierRank": rank,
        "strategyKeys": ["regular-care"],
    }
    if service_duration is not None:
        item["server_dur_hour"] = service_duration
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
                    "avgServiceDuration7d": raw.get("avgServiceDuration7d"),
                    "serviceDurationSampleDays": raw.get("serviceDurationSampleDays"),
                    "dataDate": dictionary.get("dates", [])[raw["dataDate"]],
                }
            )
    return decoded


def test_derived_indexes_aggregate_available_service_duration_snapshots():
    temp_root = tempfile.TemporaryDirectory()
    data_dir = Path(temp_root.name) / "dist" / "data"
    daily_dir = data_dir / "daily"
    daily_dir.mkdir(parents=True)
    import_module = load_import_module()
    dates_and_drivers = [
        (
            "2026-07-13",
            [
                sample_driver("1001", 2, 30),
                sample_driver("1002", None, 60),
            ],
        ),
        (
            "2026-07-14",
            [
                sample_driver("1001", 4, 20),
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
    average_index = filter_schema.index("avgServiceDuration7d")
    sample_days_index = filter_schema.index("serviceDurationSampleDays")
    driver_1001_rows = [row for row in filter_payload["rows"] if str(row[driver_id_index]) == "1001"]
    driver_1002_rows = [row for row in filter_payload["rows"] if str(row[driver_id_index]) == "1002"]

    assert len(driver_1001_rows) == 3
    assert all(row[average_index] == 2 for row in driver_1001_rows)
    assert all(row[sample_days_index] == 3 for row in driver_1001_rows)
    assert len(driver_1002_rows) == 3
    assert all(row[average_index] is None for row in driver_1002_rows)
    assert all(row[sample_days_index] == 0 for row in driver_1002_rows)

    lookup_rows = decode_lookup_rows(data_dir)
    driver_1001_lookup = next(item for item in lookup_rows if item["driverId"] == "1001")
    driver_1002_lookup = next(item for item in lookup_rows if item["driverId"] == "1002")
    assert driver_1001_lookup["avgServiceDuration7d"] == 2
    assert driver_1001_lookup["serviceDurationSampleDays"] == 3
    assert driver_1001_lookup["dataDate"] == "2026-07-15"
    assert driver_1002_lookup["avgServiceDuration7d"] is None
    assert driver_1002_lookup["serviceDurationSampleDays"] == 0
    temp_root.cleanup()


if __name__ == "__main__":
    test_derived_indexes_aggregate_available_service_duration_snapshots()
