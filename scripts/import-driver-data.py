#!/usr/bin/env python3
import argparse
import json
import math
import re
import shutil
import sys
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STRATEGY_CONFIG = ROOT / "config" / "strategy-rules.json"
DEFAULT_SIZE_LIMIT_MB = 800
DEFAULT_REFERENCE_CANDIDATES = [
    ROOT / "死亡case事发前一段时间数据.xlsx",
    Path("/Users/didi/Desktop/司机卡片/死亡case事发前一段时间数据.xlsx"),
]

NUMERIC_FIELDS = [
    "age",
    "consecutive_days",
    "consecutive_days_max_6h",
    "min_sleep_duration",
    "peak_service_dur",
    "abnormal_driving_cnt",
    "temp_change_1d",
    "consecutive_days_max",
    "online_dur_hour",
    "order_cnt_21_09_7d_rate",
    "r_deep_night_peak",
    "sleep_deprivation_days",
    "server_dur_hour",
    "server_dur_sum_7d",
    "server_dur_hour_30d",
    "server_dur_sum_30d",
    "lately_30d_online_dur_hour",
    "lately_7d_except_sub_online_dur_hour",
    "past_7_day_non_listening_period",
    "non_listen_hours_7d",
    "non_listen_hours_7d_all",
    "high_pressure",
    "systolic_blood_pressure",
    "risk_tier_rank",
    "risk_tier_score",
    "tired_score",
]

STATIC_DRIVER_NUMERIC_FIELDS = [
    "age",
    "consecutive_days",
    "consecutive_days_max_6h",
    "min_sleep_duration",
    "peak_service_dur",
    "abnormal_driving_cnt",
    "temp_change_1d",
    "server_dur_hour",
    "server_dur_sum_7d",
    "server_dur_hour_30d",
    "server_dur_sum_30d",
    "order_cnt_21_09_7d_rate",
    "r_deep_night_peak",
    "sleep_deprivation_days",
    "past_7_day_non_listening_period",
    "risk_tier_rank",
    "risk_tier_score",
    "tired_score",
]

COMPACT_DRIVER_SCHEMA = [
    "driverId",
    "city",
    "cityLevel",
    "company",
    "product",
    "isOrganized",
    "age",
    "consecutive_days",
    "consecutive_days_max_6h",
    "min_sleep_duration",
    "peak_service_dur",
    "abnormal_driving_cnt",
    "temp_change_1d",
    "server_dur_hour",
    "server_dur_sum_7d",
    "server_dur_hour_30d",
    "server_dur_sum_30d",
    "order_cnt_21_09_7d_rate",
    "r_deep_night_peak",
    "sleep_deprivation_days",
    "past_7_day_non_listening_period",
    "riskTierRank",
    "riskTierScore",
    "tiredScore",
    "strategyKeys",
    "strategyEvidence",
]

COMPACT_DICT_FIELDS = {
    "city": "cities",
    "cityLevel": "cityLevels",
    "company": "companies",
    "product": "products",
    "isOrganized": "isOrganized",
}

