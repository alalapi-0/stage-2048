// /core/levels.esm.js
// 说明：实现以棋盘尺寸为关卡的管理器（ES 模块版本），新增可序列化能力与目标函数注册表。

import { Game2048 } from './game2048.esm.js';        // 引入平台无关的 2048 核心逻辑

const DEFAULT_TARGET_FN = (size) => 2 ** (size + 3);  // 定义默认的目标函数：尺寸与 2 的幂相关
const DEFAULT_RANDOM_WEIGHTS = { 1: 0.9, 2: 0.1 };    // 定义默认的新方块权重映射（从 1 起步）

// 工具：克隆单个权重映射，过滤掉非数字键或值
function cloneSingleWeights(source) {
  const result = {};                                   // 准备输出对象
  if (!source || typeof source !== 'object') return result; // 若输入为空或非对象则直接返回空对象
  for (const key of Object.keys(source)) {             // 遍历所有键
    const numKey = Number(key);                        // 将键转换为数字
    const numVal = Number(source[key]);                // 将值转换为数字
    if (!Number.isFinite(numKey) || !Number.isFinite(numVal)) continue; // 非数字键值跳过
    result[numKey] = numVal;                           // 将合法键值写入结果
  }
  return result;                                       // 返回克隆后的映射
}

// 工具：克隆尺寸→权重的映射表
function cloneWeightMap(source) {
  const result = {};                                   // 准备输出对象
  if (!source || typeof source !== 'object') return result; // 非对象直接返回空映射
  for (const key of Object.keys(source)) {             // 遍历所有尺寸键
    const inner = cloneSingleWeights(source[key]);     // 克隆内部的权重映射
    if (Object.keys(inner).length === 0) continue;     // 若内部为空则跳过
    result[key] = inner;                               // 保存该尺寸的权重映射
  }
  return result;                                       // 返回克隆后的映射
}

// 工具：根据注册表键查找目标函数，找不到时使用默认实现
function resolveTargetFn(key, registry) {
  if (registry && typeof registry[key] === 'function') return registry[key]; // 注册表命中直接返回
  return DEFAULT_TARGET_FN;                            // 未命中则返回默认函数
}

// 工具：生成默认权重的浅拷贝，避免实例间共享引用
function getDefaultWeights() {
  return { ...DEFAULT_RANDOM_WEIGHTS };                // 使用展开运算符创建新对象
}

// 目标函数注册表：提供 power 与 fibonacci 两种示例实现
export const TARGET_FN_REGISTRY = {
  power: (size) => 2 ** (size + 3),                    // power：保持默认 2 的幂增长
  fibonacci: (size) => {                               // fibonacci：示例实现，尺寸越大目标值越接近黄金分割序列
    const steps = Math.max(0, Number(size) + 7);       // 将尺寸转换为整数并平移，确保 size=2 对应第 9 项
    let a = 0;                                         // 初始化 F(0)
    let b = 1;                                         // 初始化 F(1)
    for (let i = 0; i < steps; i++) {                  // 迭代 steps 次生成序列
      const next = a + b;                              // 计算下一项
      a = b;                                           // 更新前一项
      b = next;                                        // 更新后一项
    }
    return a || 1;                                     // 返回 F(steps)，若结果为 0 则回退为 1
  }
};

export class LevelManager {
  // 构造函数：支持配置起始尺寸、累计策略、目标函数与按尺寸定制的新方块权重
  constructor({
    startSize = 2,                                     // 默认从 2×2 棋盘开始
    carryScore = true,                                 // 默认累计跨关卡分数
    targetFn = DEFAULT_TARGET_FN,                      // 默认目标函数为 power 版本
    targetFnKey = 'power',                             // 默认目标函数标识
    randomTileWeightsBySize = {}                       // 可选：按尺寸覆写新方块权重
  } = {}) {
    const sizeNum = Number(startSize);                 // 将传入的起始尺寸转换为数字
    this.size = Number.isInteger(sizeNum) && sizeNum > 1 ? sizeNum : 2; // 非法输入回退为 2
    this.carryScore = Boolean(carryScore);             // 强制转换为布尔值
    this.targetFn = typeof targetFn === 'function' ? targetFn : DEFAULT_TARGET_FN; // 确保目标函数合法
    this.targetFnKey = typeof targetFnKey === 'string' ? targetFnKey : 'power';    // 存储目标函数标识
    this.randomTileWeightsBySize = cloneWeightMap(randomTileWeightsBySize);       // 克隆尺寸→权重映射
    this.totalScoreBeforeThisLevel = 0;                // 初始化累计分为 0
    this._createGame();                                // 创建首个 Game2048 实例
  }

