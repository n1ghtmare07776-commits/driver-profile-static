#!/usr/bin/env python3
"""Build balanced hash shards for direct driver lookups.

The normal daily files remain the source of truth for combination filters. These
shards only keep the fields needed by the current profile and strategy views so
an exact driver ID search does not need to download a whole daily detail file.
"""

import argparse
import gzip
import json
import math
import tempfile
from datetime import datetime, timezone
from pathlib import Path


DIRECT_SCHEMA = [
    "driverId",
    "city",
    "cityLevel",
    "company",
    "product",
    "dataDate",
    "isOrganized",
    "age",
    "consecutive_days",
    "server_dur_hour",
    "server_dur_hour_30d",
    "server_dur_sum_30d",
    "order_cnt_21_09_7d_rate",
    "sleep_deprivation_days",
    "past_7_day_non_listening_period",
    "riskTierRank",
    "riskTierScore",
    "tiredScore",
    "strategyKeys",
    "strategyEvidence",
]

# Full daily JSON stays available for profile details. This index keeps only the
# fields needed to filter and render the result list without downloading it.
DICT_FIELDS = {
    "city": "cities",
    "cityLevel": "cityLevels",
    "company": "companies",
    "product": "products",
    "dataDate": "dates",
    "isOrganized": "isOrganized",
}


def parse_args():
    parser = argparse.ArgumentParser(description="构建司机 ID 直达查询索引。")
    parser.add_argument("--data-dir", default="dist/data", help="静态数据目录，默认 dist/data")
    parser.add_argument("--bucket-count", type=int, default=128, help="稳定哈希分桶数，默认 128")
    parser.add_argument("--prefix-length", type=int, help=argparse.SUPPRESS)
    return parser.parse_args()


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def write_gzip_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    content = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    with gzip.open(path, "wb", compresslevel=6) as file:
        file.write(content)


def directory_size(path):
    return sum(file.stat().st_size for file in path.rglob("*") if file.is_file())


def release_root(data_dir):
    return data_dir.parent if data_dir.name == "data" else data_dir


def number_rank(value):
    try:
        rank = float(value)
    except (TypeError, ValueError):
        return math.inf
    return rank if math.isfinite(rank) and rank > 0 else math.inf


def dict_value(values, index):
    return values[index] if isinstance(index, int) and 0 <= index < len(values) else ""


def compact_record(payload, row):
    schema = payload.get("schema", [])
    raw = dict(zip(schema, row))
    dictionary = payload.get("dict", {})
    strategy_keys = [
        dict_value(dictionary.get("strategyKeys", []), index)
        for index in raw.get("strategyKeys") or []
    ]
    strategy_keys = [key for key in strategy_keys if key]
    evidence_values = raw.get("strategyEvidence") or []
    strategy_evidence = {
        key: evidence_values[index]
        for index, key in enumerate(strategy_keys)
        if index < len(evidence_values) and evidence_values[index]
    }
    return {
        "driverId": str(raw.get("driverId") or ""),
        "city": dict_value(dictionary.get("cities", []), raw.get("city")),
        "cityLevel": dict_value(dictionary.get("cityLevels", []), raw.get("cityLevel")),
        "company": dict_value(dictionary.get("companies", []), raw.get("company")),
        "product": dict_value(dictionary.get("products", []), raw.get("product")),
        "dataDate": payload.get("date", ""),
        "isOrganized": dict_value(dictionary.get("isOrganized", []), raw.get("isOrganized")),
        "age": raw.get("age"),
        "consecutive_days": raw.get("consecutive_days"),
        "server_dur_hour": raw.get("server_dur_hour"),
        "server_dur_hour_30d": raw.get("server_dur_hour_30d"),
        "server_dur_sum_30d": raw.get("server_dur_sum_30d"),
        "order_cnt_21_09_7d_rate": raw.get("order_cnt_21_09_7d_rate"),
        "sleep_deprivation_days": raw.get("sleep_deprivation_days"),
        "past_7_day_non_listening_period": raw.get("past_7_day_non_listening_period"),
        "riskTierRank": raw.get("riskTierRank"),
        "riskTierScore": raw.get("riskTierScore"),
        "tiredScore": raw.get("tiredScore"),
        "strategyKeys": strategy_keys,
        "strategyEvidence": strategy_evidence,
    }


def unique_sorted(values):
    return sorted({str(value) for value in values if value is not None and str(value) != ""})


def fnv1a_bucket(value, bucket_count):
    hash_value = 2166136261
    for byte in str(value).encode("utf-8"):
        hash_value ^= byte
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return str(hash_value % bucket_count)