# Chinese column name → English field name mapping for 健康复盘司机库 xlsx
CHINESE_FIELD_MAP = {
    "司机id": "driver_id",
    "常驻城市": "resident_city_name",
    "城市等级": "city_level",
    "公司名称": "company_name",
    "业务线": "product_level2_name",
    "年龄": "age",
    "连续出车天数": "consecutive_days",
    "近90天最高连日出车天数": "consecutive_days_max",
    "连续多天服务超过6小时的最大天数": "consecutive_days_max_6h",
    "连续6小时高强度天数": "consecutive_days_max_6h",
    "最短睡眠时长": "min_sleep_duration",
    "最短睡眠时长（小时）": "min_sleep_duration",
    "高峰期服务时长": "peak_service_dur",
    "高峰期服务时长（小时）": "peak_service_dur",
    "异常驾驶次数": "abnormal_driving_cnt",
    "近1天气温变化幅度": "temp_change_1d",
    "近1天气温变化幅度（度）": "temp_change_1d",
    "当日在线时长（小时）": "online_dur_hour",
    "当日服务时长（小时）": "server_dur_hour",
    "近7日非预约单在线时长（小时）": "lately_7d_except_sub_online_dur_hour",
    "近30天在线时长（小时）": "lately_30d_online_dur_hour",
    "近30天在非预约单线时长（小时）": "server_dur_hour_30d",
    "近30日服务时长（小时）": "server_dur_sum_30d",
    "近7天服务时长总和": "server_dur_sum_7d",
    "近7天服务时长总和（小时）": "server_dur_sum_7d",
    "近7天21-9点完单量占比": "order_cnt_21_09_7d_rate",
    "深夜高峰服务偏好/占比": "r_deep_night_peak",
    "深夜高峰服务占比": "r_deep_night_peak",
    "近7天睡眠不足天数": "sleep_deprivation_days",
    "健康拍-高压": "systolic_blood_pressure",
    "测量-高压": "high_pressure",
    "当日模型排名": "risk_tier_rank",
    "司机库分层分数": "risk_tier_score",
    "劳累分场景分数": "tired_score",
    "司机分层排名": "risk_tier_rank",
    "是否睡眠不足": "is_sleep_deprived",
    "是否常规夜班司机": "is_regular_night",
    "是否出车规律": "is_regular_schedule",
    "是否长期连日出车": "is_long_consecutive",
    "是否突然累": "is_sudden_fatigue",
    "入库来源": "source_rules",
    "是否组织化": "is_organized",
    "加盟类型lv1": "join_type_l1",
    "加盟类型l2": "join_type_l2",
    "健康拍-血压等级": "bp_health_level",
    "整体血压风险": "bp_risk_overall",
    "测量-血压等级": "bp_measure_level",
    "健康拍-低压": "diastolic_bp",
    "测量-低压": "diastolic_bp_measure",
    "近7天最高劳累劳指数": "fatigue_index_7d",
    "健康拍-高压": "systolic_bp_health",
    "组织化司机队长id": "team_leader_id",
    "当日模型百分比": "risk_percentile",
    "近7日最小模型排名": "risk_rank_7d_min",
    "近14日最小模型排名": "risk_rank_14d_min",
    "近30日最小模型排名": "risk_rank_30d_min",
    "近7日风险天数（1%天数）": "risk_days_7d",
    "近14日风险天数（1%天数）": "risk_days_14d",
    "近30日风险天数（1%天数）": "risk_days_30d",
    "近30天极高劳累风险天数": "extreme_fatigue_days_30d",
    "当日非预约单在线时长（小时）": "non_sub_online_hour",
    "当日完单量": "order_cnt_today",
    "近30天完单量": "order_cnt_30d",
    "近7天21点09点完单量": "order_cnt_21_09_7d",
    "近7天完单量": "order_cnt_7d",
    "近3天非预约单在线时长均值": "non_sub_online_avg_3d",
    "近4-10天非预约单在线时长均值": "non_sub_online_avg_4_10d",
    "近7天非听单时段（非预约单）": "non_listen_hours_7d",
    "近7天非听单时段（含预约单）": "non_listen_hours_7d_all",
    "身体基础系数": "body_base_coeff",
    "自评-高血糖": "self_high_blood_sugar",
    "自评-高血脂": "self_high_blood_lipid",
    "自评-高血压": "self_high_bp",
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="导入司机画像 xlsx/csv/json，生成 CDN 静态数据产物。"
    )
    parser.add_argument("source", help="输入文件路径，支持 .xlsx/.xls/.csv/.json")
    parser.add_argument("--out-dir", default="dist/data", help="输出目录，默认 dist/data")
    parser.add_argument("--upload-date", help="上传日期 YYYY-MM-DD；不传则从文件名或 dt 列推断")
    parser.add_argument("--date-field", default="dt", help="数据日期字段名，默认 dt")
    parser.add_argument("--size-limit-mb", type=float, default=DEFAULT_SIZE_LIMIT_MB, help="输出目录大小上限，默认 800MB")
    parser.add_argument(
        "--strategy-config",
        default=str(DEFAULT_STRATEGY_CONFIG),
        help="建议策略规则配置 JSON，默认 config/strategy-rules.json",
    )
    parser.add_argument(
        "--reference-data",
        default="",
        help="阈值参考样本文件，默认自动查找死亡case事发前一段时间数据.xlsx",
    )
    return parser.parse_args()


def clean_text(value):
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    text = str(value).strip()
    if text.lower() in {"nan", "nat", "none", "null"}:
        return ""
    return text


def clean_id(value):
    text = clean_text(value)
    return re.sub(r"\.0$", "", text)


def to_number(value):
    text = clean_text(value)
    if text == "":
        return None
    try:
      number = float(text)
    except ValueError:
      return None
    if math.isnan(number):
        return None
    return int(number) if number.is_integer() else number


@lru_cache(maxsize=1024)
def normalize_date_text(text):
    if text == "":
        return ""
    if re.fullmatch(r"\d{8}", text):
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    datetime_match = re.match(r"^(\d{4}-\d{2}-\d{2})[ T]\d{2}:\d{2}:\d{2}", text)
    if datetime_match:
        return datetime_match.group(1)
    parsed = pd.to_datetime(text, errors="coerce")
    if pd.isna(parsed):
        return ""
    return parsed.strftime("%Y-%m-%d")


def normalize_date(value):
    return normalize_date_text(clean_text(value))


def infer_upload_date(source_path, rows, date_field):
    filename_match = re.search(r"(20\d{6})", source_path.stem)
    if filename_match:
        return normalize_date(filename_match.group(1))
    dates = sorted({normalize_date(row.get(date_field)) for row in rows if normalize_date(row.get(date_field))})
    if dates:
        return dates[-1]
    raise SystemExit("无法推断上传日期：请使用 --upload-date YYYY-MM-DD，或确保文件名/数据列包含日期。")


def read_rows(source_path):
    suffix = source_path.suffix.lower()
    if suffix in {".xlsx", ".xls"}:
        frame = pd.read_excel(source_path, dtype=str)
    elif suffix == ".csv":
        frame = pd.read_csv(source_path, dtype=str)
    elif suffix == ".json":
        payload = json.loads(source_path.read_text(encoding="utf-8"))
        rows = payload.get("drivers", payload) if isinstance(payload, dict) else payload
        if not isinstance(rows, list):
            raise SystemExit("JSON 输入必须是数组，或包含 drivers 数组。")
    else:
        raise SystemExit("仅支持 .xlsx、.xls、.csv、.json 输入文件。")
    if suffix not in {".json"}:
        rows = frame.fillna("").to_dict(orient="records")
    return apply_field_mapping(rows)


def apply_field_mapping(rows):
    # Map Chinese column names to English field names for source and case reference files.
    if rows and any(k in CHINESE_FIELD_MAP for k in rows[0]):
        for row in rows:
            for cn, en in CHINESE_FIELD_MAP.items():
                if cn in row and en not in row:
                    row[en] = row[cn]
            if "近7天非听单时段（非预约单）" in row and "past_7_day_non_listening_period" not in row:
                row["past_7_day_non_listening_period"] = row["近7天非听单时段（非预约单）"]
    return rows


