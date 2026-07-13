# 数据更新与 CDN 发布规则

## 目标

由于 CDN 一键部署包大小上限为 800MB，生产发布包不得持续累计历史数据库或历史司机明细。后续每次提供新一天司机数据时，系统默认只保留上传当天向前含当天的最新 7 个自然日数据，并将处理后的静态数据发布到 CDN 给页面读取。

示例：

```text
上传日：2026-07-06
默认数据窗口：2026-06-30 至 2026-07-06
```

如果源数据里没有上传当天的数据，应以用户明确指定的上传日为窗口锚点，不自动扩大窗口。

## 数据处理规则

1. 输入可以是每日 Excel、CSV、JSON 或后端导出的结构化数据。
2. 数据必须包含可解析的数据日期字段，优先使用 `dt`。
3. 构建或上传脚本必须按 `upload_date - 6` 到 `upload_date` 过滤数据。
4. 城市、公司、产品线、司机 ID、索引字段、详情字段、综合画像、建议策略计算都只基于过滤后的 7 天窗口。
5. 生产真实数据不得提交到代码仓库，只能作为构建输入或发布产物进入受控 CDN。
6. 静态 JSON 如果包含可查询司机数据，必须在文档和 manifest 中明确标注。
7. 发布产物必须控制在 CDN 一键部署包大小上限 800MB 内；如果接近上限，应优先裁剪窗口内非页面必需字段，而不是扩大历史数据累计。
8. 如果裁剪非必需字段并使用紧凑 JSON 后仍超过 800MB，脚本应按日期从旧到新剔除，只保留 800MB 内可容纳的最近日期，且至少尝试保留最新 1 天。
9. 因 800MB 上限剔除日期时，必须在 manifest 或元信息中记录 `actual_dates`、`dropped_dates`、`drop_reason`、`package_size_mb` 和 `package_size_limit_mb`，页面日期筛选以 `actual_dates` 和 `drivers.json` 为准。
10. 如果最新 1 天单独仍超过 800MB，脚本不得强行上传，应停止并提示继续按城市/分片拆分或改用后端 API。
11. CDN 静态版采用按日独立的稳定静态版：页面先读取 `drivers.json` 日期索引、筛选项和 manifest；用户选择某个数据日期后，再读取对应的 `daily/drivers-YYYY-MM-DD.json`。
12. `drivers.json` 只能包含日期索引、最新日期和每日文件清单，不得包含多天司机明细；每天司机明细必须独立保存在 `daily/drivers-YYYY-MM-DD.json`。
13. 每次更新新一天数据时，脚本必须保留 7 天窗口内已有日期文件，并只覆盖本次输入对应日期文件；只有发布包超过 800MB 时，才允许按上述规则剔除最旧日期。
14. 每个 `daily/drivers-YYYY-MM-DD.json` 只能包含该自然日页面需要的数据，不得包含其他日期生产司机明细或页面不需要的全量原始字段；20 万级单日数据下应使用紧凑结构，不要为每条司机重复内嵌完整详情模板。

## CDN 静态产物建议

建议生成以下文件：

```text
dist/data/drivers.json
dist/data/daily/drivers-YYYY-MM-DD.json
dist/data/filter-options.json
dist/data/strategy-thresholds.json
dist/data/manifest.json
```

`drivers.json` 用于记录最近 7 天窗口内有哪些独立日期文件。它是轻量索引，不承载司机明细。

`daily/drivers-YYYY-MM-DD.json` 用于查询、组合筛选、列表展示、CSV 下载和司机详情展示。每个文件只包含对应自然日页面需要的字段、综合画像摘要和已计算好的建议策略，不持续累计其他日期数据，也不重复存放页面可由字段组装出来的整套详情模板。

`manifest.json` 至少包含：

```json
{
  "generated_at": "2026-07-06T10:00:00+08:00",
  "upload_date": "2026-07-06",
  "window_start": "2026-06-30",
  "window_end": "2026-07-06",
  "row_count": 0,
  "contains_queryable_driver_data": true,
  "actual_dates": ["2026-07-06"],
  "dropped_dates": [],
  "drop_reason": "",
  "package_size_mb": 0,
  "package_size_limit_mb": 800
}
```

