# 近7天日均在线时长口径修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用原始滚动七日在线字段替代稀疏风险快照平均值，并让页面、索引、当前数据和文档使用一致且可解释的口径。

**Architecture:** 每日紧凑文件持久化 `lately_7d_except_sub_online_dur_hour`。两个派生索引把该字段除以 7 写为 `avgOnlineDuration7d`，前端只消费派生值；一次性回填脚本从原始 Excel/ZIP 更新当前五天 daily 文件后重建索引。

**Tech Stack:** Python 3、pandas、Node.js、原生浏览器 JavaScript、gzip JSON。

---

### Task 1: 用失败测试锁定新口径

**Files:**
- Modify: `tests/test_service_duration_average.py`
- Modify: `tests/static-generated-time.test.mjs`
- Modify: `tests/filter-index-contract.mjs`
- Modify: `tests/lookup-index-contract.mjs`

- [ ] 将脱敏夹具改为写入 `lately_7d_except_sub_online_dur_hour`，断言 `14 / 7 = 2`、`0 / 7 = 0`、缺失值为 `null`。
- [ ] 断言两个索引包含 `avgOnlineDuration7d`，且不再包含 `avgServiceDuration7d` 和 `serviceDurationSampleDays`。
- [ ] 断言前端文案为“近7天日均在线时长”，旧“七天平均时长”和“周平均服务时长”不存在。
- [ ] 运行测试并确认因生产代码仍使用旧字段而失败。

### Task 2: 更新每日数据与派生索引

**Files:**
- Modify: `scripts/import-driver-data.py`
- Modify: `scripts/build-filter-index.mjs`
- Modify: `scripts/build-direct-driver-lookup.py`
- Modify: `reference/current-cdn-frontend/filter-worker.js`

- [ ] 将 `lately_7d_except_sub_online_dur_hour` 加入每日紧凑数值字段和 schema。
- [ ] 在组合筛选索引中逐行计算 `avgOnlineDuration7d = source / 7`。
- [ ] 在直达索引选定最高排名记录后按该记录源字段计算 `avgOnlineDuration7d`。
- [ ] Worker 解码并返回 `avgOnlineDuration7d`。
- [ ] 运行派生索引测试并确认通过。

### Task 3: 更新前端展示与回退逻辑

**Files:**
- Modify: `reference/current-cdn-frontend/app.js`

- [ ] 将格式化函数改为读取 `avgOnlineDuration7d`。
- [ ] 直达结果、Worker 结果和 daily 回退结果统一携带该字段。
- [ ] 顶部显示 `近7天日均在线时长 Xh/日`，综合画像显示 `近7天日均在线时长X小时/日`。
- [ ] 删除旧快照聚合和样本天数逻辑。
- [ ] 运行前端契约测试并确认通过。

### Task 4: 回填当前五天数据并重建产物

**Files:**
- Create: `scripts/backfill-seven-day-online-duration.py`
- Modify generated output outside Git: `dist/data/daily/*.json`, `dist/data/filter-index.json.gz`, `dist/data/lookup/*.json.gz`, `dist/data/manifest.json`

- [ ] 脚本接受多个 `YYYY-MM-DD=Excel或ZIP` 参数，只读取司机 ID 和近7日非预约单在线时长。
- [ ] 对对应 daily 文件按司机 ID 回填字段，保持行数和其他字段不变。
- [ ] 使用 07-13 至 07-17 原始输入回填当前五天数据。
- [ ] 重建两个索引、静态前端和 manifest，确认整个 `dist/` 小于 `800MB`。

### Task 5: 回归、文档和版本控制

**Files:**
- Modify: `docs/数据与接口契约.md`
- Modify: `docs/UI优化记录_20260709.md`
- Modify: `docs/发布记录.md`

- [ ] 标记旧七天服务快照平均口径已废弃，记录新字段、公式和发布包大小。
- [ ] 运行 Python、Node 契约和 Worker 性能回归。
- [ ] 浏览器验证司机 `580545402486991` 显示 `15.82h/日`，组合筛选路径一致且控制台无错误。
- [ ] 提交 `fix: use rolling seven-day online duration`，打标签 `风险前哨七天日均在线时长修正版-20260717`，推送 main 和标签。