def get(row, *names):
    for name in names:
        if name in row and clean_text(row.get(name)) != "":
            return row.get(name)
    return ""


def display(value):
    text = clean_text(value)
    return text if text != "" else "暂无数据"


def format_number(value):
    if value is None:
        return "暂无数据"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return display(value)
    if math.isnan(number):
        return "暂无数据"
    return f"{number:.4f}".rstrip("0").rstrip(".")


def load_strategy_config(path):
    config_path = Path(path)
    if not config_path.exists():
        raise SystemExit(f"建议策略配置不存在：{config_path}")
    return json.loads(config_path.read_text(encoding="utf-8"))


def resolve_reference_data(path):
    if path:
        candidate = Path(path)
        return candidate if candidate.exists() else None
    for candidate in DEFAULT_REFERENCE_CANDIDATES:
        if candidate.exists():
            return candidate
    return None


def read_reference_rows(path):
    if not path:
        return []
    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xls"}:
        frame = pd.read_excel(path, dtype=str)
    elif suffix == ".csv":
        frame = pd.read_csv(path, dtype=str)
    elif suffix == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = payload.get("drivers", payload) if isinstance(payload, dict) else payload
        return apply_field_mapping(rows) if isinstance(rows, list) else []
    else:
        return []
    return apply_field_mapping(frame.fillna("").to_dict(orient="records"))


def collect_reference_metrics(strategy_config):
    metrics = set()
    for rule in strategy_config.get("rules", []):
        threshold = rule.get("threshold", {})
        if threshold.get("policy") in {"case_mean", "case_quantile"} and threshold.get("reference_metric"):
            metrics.add(threshold["reference_metric"])
        for item in rule.get("condition", {}).get("any", []) + rule.get("condition", {}).get("all", []):
            item_threshold = item.get("threshold", {})
            if item_threshold.get("policy") in {"case_mean", "case_quantile"} and item_threshold.get("reference_metric"):
                metrics.add(item_threshold["reference_metric"])
    return sorted(metrics)


