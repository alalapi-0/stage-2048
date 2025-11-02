// /miniprogram/pages/index/index.js
// 说明：小程序首页逻辑，扩展撤销、复盘、演示模式、成就徽章与固定种子等功能。所有新增代码保持中文注释便于维护。

const { LevelManager, TARGET_FN_REGISTRY } = require('../../core/levels.cjs.js'); // 引入关卡管理器与目标函数注册表
const { makeLCG } = require('../../core/rng.cjs.js');                               // 引入线性同余伪随机工厂
const sys = wx.getSystemInfoSync();                                                // 获取设备信息用于计算画布尺寸

const REGISTRY_WITH_RNG = Object.assign({}, TARGET_FN_REGISTRY, { rngFactory: makeLCG }); // 扩展注册表附带 rng 工厂

const STORE = {                                                                    // 定义本地存储键
  settings: 'stage2048.mp.settings.v2',                                             // 设置存储（含动画与种子）
  progress: 'stage2048.mp.progress.v2',                                             // 关卡进度（含伪随机状态）
  best: 'stage2048.mp.bestScore.v1',                                                // 最佳分
  maxTile: 'stage2048.mp.maxTile.v1',                                               // 历史最大方块
  levelpack: 'stage2048.mp.levelpack.v1',                                           // 关卡包 JSON 文本
  levelpackIndex: 'stage2048.mp.levelpackIndex.v1'                                  // 关卡包当前索引
};

const LEGACY_STORE = {                                                             // 旧版本存储键（迁移用）
  settings: 'stage2048.mp.settings.v1',
  progress: 'stage2048.mp.progress.v1'
};

const DEFAULT_SETTINGS = Object.freeze({                                           // 默认设置
  gap: 12,
  animate: false,
  seed: '',
  LEVELS: {
    startSize: 2,
    carryScore: true,
    targetFnKey: 'power',
    randomTileWeightsBySize: {
      4: { 2: 0.9, 4: 0.1 }
    }
  }
});

const DIR_TO_LETTER = { left: 'L', right: 'R', up: 'U', down: 'D' };               // 方向到操作字符映射
const LETTER_TO_DIR = { L: 'left', R: 'right', U: 'up', D: 'down' };               // 操作字符到方向映射
const DEMO_INTERVAL = 180;                                                         // 演示模式间隔（毫秒）
const BADGES = [                                                                   // 成就徽章阈值
  { threshold: 64, icon: '🗝️', label: '达到 64 方块' },
  { threshold: 256, icon: '🎯', label: '达到 256 方块' },
  { threshold: 1024, icon: '🏆', label: '达到 1024 方块' }
];

const LEVEL_PACK_SUM_TOLERANCE = 0.001;                                            // 关卡包新生权重和允许的误差
let levelPackState = { pack: null, index: 0 };                                     // 记录当前关卡包配置与索引

function cloneWeightMap(map) {                                                     // 克隆尺寸→权重映射
  const result = {};
  if (!map || typeof map !== 'object') return result;
  for (const sizeKey of Object.keys(map)) {
    const src = map[sizeKey];
    if (!src || typeof src !== 'object') continue;
    const inner = {};
    for (const tileKey of Object.keys(src)) {
      const numVal = Number(src[tileKey]);
      if (!Number.isFinite(numVal)) continue;
      inner[tileKey] = numVal;
    }
    if (Object.keys(inner).length) result[sizeKey] = inner;
  }
  return result;
}

function cloneSettings(source) {                                                   // 克隆设置对象
  return {
    gap: source.gap,
    animate: Boolean(source.animate),
    seed: typeof source.seed === 'string' ? source.seed : (source.seed === null || source.seed === undefined ? '' : String(source.seed)),
    LEVELS: {
      startSize: source.LEVELS.startSize,
      carryScore: source.LEVELS.carryScore,
      targetFnKey: source.LEVELS.targetFnKey,
      randomTileWeightsBySize: cloneWeightMap(source.LEVELS.randomTileWeightsBySize)
    }
  };
}

function sanitizeNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) { // 数值清洗
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function sanitizeBoolean(value, fallback) {                                        // 布尔清洗
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

function sanitizeTargetFnKey(value, fallback) {                                   // 目标函数键清洗
  if (typeof value === 'string' && TARGET_FN_REGISTRY[value]) return value;
  return TARGET_FN_REGISTRY[fallback] ? fallback : 'power';
}

function sanitizeSettings(patch, fallback = DEFAULT_SETTINGS) {                   // 设置对象清洗
  const base = cloneSettings(fallback);
  if (!patch || typeof patch !== 'object') return base;
  if ('gap' in patch) base.gap = sanitizeNumber(patch.gap, base.gap, { min: 4, max: 60 });
  if ('animate' in patch) base.animate = sanitizeBoolean(patch.animate, base.animate);
  if ('seed' in patch) {
    const raw = patch.seed;
    base.seed = raw === null || raw === undefined ? '' : String(raw).trim();
  }
  const lvlPatch = patch.LEVELS && typeof patch.LEVELS === 'object' ? patch.LEVELS : null;
  if (lvlPatch) {
    if ('startSize' in lvlPatch) base.LEVELS.startSize = Math.max(2, Math.floor(sanitizeNumber(lvlPatch.startSize, base.LEVELS.startSize, { min: 2, max: 16 })));
    if ('carryScore' in lvlPatch) base.LEVELS.carryScore = sanitizeBoolean(lvlPatch.carryScore, base.LEVELS.carryScore);
    if ('targetFnKey' in lvlPatch) base.LEVELS.targetFnKey = sanitizeTargetFnKey(lvlPatch.targetFnKey, base.LEVELS.targetFnKey);
    if ('randomTileWeightsBySize' in lvlPatch) base.LEVELS.randomTileWeightsBySize = cloneWeightMap(lvlPatch.randomTileWeightsBySize);
  }
  return base;
}

function readJSON(key) {                                                            // 读取并解析 JSON
  try {
    const raw = wx.getStorageSync(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[Stage2048][mini] 读取存储失败：', key, err);
    return null;
  }
}

function writeJSON(key, value) {                                                    // 写入 JSON
  try {
    wx.setStorageSync(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[Stage2048][mini] 写入存储失败：', key, err);
  }
}

function removeStorage(key) {                                                       // 移除存储
  try {
    wx.removeStorageSync(key);
  } catch (err) {
    console.warn('[Stage2048][mini] 移除存储失败：', key, err);
  }
}

function createManager(settings) {                                                  // 基于设置创建关卡管理器
  const defaultKey = sanitizeTargetFnKey(settings.LEVELS.targetFnKey, 'power');     // 读取默认目标函数键
  let targetKey = defaultKey;                              // 初始化为默认目标键
  let targetFn = TARGET_FN_REGISTRY[targetKey] || TARGET_FN_REGISTRY.power; // 初始化目标函数
  let startSize = settings.LEVELS.startSize;              // 默认起始尺寸
  const weightsMap = cloneWeightMap(settings.LEVELS.randomTileWeightsBySize); // 克隆权重映射
  const level = getActivePackLevel();                     // 获取关卡包当前定义
  if (level) {                                            // 若关卡包生效
    startSize = level.size;                               // 使用包内指定尺寸
    if (level.targetFnKey && TARGET_FN_REGISTRY[level.targetFnKey]) { // 指定目标函数键可用
      targetKey = level.targetFnKey;                      // 覆盖目标键
      targetFn = TARGET_FN_REGISTRY[level.targetFnKey];   // 覆盖目标函数
    }
    if (level.randomTileWeights) {                        // 若提供自定义新生权重
      const cloned = {};                                  // 创建浅拷贝
      for (const key of Object.keys(level.randomTileWeights)) { // 遍历每个条目
        cloned[key] = level.randomTileWeights[key];       // 逐项复制
      }
      weightsMap[startSize] = cloned;                     // 写入对应尺寸权重
    }
  }
  const opts = {                                          // 组装管理器配置
    startSize,
    carryScore: settings.LEVELS.carryScore,
    targetFn,
    targetFnKey: targetKey,
    randomTileWeightsBySize: weightsMap
  };
  const seed = typeof settings.seed === 'string' ? settings.seed.trim() : ''; // 规范化种子
  if (seed) {                                            // 有固定种子时写入
    opts.rngSeed = seed;
    opts.rngFactory = makeLCG;
  }
  return new LevelManager(opts);                          // 创建并返回实例
}

function getGridMaxValue(grid) {                                                    // 计算棋盘最大值
  let max = 0;
  for (const row of grid) {
    for (const v of row) {
      if (v > max) max = v;
    }
  }
  return max;
}

function computeAnimatedCells(prev, next) {                                         // 计算动画单元格集合
  const cells = new Set();
  const size = next.length;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const before = prev[r][c];
      const after = next[r][c];
      if (!after) continue;
      if (before === 0 || after > before) cells.add(`${r}-${c}`);
    }
  }
  return cells;
}

function simulateLine(line, reverse = false) {                                      // 模拟一行的合并结果
  const arr = reverse ? line.slice().reverse() : line.slice();
  const filtered = arr.filter(v => v !== 0);
  const out = [];
  for (let i = 0; i < filtered.length; i++) {
    if (i < filtered.length - 1 && filtered[i] === filtered[i + 1]) {
      out.push(filtered[i] * 2);
      i++;
    } else {
      out.push(filtered[i]);
    }
  }
  while (out.length < line.length) out.push(0);
  if (reverse) out.reverse();
  for (let i = 0; i < line.length; i++) {
    if (out[i] !== line[i]) return { changed: true, line: out };
  }
  return { changed: false, line: out };
}

function simulateMovePossible(grid, dir) {                                          // 判断方向是否会改变棋盘
  const size = grid.length;
  if (dir === 'left' || dir === 'right') {
    const reverse = dir === 'right';
    for (let r = 0; r < size; r++) {
      if (simulateLine(grid[r], reverse).changed) return true;
    }
    return false;
  }
  if (dir === 'up' || dir === 'down') {
    const reverse = dir === 'down';
    for (let c = 0; c < size; c++) {
      const col = [];
      for (let r = 0; r < size; r++) col.push(grid[r][c]);
      if (simulateLine(col, reverse).changed) return true;
    }
    return false;
  }
  return false;
}

function normalizeLevelPack(raw) {                                                   // 标准化并校验关卡包
  const errors = [];                                   // 准备错误信息列表
  if (!raw || typeof raw !== 'object') {               // 根节点必须为对象
    errors.push('关卡包需要是对象');                     // 记录错误
    return { valid: false, errors, normalized: null }; // 返回失败结果
  }
  const normalized = {                                 // 构建标准化结果
    name: '',                                          // 默认名称为空
    version: 1,                                        // 默认版本号为 1
    levels: []                                         // 初始化关卡数组
  };
  if (typeof raw.name === 'string') {                  // 若提供名称
    normalized.name = raw.name.trim();                 // 去除空白后写入
  } else if (raw.name !== undefined && raw.name !== null) { // 非字符串时记录错误
    errors.push('name 必须是字符串');
  }
  if (raw.version !== undefined && raw.version !== null) { // 若提供版本号
    const versionNum = Number(raw.version);            // 转换为数字
    if (!Number.isInteger(versionNum) || versionNum <= 0) { // 必须为正整数
      errors.push('version 必须是正整数');                // 记录错误
    } else {
      normalized.version = versionNum;                // 合法则写入
    }
  }
  if (!Array.isArray(raw.levels) || raw.levels.length === 0) { // 关卡数组必需
    errors.push('levels 必须是非空数组');                // 记录错误
    return { valid: false, errors, normalized: null }; // 无关卡直接返回失败
  }
  const supportedTargets = Object.keys(TARGET_FN_REGISTRY || {}); // 获取可用目标函数键
  raw.levels.forEach((lvRaw, idx) => {                // 遍历每个关卡
    const levelErrors = [];                            // 当前关卡错误列表
    if (!lvRaw || typeof lvRaw !== 'object') {         // 关卡必须是对象
      levelErrors.push('关卡必须是对象');               // 记录错误
    }
    const levelNormalized = {                          // 标准化关卡结构
      size: 0,
      targetFnKey: null,
      randomTileWeights: null
    };
    if (lvRaw && typeof lvRaw === 'object') {          // 仅在对象时继续
      const sizeNum = Number(lvRaw.size);              // 转换尺寸
      if (!Number.isInteger(sizeNum) || sizeNum < 2 || sizeNum > 10) {
        levelErrors.push('size 需要是 2~10 的整数');      // 记录错误
      } else {
        levelNormalized.size = sizeNum;               // 合法尺寸写入
      }
      if (lvRaw.targetFnKey !== undefined && lvRaw.targetFnKey !== null) { // 处理目标函数键
        if (typeof lvRaw.targetFnKey !== 'string') {   // 必须为字符串
          levelErrors.push('targetFnKey 必须是字符串');
        } else {
          const key = lvRaw.targetFnKey.trim();       // 去除空白
          if (supportedTargets.length > 0 && !supportedTargets.includes(key)) { // 若注册表未包含
            levelErrors.push(`targetFnKey ${key} 未注册`); // 记录错误
          } else {
            levelNormalized.targetFnKey = key || null; // 合法键写入
          }
        }
      }
      if (lvRaw.randomTileWeights !== undefined && lvRaw.randomTileWeights !== null) { // 处理新生权重
        if (!lvRaw.randomTileWeights || typeof lvRaw.randomTileWeights !== 'object' || Array.isArray(lvRaw.randomTileWeights)) {
          levelErrors.push('randomTileWeights 必须是对象'); // 非对象时记录错误
        } else {
          const weightMap = {};                         // 整理后的权重
          let sum = 0;                                  // 累计概率和
          let hasInvalid = false;                       // 标记是否出现非法项
          for (const key of Object.keys(lvRaw.randomTileWeights)) { // 遍历每个条目
            const numKey = Number(key);                 // 将键转换为数字
            const numVal = Number(lvRaw.randomTileWeights[key]); // 将值转换为数字
            if (!Number.isFinite(numKey)) {             // 键必须是有限数
              levelErrors.push(`randomTileWeights 的键 ${key} 不是数字`);
              hasInvalid = true;
              continue;
            }
            if (!Number.isFinite(numVal)) {             // 值必须是有限数
              levelErrors.push(`randomTileWeights[${key}] 不是数字`);
              hasInvalid = true;
              continue;
            }
            if (!(numVal > 0 && numVal <= 1)) {         // 概率需落在 (0,1]
              levelErrors.push(`randomTileWeights[${key}] 需要落在 (0,1] 区间`);
              hasInvalid = true;
              continue;
            }
            weightMap[String(numKey)] = numVal;        // 写入整理后的权重
            sum += numVal;                              // 累计总和
          }
          if (!hasInvalid) {                            // 无非法条目时继续
            const keys = Object.keys(weightMap);        // 获取键集合
            if (keys.length === 0) {                    // 至少需要一项
              levelErrors.push('randomTileWeights 至少需要一项');
            } else if (Math.abs(sum - 1) > LEVEL_PACK_SUM_TOLERANCE) { // 检查概率和
              levelErrors.push('randomTileWeights 的概率之和需要接近 1');
            } else {
              levelNormalized.randomTileWeights = weightMap; // 合法时写入
            }
          }
        }
      }
    }
    if (levelErrors.length > 0) {                       // 若存在错误
      levelErrors.forEach((msg) => errors.push(`levels[${idx}]: ${msg}`)); // 附带索引写入总列表
    } else {
      normalized.levels.push(levelNormalized);         // 校验通过的关卡写入结果
    }
  });
  if (normalized.levels.length === 0) {                 // 若没有合法关卡
    errors.push('关卡包需要至少包含一个合法关卡');
  }
  return {                                              // 返回综合结果
    valid: errors.length === 0,
    errors,
    normalized: errors.length === 0 ? normalized : null
  };
}

function validateLevelPack(raw) {                                                          // 布尔包装函数
  const result = normalizeLevelPack(raw);               // 执行标准化校验
  if (!result.valid) {                                  // 校验失败时
    console.warn('[Stage2048][mini] 关卡包校验失败：', result.errors); // 输出错误
    return false;                                       // 返回 false
  }
  return true;                                          // 校验通过返回 true
}

function loadLevelPackFromStorage() {                                                       // 读取关卡包
  try {
    const txt = wx.getStorageSync(STORE.levelpack);     // 读取存储文本
    if (!txt) return null;                              // 未存储时返回 null
    const parsed = JSON.parse(txt);                     // 解析 JSON
    const result = normalizeLevelPack(parsed);          // 校验并标准化
    if (!result.valid) {                                // 校验失败
      console.warn('[Stage2048][mini] 存储的关卡包无效：', result.errors);
      return null;                                      // 返回 null
    }
    return result.normalized;                           // 返回标准化对象
  } catch (err) {
    console.warn('[Stage2048][mini] 读取关卡包失败：', err); // 捕获异常
    return null;                                        // 异常时返回 null
  }
}

function saveLevelPackToStorage(pack) {                                                     // 保存关卡包
  try {
    wx.setStorageSync(STORE.levelpack, JSON.stringify(pack)); // 序列化后写入
  } catch (err) {
    console.warn('[Stage2048][mini] 写入关卡包失败：', err);  // 输出异常
  }
}

function clearLevelPackStorage() {                                                           // 清除关卡包
  try {
    wx.removeStorageSync(STORE.levelpack);               // 移除对应存储
  } catch (err) {
    console.warn('[Stage2048][mini] 清除关卡包失败：', err);  // 输出异常
  }
}

function loadLevelPackIndex() {                                                              // 读取索引
  try {
    const raw = wx.getStorageSync(STORE.levelpackIndex); // 读取索引文本
    if (raw === '' || raw === null || raw === undefined) return 0; // 未写入时回退 0
    const num = Number(raw);                            // 转换数字
    return Number.isInteger(num) && num >= 0 ? num : 0; // 非负整数视为合法
  } catch (err) {
    console.warn('[Stage2048][mini] 读取关卡包索引失败：', err); // 输出异常
    return 0;                                           // 异常回退 0
  }
}

function saveLevelPackIndex(idx) {                                                           // 写入索引
  try {
    wx.setStorageSync(STORE.levelpackIndex, String(idx)); // 序列化后写入
  } catch (err) {
    console.warn('[Stage2048][mini] 写入关卡包索引失败：', err); // 输出异常
  }
}

function clearLevelPackIndex() {                                                             // 清除索引存储
  try {
    wx.removeStorageSync(STORE.levelpackIndex);          // 移除索引键
  } catch (err) {
    console.warn('[Stage2048][mini] 清除关卡包索引失败：', err); // 输出异常
  }
}

function persistCurrentLevelPackIndex() {                                                    // 根据状态写入索引
  if (!levelPackState.pack) {                           // 未启用关卡包
    clearLevelPackIndex();                              // 直接清除
    return;
  }
  saveLevelPackIndex(levelPackState.index);             // 写入当前索引
}

function clampLevelPackIndex() {                                                             // 校正索引范围
  if (!levelPackState.pack) {                           // 无关卡包配置
    levelPackState.index = 0;                           // 索引重置
    return;
  }
  const levels = levelPackState.pack.levels;            // 读取关卡数组
  const total = Array.isArray(levels) ? levels.length : 0; // 计算总关卡数
  if (total <= 0) {                                     // 若数组为空
    levelPackState.pack = null;                         // 清空配置
    levelPackState.index = 0;                           // 重置索引
    clearLevelPackStorage();                            // 清除存储
    clearLevelPackIndex();                              // 清除索引
    return;
  }
  if (levelPackState.index < 0) levelPackState.index = 0; // 下限保护
  if (levelPackState.index > total) levelPackState.index = total; // 上限允许等于总数
}

function syncLevelPackStateFromStorage() {                                                   // 同步运行时状态
  levelPackState = {                                    // 重建状态对象
    pack: loadLevelPackFromStorage(),                   // 读取并校验关卡包
    index: loadLevelPackIndex()                         // 读取索引
  };
  clampLevelPackIndex();                                // 校正索引范围
  persistCurrentLevelPackIndex();                       // 写回一次确保一致
}

function getActivePackLevel() {                                                              // 获取当前索引的关卡定义
  if (!levelPackState.pack) return null;                // 未启用时返回 null
  const levels = levelPackState.pack.levels;            // 读取关卡数组
  if (!Array.isArray(levels) || levels.length === 0) return null; // 无合法关卡时返回 null
  if (levelPackState.index >= levels.length) return null; // 索引越界表示已完成
  return levels[levelPackState.index];                  // 返回当前关卡配置
}

Page({
  data: {
    canvasPx: 360,                  // 画布像素尺寸
    gap: 12,                        // 格子间隙
    size: 2,                        // 棋盘尺寸
    level: 1,                       // 关卡编号
    target: 32,                     // 目标值
    score: 0,                       // 当前得分
    totalScore: 0,                  // 累计总分
    bestScore: 0,                   // 历史最佳
    achv: '尚未解锁',               // 成就徽章文本
    achvLabel: '尚未解锁',          // 成就朗读文本
    demo: false,                    // 演示模式开关状态
    statusText: '',                 // 状态播报文本
    packStatus: '当前未加载关卡包，将按默认尺寸递增推进。' // 关卡包状态提示
  },

  onLoad() {
    this.SETTINGS = cloneSettings(DEFAULT_SETTINGS);                         // 初始化设置副本
    syncLevelPackStateFromStorage();                                         // 同步关卡包存储状态
    this.packStatusText = '当前未加载关卡包，将按默认尺寸递增推进。';       // 初始化关卡包提示文本
    let storedSettings = readJSON(STORE.settings);                           // 读取新版设置
    if (!storedSettings) {                                                  // 若无数据尝试迁移旧版
      storedSettings = readJSON(LEGACY_STORE.settings);
      if (storedSettings) {
        writeJSON(STORE.settings, storedSettings);
        removeStorage(LEGACY_STORE.settings);
      }
    }
    if (storedSettings) this.SETTINGS = sanitizeSettings(storedSettings, this.SETTINGS); // 合并设置
    this.setData({ gap: this.SETTINGS.gap });                                 // 同步间隙到 data

    const best = Number(wx.getStorageSync(STORE.best) || 0);                  // 读取最佳分
    this.bestScore = Number.isFinite(best) && best >= 0 ? best : 0;
    this.setData({ bestScore: this.bestScore });

    this.maxTileHistory = this._loadMaxTile();                                // 载入历史最大方块
    this.badgeText = '尚未解锁';                                              // 初始化徽章文本
    this.badgeLabel = '尚未解锁';

    let storedProgress = readJSON(STORE.progress);                           // 读取新版进度
    if (!storedProgress) {                                                   // 若无数据尝试迁移旧版
      storedProgress = readJSON(LEGACY_STORE.progress);
      if (storedProgress) {
        writeJSON(STORE.progress, storedProgress);
        removeStorage(LEGACY_STORE.progress);
      }
    }

    try {
      this.LM = storedProgress ? LevelManager.fromJSON(storedProgress, REGISTRY_WITH_RNG) : createManager(this.SETTINGS); // 恢复或创建关卡
    } catch (err) {
      console.warn('[Stage2048][mini] 进度恢复失败，使用新实例：', err);
      this.LM = createManager(this.SETTINGS);
    }
    this.SETTINGS.LEVELS.targetFnKey = sanitizeTargetFnKey(this.LM.targetFnKey, this.SETTINGS.LEVELS.targetFnKey); // 同步目标函数键
    this.SETTINGS.LEVELS.randomTileWeightsBySize = cloneWeightMap(this.LM.randomTileWeightsBySize);               // 同步权重映射

    if (levelPackState.pack && this.LM) {                                    // 若启用了关卡包
      const levels = levelPackState.pack.levels;                            // 读取关卡数组
      if (Array.isArray(levels) && levels.length > 0) {                     // 确保数组有效
        const match = levels.findIndex((item) => item.size === this.LM.size); // 根据尺寸匹配索引
        if (match >= 0) {                                                   // 找到匹配项
          levelPackState.index = match;                                     // 对齐索引
        } else if (this.LM.size > levels[levels.length - 1].size) {         // 超出包尾
          levelPackState.index = levels.length;                             // 视为已完成
        } else {
          levelPackState.index = 0;                                         // 其他情况回退首关
        }
        persistCurrentLevelPackIndex();                                     // 将索引写回存储
      }
    }

    this._applyLevelPackForCurrentLevel();                                   // 应用关卡包参数
    this.game = this.LM.getGame();                                           // 获取 Game2048 实例
    this._updatePackStatus();                                                // 更新提示文本
    writeJSON(STORE.settings, this.SETTINGS);                                 // 存储清洗后的设置

    this.ops = [];                                                           // 初始化操作序列
    this.undoSnapshot = null;                                                // 初始化撤销快照
    this.demoTimer = null;                                                   // 演示计时器
    this.isReplaying = false;                                                // 复盘状态标记
    this.replayTimer = null;                                                 // 复盘计时器
    this.replayQueue = null;                                                 // 复盘操作队列
    this.replayIndex = 0;                                                    // 复盘索引
    this.animCells = null;                                                   // 动画单元格集合
    this.animTimeout = null;                                                 // 动画超时句柄

    const px = Math.min(Math.max(300, sys.windowWidth - 32), 480);           // 计算画布尺寸
    this.setData({ canvasPx: Math.floor(px), achv: this.badgeText, achvLabel: this.badgeLabel, statusText: '' });
  },

  onReady() {
    this.ctx = wx.createCanvasContext('game', this);                         // 创建 2D 上下文
    this._computeTileSize();                                                 // 计算格子尺寸
    this._syncHud();                                                         // 同步 HUD
    this._drawAll();                                                         // 初始绘制
    this._refreshAchievements();                                             // 刷新徽章显示
  },

  onUnload() {
    this._stopDemo();                                                        // 离开页面时停止演示
    this._stopReplay();                                                      // 同时停止复盘
    this._clearAnimation();                                                  // 清理动画定时器
  },

  _computeTileSize() {
    const size = this.game.size;
    const gap = this.SETTINGS.gap;
    const canvasPx = this.data.canvasPx;
    this.tileSize = (canvasPx - gap * (size + 1)) / size;
  },

  _roundRect(x, y, w, h, r, color) {
    const ctx = this.ctx;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.setFillStyle(color);
    ctx.fill();
    ctx.closePath();
  },

  _fitFont(text, maxW, maxH) {
    const ctx = this.ctx;
    let lo = 4, hi = Math.floor(maxH), best = lo;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      ctx.setFontSize(mid);
      const w = ctx.measureText(text).width;
      if (w <= maxW && mid <= maxH) { best = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    return best;
  },

  _drawAll(progress = 1) {
    const ctx = this.ctx;
    const gap = this.SETTINGS.gap;
    const size = this.game.size;
    const S = this.data.canvasPx;
    const T = this.tileSize;
    ctx.clearRect(0, 0, S, S);
    this._roundRect(0, 0, S, S, 10, '#bbada0');
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const x = gap + c * (T + gap);
        const y = gap + r * (T + gap);
        this._roundRect(x, y, T, T, 8, '#cdc1b4');
      }
    }
    const grid = this.game.getGrid();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const val = grid[r][c];
        if (!val) continue;
        const key = `${r}-${c}`;
        const x = gap + c * (T + gap);
        const y = gap + r * (T + gap);
        const sty = this._tileStyle(val);
        if (this.animCells && this.animCells.has(key)) ctx.setGlobalAlpha(progress);
        else ctx.setGlobalAlpha(1);
        this._roundRect(x, y, T, T, 8, sty.bg);
        const pad = T * 0.12;
        const inner = T - pad * 2;
        const fontSize = this._fitFont(String(val), inner, inner);
        ctx.setFillStyle(sty.fg);
        ctx.setFontSize(fontSize);
        ctx.setTextAlign('center');
        ctx.setTextBaseline('middle');
        ctx.fillText(String(val), x + T / 2, y + T / 2);
      }
    }
    ctx.draw();
    ctx.setGlobalAlpha(1);
    this._refreshAchievements();
  },

  _tileStyle(val) {
    const COLORS = {
      1: { bg: '#eee4da', fg: '#776e65' },
      2: { bg: '#ede0c8', fg: '#776e65' },
      4: { bg: '#f2b179', fg: '#f9f6f2' },
      8: { bg: '#f59563', fg: '#f9f6f2' },
      16: { bg: '#f67c5f', fg: '#f9f6f2' },
      32: { bg: '#f65e3b', fg: '#f9f6f2' },
      64: { bg: '#edcf72', fg: '#f9f6f2' },
      128: { bg: '#edcc61', fg: '#f9f6f2' },
      256: { bg: '#edc850', fg: '#f9f6f2' },
      512: { bg: '#edc53f', fg: '#f9f6f2' },
      1024: { bg: '#edc22e', fg: '#f9f6f2' },
      2048: { bg: '#3c3a32', fg: '#f9f6f2' }
    };
    return COLORS[val] || { bg: '#3c3a32', fg: '#f9f6f2' };
  },

  _refreshAchievements() {
    const currentMax = getGridMaxValue(this.game.getGrid());
    if (currentMax > this.maxTileHistory) {
      this.maxTileHistory = currentMax;
      this._persistMaxTile();
    }
    const unlocked = BADGES.filter(item => this.maxTileHistory >= item.threshold);
    this.badgeText = unlocked.length ? unlocked.map(item => item.icon).join(' ') : '尚未解锁';
    this.badgeLabel = unlocked.length ? unlocked.map(item => `${item.icon} ${item.label}`).join('，') : '尚未解锁';
    this.setData({ achv: this.badgeText, achvLabel: this.badgeLabel });
  },

  _loadMaxTile() {
    try {
      const raw = wx.getStorageSync(STORE.maxTile);
      const num = Number(raw);
      return Number.isFinite(num) && num > 0 ? num : 0;
    } catch (err) {
      console.warn('[Stage2048][mini] 读取成就记录失败：', err);
      return 0;
    }
  },

  _persistMaxTile() {
    try {
      wx.setStorageSync(STORE.maxTile, String(this.maxTileHistory));
    } catch (err) {
      console.warn('[Stage2048][mini] 写入成就记录失败：', err);
    }
  },

  _persistProgress() {                                                     // 持久化当前关卡进度
    writeJSON(STORE.progress, this.LM.toJSON());                            // 写入关卡管理器快照
    persistCurrentLevelPackIndex();                                        // 同步关卡包索引
  },
  _persistSettings() { writeJSON(STORE.settings, this.SETTINGS); },
  _persistBest() { wx.setStorageSync(STORE.best, String(this.bestScore)); },

  _applyPackWeightsForSize(size, weights) {                                 // 为指定尺寸应用新生权重
    if (!this.LM) return;                                                   // 管理器未初始化时直接返回
    if (!this.LM.randomTileWeightsBySize || typeof this.LM.randomTileWeightsBySize !== 'object') {
      this.LM.randomTileWeightsBySize = {};                                 // 确保映射存在
    }
    if (weights && typeof weights === 'object') {                           // 关卡包提供权重时
      const cloned = {};                                                    // 创建浅拷贝
      for (const key of Object.keys(weights)) {                             // 遍历每个条目
        cloned[key] = weights[key];                                         // 逐项复制
      }
      this.LM.randomTileWeightsBySize[size] = cloned;                       // 写入目标尺寸权重
    } else if (this.SETTINGS.LEVELS.randomTileWeightsBySize && this.SETTINGS.LEVELS.randomTileWeightsBySize[size]) {
      this.LM.randomTileWeightsBySize[size] = cloneWeightMap({ [size]: this.SETTINGS.LEVELS.randomTileWeightsBySize[size] })[size]; // 恢复设置中的默认权重
    } else {
      delete this.LM.randomTileWeightsBySize[size];                          // 无默认配置时删除条目回退到核心默认
    }
  },

  _applyLevelPackForCurrentLevel() {                                        // 按关卡包配置调整当前关卡
    const level = getActivePackLevel();                                     // 读取当前关卡定义
    const fallbackKey = sanitizeTargetFnKey(this.SETTINGS.LEVELS.targetFnKey, 'power'); // 默认目标函数键
    const fallbackFn = TARGET_FN_REGISTRY[fallbackKey] || TARGET_FN_REGISTRY.power; // 默认目标函数
    if (!this.LM) return;                                                   // 管理器尚未准备好时直接返回
    if (level && level.targetFnKey && TARGET_FN_REGISTRY[level.targetFnKey]) { // 关卡包指定目标函数时
      this.LM.targetFnKey = level.targetFnKey;                              // 覆盖目标函数键
      this.LM.targetFn = TARGET_FN_REGISTRY[level.targetFnKey];             // 覆盖目标函数
    } else {
      this.LM.targetFnKey = fallbackKey;                                    // 回退到默认目标函数
      this.LM.targetFn = fallbackFn;                                        // 使用默认函数
    }
    if (level) {                                                            // 若当前关卡来自关卡包
      this._applyPackWeightsForSize(level.size, level.randomTileWeights);   // 应用对应权重
      if (this.LM.size !== level.size) {                                    // 如尺寸不一致则同步
        this.LM.size = level.size;                                          // 更新管理器尺寸
        this.LM._createGame();                                              // 重新创建关卡实例
        this.game = this.LM.getGame();                                      // 同步游戏引用
      }
    } else {
      this._applyPackWeightsForSize(this.LM.size, null);                    // 无关卡包时恢复默认权重
    }
  },

  _prepareNextLevelWithPack() {                                             // 进入下一关前处理关卡包索引
    if (!this.LM) return;                                                   // 管理器未准备好直接返回
    if (!levelPackState.pack) {                                             // 未启用关卡包
      this._applyPackWeightsForSize(this.LM.size + 1, null);                // 确保下一尺寸使用默认权重
      return;                                                               // 结束处理
    }
    const levels = levelPackState.pack.levels;                              // 读取关卡数组
    const total = Array.isArray(levels) ? levels.length : 0;                 // 计算总数
    if (total === 0) {                                                       // 关卡包为空时
      levelPackState.pack = null;                                           // 清空配置
      levelPackState.index = 0;                                             // 重置索引
      clearLevelPackStorage();                                              // 清除存储
      clearLevelPackIndex();                                                // 清除索引
      this._applyLevelPackForCurrentLevel();                                // 恢复默认参数
      this._updatePackStatus();                                             // 更新提示
      return;                                                               // 结束
    }
    if (levelPackState.index < total - 1) {                                 // 仍有下一关
      levelPackState.index += 1;                                            // 索引递增
      persistCurrentLevelPackIndex();                                       // 持久化索引
      const nextLevel = levels[levelPackState.index];                       // 读取下一关定义
      if (nextLevel && nextLevel.targetFnKey && TARGET_FN_REGISTRY[nextLevel.targetFnKey]) {
        this.LM.targetFnKey = nextLevel.targetFnKey;                        // 应用包内目标函数
        this.LM.targetFn = TARGET_FN_REGISTRY[nextLevel.targetFnKey];       // 更新函数引用
      } else {
        const fallbackKey = sanitizeTargetFnKey(this.SETTINGS.LEVELS.targetFnKey, 'power'); // 默认目标键
        this.LM.targetFnKey = fallbackKey;                                  // 使用默认键
        this.LM.targetFn = TARGET_FN_REGISTRY[fallbackKey] || TARGET_FN_REGISTRY.power; // 使用默认函数
      }
      this._applyPackWeightsForSize(nextLevel.size, nextLevel.randomTileWeights); // 应用下一关权重
      this.LM.size = Math.max(1, nextLevel.size - 1);                        // 调整尺寸以便 nextLevel 调用后正确
      return;                                                               // 完成准备
    }
    levelPackState.index = total;                                          // 没有更多关卡，索引指向末尾
    persistCurrentLevelPackIndex();                                        // 持久化索引
    const fallbackKey = sanitizeTargetFnKey(this.SETTINGS.LEVELS.targetFnKey, 'power'); // 默认目标函数键
    this.LM.targetFnKey = fallbackKey;                                     // 恢复默认目标函数键
    this.LM.targetFn = TARGET_FN_REGISTRY[fallbackKey] || TARGET_FN_REGISTRY.power; // 恢复默认目标函数
    this._applyPackWeightsForSize(this.LM.size + 1, null);                 // 下一尺寸使用默认权重
  },

  _updatePackStatus(customText) {                                           // 更新关卡包提示文本
    let text = '';                                                          // 准备提示文案
    if (typeof customText === 'string' && customText.trim()) {              // 若提供自定义文案
      text = customText.trim();                                             // 使用自定义提示
    } else if (!levelPackState.pack) {                                      // 未启用关卡包
      text = '当前未加载关卡包，将按默认尺寸递增推进。';                   // 默认提示
    } else {
      const pack = levelPackState.pack;                                     // 读取关卡包配置
      const total = pack.levels.length;                                     // 统计关卡数
      const name = pack.name ? `《${pack.name}》` : '（未命名包）';         // 构造包名展示
      if (levelPackState.index >= total) {                                  // 已完成全部关卡
        text = `已加载关卡包${name}，共 ${total} 关，已全部完成，后续按默认规则推进。`; // 完成提示
      } else {
        const current = levelPackState.index + 1;                           // 当前关卡编号
        text = `已加载关卡包${name}，共 ${total} 关，当前位于第 ${current} 关。`; // 进行中提示
      }
    }
    this.packStatusText = text;                                            // 记录提示文本
    this.setData({ packStatus: text });                                    // 更新界面显示
  },

  _rebuildAfterPackChange(alertText, tipText) {                             // 关卡包变更后重建关卡
    this._stopDemo();                                                       // 停止演示模式
    this._stopReplay();                                                     // 停止复盘
    removeStorage(STORE.progress);                                         // 清除旧进度
    this.LM = createManager(this.SETTINGS);                                 // 根据当前设置重建管理器
    this._applyLevelPackForCurrentLevel();                                  // 应用关卡包配置
    this.game = this.LM.getGame();                                          // 获取新的游戏实例
    this.ops = [];                                                          // 清空操作记录
    this.undoSnapshot = null;                                               // 清空撤销快照
    this._computeTileSize();                                                // 重新计算格子尺寸
    this._persistProgress();                                                // 保存最新状态
    this._clearAnimation();                                                 // 清理动画
    this._drawAll();                                                        // 重新绘制棋盘
    this._syncHud();                                                        // 同步 HUD 文本
    this._updatePackStatus(tipText);                                        // 更新提示文本
    if (alertText) wx.showToast({ title: alertText, icon: 'none' });        // 通过 Toast 提示用户
    this._announce(alertText || '关卡包已更新', true);                      // 播报结果
  },

  _announce(message, toast = false) {
    this.setData({ statusText: message || '' });
    if (toast && message) wx.showToast({ title: message, icon: 'none', duration: 1500 });
  },

  _clearAnimation() {
    if (this.animTimeout) {
      clearTimeout(this.animTimeout);
      this.animTimeout = null;
    }
    this.animCells = null;
  },

  _startAnimation(cells) {
    this._clearAnimation();
    if (!this.SETTINGS.animate || !cells || cells.size === 0) {
      this._drawAll();
      return;
    }
    this.animCells = cells;
    this._drawAll(0.1);
    this.animTimeout = setTimeout(() => {
      this.animCells = null;
      this._drawAll();
      this.animTimeout = null;
    }, 140);
  },

  _takeSnapshot() { return this.LM.snapshot(); },

  _restoreSnapshot(snapshot) {
    const ok = this.LM.restore(snapshot, REGISTRY_WITH_RNG);
    if (!ok) return false;
    this.game = this.LM.getGame();
    this._computeTileSize();
    this._clearAnimation();
    this._drawAll();
    this._syncHud();
    this._persistProgress();
    return true;
  },

  _syncHud() {
    this.setData({
      size: this.game.size,
      level: this.LM.getLevel(),
      target: this.LM.getTarget(),
      score: this.game.getScore(),
      totalScore: this.LM.getTotalScore(),
      bestScore: this.bestScore,
      achv: this.badgeText,
      achvLabel: this.badgeLabel
    });
    this._updatePackStatus();                                              // 同步关卡包提示文本
  },

  _doMove(dir, { mode = 'user', trackUndo = true, log = true, animate = true } = {}) {
    if (!dir) return false;
    const prevGrid = (this.SETTINGS.animate && animate) ? this.game.getGrid() : null;
    const snapshot = trackUndo ? this._takeSnapshot() : null;
    const prevOpsLength = this.ops.length;
    const moved = this.game.move(dir);
    if (!moved) return false;
    if (trackUndo && snapshot) this.undoSnapshot = { lm: snapshot.lm, opsLength: prevOpsLength };
    if (log && DIR_TO_LETTER[dir]) this.ops.push(DIR_TO_LETTER[dir]);
    this._persistProgress();
    if (this.SETTINGS.animate && animate && prevGrid) this._startAnimation(computeAnimatedCells(prevGrid, this.game.getGrid()));
    else {
      this._clearAnimation();
      this._drawAll();
    }
    const curScore = this.game.getScore();
    if (curScore > this.bestScore) {
      this.bestScore = curScore;
      this._persistBest();
    }
    this._syncHud();

    if (this.LM.checkPass()) {
      if (mode === 'demo') {
        this._stopDemo('演示达到目标，已暂停');
        wx.showToast({ title: '演示达到目标', icon: 'none' });
      } else if (mode === 'replay') {
        this._announce('复盘达到目标，已暂停');
        this._stopReplay();
      } else {
        wx.showModal({
          title: '通关提示',
          content: '是否进入下一关？',
          success: (res) => { if (res.confirm) this.onNextLevel(); }
        });
      }
      return true;
    }

    if (!this.game.canMove()) {
      if (mode === 'demo') {
        this._stopDemo('演示已无可用步，已暂停');
        wx.showToast({ title: '演示已无可用步', icon: 'none' });
      } else if (mode === 'replay') {
        this._announce('复盘达到死局，已暂停');
        this._stopReplay();
      } else {
        wx.showToast({ title: '无可用步', icon: 'none' });
      }
    }
    return true;
  },

  onRestart() {
    this._stopDemo();
    this._stopReplay();
    this.game.reset();
    this.ops = [];
    this.undoSnapshot = null;
    this._persistProgress();
    this._clearAnimation();
    this._drawAll();
    this._syncHud();
    this._announce('已重开本关', true);
  },

  onNextLevel() {
    this._stopDemo();
    this._stopReplay();
    this._prepareNextLevelWithPack();                                    // 根据关卡包调整下一关索引与参数
    this.LM.nextLevel();
    this._applyLevelPackForCurrentLevel();                               // 进入新关卡后应用关卡包参数
    this.game = this.LM.getGame();
    this.ops = [];
    this.undoSnapshot = null;
    this._computeTileSize();
    this._persistProgress();
    this._clearAnimation();
    this._drawAll();
    this._syncHud();
    this._announce('已进入下一关', true);
  },

  onResetProgress() {
    this._stopDemo();
    this._stopReplay();
    removeStorage(STORE.progress);
    this.LM = createManager(this.SETTINGS);
    levelPackState.index = 0;                                            // 重置关卡包索引
    persistCurrentLevelPackIndex();                                      // 写回存储
    this._applyLevelPackForCurrentLevel();                               // 应用关卡包起始参数
    this.game = this.LM.getGame();
    this.ops = [];
    this.undoSnapshot = null;
    this._computeTileSize();
    this._persistProgress();
    this._clearAnimation();
    this._drawAll();
    this._syncHud();
    this._announce('进度已重置', true);
  },

  onClearBest() {
    this.bestScore = 0;
    this._persistBest();
    this._drawAll();
    this._announce('最佳分已清空', true);
  },

  onImportPack() {                                                           // 从剪贴板导入关卡包
    wx.getClipboardData({                                                    // 调用剪贴板 API
      success: (res) => {                                                    // 成功读取剪贴板
        try {
          const parsed = JSON.parse(res.data);                               // 解析 JSON 文本
          const result = normalizeLevelPack(parsed);                         // 校验并标准化
          if (!result.valid) {                                               // 校验失败
            console.warn('[Stage2048][mini] 关卡包校验失败：', result.errors); // 输出错误信息
            wx.showToast({ title: '关卡包校验失败', icon: 'none' });         // Toast 提示失败
            this._updatePackStatus('关卡包校验失败，请检查剪贴板内容。');     // 提示区域给出说明
            this._announce('关卡包导入失败', true);                           // 播报失败
            return;                                                          // 终止处理
          }
          levelPackState.pack = result.normalized;                          // 写入关卡包配置
          levelPackState.index = 0;                                          // 重置索引
          saveLevelPackToStorage(result.normalized);                         // 保存至本地存储
          persistCurrentLevelPackIndex();                                    // 写回索引
          this._rebuildAfterPackChange('关卡包导入成功，下次进入下一关时生效。', '关卡包已导入，下次重开或进入下一关生效。'); // 重建游戏
        } catch (err) {
          console.warn('[Stage2048][mini] 解析关卡包失败：', err);            // 解析异常
          wx.showToast({ title: '关卡包解析失败', icon: 'none' });           // Toast 提示
          this._updatePackStatus('关卡包解析失败，请确保剪贴板为合法 JSON。'); // 更新提示
          this._announce('关卡包导入失败', true);                             // 播报失败
        }
      },
      fail: () => {                                                          // 读取剪贴板失败
        wx.showToast({ title: '读取剪贴板失败', icon: 'none' });             // Toast 提示
        this._announce('读取剪贴板失败', true);                               // 播报失败
      }
    });
  },

  onClearPack() {                                                            // 清除已加载的关卡包
    levelPackState.pack = null;                                              // 清空运行时配置
    levelPackState.index = 0;                                                // 重置索引
    clearLevelPackStorage();                                                 // 移除存储内容
    clearLevelPackIndex();                                                   // 移除索引存储
    this._rebuildAfterPackChange('已清除关卡包，恢复默认推进。', '关卡包已清除，按默认尺寸推进。'); // 重建游戏并提示
  },

  onUndo() {
    if (!this.undoSnapshot) {
      this._announce('当前没有可撤销的步数', true);
      return;
    }
    this._stopDemo();
    this._stopReplay();
    if (this._restoreSnapshot(this.undoSnapshot.lm)) {
      this.ops.length = Math.max(0, this.undoSnapshot.opsLength);
      this.undoSnapshot = null;
      this._announce('已撤销一步', true);
    } else {
      this._announce('撤销失败', true);
    }
  },

  onDemoToggle(e) {
    if (e.detail.value) this._startDemo();
    else this._stopDemo('演示模式已关闭');
  },

  _startDemo() {
    if (this.isReplaying) {
      this._announce('复盘进行中，无法开启演示', true);
      this.setData({ demo: false });
      return;
    }
    if (this.demoTimer) return;
    if (!this.game.canMove()) {
      this._announce('当前棋盘无法演示', true);
      this.setData({ demo: false });
      return;
    }
    this.setData({ demo: true });
    this._announce('演示模式已开启');
    this.demoTimer = setInterval(() => {
      if (!this.game.canMove()) {
        this._stopDemo('演示已无可用步，已暂停');
        wx.showToast({ title: '演示已无可用步', icon: 'none' });
        return;
      }
      const grid = this.game.getGrid();
      const dirs = ['left', 'up', 'right', 'down'];
      let moved = false;
      for (const dir of dirs) {
        if (!simulateMovePossible(grid, dir)) continue;
        if (this._doMove(dir, { mode: 'demo', trackUndo: true, log: true, animate: true })) {
          moved = true;
          break;
        }
      }
      if (!moved) this._stopDemo('演示已无可用步，已暂停');
    }, DEMO_INTERVAL);
  },

  _stopDemo(message) {
    if (this.demoTimer) {
      clearInterval(this.demoTimer);
      this.demoTimer = null;
    }
    if (this.data.demo) this.setData({ demo: false });
    if (message) this._announce(message);
  },

  onReplay() {
    wx.getClipboardData({
      success: (res) => {
        try {
          const parsed = JSON.parse(res.data);
          let payload = null;
          if (parsed && typeof parsed === 'object') {
            if (parsed.replay) payload = parsed.replay;
            else if (Array.isArray(parsed.ops) || parsed.seed !== undefined) payload = parsed;
          }
          if (!payload || !Array.isArray(payload.ops)) throw new Error('missing ops');
          const seed = payload.seed === undefined || payload.seed === null ? '' : String(payload.seed);
          const ops = payload.ops.map((step) => String(step).trim().charAt(0).toUpperCase());
          this._startReplay(seed, ops);
        } catch (err) {
          console.warn('[Stage2048][mini] 解析复盘脚本失败：', err);
          wx.showToast({ title: '剪贴板非复盘 JSON', icon: 'none' });
          this._announce('复盘脚本解析失败');
        }
      },
      fail: () => {
        wx.showToast({ title: '读取剪贴板失败', icon: 'none' });
      }
    });
  },

  _startReplay(seed, sequence) {
    if (!Array.isArray(sequence) || sequence.length === 0) {
      this._announce('复盘脚本为空', true);
      return;
    }
    this._stopDemo();
    this._stopReplay();
    this.isReplaying = true;
    this.replayQueue = sequence;
    this.replayIndex = 0;
    this.ops = [];
    this.undoSnapshot = null;
    this.SETTINGS.seed = seed;
    this._persistSettings();
    this.LM = createManager(this.SETTINGS);
    this._applyLevelPackForCurrentLevel();
    this.game = this.LM.getGame();
    this._computeTileSize();
    this._persistProgress();
    this._clearAnimation();
    this._drawAll();
    this._syncHud();
    this._announce(`开始复盘，共 ${sequence.length} 步`);
    this.replayTimer = setInterval(() => {
      if (!this.isReplaying || !this.replayQueue) { this._stopReplay(); return; }
      if (this.replayIndex >= this.replayQueue.length) { this._stopReplay('复盘完成'); return; }
      const letter = this.replayQueue[this.replayIndex];
      const dir = LETTER_TO_DIR[letter];
      if (!dir) { this._stopReplay('复盘包含无效指令'); return; }
      const moved = this._doMove(dir, { mode: 'replay', trackUndo: false, log: false, animate: false });
      if (!moved) { this._stopReplay(`复盘失败：第 ${this.replayIndex + 1} 步无法执行`); return; }
      this.replayIndex += 1;
      this.ops = this.replayQueue.slice(0, this.replayIndex);
      if (this.replayIndex >= this.replayQueue.length) this._stopReplay('复盘完成');
    }, DEMO_INTERVAL);
  },

  _stopReplay(message) {
    if (this.replayTimer) {
      clearInterval(this.replayTimer);
      this.replayTimer = null;
    }
    if (message) this._announce(message, true);
    this.isReplaying = false;
    this.replayQueue = null;
    this.replayIndex = 0;
  },

  onTouchStart(e) {
    const t = e.touches[0];
    this.touchStart = { x: t.clientX, y: t.clientY };
  },

  onTouchEnd(e) {
    if (!this.touchStart || this.isReplaying) { this.touchStart = null; return; }
    if (this.demoTimer) this._stopDemo('已因手动操作停止演示');
    const t = e.changedTouches[0];
    const dx = t.clientX - this.touchStart.x;
    const dy = t.clientY - this.touchStart.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const min = 20;
    if (ax < min && ay < min) { this.touchStart = null; return; }
    if (ax > ay) this._doMove(dx > 0 ? 'right' : 'left');
    else this._doMove(dy > 0 ? 'down' : 'up');
    this.touchStart = null;
  }
});
