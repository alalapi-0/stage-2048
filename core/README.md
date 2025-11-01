# core 模块说明（占位）

`core/` 目录将在第 2 轮开始提供平台无关的 2048 核心逻辑，包含 ESM 与 CommonJS 两种模块形态，方便在 Web 与微信小程序中复用。

## 规划中的文件
- `game2048.esm.js` 与 `game2048.cjs.js`：提供完全等价的游戏核心逻辑。
- `levels.esm.js` 与 `levels.cjs.js`：提供关卡管理与目标计算能力。

## 预期 API
- `reset()`：重置当前棋盘与得分。
- `addRandomTile()`：根据权重生成新方块。
- `move(direction)`：按照方向合并并更新棋盘状态。
- `canMove()`：检测当前是否存在可行操作。
- `getGrid()`：返回棋盘的内部表示供渲染层使用。
- `getScore()`：返回当前累计得分。

### LevelManager 规划
- `getGame()`：获取当前关卡的游戏实例。
- `getLevel()`：获取当前关卡编号与棋盘尺寸。
- `getTarget()`：获取当前关卡的目标分值或目标数字。
- `nextLevel()`：推进到下一关并重新初始化棋盘。

详细的实现会在第 2 轮逐步补齐，本文件后续也将补充示例代码与测试策略。