def build_reference_stats(reference_rows, strategy_config):
    stats = {}
    for metric in collect_reference_metrics(strategy_config):
        values = [to_number(row.get(metric)) for row in reference_rows if metric in row]
        values = sorted(value for value in values if value is not None)
        if not values:
            stats[metric] = {"sample_count": 0, "reason": "reference_metric_missing_or_empty"}
            continue
        mean = sum(values) / len(values)
        stats[metric] = {
            "sample_count": len(values),
            "mean": mean,
            "median": values[len(values) // 2],
            "p75": values[min(len(values) - 1, int((len(values) - 1) * 0.75))],
            "max": values[-1],
        }
    return stats


def threshold_value_for(threshold, reference_stats):
    policy = threshold.get("policy")
    if policy == "manual_value":
        return threshold.get("value")
    reference_metric = threshold.get("reference_metric")
    metric_stats = reference_stats.get(reference_metric, {})
    if policy == "case_mean" and metric_stats.get("sample_count", 0) > 0:
        return metric_stats.get("mean")
    if policy == "case_quantile" and metric_stats.get("sample_count", 0) > 0:
        quantile = float(threshold.get("quantile", 0.75))
        values_key = "p75" if quantile == 0.75 else None
        if values_key:
            return metric_stats.get(values_key)
    return None


def threshold_missing_reason(threshold, reference_stats):
    reference_metric = threshold.get("reference_metric")
    if not reference_metric:
        return "reference_metric_missing"
    metric_stats = reference_stats.get(reference_metric)
    if not metric_stats:
        return "reference_metric_not_calculated"
    if metric_stats.get("sample_count", 0) <= 0:
        return metric_stats.get("reason", "reference_metric_empty")
    return "threshold_not_available"


def compare_numbers(driver_value, threshold_value, operator):
    if driver_value is None or threshold_value is None:
        return False
    if operator == ">":
        return driver_value > threshold_value
    if operator == ">=":
        return driver_value >= threshold_value
    if operator == "<":
        return driver_value < threshold_value
    if operator == "<=":
        return driver_value <= threshold_value
    if operator == "==":
        return driver_value == threshold_value
    return False


def threshold_relation_label(operator):
    if operator in {"<", "<="}:
        return "低于"
    return "高于"


def replace_template(template, context):
    text = template
    for key, value in context.items():
        text = text.replace("{{" + key + "}}", str(value))
    return text


def evaluate_leaf_condition(row, condition, reference_stats):
    operator = condition.get("operator")
    metric = condition.get("driver_metric", "")
    label = condition.get("driver_metric_label") or metric
    raw_value = get(row, metric)
    text_value = clean_text(raw_value)

    if operator in {"contains_any", "in", "not_blank"}:
        if operator == "not_blank":
            matched = text_value != ""
        elif operator == "contains_any":
            matched = any(value in text_value for value in condition.get("values", []))
        else:
            matched = text_value in set(condition.get("values", []))
        return {
            "matched": matched,
            "evidence": f"{label}{display(raw_value)}",
            "debug": {
                "operator": operator,
                "driverMetric": metric,
                "driverValue": text_value,
                "configuredValues": condition.get("values", []),
                "reason": "" if matched else "condition_not_matched",
            },
        }

    threshold = condition.get("threshold", {})
    driver_value = to_number(raw_value)
    threshold_value = threshold_value_for(threshold, reference_stats)
    threshold_operator = threshold.get("operator", operator or ">")
    matched = compare_numbers(driver_value, threshold_value, threshold_operator)
    reason = "" if matched else "threshold_not_met"
    if driver_value is None:
        reason = "driver_metric_missing"
    elif threshold_value is None:
        reason = threshold_missing_reason(threshold, reference_stats)
    unit = condition.get("unit", "")
    relation_label = threshold_relation_label(threshold_operator)
    return {
        "matched": matched,
        "evidence": (
            f"{label}{format_number(driver_value)}{unit}，"
            f"{relation_label}case均值{format_number(threshold_value)}{unit}"
        ),
        "debug": {
            "policy": threshold.get("policy"),
            "source": threshold.get("source"),
            "operator": threshold_operator,
            "driverMetric": metric,
            "driverMetricLabel": label,
            "referenceMetric": threshold.get("reference_metric"),
            "driverValue": driver_value,
            "thresholdValue": threshold_value,
            "thresholdLabel": "case均值" if threshold.get("policy") == "case_mean" else "",
            "thresholdRelationLabel": relation_label,
            "sampleCount": reference_stats.get(threshold.get("reference_metric"), {}).get("sample_count"),
            "unit": unit,
            "reason": reason,
        },
    }


def evaluate_condition(row, condition, reference_stats):
    if "all" in condition:
        results = [evaluate_condition(row, item, reference_stats) for item in condition.get("all", [])]
        matched_results = [item for item in results if item["matched"]]
        return {
            "matched": bool(results) and all(item["matched"] for item in results),
            "evidence": "，".join(item["evidence"] for item in matched_results or results),
            "debug": results,
        }
    if "any" in condition:
        results = [evaluate_condition(row, item, reference_stats) for item in condition.get("any", [])]
        matched_results = [item for item in results if item["matched"]]
        return {
            "matched": bool(matched_results),
            "evidence": "，".join(item["evidence"] for item in matched_results),
            "debug": results,
        }
    return evaluate_leaf_condition(row, condition, reference_stats)


def render_rule_strategy(row, rule, result):
    if rule.get("condition"):
        context = {
            "matched_evidence": result.get("evidence") or "暂无可展示依据",
        }
    else:
        threshold = rule.get("threshold", {})
        driver_value = to_number(get(row, rule.get("driver_metric", "")))
        threshold_value = result.get("debug", {}).get("thresholdValue")
        context = {
            "driver_value": format_number(driver_value),
            "threshold_value": format_number(threshold_value),
            "threshold_relation": threshold_relation_label(threshold.get("operator", ">")),
            "unit": rule.get("unit", ""),
            "driver_metric_label": rule.get("driver_metric_label", rule.get("driver_metric", "")),
            "reference_metric_label": threshold.get("reference_metric", ""),
            "data_date": normalize_date(get(row, "dt", "dataDate")),
            "matched_evidence": result.get("evidence") or "",
        }
    return {
        "key": rule["key"],
        "title": rule["title"],
        "category": rule.get("category", ""),
        "priority": rule.get("priority", 999),
        "priority_tier": rule.get("priority_tier", ""),
        "badges": rule.get("badges", []),
        "evidence": replace_template(rule.get("evidence_template", ""), context),
        "advice": replace_template(rule.get("advice_template", ""), context),
        "tags": rule.get("tags", []),
    }


def strategies_for(row, strategy_config, reference_stats):
    strategies = []
    for rule in strategy_config.get("rules", []):
        if not rule.get("enabled", True):
            continue
        condition = rule.get("condition") or {
            "driver_metric": rule.get("driver_metric"),
            "driver_metric_label": rule.get("driver_metric_label"),
            "unit": rule.get("unit", ""),
            "threshold": rule.get("threshold", {}),
        }
        result = evaluate_condition(row, condition, reference_stats)
        if result["matched"]:
            strategies.append(render_rule_strategy(row, rule, result))

    if not strategies:
        fallback = strategy_config.get("fallbackRule", {})
        strategies.append(
            {
                "key": fallback.get("key", "regular-care"),
                "title": fallback.get("title", "常规关怀"),
                "evidence": fallback.get("evidence", "当前没有策略指标超过配置阈值。"),
                "advice": fallback.get("advice", "可做常规状态确认，提醒司机保持安全驾驶、合理休息和规律作息。"),
                "priority": fallback.get("priority", 999),
            }
        )
    return sorted(strategies, key=lambda item: item.get("priority", 999))


def matched_evidence_values(result):
    debug = result.get("debug")
    if isinstance(debug, list):
        values = []
        for item in debug:
            if item.get("matched"):
                values.extend(matched_evidence_values(item))
        return values
    if not result.get("matched") or not isinstance(debug, dict):
        return []
    metric = debug.get("driverMetric")
    if not metric:
        return []
    return [[metric, debug.get("driverValue"), debug.get("thresholdValue")]]


def strategy_hits_for(row, strategy_config, reference_stats):
    hits = []
    for rule in strategy_config.get("rules", []):
        if not rule.get("enabled", True):
            continue
        condition = rule.get("condition") or {
            "driver_metric": rule.get("driver_metric"),
            "driver_metric_label": rule.get("driver_metric_label"),
            "unit": rule.get("unit", ""),
            "threshold": rule.get("threshold", {}),
        }
        result = evaluate_condition(row, condition, reference_stats)
        if result["matched"]:
            hits.append(
                {
                    "key": rule["key"],
                    "priority": rule.get("priority", 999),
                    "evidence": matched_evidence_values(result),
                }
            )
    if not hits:
        fallback = strategy_config.get("fallbackRule", {})
        hits.append(
            {
                "key": fallback.get("key", "regular-care"),
                "priority": fallback.get("priority", 999),
                "evidence": [],
            }
        )
    return sorted(hits, key=lambda item: item.get("priority", 999))


def strategy_threshold_summary(strategy_config, window_rows, reference_rows, reference_path, reference_stats):
    rules = []
    for rule in strategy_config.get("rules", []):
        threshold = rule.get("threshold")
        if threshold:
            rules.append(
                {
                    "key": rule.get("key"),
                    "title": rule.get("title"),
                    "driver_metric": rule.get("driver_metric"),
                    "policy": threshold.get("policy"),
                    "source": threshold.get("source"),
                    "reference_metric": threshold.get("reference_metric"),
                    "operator": threshold.get("operator"),
                    "priority": rule.get("priority"),
                    "priority_tier": rule.get("priority_tier", ""),
                    "badges": rule.get("badges", []),
                    "threshold_value": threshold_value_for(threshold, reference_stats),
                    "threshold_label": "case均值" if threshold.get("policy") == "case_mean" else "",
                    "sample_count": reference_stats.get(threshold.get("reference_metric"), {}).get("sample_count"),
                    "unit": rule.get("unit", ""),
                }
            )
        for item in rule.get("condition", {}).get("any", []) + rule.get("condition", {}).get("all", []):
            item_threshold = item.get("threshold")
            rules.append(
                {
                    "key": rule.get("key"),
                    "title": rule.get("title"),
                    "driver_metric": item.get("driver_metric"),
                    "policy": item_threshold.get("policy") if item_threshold else None,
                    "source": item_threshold.get("source") if item_threshold else "manual_condition",
                    "reference_metric": item_threshold.get("reference_metric") if item_threshold else None,
                    "operator": item_threshold.get("operator") if item_threshold else item.get("operator"),
                    "priority": rule.get("priority"),
                    "priority_tier": rule.get("priority_tier", ""),
                    "badges": rule.get("badges", []),
                    "threshold_value": threshold_value_for(item_threshold, reference_stats) if item_threshold else item.get("values"),
                    "threshold_label": "case均值" if item_threshold and item_threshold.get("policy") == "case_mean" else "",
                    "sample_count": reference_stats.get(item_threshold.get("reference_metric"), {}).get("sample_count") if item_threshold else None,
                    "unit": item.get("unit", ""),
                }
            )
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "version": strategy_config.get("version"),
        "reference_data": str(reference_path) if reference_path else "",
        "reference_row_count": len(reference_rows),
        "rules": rules,
        "notes": [
            "策略由 config/strategy-rules.json 驱动，daily 明细只保存 strategyKeys 和少量证据值，页面展示时再组装文案。",
            "case_mean 阈值从死亡 case 参考样本实时计算平均值，前端展示口径统一称为 case均值。",
            "司机指标缺失、参考字段缺失或 case均值无法计算时，对应策略不触发。",
            f"本次窗口内参与计算司机行数：{len(window_rows)}。",
        ],
    }


