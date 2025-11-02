# Stage2048（关卡 2048）

## 项目简介
Stage2048 是一个以纯 Canvas 实现的数字格子 2048 游戏，支持 Web 浏览器与微信小程序双端版本。关卡系统让玩家从 2×2 棋盘起步，逐步解锁更大的棋盘尺寸，并让目标值随关卡增长，使游戏体验更加循序渐进。

## 架构总览
```
stage-2048
├─ core/           # 平台无关：2048 核心逻辑与关卡管理
├─ web/            # 浏览器版 Canvas 渲染、设置面板与持久化
├─ miniprogram/    # 微信小程序版 Canvas 渲染、手势与持久化
└─ docs/           # 配置与设计文档
```

## 快速开始
- **Web**：双击 `web/index.html` 即可在浏览器中游玩关卡模式；页面会自动加载本地存储中的设置与进度，并提供设置面板、URL 覆盖以及导入/导出 JSON 的能力。
- **小程序**：使用微信开发者工具导入 `miniprogram/` 目录，填写你自己的 `appid`；首页提供滑动操作、关卡 HUD，以及“重置进度”“清空最佳分”等本地持久化操作。

## 小程序使用说明
- 首页显示「关卡、目标、得分、总分、最佳分」
- 通过滑动进行操作，通关弹窗询问进入下一关
- 点击「重开本关」可重置当前关卡
- 新增「重置进度」「清空最佳分」按钮，可管理本地存档
- 逻辑与 Web 版复用同一套核心 API（CJS 版）

## 六轮开发计划
| 轮次 | 目标 | 产物 | 验收标准 |
| --- | --- | --- | --- |
| 1 | 脚手架与文档 | 目录、规范、占位页 | Web 与小程序能打开占位页；文档齐全 |
| 2 | 核心逻辑（含从 1 起步）+ 关卡管理 | Game2048 与 LevelManager（ESM/CJS 双发） | 控制台冒烟测试通过 |
| 3 | Web Canvas 渲染与交互 | 适配字号绘制、键盘与触摸、关卡 HUD | 浏览器可玩并显示关卡与目标 |
| 4 | 小程序接入关卡 | 画布绘制、手势、关卡推进 | 开发者工具可玩并能通关 |
| 5 | 参数化与持久化 | 统一配置、存档、导入导出 | Web/localStorage 与小程序存储正常 |
| 6 | 质量与文档收尾 | 规范、FAQ、问题记录模板 | 文档完善，无二进制入库 |

## 核心逻辑
核心模块位于 `core/`，提供 `Game2048` 与 `LevelManager` 两个类。示例：

```js
import { Game2048 } from './core/game2048.esm.js';
import { LevelManager, TARGET_FN_REGISTRY } from './core/levels.esm.js';

const game = new Game2048({ size: 4 });
if (game.canMove()) {
  const moved = game.move('left');
  console.log('是否发生移动：', moved, '当前得分：', game.getScore());
}
console.table(game.getGrid());

const manager = new LevelManager({ startSize: 2, targetFn: TARGET_FN_REGISTRY.power, targetFnKey: 'power' });
console.log('当前关卡目标值：', manager.getTarget());
if (manager.checkPass()) {
  manager.nextLevel();
  console.log('晋级后关卡编号：', manager.getLevel());
}
```

## 参数化与持久化
- 核心层新增 `TARGET_FN_REGISTRY` 与 `LevelManager.toJSON()/fromJSON()`，用于序列化关卡尺寸、累计分以及棋盘状态。
- `/core/config.schema.md` 与 `/docs/CONFIG_GUIDE.md` 详细列出可配置字段及其载入优先级，默认配置在 Web 与小程序端自动加载。
- **Web 端**：使用 `localStorage` 存储设置（`stage2048.settings.v2`）、进度（`stage2048.progress.v2`）与最佳分（`stage2048.bestScore.v1`），支持 URL Query 覆盖以及导入/导出 JSON。
- **小程序端**：使用 `wx.setStorageSync`/`wx.getStorageSync` 存储设置（`stage2048.mp.settings.v2`）、进度（`stage2048.mp.progress.v2`）与最佳分（`stage2048.mp.bestScore.v1`），并提供“重置进度”“清空最佳分”按钮。
<!-- 规则编辑器章节标题 -->
## 规则编辑器
<!-- 规则编辑器入口说明 -->
- Web 主页面的设置面板新增「打开规则编辑器」链接，指向 `/web/rules.html`，可在新窗口中管理 JSON 规则。
<!-- 规则编辑器功能说明 -->
- 规则编辑器提供基础设置、LEVELS 选项与随机权重表单，可导出 `.json` 文件、从文件导入并写入 `localStorage['stage2048.settings.v2']`。
<!-- 规则编辑器校验说明 -->
- 表单内置尺寸范围与概率和校验，随机权重支持动态增删尺寸与权重项，保存时会提醒新规则可能影响现有进度。
<!-- 规则编辑器使用建议 -->
- 导入时会自动合并默认值并显示错误列表；应用后返回 `/web/index.html` 刷新即可生效，建议必要时在主页面重置进度。

