# 风险前哨：统一 Agent 交接说明

本文件是本项目唯一的 Agent 交接入口，合并了原 `AGENTS.md` 的工程约束与 `AGENT_PROMPT_给另一个agent.md` 的执行要求。处理本项目、更新数据或部署 CDN 前，先阅读本文件。

## 当前发布版本

- 产品名：`风险前哨`
- 英文副标题：`RISK SENTINEL`
- 静态入口：`dist/index.html`
- 当前前端：`dist/app.js`
- 当前数据元信息：`dist/data/manifest.json`
- 当前发布目录含可查询司机数据；不得提交到公开代码仓库。
- 当前数据窗口、实际日期、行数和包大小必须以 `manifest.json` 中的 `actual_dates`、`row_count`、`package_size_mb` 为准，不可在说明中手工假定。

## 当前页面形态

- 左侧：司机 ID、城市/公司/产品线多选、日期、高级筛选、结果列表和 CSV 下载。
- 右侧：顶部司机快照、综合画像、`话术指导`、`建议策略`。
- `司机资料`板块已移除。
- `话术指导`展示可复制的综合关怀话术；`建议策略`展示沟通提醒、内部依据和内部建议。
- 沟通提醒应高亮展示，且不得对司机说 case 均值、内部阈值或内部统计口径。
- 列表卡仅保留策略数量、近七天最高排名、风险分和疲劳分；不得显示“待联系 / 待回访”等联系状态按钮，也不得显示“疲劳高”等疲劳等级标签。
- 首次打开仅加载最新日快照；首次近七天查询补齐窗口日期。进度条必须按整个任务单调前进，不得每个日文件从低百分比重新跳动。

## 必须保留的能力

1. 司机 ID 精确查询。
2. 城市、公司、产品线多选；组内 OR，筛选组之间 AND。
3. 日期筛选与高级筛选：排名、年龄、连续出车天数、服务时长、夜间出车占比、睡眠不足天数、是否组织化。
4. 点击司机后展示快照日期、综合画像、话术指导和建议策略。
5. 导出当前筛选名单 CSV，至少仅含 `司机id`、`综合画像` 两列，不得导出完整健康字段。
6. 字段对齐：当天源 Excel 没有的字段，页面不显示；同日存在的字段正常展示。不能把不存在的字段硬渲染为“暂无数据”。

## 建议策略与话术

- 策略规则必须配置驱动，配置在 `config/strategy-rules.json`，发布时同步到 `dist/data/strategy-rules.json`。
- 阈值计算必须在独立计算层完成，页面只消费 `strategyKeys` 和少量证据值，不可把阈值或触发判断散落写进 UI 渲染代码。
- 生产策略仅使用 `case_mean`：大多数指标高于死亡 case 对应字段均值触发；反向指标可通过配置使用低于 case 均值触发。
- 缺少司机指标、参考指标、有效样本或阈值时不得触发；无命中时展示 `常规关怀`。
- 对外话术必须委婉、关怀、可操作，不做医学诊断或事故因果判断。
- 话术措辞可参考 `语料库/` 下内容，但忽略语料文件中的旧条件和旧阈值，不得把语料库逻辑当成策略触发规则。

## 静态数据与 800MB 约束

- CDN 限制为 800MB。每次新数据默认保留上传日向前含当天的最近 7 个自然日。
- 静态结构：

```text
dist/
  index.html
  app.js
  styles.css
  data/
    manifest.json
    meta.json
    filter-options.json
    drivers.json                 # 只能是日期索引和文件清单
    driver-lookup-index.json     # 完整司机 ID 直达查询索引
    lookup/driver-bucket-*.json.gz # 按司机 ID 稳定哈希均匀分桶的 gzip 轻量画像索引
    filter-index.json.gz         # gzip 压缩的近 7 天组合筛选轻量索引，供 Web Worker 解压使用
    daily/drivers-YYYY-MM-DD.json # 每天独立明细
    strategy-rules.json
    strategy-thresholds.json
```

- `drivers.json` 禁止放多天司机明细；每个日文件只放本日查询、筛选、列表、详情、综合画像和策略所需字段。
- 新增某日数据时，只覆盖该日期日文件，保留仍在窗口内的旧日期文件。
- 超过 800MB 时，先裁剪页面不需要字段并使用紧凑 JSON；仍超限则从旧到新剔除日期，至少保留最新 1 天。
- manifest/meta 必须记录 `generated_at`、`upload_date`、`window_start`、`window_end`、`row_count`、`actual_dates`、`dropped_dates`、`drop_reason`、`package_size_mb`、`package_size_limit_mb`。`package_size_mb` 按实际上传的整个 `dist/` 递归统计，不只统计 `dist/data/`。

## 更新与部署

1. 输入每日 Excel，使用 `scripts/import-driver-data.py` 生成或更新 `dist/data/`。
2. 检查 manifest、日文件清单、实际日期和包大小。
3. 本地启动：

```bash
cd "/Users/didi/Desktop/司机画像多日测试版/dist"
python3 -m http.server 8769
```

4. 验收 ID 查询、组合筛选、近七天去重最高排名、CSV 下载、字段对齐、策略和话术指导。
5. 导入脚本会自动重建组合筛选索引和司机直达索引。只有手动修改了 `dist/data/daily/` 时才补建：

```bash
node scripts/build-filter-index.mjs dist/data
python3 scripts/build-direct-driver-lookup.py --data-dir dist/data --bucket-count 128
```

直达索引必须使用 `fnv1a32-modulo` 稳定哈希均匀分桶，不能退回司机 ID 前缀分片；集中前缀会产生几十 MB 单分片并拖慢冷查询。索引脚本会同步刷新 `manifest.generated_at` 和最终包体。

6. 将整个 `dist/` 目录递归上传至 CDN；入口必须是 `dist/index.html`。不能只传 HTML，不能只传 `drivers.json`，也不能遗漏 `driver-lookup-index.json`、`lookup/`、`filter-index.json.gz` 与 `filter-worker.js`。
7. 每次部署使用新的 deploy-id 或刷新 CDN 缓存，确保 `index.html`、`app.js`、样式和 `data/` 同版本发布。
8. 发布后返回 CDN 的 `index.html` 链接、manifest 实际日期和包大小。
9. 每次接收并完成新一天数据更新后，无论用户是否再次提醒，最终回复都必须附上一段可直接交给公司内网 Agent 的完整部署提示词，包含项目目录、deploy-id、递归上传命令、manifest 验收口径和部署后检查项。

## 验收底线

- 不做只有输入框的简化页面，不改成深色或营销落地页。
- 不删除建议策略，不把策略做成固定文案或固定人工阈值。
- 不将真实司机明细、健康指标或完整 profile 提交至公开仓库、文档样例或 GitHub。
- 不持续叠加历史数据，不超过 800MB，不将多天明细塞进 `drivers.json`。
- 修改 UI 后必须检查 `index.html` 实际引用的脚本和样式是当前版本，避免修改了 `app.js` 但页面仍引用旧版带时间戳文件。