def summary_for(row):
    age = display(get(row, "age"))
    city = display(get(row, "resident_city_name", "city"))
    product = display(get(row, "product_level2_name", "product"))
    company = display(get(row, "company_name", "company"))
    days = display(get(row, "consecutive_days"))
    service = display(get(row, "server_dur_hour"))
    night = display(get(row, "order_cnt_21_09_7d_rate"))
    sleep = display(get(row, "sleep_deprivation_days"))
    dt = display(get(row, "dt", "dataDate"))
    return (
        f"{age}岁，{city}，{product}，{company}，连续出车{days}天，"
        f"当日服务{service}小时，夜间出车占比{night}，睡眠不足{sleep}天，数据日期{dt}。"
    )


def header_chips(row, strategies=None):
    chips = []
    city = clean_text(get(row, "resident_city_name", "city"))
    product = clean_text(get(row, "product_level2_name", "product"))
    if city:
        chips.append({"kind": "region", "label": city})
    if product:
        chips.append({"kind": "business", "label": product})
    tag_map = {
        "高龄": "高龄",
        "疲劳": "疲劳",
        "健康": "健康",
        "城市": "城市",
    }
    for strategy in strategies or []:
        for tag in strategy.get("tags", []):
            label = tag_map.get(tag, tag)
            if not any(chip.get("label") == label for chip in chips):
                chips.append({"kind": "problem", "label": label})
    return chips


def field(label, value):
    return {"displayLabel": label, "displayValue": display(value)}


def profile_for(row, strategy_config, reference_stats):
    driver_id = clean_id(get(row, "driver_id", "driverId"))
    data_date = normalize_date(get(row, "dt", "dataDate"))
    strategies = strategies_for(row, strategy_config, reference_stats)
    strategy_titles = [item["title"] for item in strategies if item.get("key") != "regular-care"]
    summary = summary_for({**row, "dt": data_date})
    if strategy_titles:
        summary = f"{summary} 重点关注：{'、'.join(strategy_titles[:6])}。"
    return {
        "driverId": driver_id,
        "summary": summary,
        "meta": {
            "dataDate": data_date,
            "riskTierRank": display(get(row, "risk_tier_rank", "riskTierRank")),
            "riskTierScore": display(get(row, "risk_tier_score", "riskTierScore")),
            "tiredScore": display(get(row, "tired_score", "tiredScore")),
        },
        "source": {
            "dataDate": data_date,
            "syncStatus": "静态快照",
        },
        "header": {
            "title": "司机画像",
            "chips": header_chips(row, strategies),
        },
        "strategies": strategies,
        "groups": [
            {
                "key": "basic",
                "title": "基础资料",
                "items": [
                    field("城市 resident_city_name", get(row, "resident_city_name", "city")),
                    field("城市等级 city_level", get(row, "city_level")),
                    field("公司 company_name", get(row, "company_name", "company")),
                    field("产品线 product_level2_name", get(row, "product_level2_name", "product")),
                    field("年龄 age", get(row, "age")),
                    field("是否组织化 is_organized", get(row, "is_organized")),
                ],
            },
            {
                "key": "workload",
                "title": "出车/服务指标",
                "items": [
                    field("连续出车天数 consecutive_days", get(row, "consecutive_days")),
                    field("当日服务时长 server_dur_hour", get(row, "server_dur_hour")),
                    field("近30天服务时长 server_dur_sum_30d", get(row, "server_dur_sum_30d", "server_dur_hour_30d")),
                ],
            },
            {
                "key": "fatigue",
                "title": "疲劳相关",
                "items": [
                    field("夜间出车占比 order_cnt_21_09_7d_rate", get(row, "order_cnt_21_09_7d_rate")),
                    field("睡眠不足天数 sleep_deprivation_days", get(row, "sleep_deprivation_days")),
                    field("疲劳分 tired_score", get(row, "tired_score", "tiredScore")),
                ],
            },
        ],
    }


