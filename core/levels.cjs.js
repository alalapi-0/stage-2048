// /core/levels.cjs.js
// 说明：实现与 ES 模块版本等价的关卡管理器（CommonJS 版本），供微信小程序等环境复用。

const Game2048 = require('./game2048.cjs.js');       // 引入 CommonJS 版本的 2048 核心逻辑

class LevelManager {
  // 构造函数：支持配置起始尺寸、是否累计分数、目标函数以及按尺寸定制的随机权重
  constructor({
    startSize = 2,                                     // 默认从 2x2 棋盘开始
    carryScore = true,                                 // 默认累计跨关卡分数
    targetFn = (size) => 2 ** (size + 3),              // 默认目标函数：size=2→32、3→128、4→256
    randomTileWeightsBySize = {}                       // 可选：按尺寸覆写新方块生成权重
  } = {}) {
    this.size = startSize;                             // 当前关卡的棋盘尺寸
    this.carryScore = carryScore;                      // 是否累计分数
    this.targetFn = targetFn;                          // 存储目标函数
    this.randomTileWeightsBySize = randomTileWeightsBySize; // 保存按尺寸定制的权重映射
    this.totalScoreBeforeThisLevel = 0;                // 记录进入本关前的累计分数
    this._createGame();                                // 创建当前关卡的游戏实例
  }

  // 内部方法：根据当前尺寸创建 Game2048 实例
  _createGame() {
    const weights = this.randomTileWeightsBySize[this.size] || { 1: 0.9, 2: 0.1 }; // 选择对应尺寸的权重
    this.game = new Game2048({ size: this.size, randomTileWeights: weights });     // 创建游戏实例
  }

  // 获取当前关卡的游戏实例
  getGame() {
    return this.game;                                  // 返回内部 Game2048 实例
  }

  // 获取当前关卡编号（尺寸 2 视为第 1 关）
  getLevel() {
    return this.size - 1;                              // 根据尺寸计算关卡编号
  }

  // 获取当前关卡目标值
  getTarget() {
    return this.targetFn(this.size);                   // 调用目标函数
  }

  // 获取累计总分
  getTotalScore() {
    return this.totalScoreBeforeThisLevel + this.game.getScore(); // 返回累计分数与当前分数之和
  }

  // 检查当前关卡是否通过（棋盘最大值达到或超过目标）
  checkPass() {
    const grid = this.game.getGrid();                  // 获取棋盘数据
    let max = 0;                                       // 初始化最大值
    for (const row of grid) {                          // 遍历每一行
      for (const v of row) {                           // 遍历每一个格子
        if (v > max) max = v;                          // 更新最大值
      }
    }
    return max >= this.getTarget();                    // 返回是否达到目标
  }

  // 进入下一关：根据配置累计分数、尺寸加一并创建新实例
  nextLevel() {
    if (this.carryScore) {                             // 如果需要累计分数
      this.totalScoreBeforeThisLevel += this.game.getScore(); // 将当前分数并入累计总分
    }
    this.size += 1;                                    // 尺寸加一
    this._createGame();                                // 生成下一关的游戏实例
  }
}

module.exports = { LevelManager };                    // 导出对象以保持与 ES 模块版本的命名一致
