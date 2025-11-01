// /web/dev-smoke-test.mjs
// 说明：Node 环境下的冒烟测试脚本，用于快速验证核心逻辑与关卡推进是否正常工作。
// 使用方法：在仓库根目录运行 `node ./web/dev-smoke-test.mjs`，控制台会输出关卡推进日志与最终棋盘。

import { LevelManager } from '../core/levels.esm.js'; // 引入关卡管理器（ES 模块版本）

// 创建关卡管理器实例：从 2x2 开始，启用分数累计，同时展示按尺寸覆写权重的用法
const LM = new LevelManager({
  startSize: 2,                 // 关卡起始尺寸为 2x2
  carryScore: true,             // 启用跨关卡分数累计
  targetFn: (size) => {         // 自定义更易于达到的目标函数，确保冒烟测试能在有限步数内晋级
    if (size === 2) return 8;   // 2x2 棋盘只需凑出 8 即可晋级
    if (size === 3) return 32;  // 3x3 棋盘目标设为 32
    return 2 ** (size + 3);     // 其余关卡沿用默认策略
  },
  randomTileWeightsBySize: {    // 示例：在 4x4 之后改用传统 2/4 权重
    4: { 2: 0.9, 4: 0.1 }
  }
});

let game = LM.getGame();                               // 获取当前关卡的游戏实例
const DIRS = ['left', 'right', 'up', 'down'];          // 定义可移动的四个方向

let steps = 0;                                         // 已尝试的移动步数
const targetLevel = 3;                                 // 希望至少到达第三关（size=4）
const safetyLimit = 5000;                              // 安全步数上限，避免死循环

while (steps < safetyLimit) {                          // 在限制内循环尝试移动
  if (LM.checkPass()) {                                // 如果当前关卡已经达成目标
    console.log(`[PASS] size=${game.size} → next level`); // 输出通关信息
    LM.nextLevel();                                    // 进入下一关
    game = LM.getGame();                               // 更新当前游戏实例
  }

  if (LM.getLevel() >= targetLevel) {                  // 若已达到目标关卡
    console.log(`[DONE] 已到目标关卡：level=${LM.getLevel()} (size=${game.size}x${game.size})`); // 输出完成信息
    break;                                             // 结束循环
  }

  if (!game.canMove()) {                               // 若当前关卡没有可行移动
    console.log(`[BLOCKED] 本关无可移动步，重置本关（size=${game.size}）`); // 输出阻塞日志
    game.reset();                                      // 重置本关重新开始
  }

  const dir = DIRS[Math.floor(Math.random() * DIRS.length)]; // 随机选择一个方向
  const moved = game.move(dir);                        // 尝试移动
  steps += 1;                                          // 记录步数

  if (steps % 100 === 0) {                             // 每隔一定步数输出一次状态
    console.log(`[STEP ${steps}] size=${game.size}, score=${game.getScore()}, total=${LM.getTotalScore()}, lastMove=${dir}, moved=${moved}`);
  }
}

if (steps >= safetyLimit) {                            // 若达到安全上限仍未完成目标
  console.log(`[WARN] 达到安全步数上限 ${safetyLimit}，请检查逻辑或放宽目标值`); // 提示可能需要调整参数
}

console.log('=== 测试结束 ===');                         // 输出结束标记
console.log(`最终关卡 level=${LM.getLevel()}, 尺寸 size=${game.size}x${game.size}`); // 输出最终关卡信息
console.log(`当前分数 score=${game.getScore()}, 累计总分 total=${LM.getTotalScore()}`); // 输出分数信息
console.log('当前网格：');                             // 输出棋盘标题
console.table(game.getGrid());                         // 使用 console.table 打印棋盘