def index_item_for(row):
    driver_id = clean_id(get(row, "driver_id", "driverId"))
    data_date = normalize_date(get(row, "dt", "dataDate"))
    city = clean_text(get(row, "resident_city_name", "city"))
    company = clean_text(get(row, "company_name", "company"))
    product = clean_text(get(row, "product_level2_name", "product"))
    item = {
        "driverId": driver_id,
        "city": city,
        "cityLevel": clean_text(get(row, "city_level")),
        "company": company,
        "product": product,
        "dataDate": data_date,
        "isOrganized": clean_text(get(row, "is_organized")),
        "subtitle": " · ".join(part for part in [city, product, company] if part),
    }
    for field_name in STATIC_DRIVER_NUMERIC_FIELDS:
        value = to_number(get(row, field_name))
        if value is not None:
            camel_name = {
                "risk_tier_rank": "riskTierRank",
                "risk_tier_score": "riskTierScore",
                "tired_score": "tiredScore",
            }.get(field_name, field_name)
            item[camel_name] = value
    return item


def static_driver_for(row, strategy_config, reference_stats):
    item = index_item_for(row)
    strategy_hits = strategy_hits_for(row, strategy_config, reference_stats)
    item["strategyKeys"] = [hit["key"] for hit in strategy_hits]
    evidence = {
        hit["key"]: hit["evidence"]
        for hit in strategy_hits
        if hit.get("evidence")
    }
    if evidence:
        item["strategyEvidence"] = evidence
    return item


def dict_index(values):
    return {value: index for index, value in enumerate(values)}


def encode_daily_payload(data_date, drivers):
    dictionary = {
        dict_key: sorted_unique(driver.get(field_name) for driver in drivers)
        for field_name, dict_key in COMPACT_DICT_FIELDS.items()
    }
    strategy_keys = []
    for driver in drivers:
        for key in driver.get("strategyKeys", []):
            if key and key not in strategy_keys:
                strategy_keys.append(key)
    dictionary["strategyKeys"] = strategy_keys
    dict_indexes = {key: dict_index(values) for key, values in dictionary.items()}

    rows = []
    for driver in drivers:
        row = []
        driver_strategy_keys = driver.get("strategyKeys", [])
        for field_name in COMPACT_DRIVER_SCHEMA:
            if field_name in COMPACT_DICT_FIELDS:
                value = driver.get(field_name, "")
                row.append(dict_indexes[COMPACT_DICT_FIELDS[field_name]].get(value) if value else None)
            elif field_name == "strategyKeys":
                row.append([dict_indexes["strategyKeys"][key] for key in driver_strategy_keys if key in dict_indexes["strategyKeys"]])
            elif field_name == "strategyEvidence":
                evidence = driver.get("strategyEvidence", {})
                row.append([evidence.get(key) for key in driver_strategy_keys])
            else:
                value = driver.get(field_name)
                row.append(value if value != "" else None)
        rows.append(row)
    return {
        "mode": "daily-static-compact",
        "date": data_date,
        "schema": COMPACT_DRIVER_SCHEMA,
        "dict": dictionary,
        "rows": rows,
    }


def decode_daily_payload(payload):
    if isinstance(payload, dict) and payload.get("mode") == "daily-static-compact":
        schema = payload.get("schema", [])
        dictionary = payload.get("dict", {})
        drivers = []
        for row in payload.get("rows", []):
            driver = {}
            raw_values = dict(zip(schema, row))
            for field_name, value in raw_values.items():
                if field_name in COMPACT_DICT_FIELDS:
                    values = dictionary.get(COMPACT_DICT_FIELDS[field_name], [])
                    driver[field_name] = values[value] if isinstance(value, int) and 0 <= value < len(values) else ""
                elif field_name == "strategyKeys":
                    values = dictionary.get("strategyKeys", [])
                    driver[field_name] = [
                        values[index]
                        for index in value or []
                        if isinstance(index, int) and 0 <= index < len(values)
                    ]
                elif field_name == "strategyEvidence":
                    continue
                elif value is not None:
                    driver[field_name] = value
            driver["dataDate"] = driver.get("dataDate") or payload.get("date", "")
            strategy_keys = driver.get("strategyKeys", [])
            evidence_values = raw_values.get("strategyEvidence") or []
            strategy_evidence = {}
            for index, key in enumerate(strategy_keys):
                if index < len(evidence_values) and evidence_values[index]:
                    strategy_evidence[key] = evidence_values[index]
            if strategy_evidence:
                driver["strategyEvidence"] = strategy_evidence
            driver["subtitle"] = " · ".join(
                part for part in [driver.get("city", ""), driver.get("product", ""), driver.get("company", "")] if part
            )
            drivers.append(driver)
        return drivers
    if isinstance(payload, dict) and isinstance(payload.get("drivers"), list):
        return payload["drivers"]
    return payload if isinstance(payload, list) else []


