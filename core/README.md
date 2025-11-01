# core 模块说明

`core/` 目录存放平台无关的核心逻辑与关卡管理模块，提供 ES 模块与 CommonJS 两套实现，便于在浏览器与微信小程序中复用。本轮已完成的文件说明如下。

## 模块列表
- `game2048.esm.js` / `game2048.cjs.js`：实现 2048 游戏核心逻辑，棋盘从数字 1 起步，新方块默认采用 `{1:0.9, 2:0.1}` 权重生成。
- `levels.esm.js` / `levels.cjs.js`：实现以棋盘尺寸为关卡的管理器，负责晋级、分数累计以及目标值计算。

## API 清单与示例
### Game2048
- `constructor({ size, randomTileWeights })`：创建指定尺寸的棋盘，可覆写新方块权重。
- `reset()`：重置当前棋盘与分数，并重新生成两个随机方块。
- `move(dir)`：按 `left` / `right` / `up` / `down` 合并棋盘，若发生变化会生成新方块并返回 `true`。
- `canMove()`：检测棋盘是否还能移动（存在空位或相邻可合并）。
- `getGrid()`：返回当前棋盘的二维数组副本，供渲染层读取。
- `getScore()`：返回当前累计得分。

#### 使用示例
```js
import { Game2048 } from './game2048.esm.js';

const game = new Game2048({ size: 4 });
if (game.canMove()) {
  const moved = game.move('left');
  console.log('移动是否发生：', moved, '当前分数：', game.getScore());
}
console.table(game.getGrid());
```

### LevelManager
- `constructor({ startSize, carryScore, targetFn, randomTileWeightsBySize })`：创建关卡管理器，可配置起始尺寸、分数累计、目标函数与不同尺寸的权重覆写。
- `getGame()`：获取当前关卡的 `Game2048` 实例。
- `getLevel()`：获取当前关卡编号（2×2 记为第 1 关）。
- `getTarget()`：根据关卡尺寸计算当前目标值。
- `getTotalScore()`：返回累计总分，包含历史关卡与当前关卡。
- `checkPass()`：检测当前关卡是否达成目标。
- `nextLevel()`：在通关后推进到下一关，并根据配置累计分数。

#### 使用示例
```js
import { LevelManager } from './levels.esm.js';

const manager = new LevelManager({ startSize: 2 });
const game = manager.getGame();
console.log('当前目标值：', manager.getTarget());
// 模拟玩家操作
if (manager.checkPass()) {
  manager.nextLevel();
  console.log('已晋级到第', manager.getLevel(), '关');
}
```

## 复杂度说明
- 每次调用 `move()` 会遍历所有行或列：提取数组、执行线性合并、写回结果，时间复杂度为 `O(n^2)`。
- `move()` 在处理中仅使用少量临时数组，空间复杂度为 `O(n)`。

## 设计取舍
- 新方块从数字 1 起步，可以带来“1+1=2，2+2=4...” 的自然升级节奏；在高关卡可以通过 `randomTileWeightsBySize` 将分布改回传统的 `2` / `4`，兼顾体验与挑战。
- `LevelManager` 仅维护关卡与分数状态，将渲染与输入完全隔离，便于在不同前端环境中复用。

## 冒烟测试
- 脚本位置：`/web/dev-smoke-test.mjs`
- 运行方式：
  ```bash
  node ./web/dev-smoke-test.mjs
  ```
- 预期行为：控制台会输出关卡通关日志、步数进度以及最终 `console.table` 打印的棋盘，确保核心逻辑与关卡推进正常。