  // 内部工具：根据当前尺寸创建 Game2048 实例
  _createGame() {
    const customWeights = cloneSingleWeights(this.randomTileWeightsBySize[this.size]); // 读取并克隆对应尺寸的权重
    const weights = Object.keys(customWeights).length ? customWeights : getDefaultWeights(); // 若无定制则使用默认权重
    this.game = new Game2048({ size: this.size, randomTileWeights: weights });              // 基于尺寸与权重生成游戏实例
  }

  // 获取当前关卡的 Game2048 实例
  getGame() {
    return this.game;                                  // 返回内部实例供渲染或操作层使用
  }

  // 获取当前关卡编号：尺寸 2 视为第 1 关，因此返回 size - 1
  getLevel() {
    return this.size - 1;                              // 计算并返回关卡编号
  }

  // 获取当前关卡目标值
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

  // 序列化：导出当前关卡管理器的可持久化状态
  toJSON() {
    const keyFromState = this.targetFnKey || Object.keys(TARGET_FN_REGISTRY).find((k) => TARGET_FN_REGISTRY[k] === this.targetFn) || 'power'; // 推断目标函数标识
    return {
      size: this.size,                                 // 当前关卡尺寸
      carryScore: this.carryScore,                     // 是否累计分数
      totalScoreBeforeThisLevel: this.totalScoreBeforeThisLevel, // 当前关卡前的累计分
      game: {
        size: this.game.size,                          // Game2048 当前尺寸
        score: this.game.getScore(),                   // Game2048 当前分数
        grid: this.game.getGrid(),                     // 棋盘二维数组副本
        randomTileWeights: cloneSingleWeights(this.game.randomTileWeights) // 当前实例使用的新方块权重
      },
      targetFnKey: keyFromState,                       // 目标函数标识
      randomTileWeightsBySize: cloneWeightMap(this.randomTileWeightsBySize) // 尺寸→权重映射副本
    };
  }

  // 反序列化：从 JSON 数据恢复关卡管理器状态
  static fromJSON(json, targetFnRegistry = TARGET_FN_REGISTRY) {
    if (!json || typeof json !== 'object') {           // 若传入数据无效
      console.warn('[LevelManager.fromJSON] 输入数据无效，使用默认配置重建。'); // 控制台提示
      return new LevelManager();                       // 退回默认实例
    }

    const sizeNum = Number(json.size);                 // 读取并转换关卡尺寸
    const size = Number.isInteger(sizeNum) && sizeNum > 1 ? sizeNum : 2; // 非法尺寸回退为 2
    const carryScore = typeof json.carryScore === 'boolean' ? json.carryScore : Boolean(json.carryScore); // 解析布尔值
    const targetKey = typeof json.targetFnKey === 'string' ? json.targetFnKey : 'power'; // 解析目标函数标识
    const targetFn = resolveTargetFn(targetKey, targetFnRegistry); // 根据注册表查找目标函数
    const weightMap = cloneWeightMap(json.randomTileWeightsBySize); // 克隆尺寸→权重映射

    const manager = new LevelManager({                // 基于解析后的数据创建实例
      startSize: size,
      carryScore,
      targetFn,
      targetFnKey: targetKey,
      randomTileWeightsBySize: weightMap
    });

    const total = Number(json.totalScoreBeforeThisLevel); // 读取累计分
    manager.totalScoreBeforeThisLevel = Number.isFinite(total) ? total : 0; // 非数字回退为 0

    const gameData = json.game && typeof json.game === 'object' ? json.game : {}; // 读取 game 数据块
    const restored = manager.getGame();               // 获取内部 Game2048 实例

    if (gameData.randomTileWeights) {                 // 如有记录权重则覆盖
      const weights = cloneSingleWeights(gameData.randomTileWeights); // 克隆权重
      if (Object.keys(weights).length) restored.randomTileWeights = weights; // 存在有效键值时写入
    }

    if (Array.isArray(gameData.grid)) {               // 若提供网格数据
      const sizeCurrent = restored.size;              // 读取当前棋盘尺寸
      const grid = [];                                // 准备新网格
      for (let r = 0; r < sizeCurrent; r++) {         // 遍历每一行
        const rowSrc = Array.isArray(gameData.grid[r]) ? gameData.grid[r] : []; // 获取原始行
        const row = [];                               // 创建新行
        for (let c = 0; c < sizeCurrent; c++) {       // 遍历每个格子
          const val = Number(rowSrc[c]);              // 转换为数字
          row.push(Number.isFinite(val) ? val : 0);   // 非数字回退为 0
        }
        grid.push(row);                               // 将新行推入网格
      }
      restored.grid = grid;                           // 覆盖 Game2048 的网格
    }

    const score = Number(gameData.score);             // 解析当前得分
    if (Number.isFinite(score)) restored.score = score; // 若为数字则覆盖

    return manager;                                   // 返回恢复后的实例
  }
}
