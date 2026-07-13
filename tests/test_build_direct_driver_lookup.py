import gzip
import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "build-direct-driver-lookup.py"


def fnv1a_bucket(value, bucket_count):
    hash_value = 2166136261
    for byte in str(value).encode("utf-8"):
        hash_value ^= byte
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return str(hash_value % bucket_count)


def test_direct_lookup_uses_balanced_hash_buckets():
    with tempfile.TemporaryDirectory() as temp_dir_name:
        data_dir = Path(temp_dir_name)
        daily_dir = data_dir / "daily"
        daily_dir.mkdir()
        schema = ["driverId", "riskTierRank"]
        driver_ids = [f"5805454024{index:05d}" for index in range(1000)]
        daily_path = daily_dir / "drivers-2026-07-13.json"
        daily_path.write_text(
            json.dumps(
                {
                    "mode": "daily-static-compact",
                    "date": "2026-07-13",
                    "schema": schema,
                    "dict": {},
                    "rows": [[driver_id, index + 1] for index, driver_id in enumerate(driver_ids)],
                },
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
        (data_dir / "drivers.json").write_text(
            json.dumps(
                {
                    "mode": "daily-static-index",
                    "dates": ["2026-07-13"],
                    "files": [
                        {
                            "date": "2026-07-13",
                            "path": "daily/drivers-2026-07-13.json",
                            "row_count": len(driver_ids),
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        for metadata_name in ("manifest.json", "meta.json"):
            (data_dir / metadata_name).write_text(
                json.dumps(
                    {
                        "generated_at": "2026-01-01T00:00:00+00:00",
                        "package_size_mb": 1,
                        "driver_lookup_prefix_length": 5,
                    }
                ),
                encoding="utf-8",
            )

        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--data-dir",
                str(data_dir),
                "--bucket-count",
                "128",
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr

        index = json.loads((data_dir / "driver-lookup-index.json").read_text())
        assert index["shardMode"] == "fnv1a32-modulo"
        assert index["bucketCount"] == 128
        assert "prefixLength" not in index
        assert len(index["files"]) >= 120

        actual_size_mb = round(
            sum(path.stat().st_size for path in data_dir.rglob("*") if path.is_file()) / 1024 / 1024,
            3,
        )
        manifest = json.loads((data_dir / "manifest.json").read_text())
        assert manifest["generated_at"] != "2026-01-01T00:00:00+00:00"
        assert abs(manifest["package_size_mb"] - actual_size_mb) <= 0.001
        assert "driver_lookup_prefix_length" not in manifest
        assert manifest["driver_lookup_shard_mode"] == "fnv1a32-modulo"
        assert manifest["driver_lookup_bucket_count"] == 128

        max_rows = 0
        for path in index["files"].values():
            payload = json.loads(gzip.decompress((data_dir / path).read_bytes()))
            max_rows = max(max_rows, len(payload["rows"]))
        assert max_rows < 20

        target_id = driver_ids[731]
        target_bucket = fnv1a_bucket(target_id, index["bucketCount"])
        target_payload = json.loads(
            gzip.decompress((data_dir / index["files"][target_bucket]).read_bytes())
        )
        driver_id_index = target_payload["schema"].index("driverId")
        assert target_id in {str(row[driver_id_index]) for row in target_payload["rows"]}


if __name__ == "__main__":
    test_direct_lookup_uses_balanced_hash_buckets()