def sorted_unique(values):
    return sorted({clean_text(value) for value in values if clean_text(value)})


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def write_pretty_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def directory_size(path):
    return sum(file.stat().st_size for file in path.rglob("*") if file.is_file())


def clean_stale_static_outputs(out_dir):
    stale_names = [
        "driver-index.json",
        "field-labels.json",
    ]
    for name in stale_names:
        stale_path = out_dir / name
        if stale_path.exists():
            stale_path.unlink()
    stale_profiles_dir = out_dir / "profiles"
    if stale_profiles_dir.exists():
        shutil.rmtree(stale_profiles_dir)
    stale_patterns = [
        "drivers-*.json",
        "profiles-*.json",
    ]
    for pattern in stale_patterns:
        for stale_path in out_dir.glob(pattern):
            if stale_path.name != "drivers.json":
                stale_path.unlink()


def daily_file_path(out_dir, data_date):
    return out_dir / "daily" / f"drivers-{data_date}.json"


def read_static_drivers_file(path):
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    return decode_daily_payload(payload)


def migrate_legacy_drivers_json(out_dir, window_start, window_end):
    legacy_path = out_dir / "drivers.json"
    if not legacy_path.exists():
        return
    try:
        payload = json.loads(legacy_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return
    if not (isinstance(payload, dict) and isinstance(payload.get("drivers"), list)):
        return
    grouped = {}
    for driver in payload["drivers"]:
        data_date = normalize_date(driver.get("dataDate") or driver.get("dt"))
        if not data_date:
            continue
        date_value = datetime.strptime(data_date, "%Y-%m-%d").date()
        if window_start <= date_value <= window_end:
            grouped.setdefault(data_date, []).append(driver)
    for data_date, drivers in grouped.items():
        path = daily_file_path(out_dir, data_date)
        if not path.exists():
            write_json(path, {"mode": "daily-static", "date": data_date, "drivers": drivers})


def remove_daily_files_outside_window(out_dir, window_start, window_end):
    daily_dir = out_dir / "daily"
    if not daily_dir.exists():
        return
    for path in daily_dir.glob("drivers-*.json"):
        match = re.fullmatch(r"drivers-(\d{4}-\d{2}-\d{2})\.json", path.name)
        if not match:
            continue
        date_value = datetime.strptime(match.group(1), "%Y-%m-%d").date()
        if date_value < window_start or date_value > window_end:
            path.unlink()


def load_daily_static_drivers(out_dir, window_start, window_end):
    daily_dir = out_dir / "daily"
    if not daily_dir.exists():
        return []
    drivers = []
    for path in sorted(daily_dir.glob("drivers-*.json")):
        match = re.fullmatch(r"drivers-(\d{4}-\d{2}-\d{2})\.json", path.name)
        if not match:
            continue
        date_value = datetime.strptime(match.group(1), "%Y-%m-%d").date()
        if window_start <= date_value <= window_end:
            drivers.extend(read_static_drivers_file(path))
    return drivers


def daily_file_index(out_dir, dates):
    files = []
    for data_date in dates:
        path = daily_file_path(out_dir, data_date)
        row_count = len(read_static_drivers_file(path))
        files.append(
            {
                "date": data_date,
                "path": f"daily/{path.name}",
                "row_count": row_count,
            }
        )
    return files


def build_filter_options(static_drivers, dates):
    return {
        "cities": sorted_unique(item["city"] for item in static_drivers),
        "companies": sorted_unique(item["company"] for item in static_drivers),
        "products": sorted_unique(item["product"] for item in static_drivers),
        "dates": dates,
    }


def build_meta_payload(static_drivers, dates, upload_date, window_start, window_end, daily_files, size_control=None):
    payload = {
        "row_count": len(static_drivers),
        "data_dates": dates,
        "upload_date": upload_date,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "data_mode": "daily_static",
        "primary_data_file": "drivers.json",
        "daily_files": daily_files,
    }
    if size_control:
        payload.update(size_control)
    return payload


def build_manifest_payload(static_drivers, dates, upload_date, window_start, window_end, daily_files, size_limit_mb, size_control=None):
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "upload_date": upload_date,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "row_count": len(static_drivers),
        "contains_queryable_driver_data": True,
        "data_mode": "daily_static",
        "primary_data_file": "drivers.json",
        "daily_files": daily_files,
        "package_size_limit_mb": size_limit_mb,
        "actual_dates": dates,
        "dropped_dates": [],
        "package_size_mb": 0,
    }
    if size_control:
        payload.update(size_control)
    return payload


def write_static_indexes(out_dir, static_drivers, dates, upload_date, window_start, window_end, size_limit_mb, size_control=None):
    daily_files = daily_file_index(out_dir, dates)
    write_json(
        out_dir / "drivers.json",
        {
            "mode": "daily-static-index",
            "latestDate": dates[-1] if dates else "",
            "dates": dates,
            "files": daily_files,
        },
    )
    write_pretty_json(out_dir / "filter-options.json", build_filter_options(static_drivers, dates))
    write_pretty_json(
        out_dir / "meta.json",
        build_meta_payload(static_drivers, dates, upload_date, window_start, window_end, daily_files, size_control),
    )
    write_pretty_json(
        out_dir / "manifest.json",
        build_manifest_payload(
            static_drivers,
            dates,
            upload_date,
            window_start,
            window_end,
            daily_files,
            size_limit_mb,
            size_control,
        ),
    )
    return daily_files