def encode_shard_payload(shard, records):
    dictionary = {
        dict_key: unique_sorted(record.get(field_name) for record in records)
        for field_name, dict_key in DICT_FIELDS.items()
    }
    dictionary["strategyKeys"] = unique_sorted(
        key for record in records for key in record.get("strategyKeys", [])
    )
    indexes = {
        key: {value: index for index, value in enumerate(values)}
        for key, values in dictionary.items()
    }
    rows = []
    for record in records:
        row = []
        for field_name in DIRECT_SCHEMA:
            if field_name in DICT_FIELDS:
                value = record.get(field_name, "")
                row.append(indexes[DICT_FIELDS[field_name]].get(str(value)) if value != "" else None)
            elif field_name == "strategyKeys":
                row.append([
                    indexes["strategyKeys"][key]
                    for key in record.get("strategyKeys", [])
                    if key in indexes["strategyKeys"]
                ])
            elif field_name == "strategyEvidence":
                evidence = record.get("strategyEvidence", {})
                row.append([evidence.get(key) for key in record.get("strategyKeys", [])])
            else:
                value = record.get(field_name)
                row.append(value if value not in (None, "") else None)
        rows.append(row)
    return {
        "mode": "driver-direct-lookup-compact",
        "shard": shard,
        "schema": DIRECT_SCHEMA,
        "dict": dictionary,
        "rows": rows,
    }


def main():
    args = parse_args()
    if args.bucket_count < 1:
        raise SystemExit("稳定哈希分桶数必须大于 0。")
    data_dir = Path(args.data_dir)
    index_path = data_dir / "drivers.json"
    if not index_path.exists():
        raise SystemExit(f"找不到日期索引：{index_path}")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    daily_files = index.get("files", [])
    if not daily_files:
        raise SystemExit("日期索引没有日文件。")

    lookup_dir = data_dir / "lookup"
    lookup_dir.mkdir(parents=True, exist_ok=True)
    for pattern in ("driver-*.json", "driver-*.json.gz"):
        for old_file in lookup_dir.glob(pattern):
            old_file.unlink()

    with tempfile.TemporaryDirectory(prefix="risk-sentinel-lookup-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        writers = {}
        try:
            for item in daily_files:
                source_path = data_dir / item["path"]
                payload = json.loads(source_path.read_text(encoding="utf-8"))
                if payload.get("mode") != "daily-static-compact":
                    continue
                for row in payload.get("rows", []):
                    record = compact_record(payload, row)
                    driver_id = record["driverId"]
                    if not driver_id:
                        continue
                    shard = fnv1a_bucket(driver_id, args.bucket_count)
                    if shard not in writers:
                        writers[shard] = (temp_dir / f"{int(shard):04d}.jsonl").open("w", encoding="utf-8")
                    writers[shard].write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
        finally:
            for writer in writers.values():
                writer.close()

        files = {}
        total_records = 0
        for candidate_path in sorted(temp_dir.glob("*.jsonl")):
            best_by_driver = {}
            for line in candidate_path.read_text(encoding="utf-8").splitlines():
                record = json.loads(line)
                current = best_by_driver.get(record["driverId"])
                if current is None or (
                    number_rank(record.get("riskTierRank")), record.get("dataDate", "")
                ) < (
                    number_rank(current.get("riskTierRank")), current.get("dataDate", "")
                ):
                    best_by_driver[record["driverId"]] = record
            shard = str(int(candidate_path.stem))
            records = sorted(best_by_driver.values(), key=lambda record: record["driverId"])
            output_name = f"driver-bucket-{int(shard):04d}.json.gz"
            write_gzip_json(lookup_dir / output_name, encode_shard_payload(shard, records))
            files[shard] = f"lookup/{output_name}"
            total_records += len(records)

    lookup_index = {
        "mode": "driver-direct-lookup-index",
        "shardMode": "fnv1a32-modulo",
        "bucketCount": args.bucket_count,
        "files": files,
        "driver_count": total_records,
        "source_dates": index.get("dates", []),
    }
    write_json(data_dir / "driver-lookup-index.json", lookup_index)
    generated_at = datetime.now(timezone.utc).isoformat()
    metadata_paths = []
    for metadata_name in ("manifest.json", "meta.json"):
        metadata_path = data_dir / metadata_name
        if metadata_path.exists():
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata["generated_at"] = generated_at
            metadata["driver_lookup_index"] = "driver-lookup-index.json"
            metadata.pop("driver_lookup_prefix_length", None)
            metadata["driver_lookup_shard_mode"] = "fnv1a32-modulo"
            metadata["driver_lookup_bucket_count"] = args.bucket_count
            write_json(metadata_path, metadata)
            metadata_paths.append(metadata_path)
    # Package size includes the metadata files themselves, so settle it after writes.
    for _ in range(3):
        package_size_mb = round(directory_size(release_root(data_dir)) / 1024 / 1024, 3)
        for metadata_path in metadata_paths:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata["package_size_mb"] = package_size_mb
            write_json(metadata_path, metadata)
    print(f"直达索引分片：{len(files)}")
    print(f"去重司机数：{total_records}")
    print(f"输出目录：{lookup_dir}")


if __name__ == "__main__":
    main()
