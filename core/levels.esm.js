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
  // 构造函数：支持配置起始尺寸、累计策略、目标函数、新方块权重与可选的固定种子
  constructor({
    startSize = 2,                                     // 默认从 2×2 棋盘开始
    carryScore = true,                                 // 默认累计跨关卡分数
    targetFn = DEFAULT_TARGET_FN,                      // 默认目标函数为 power 版本
    targetFnKey = 'power',                             // 默认目标函数标识
    randomTileWeightsBySize = {},                      // 可选：按尺寸覆写新方块权重
    rngSeed = '',                                      // 可选：固定伪随机数种子
    rngFactory = null                                  // 可选：根据种子生成伪随机函数的工厂
  } = {}) {
    const sizeNum = Number(startSize);                 // 将传入的起始尺寸转换为数字
    this.size = Number.isInteger(sizeNum) && sizeNum > 1 ? sizeNum : 2; // 非法输入回退为 2
    this.carryScore = Boolean(carryScore);             // 强制转换为布尔值
    this.targetFn = typeof targetFn === 'function' ? targetFn : DEFAULT_TARGET_FN; // 确保目标函数合法
    this.targetFnKey = typeof targetFnKey === 'string' ? targetFnKey : 'power';    // 存储目标函数标识
    this.randomTileWeightsBySize = cloneWeightMap(randomTileWeightsBySize);       // 克隆尺寸→权重映射
    this.totalScoreBeforeThisLevel = 0;                // 初始化累计分为 0
    this.rngFactory = typeof rngFactory === 'function' ? rngFactory : null; // 记录伪随机工厂，非法值置空
    this.rngSeed = rngSeed === null || rngSeed === undefined || rngSeed === '' ? '' : String(rngSeed); // 规范化存储种子字符串
    this._rng = this._createRngFromSeed();             // 基于种子生成伪随机函数，未配置时为 null
    this._createGame();                                // 创建首个 Game2048 实例
  }

  // 内部工具：根据当前尺寸创建 Game2048 实例
  _createGame() {
    const customWeights = cloneSingleWeights(this.randomTileWeightsBySize[this.size]); // 读取并克隆对应尺寸的权重
    const weights = Object.keys(customWeights).length ? customWeights : getDefaultWeights(); // 若无定制则使用默认权重
    const rng = typeof this._rng === 'function' ? this._rng : null; // 获取伪随机函数引用，未设置时返回 null
    this.game = new Game2048({ size: this.size, randomTileWeights: weights, rng: rng || undefined }); // 基于尺寸、权重与伪随机函数生成实例
  }

  // 内部工具：根据当前种子与工厂创建伪随机函数
  _createRngFromSeed() {
    if (!this.rngFactory) return null;                 // 未提供工厂则不生成伪随机函数
    if (this.rngSeed === '') return null;              // 种子为空字符串时视为不启用
    try {
      const rng = this.rngFactory(this.rngSeed);       // 调用工厂基于种子生成伪随机函数
      return typeof rng === 'function' ? rng : null;   // 若返回值为函数则使用，否则视为未启用
    } catch (err) {
      console.warn('[LevelManager] rngFactory 执行失败，已回退为非确定模式：', err); // 捕获异常并给出警告
      return null;                                     // 出错时禁用伪随机函数
    }
  }

  // 内部工具：尝试恢复伪随机函数的内部状态
  _applyRngState(stateValue) {
    if (!this._rng || typeof this._rng.restoreState !== 'function') return; // 无法恢复时直接返回
    const num = Number(stateValue);                  // 将传入值转换为数字
    if (!Number.isFinite(num)) return;               // 非数字直接忽略
    this._rng.restoreState(num);                     // 调用工厂提供的恢复能力
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
      randomTileWeightsBySize: cloneWeightMap(this.randomTileWeightsBySize), // 尺寸→权重映射副本
      rngSeed: this.rngSeed,                           // 记录伪随机数种子，空字符串表示未固定
      rngState: this._rng && typeof this._rng.peekState === 'function' ? this._rng.peekState() : null // 记录伪随机内部状态
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

    const rngSeed = json.rngSeed === null || json.rngSeed === undefined || json.rngSeed === '' ? '' : String(json.rngSeed); // 解析并规范化种子
    const rngFactory = targetFnRegistry && typeof targetFnRegistry.rngFactory === 'function'
      ? targetFnRegistry.rngFactory
      : null;                                         // 从注册表获取伪随机工厂

    const manager = new LevelManager({                // 基于解析后的数据创建实例
      startSize: size,
      carryScore,
      targetFn,
      targetFnKey: targetKey,
      randomTileWeightsBySize: weightMap,
      rngSeed,
      rngFactory
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

    const rngState = json.rngState;                   // 读取伪随机内部状态
    if (rngState !== undefined) manager._applyRngState(rngState); // 尝试恢复伪随机内部状态

    return manager;                                   // 返回恢复后的实例
  }

  // 导出当前状态快照：包含序列化数据与时间戳
  snapshot() {
    return { lm: this.toJSON(), t: Date.now() };       // 返回 JSON 结构与当前时间戳
  }

  // 从 JSON 数据恢复当前实例，相当于重建后替换内部字段
  restore(json, registry = TARGET_FN_REGISTRY) {
    const restored = LevelManager.fromJSON(json, registry); // 使用静态方法生成新实例
    if (!(restored instanceof LevelManager)) return false;  // 未能成功恢复时返回 false
    this.size = restored.size;                              // 替换棋盘尺寸
    this.carryScore = restored.carryScore;                  // 替换累计策略
    this.targetFn = restored.targetFn;                      // 替换目标函数实现
    this.targetFnKey = restored.targetFnKey;                // 替换目标函数键
    this.randomTileWeightsBySize = cloneWeightMap(restored.randomTileWeightsBySize); // 深拷贝尺寸→权重映射
    this.totalScoreBeforeThisLevel = restored.totalScoreBeforeThisLevel; // 覆盖累计分
    this.rngFactory = restored.rngFactory;                  // 更新伪随机工厂引用
    this.rngSeed = restored.rngSeed;                        // 更新种子字符串
    this._rng = restored._rng;                              // 更新伪随机函数引用
    this.game = restored.getGame();                         // 替换 Game2048 实例
    return true;                                            // 恢复成功返回 true
  }
}