## 撤销与复盘
- 核心 `Game2048` 支持 `peekState()` 与 `restoreState()`，`LevelManager` 增强为可生成 `snapshot()` 并通过 `restore()` 恢复，用于撤销与复盘脚本。
- Web 端提供「撤销一步」按钮，每次有效移动都会记录快照，可立即回到上一步；导出 JSON 时会附带 `{ seed, ops }` 便于重放。
- 小程序端同样支持撤销，在演示或复盘过程中会自动禁用，导入复盘脚本可通过剪贴板 JSON 完成，存储键升级为 `*.v2` 并向下兼容旧版数据。

## 演示模式
- Web 与小程序均新增演示模式开关，启用后会按照「左→上→右→下」的启发式尝试移动，帮助玩家观察策略。
- 演示会在无可用步、玩家手动关闭或棋局结束时自动停止，同时通过状态播报提示。
- 复盘过程中自动禁用演示，避免两种自动流程互相冲突。

## 动画与性能
- 新增淡入动画开关，默认关闭；开启后新生与合并方块会在约 160ms 内完成透明度渐变。
- 动画状态与绘制逻辑经过优化，不会重复触发 requestAnimationFrame，确保低端设备也能保持流畅。
- 小程序端沿用轻量绘制策略，仅在设置开启动画时为新格子应用一次性透明度过渡。

## 质量与可访问性
- Web 页面结构调整为语义化的 `<header>/<main>/<section>`，同时在按钮、HUD 与状态区补充 `aria-label`、`aria-live`。
- 新增高对比度模式开关与 `/web/a11y.css`，焦点高亮与暗背景/亮文字组合使视力受限用户更易辨识。
- `#status` 区域通过 `role="status"` 播报导入、导出、重置等操作，屏幕阅读器会自动朗读变化。
- 绘制层加入 `requestAnimationFrame` 合帧节流，快速滑动或长按方向键时也只在下一帧集中绘制一次。
- 增补 `tests/smoke-core.mjs` 与 `tests/simulate-2048-runs.mjs`，可在纯 Node 环境验证核心 API 与随机局表现。

## 成就系统
- 游戏会记录历史最大方块值（Web：`stage2048.maxTile.v1`，小程序：`stage2048.mp.maxTile.v1`），跨会话保留。
- 达到 64、256、1024 三个阈值分别授予 🗝️、🎯、🏆 徽章，并在 HUD 显示以及朗读提示中同步。
- 撤销或复盘不会降低已解锁的徽章，确保成就持久化。

## 本地验证 / 冒烟测试
- 使用以下命令运行无依赖脚本，快速确认核心逻辑、关卡推进与随机局表现：

```bash
node ./tests/smoke-core.mjs
node ./tests/simulate-2048-runs.mjs
```

- 若需额外观察绘制与输入处理，可继续运行 `node ./web/dev-smoke-test.mjs`，检查控制台输出的关卡通关信息。

## 可配置字段
| 字段 | 位置 | 类型/示例 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| canvasSize | Web 设置 | number(px) | 480 | 画布 CSS 尺寸（URL/面板/存储可覆盖） |
| gap | Web/小程序运行时 | number(px) | 12 | 格子间隙，影响绘制布局 |
| LEVELS.startSize | LevelManager | number | 2 | 起始关卡尺寸（2 表示 2×2） |
| LEVELS.carryScore | LevelManager | boolean | true | 是否跨关卡累计总分 |
| LEVELS.targetFnKey | LevelManager | enum | `power` | 目标函数标识，对应注册表 |
| LEVELS.randomTileWeightsBySize | LevelManager | map | `{4:{2:0.9,4:0.1}}` | 尺寸→新方块权重映射 |
| bestScore | 本地存储 | number | 0 | 历史最佳分，按平台独立保存 |

## 提交与仓库规范
- 所有源代码与配置文件必须逐行添加中文注释，确保后续协作成员能快速理解意图。
- 禁止任何二进制文件入库，包括图片、压缩包、构建产物等。
- 建议提交信息前缀使用 `core: ...`、`web: ...`、`mini: ...`、`docs: ...` 等模块化标签。
- 每次改动后需要在 `README.diff.md` 中记录差异（模板见文件）。

## 发布与分发
- Web 版本可直接托管 `/web/` 目录，或在 GitHub Pages 中指定 `main` 分支的 `/web` 子目录。
- 小程序上线前需在 `project.config.json` 填写自己的 `appid`，并使用开发者工具完成真机预览、提审与发布。
- 发布动作前请阅读 `/docs/RELEASE_GUIDE.md`，同步版本号、更新 `README.diff.md`，并在 Releases 中复用摘要说明。

## FAQ（占位）
- **字体度量在不同环境可能不同，如何处理？** 通过二分法与近似比例调整字号，以保证跨平台一致性。
- **小程序 Canvas 与 Web Canvas API 有差异怎么办？** 在各自平台的渲染层中进行适配，确保核心逻辑保持统一。