`generated_at` 必须是构建或上传脚本运行时写入的实时时间，用于页面左侧 `静态站点生成时间` 展示。前端展示时建议格式化为：

```text
静态站点生成时间： 2026/07/06 13:30
```

可以使用本需求包提供的脚本生成 manifest：

```text
node scripts/write-static-manifest.mjs dist/data/manifest.json 2026-07-06
```

也可以直接使用一键导入脚本从 Excel 生成完整 CDN 数据产物：

```text
python3 scripts/import-driver-data.py data/incoming/司机库数据_20260706.xlsx --upload-date 2026-07-06 --out-dir dist/data
```

导入脚本会同时生成 `filter-index.json.gz` 和稳定哈希分桶的 `driver-lookup-index.json`、`lookup/driver-bucket-*.json.gz`。前者只包含近 7 天组合筛选、列表排序所需字段，由 Web Worker 解压、筛选；后者用于完整司机 ID 直达查询，避免下载整日明细。哈希分桶不得改回司机 ID 前缀分片，否则集中前缀会形成过大的单文件并拖慢查询。

所有派生索引生成完以后，脚本才按实际上传的整个 `dist/` 目录执行最终 800MB 包体统计并回写 manifest/meta；如果因上限剔除旧日期，必须同步重建两套索引，不能保留被剔除日期的旧索引记录。

如果不传 `--upload-date`，脚本会优先从文件名中的 `YYYYMMDD` 推断上传日期；如果文件名没有日期，再使用数据列 `dt` 中的最大日期。

## 建议策略联动

- 建议策略阈值和命中结果必须基于当前发布的数据窗口或明确配置的参考样本。
- 阈值来源、计算方法、样本数和缺字段原因应写入 `strategy-thresholds.json` 或阈值说明文档。
- 页面展示建议策略时，只读取配置/计算层产物，不在页面渲染函数里重新硬编码策略判断。

## 代码实现建议

可以用一个构建脚本实现：

```text
读取源数据
  -> 校验字段和日期
  -> 按 upload_date 过滤最新 7 天
  -> 生成筛选候选项
  -> 为每个数据日期生成 daily/drivers-YYYY-MM-DD.json
  -> 生成稳定静态版 drivers.json 日期索引
  -> 根据策略配置计算阈值和建议策略
  -> 写入 manifest.generated_at 为当前实时时间
  -> 写出 dist/data/*.json
  -> 检查发布包大小不超过 800MB
  -> 如超过 800MB，先裁剪字段和紧凑化；仍超过则剔除最旧日期并重建索引
  -> 上传 dist 到 CDN
```

静态版前端读取 CDN 上的 `drivers.json`、`filter-options.json` 和 `manifest.json`；用户选择数据日期后，读取对应的 `daily/drivers-YYYY-MM-DD.json` 并展示已加载的静态档案。后端版可以把同样的过滤逻辑放在数据入库或 API 查询层。

## 验收

- 上传日为 2026-07-06 时，产物不包含 2026-06-29 及更早数据。
- 页面能显示当前数据窗口或最新快照日期。
- 页面左侧 `静态站点生成时间` 显示 manifest 中的实时时间，格式为 `YYYY/MM/DD HH:mm`。
- 城市、公司、产品线筛选项只来自当前 7 天窗口。
- 首页读取 `drivers.json` 日期索引；选择 2026-07-03 时必须读取 `daily/drivers-2026-07-03.json`，选择 2026-07-07 时必须读取 `daily/drivers-2026-07-07.json`。
- 导入 2026-07-07 单日数据后，仍在 7 天窗口内的 2026-07-03 日期文件不得丢失。
- 如果 2026-07-03 和 2026-07-07 合计超过 800MB，允许剔除更旧的 2026-07-03，但必须在 manifest 中记录 `dropped_dates=["2026-07-03"]` 和 `drop_reason="package_size_limit"`。
- 点击司机后直接用已加载的司机字段和建议策略组装静态档案，不再请求单司机详情 JSON。
- 下载 CSV 只包含当前 7 天窗口和当前筛选结果。
- 建议策略结果与当前窗口数据或指定参考样本一致。
- 发布包大小检查能阻止超过 800MB 的产物继续上传。
