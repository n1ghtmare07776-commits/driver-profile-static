# 参考文件说明

这个目录里的文件来自当前项目最新版前端，只用于帮助另一个 agent 理解现有页面外观和交互。

## 目录

```text
current-cdn-frontend/    CDN 静态版前端源码参考
current-local-frontend/  本地后端版前端源码参考
schema/                  脱敏样例数据结构
```

## 使用方式

可以参考：

- 页面布局。
- 白色视觉风格。
- 左侧筛选栏。
- 城市/公司/产品线 token 多选组件。
- 高级筛选输入。
- 查询结果列表样式。
- 司机详情卡片样式。
- 建议策略模块的位置和卡片形态。

不要照搬：

- `renderStrategies`
- `renderSpeechTemplate`
- `话术模板` 模块。
- `/api/reimport` 重建 SQLite 按钮。
- 任何真实数据路径或旧部署逻辑。
- 写死在旧页面里的建议策略阈值和触发逻辑。

本次复刻以 `docs/需求补充说明.md` 和 `docs/验收清单.md` 为准。
