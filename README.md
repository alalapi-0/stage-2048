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
- **Web 端**：使用 `localStorage` 存储设置（`stage2048.settings.v1`）、进度（`stage2048.progress.v1`）与最佳分（`stage2048.bestScore.v1`），支持 URL Query 覆盖以及导入/导出 JSON。
- **小程序端**：使用 `wx.setStorageSync`/`wx.getStorageSync` 存储设置（`stage2048.mp.settings.v1`）、进度（`stage2048.mp.progress.v1`）与最佳分（`stage2048.mp.bestScore.v1`），并提供“重置进度”“清空最佳分”按钮。

## 本地验证 / 冒烟测试
使用以下命令运行 Node 版冒烟脚本，快速确认核心逻辑与关卡推进是否生效：

```bash
node ./web/dev-smoke-test.mjs
```

脚本会在控制台打印关卡通关、步数与分数信息，结束时使用 `console.table` 输出棋盘快照，便于目视检查状态是否合理。

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

## FAQ（占位）
- **字体度量在不同环境可能不同，如何处理？** 通过二分法与近似比例调整字号，以保证跨平台一致性。
- **小程序 Canvas 与 Web Canvas API 有差异怎么办？** 在各自平台的渲染层中进行适配，确保核心逻辑保持统一。