def enforce_size_limit(out_dir, upload_date, window_start, window_end, size_limit_mb):
    limit_bytes = int(size_limit_mb * 1024 * 1024)
    dropped_dates = []
    static_drivers = load_daily_static_drivers(out_dir, window_start, window_end)
    dates = sorted_unique(item["dataDate"] for item in static_drivers)
    total_size = directory_size(out_dir)
    if total_size <= limit_bytes:
        return static_drivers, dates, {
            "actual_dates": dates,
            "dropped_dates": dropped_dates,
            "drop_reason": "",
            "package_size_mb": round(total_size / 1024 / 1024, 3),
            "package_size_limit_mb": size_limit_mb,
        }

    for data_date in list(dates):
        if len(dates) <= 1:
            break
        path = daily_file_path(out_dir, data_date)
        if path.exists():
            path.unlink()
        dropped_dates.append(data_date)
        static_drivers = load_daily_static_drivers(out_dir, window_start, window_end)
        dates = sorted_unique(item["dataDate"] for item in static_drivers)
        write_static_indexes(
            out_dir,
            static_drivers,
            dates,
            upload_date,
            window_start,
            window_end,
            size_limit_mb,
            {
                "actual_dates": dates,
                "dropped_dates": dropped_dates,
                "drop_reason": "package_size_limit",
                "package_size_mb": round(directory_size(out_dir) / 1024 / 1024, 3),
                "package_size_limit_mb": size_limit_mb,
            },
        )
        total_size = directory_size(out_dir)
        if total_size <= limit_bytes:
            break

    size_control = {
        "actual_dates": dates,
        "dropped_dates": dropped_dates,
        "drop_reason": "package_size_limit" if dropped_dates else "",
        "package_size_mb": round(total_size / 1024 / 1024, 3),
        "package_size_limit_mb": size_limit_mb,
    }
    if total_size > limit_bytes:
        size_control["drop_reason"] = "package_size_limit_latest_day_exceeds_limit"
        write_static_indexes(
            out_dir,
            static_drivers,
            dates,
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
    return static_drivers, dates, size_control


def main():
    args = parse_args()
    source_path = Path(args.source)
    out_dir = Path(args.out_dir)
    if not source_path.exists():
        raise SystemExit(f"输入文件不存在：{source_path}")

    strategy_config = load_strategy_config(args.strategy_config)
    reference_path = resolve_reference_data(args.reference_data)
    reference_rows = read_reference_rows(reference_path)
    reference_stats = build_reference_stats(reference_rows, strategy_config)

    rows = read_rows(source_path)
    upload_date = normalize_date(args.upload_date) if args.upload_date else infer_upload_date(source_path, rows, args.date_field)
    if not upload_date:
        raise SystemExit("上传日期格式无效，应为 YYYY-MM-DD。")
    window_end = datetime.strptime(upload_date, "%Y-%m-%d").date()
    window_start = window_end - timedelta(days=6)

    window_rows = []
    for row in rows:
        data_date = normalize_date(get(row, args.date_field, "dt", "dataDate"))
        if not data_date:
            # No date column — treat as upload_date
            data_date = upload_date
        date_value = datetime.strptime(data_date, "%Y-%m-%d").date()
        if window_start <= date_value <= window_end:
            window_rows.append({**row, "dt": data_date})

    imported_static_drivers = [
        static_driver_for(row, strategy_config, reference_stats)
        for row in window_rows
        if clean_id(get(row, "driver_id", "driverId"))
    ]

    clean_stale_static_outputs(out_dir)
    migrate_legacy_drivers_json(out_dir, window_start, window_end)
    remove_daily_files_outside_window(out_dir, window_start, window_end)

    imported_by_date = {}
    for driver in imported_static_drivers:
        imported_by_date.setdefault(driver["dataDate"], []).append(driver)
    for data_date, drivers in imported_by_date.items():
        write_json(
            daily_file_path(out_dir, data_date),
            encode_daily_payload(data_date, drivers),
        )

    static_drivers = load_daily_static_drivers(out_dir, window_start, window_end)
    dates = sorted_unique(item["dataDate"] for item in static_drivers)
    write_static_indexes(out_dir, static_drivers, dates, upload_date, window_start, window_end, args.size_limit_mb)
    write_pretty_json(
        out_dir / "strategy-thresholds.json",
        strategy_threshold_summary(strategy_config, window_rows, reference_rows, reference_path, reference_stats),
    )
    write_pretty_json(out_dir / "strategy-rules.json", strategy_config)
    static_drivers, dates, size_control = enforce_size_limit(
        out_dir,
        upload_date,
        window_start,
        window_end,
        args.size_limit_mb,
    )
    write_static_indexes(out_dir, static_drivers, dates, upload_date, window_start, window_end, args.size_limit_mb, size_control)
    total_size = directory_size(out_dir)

    print(f"输入文件：{source_path}")
    print(f"输出目录：{out_dir}")
    print(f"数据窗口：{window_start.isoformat()} 至 {window_end.isoformat()}")
    print(f"策略配置：{args.strategy_config}")
    print(f"参考样本：{reference_path or '未找到，无法计算 case均值的策略将不触发'}")
    print(f"本次导入司机数据：{len(imported_static_drivers)} 条")
    print(f"窗口内司机数据：{len(static_drivers)} 条")
    print(f"独立日期文件：{', '.join(dates) if dates else '无'}")
    if size_control.get("dropped_dates"):
        print(f"因 {args.size_limit_mb:g}MB 上限剔除日期：{', '.join(size_control['dropped_dates'])}")
    print(f"输出大小：{total_size} bytes")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"导入失败：{error}", file=sys.stderr)
        sys.exit(1)
