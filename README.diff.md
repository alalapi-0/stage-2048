| 时间 | 分支 | 提交哈希 | 改动文件 | 问题现象 | 分析 | 解决方案 | 验证方式 | 后续工作 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2024-01-01 | main | 初始化 | 全部骨架文件 | 仓库为空缺少结构 | 需求确认后搭建骨架 | 创建目录、文档与占位页 | 打开 web/index.html 与小程序占位页 | 后续轮次补齐核心逻辑 |
| 2025-11-01 | main | N/A | core/game2048.esm.js、core/game2048.cjs.js、core/levels.esm.js、core/levels.cjs.js、web/dev-smoke-test.mjs、core/README.md、README.md、README.diff.md | 无（实现新功能） | 实现核心逻辑与关卡管理 | 新增双形态核心逻辑、关卡管理器与冒烟脚本，并更新文档 | node ./web/dev-smoke-test.mjs | 第 3 轮接入 Web Canvas 渲染与 HUD |
| 2025-11-01 | main | N/A | /web/index.html、/web/main.mjs、/web/README.md、README.md | 实现 Web 版渲染与交互，接入关卡 HUD | Canvas 绘制需兼顾字号与输入适配 | 使用 Canvas 绘制方格与数字、二分法适配字体、支持键盘与触摸输入 | 本地打开 web/index.html，尝试移动、通关与重开 | 第 4 轮接入微信小程序绘制与关卡推进 |
| 2025-11-02 | main | N/A | /miniprogram/core/*、/miniprogram/pages/index/*、/miniprogram/README.md、README.md | 实现小程序端渲染与交互，接入关卡 HUD | 小程序需复用核心逻辑并补齐 HUD | 使用 2D canvas 绘制、二分法拟合字号、滑动手势识别 | 微信开发者工具运行首页，操作与通关 | 第 5 轮参数化与持久化扩展（统一配置、bestScore 与总分策略等） |
| 2025-11-03 | main | N/A | core/levels.*、core/config.schema.md、docs/CONFIG_GUIDE.md、web/*、miniprogram/pages/index/*、miniprogram/README.md、web/README.md、README.md、README.diff.md | 参数化与持久化未实现 | 缺少统一配置、序列化与跨端存档 | 新增 TARGET_FN_REGISTRY、LevelManager 序列化、Web 设置面板与导入导出、小程序存储按钮，并补充文档 | Web：刷新延续进度、导入导出 JSON；小程序：重启后保持进度、按钮提示 | 后续关注更多目标函数与 UI 微调 |
