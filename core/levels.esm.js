// /core/levels.esm.js
// 说明：实现以棋盘尺寸为关卡的管理器，负责在达到目标数字后晋级到更大的棋盘尺寸（ES 模块版本）。

import { Game2048 } from './game2048.esm.js';        // 引入平台无关的 2048 核心逻辑

export class LevelManager {
  // 构造函数：支持配置起始尺寸、分数是否累计、目标函数以及不同尺寸的随机权重
  constructor({
    startSize = 2,                                     // 默认从 2x2 棋盘开始
    carryScore = true,                                 // 默认累计跨关卡的分数
    targetFn = (size) => 2 ** (size + 3),              // 默认目标函数：size=2→32、3→128、4→256
    randomTileWeightsBySize = {}                       // 可选：按棋盘尺寸覆写新方块权重
  } = {}) {
    this.size = startSize;                             // 当前关卡的棋盘尺寸
    this.carryScore = carryScore;                      // 是否在跨关卡时累计分数
    this.targetFn = targetFn;                          // 存储目标函数
    this.randomTileWeightsBySize = randomTileWeightsBySize; // 保存按尺寸定制的权重映射
    this.totalScoreBeforeThisLevel = 0;                // 记录进入当前关卡前的累计得分

    this._createGame();                                // 初始化当前关卡的 Game2048 实例
  }

  // 内部工具：根据当前尺寸创建 Game2048 实例
  _createGame() {
    const weights = this.randomTileWeightsBySize[this.size] || { 1: 0.9, 2: 0.1 }; // 选择对应尺寸的权重
    this.game = new Game2048({ size: this.size, randomTileWeights: weights });     // 创建游戏实例
  }

  // 获取当前关卡对应的 Game2048 实例
  getGame() {
    return this.game;                                  // 直接返回内部实例供调用方操作
  }

  // 获取当前关卡编号：将尺寸 2 视为第 1 关，因此返回 size - 1
  getLevel() {
    return this.size - 1;                              // 计算并返回关卡编号
  }

  // 获取当前关卡的目标值
  getTarget() {
    return this.targetFn(this.size);                   // 调用配置的目标函数
  }

  // 获取累计总分：包含之前关卡与当前关卡的得分
  getTotalScore() {
    return this.totalScoreBeforeThisLevel + this.game.getScore(); // 前缀分数加上当前分数
  }

  // 检测当前关卡是否已经达成目标：棋盘上的最大值大于等于目标值
  checkPass() {
    const grid = this.game.getGrid();                  // 获取当前棋盘
    let max = 0;                                       // 初始化最大值记录
    for (const row of grid) {                          // 遍历每一行
      for (const v of row) {                           // 遍历每一格
        if (v > max) max = v;                          // 更新最大值
      }
    }
    return max >= this.getTarget();                    // 返回是否达到目标
  }

  // 推进到下一关：尺寸 +1，并根据配置累计分数
  nextLevel() {
    if (this.carryScore) {                             // 如果需要累计分数
      this.totalScoreBeforeThisLevel += this.game.getScore(); // 将当前关卡分数加入累计总分
    }
    this.size += 1;                                    // 棋盘尺寸 +1，对应进入下一关
    this._createGame();                                // 创建下一关的 Game2048 实例
  }
}
