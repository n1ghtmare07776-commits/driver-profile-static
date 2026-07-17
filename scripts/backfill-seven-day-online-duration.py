#!/usr/bin/env python3
"""Backfill rolling seven-day online duration into compact daily files."""

import argparse
import io
import json
import math
import zipfile
from pathlib import Path

import pandas as pd


TARGET_FIELD = "lately_7d_except_sub_online_dur_hour"
SOURCE_ID_FIELDS = ("司机id", "driver_id", "driverId")
SOURCE_VALUE_FIELDS = ("近7日非预约单在线时长（小时）", TARGET_FIELD)


def parse_args():
    parser = argparse.ArgumentParser(description="回填近7日非预约单在线时长。")
    parser.add_argument("--data-dir", default="dist/data", help="静态数据目录。")
    parser.add_argument(
        "--date-source",
        action="append",
        required=True,
        metavar="YYYY-MM-DD=PATH",
        help="日期与原始 Excel/CSV/ZIP 的对应关系，可重复传入。",
    )
    return parser.parse_args()


def clean_id(value):
    text = str(value or "").strip()
    if text.lower() in {"", "nan", "none"}:
        return ""
    return text[:-2] if text.endswith(".0") else text


def finite_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return int(number) if number.is_integer() else number


def selected_columns(frame):
    id_field = next((field for field in SOURCE_ID_FIELDS if field in frame.columns), None)
    value_field = next((field for field in SOURCE_VALUE_FIELDS if field in frame.columns), None)
    if not id_field or not value_field:
        return {}
    result = {}
    for driver_id, value in frame[[id_field, value_field]].itertuples(index=False, name=None):
        normalized_id = clean_id(driver_id)
        if normalized_id:
            result[normalized_id] = finite_number(value)
    return result


def read_table(source, suffix):
    usecols = lambda column: column in SOURCE_ID_FIELDS or column in SOURCE_VALUE_FIELDS
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(source, dtype=str, usecols=usecols).fillna("")
    if suffix == ".csv":
        return pd.read_csv(source, dtype=str, usecols=usecols).fillna("")
    raise ValueError(f"不支持的源文件格式：{suffix}")


def read_source(path):
    path = Path(path)
    values = {}
    if path.suffix.lower() != ".zip":
        values.update(selected_columns(read_table(path, path.suffix.lower())))
        return values
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            suffix = Path(name).suffix.lower()
            if suffix not in {".xlsx", ".xls", ".csv"}:
                continue
            with archive.open(name) as member:
                content = io.BytesIO(member.read())
            values.update(selected_columns(read_table(content, suffix)))
    return values


def write_json(path, payload):
    content = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def backfill_daily(data_dir, data_date, source_path):
    daily_path = data_dir / "daily" / f"drivers-{data_date}.json"
    if not daily_path.exists():
        raise SystemExit(f"找不到日文件：{daily_path}")
    source_values = read_source(source_path)
    payload = json.loads(daily_path.read_text(encoding="utf-8"))
    schema = payload.get("schema", [])
    rows = payload.get("rows", [])
    if "driverId" not in schema:
        raise SystemExit(f"日文件缺少 driverId：{daily_path}")
    driver_id_index = schema.index("driverId")
    if TARGET_FIELD in schema:
        value_index = schema.index(TARGET_FIELD)
    else:
        schema.append(TARGET_FIELD)
        value_index = len(schema) - 1
        for row in rows:
            row.append(None)
    matched = 0
    for row in rows:
        driver_id = clean_id(row[driver_id_index])
        value = source_values.get(driver_id)
        row[value_index] = value
        if driver_id in source_values:
            matched += 1
    payload["schema"] = schema
    write_json(daily_path, payload)
    print(f"{data_date}: 回填 {matched}/{len(rows)} 条，源数据 {len(source_values)} 条")


def main():
    args = parse_args()
    data_dir = Path(args.data_dir)
    for item in args.date_source:
        if "=" not in item:
            raise SystemExit(f"--date-source 格式错误：{item}")
        data_date, source_path = item.split("=", 1)
        backfill_daily(data_dir, data_date.strip(), source_path.strip())


if __name__ == "__main__":
    main()
