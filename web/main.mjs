// /web/main.mjs
// 说明：浏览器端的渲染与交互层，新增统一配置加载、进度持久化、导入导出与设置面板联动。

import { LevelManager, TARGET_FN_REGISTRY } from '../core/levels.esm.js'; // 引入关卡管理器与目标函数注册表
import { makeLCG } from '../core/rng.esm.js';                             // 引入线性同余伪随机数生成器工厂

// 本地存储键位常量，区分设置、进度与最佳分
const STORE = {
  settings: 'stage2048.settings.v2',                  // 保存 Web 端设置（含种子与动画）
  progress: 'stage2048.progress.v2',                  // 保存关卡进度（含伪随机状态）
  best: 'stage2048.bestScore.v1',                     // 保存最佳分
  maxTile: 'stage2048.maxTile.v1'                     // 保存历史最大方块值
};

const LEGACY_STORE = {
  settings: 'stage2048.settings.v1',                  // 旧版设置存储键，便于迁移
  progress: 'stage2048.progress.v1'                   // 旧版进度存储键，便于迁移
};

// 默认配置对象：包含画布尺寸、间隙以及 LevelManager 相关参数
const DEFAULT_SETTINGS = Object.freeze({
  canvasSize: 480,                                     // 默认画布 CSS 尺寸
  gap: 12,                                             // 默认格子间隙
  animate: false,                                      // 默认关闭淡入动画
  seed: '',                                            // 默认不固定伪随机种子
  LEVELS: {                                            // 关卡相关配置
    startSize: 2,                                      // 起始棋盘尺寸
    carryScore: true,                                  // 是否累计总分
    targetFnKey: 'power',                              // 默认目标函数标识
    randomTileWeightsBySize: {                         // 示例：4×4 时恢复经典 2/4 概率
      4: { 2: 0.9, 4: 0.1 }
    }
  }
});

const TARGET_REGISTRY_WITH_RNG = { ...TARGET_FN_REGISTRY, rngFactory: makeLCG }; // 扩展注册表，附带伪随机工厂

// 数值到颜色的映射表，与此前版本保持一致
const COLORS = {
  0:    { bg: '#cdc1b4', fg: '#776e65' },
  1:    { bg: '#eee4da', fg: '#776e65' },
  2:    { bg: '#ede0c8', fg: '#776e65' },
  4:    { bg: '#f2b179', fg: '#f9f6f2' },
  8:    { bg: '#f59563', fg: '#f9f6f2' },
  16:   { bg: '#f67c5f', fg: '#f9f6f2' },
  32:   { bg: '#f65e3b', fg: '#f9f6f2' },
  64:   { bg: '#edcf72', fg: '#f9f6f2' },
  128:  { bg: '#edcc61', fg: '#f9f6f2' },
  256:  { bg: '#edc850', fg: '#f9f6f2' },
  512:  { bg: '#edc53f', fg: '#f9f6f2' },
  1024: { bg: '#edc22e', fg: '#f9f6f2' },
  2048: { bg: '#3c3a32', fg: '#f9f6f2' }
};

const ANIMATE = true;                                  // 全局动画逻辑开关，配合 SETTINGS.animate 决定是否执行淡入

// 读取页面元素引用
const canvas = document.getElementById('game');        // 画布节点
const ctx = canvas.getContext('2d');                   // 2D 绘图上下文
const elLevel = document.getElementById('level');      // 关卡文本
const elTarget = document.getElementById('target');    // 目标文本
const elScore = document.getElementById('score');      // 当前分数文本
const elTotal = document.getElementById('total');      // 总分文本
const elBest = document.getElementById('best');        // 最佳分文本
const elAchv = document.getElementById('achv');        // 成就徽章展示元素
const elStatus = document.getElementById('status');    // 状态播报元素（role=status）
const btnNew = document.getElementById('btn-new');     // 重开按钮
const btnResetProgress = document.getElementById('btn-reset-progress'); // 重置进度按钮
const btnClearBest = document.getElementById('btn-clear-best');         // 清空最佳分按钮
const btnUndo = document.getElementById('btn-undo');   // 撤销一步按钮
const btnExport = document.getElementById('btn-export');                // 导出按钮
const inputImport = document.getElementById('input-import');            // 导入文件输入
const inputHighContrast = document.getElementById('hc');                // 高对比度模式复选框
const inputDemo = document.getElementById('demo');     // 演示模式开关
const form = document.getElementById('settings-form');                 // 设置表单
const inputCanvasSize = document.getElementById('input-canvas-size');  // 画布尺寸输入框
const inputGap = document.getElementById('input-gap');                 // 间隙输入框
const inputStartSize = document.getElementById('input-start-size');    // 起始尺寸输入框
const inputCarryScore = document.getElementById('input-carry-score');  // 累计总分复选框
const inputTargetFn = document.getElementById('input-target-fn');      // 目标函数下拉框
const inputSeed = document.getElementById('input-seed');               // 固定种子输入框
const inputAnimate = document.getElementById('input-animate');         // 启用淡入动画复选框

// 运行时变量
let SETTINGS = cloneSettings(DEFAULT_SETTINGS);        // 当前生效的设置（深拷贝）
let LM = null;                                        // 当前关卡管理器实例
let game = null;                                      // 当前 Game2048 实例
let tileSize = 0;                                     // 单格尺寸（绘制用）
let canvasCssSize = SETTINGS.canvasSize;              // 画布 CSS 尺寸缓存
let bestScore = 0;                                    // 本地最佳分
let touchStart = null;                                // 触摸起点记录
let suppressSettingsNotice = false;                   // 控制导入/初始化时不弹出提示
let undoSnapshot = null;                              // 存放撤销所需的关卡快照
let ops = [];                                         // 记录当前局的操作序列
let animationState = null;                            // 当前动画状态（包含淡入单元格）
let animationRaf = 0;                                 // requestAnimationFrame 标识
let demoActive = false;                               // 演示模式开关状态
let demoRaf = 0;                                      // 演示模式帧调度句柄
let demoLastTick = 0;                                 // 上一次演示尝试移动的时间戳
let isReplaying = false;                              // 是否正在执行复盘
let replayQueue = null;                               // 复盘操作队列
let replayIndex = 0;                                  // 复盘已执行步数
let replayRaf = 0;                                    // 复盘调度句柄
let replayLastTick = 0;                               // 复盘上一次执行时间戳
let maxTileHistory = 0;                               // 历史最大方块值（用于成就）
let drawQueued = false;                               // 是否已有绘制请求排队

const ANIMATION_DURATION = 160;                       // 单次淡入动画的持续时间（毫秒）
const DEMO_INTERVAL = 160;                            // 演示模式每步尝试间隔（毫秒）
const DIR_TO_LETTER = { left: 'L', right: 'R', up: 'U', down: 'D' }; // 方向到序列字符的映射
const LETTER_TO_DIR = { L: 'left', R: 'right', U: 'up', D: 'down' }; // 序列字符到方向的映射
const BADGES = [                                      // 成就阈值与对应徽章
  { threshold: 64, icon: '🗝️', label: '达到 64 方块' },
  { threshold: 256, icon: '🎯', label: '达到 256 方块' },
  { threshold: 1024, icon: '🏆', label: '达到 1024 方块' }
];

// ===== 工具函数区域 =====

// 深拷贝设置对象，确保嵌套结构互不影响
function cloneSettings(source) {
  return {
    canvasSize: source.canvasSize,
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

// 克隆尺寸→权重映射，过滤掉非数字值
function cloneWeightMap(map) {
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

// 数值清洗：将输入转换为数字，带可选上下限
function sanitizeNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

// 布尔清洗：支持字符串/数字表示
function sanitizeBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

// 目标函数键清洗：不在注册表中时回退到 power
function sanitizeTargetFnKey(value, fallback) {
  if (typeof value === 'string' && TARGET_FN_REGISTRY[value]) return value;
  return TARGET_FN_REGISTRY[fallback] ? fallback : 'power';
}

// 合并补全设置：以 fallback 为基础，将 patch 中的字段覆盖并校验
function sanitizeSettings(patch, fallback = DEFAULT_SETTINGS) {
  const base = cloneSettings(fallback);               // 从回退值开始构造
  if (!patch || typeof patch !== 'object') return base; // 非对象直接返回基础值

  if ('canvasSize' in patch) {                        // 覆盖画布尺寸
    base.canvasSize = sanitizeNumber(patch.canvasSize, base.canvasSize, { min: 300, max: 800 });
  }
  if ('gap' in patch) {                               // 覆盖格子间隙
    base.gap = sanitizeNumber(patch.gap, base.gap, { min: 4, max: 60 });
  }
  if ('animate' in patch) {                           // 覆盖动画开关
    base.animate = sanitizeBoolean(patch.animate, base.animate);
  }
  if ('seed' in patch) {                              // 覆盖固定种子
    const raw = patch.seed;
    if (raw === null || raw === undefined) base.seed = '';
    else base.seed = String(raw).trim();
  }

  const lvlPatch = patch.LEVELS && typeof patch.LEVELS === 'object' ? patch.LEVELS : null; // 提取 LEVELS
  if (lvlPatch) {
    if ('startSize' in lvlPatch) {                    // 起始尺寸至少为 2
      base.LEVELS.startSize = Math.max(2, Math.floor(sanitizeNumber(lvlPatch.startSize, base.LEVELS.startSize, { min: 2, max: 16 })));
    }
    if ('carryScore' in lvlPatch) {                   // 累计总分布尔开关
      base.LEVELS.carryScore = sanitizeBoolean(lvlPatch.carryScore, base.LEVELS.carryScore);
    }
    if ('targetFnKey' in lvlPatch) {                  // 目标函数键
      base.LEVELS.targetFnKey = sanitizeTargetFnKey(lvlPatch.targetFnKey, base.LEVELS.targetFnKey);
    }
    if ('randomTileWeightsBySize' in lvlPatch) {      // 尺寸→权重映射
      base.LEVELS.randomTileWeightsBySize = cloneWeightMap(lvlPatch.randomTileWeightsBySize);
    }
  }

  return base;                                        // 返回合并后的新对象
}

// 从本地存储读取 JSON 并解析
function loadStoredJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[Stage2048] 读取本地存储失败：', key, err);
    return null;
  }
}

// 将对象写入本地存储
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[Stage2048] 写入本地存储失败：', key, err);
  }
}

// 删除指定键值
function removeStored(key) {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.warn('[Stage2048] 移除本地存储失败：', key, err);
  }
}

// 状态播报：用于提示撤销、复盘等操作结果
function announce(message) {
  if (!elStatus) return;                               // 若无状态区域则直接返回
  const text = message || '';                          // 将 undefined/null 归一为空串
  elStatus.textContent = text;                         // 更新可读文本，供屏幕阅读器朗读
  elStatus.setAttribute('aria-label', text);           // 同步 aria-label 以便重复播报
}

// 读取历史最大方块记录，兼容异常情况
function loadMaxTileFromStorage() {
  try {
    const raw = localStorage.getItem(STORE.maxTile);   // 从本地读取字符串
    const num = Number(raw);
    maxTileHistory = Number.isFinite(num) && num > 0 ? num : 0; // 合法值写入历史最大
  } catch (err) {
    console.warn('[Stage2048] 读取成就记录失败：', err); // 捕获异常并输出日志
    maxTileHistory = 0;                                 // 出错时回退为 0
  }
}

// 持久化历史最大方块记录
function persistMaxTile() {
  try {
    localStorage.setItem(STORE.maxTile, String(maxTileHistory)); // 将最大值写入本地
  } catch (err) {
    console.warn('[Stage2048] 写入成就记录失败：', err); // 捕获异常但不中断流程
  }
}

// 计算棋盘中的最大值
function getGridMaxValue(grid) {
  let max = 0;                                         // 初始化最大值
  for (const row of grid) {                            // 遍历每一行
    for (const v of row) {                             // 遍历每一格
      if (v > max) max = v;                            // 更新最大值
    }
  }
  return max;                                          // 返回计算结果
}

// 根据当前最大值更新徽章展示与 aria 提示
function updateAchievementDisplay(currentMax) {
  if (Number.isFinite(currentMax) && currentMax > maxTileHistory) { // 若创造新纪录
    maxTileHistory = currentMax;                      // 更新历史最大值
    persistMaxTile();                                 // 写入本地存储
  }
  if (!elAchv) return;                               // 无展示元素则直接返回
  const unlocked = BADGES.filter((item) => maxTileHistory >= item.threshold); // 过滤已解锁徽章
  const icons = unlocked.map((item) => item.icon).join(' '); // 拼接图标字符串
  elAchv.textContent = icons || '尚未解锁';            // 若无徽章则显示提示文字
  const description = unlocked.length
    ? unlocked.map((item) => `${item.icon} ${item.label}`).join('，')
    : '尚未解锁成就';                                   // 生成朗读描述
  elAchv.setAttribute('aria-label', `成就徽章：${description}`); // 同步 aria-label
}

// 取消当前动画并重绘
function cancelAnimation() {
  if (animationRaf) {                                  // 若存在排队的动画帧
    cancelAnimationFrame(animationRaf);                // 取消调度
    animationRaf = 0;                                  // 重置句柄
  }
  animationState = null;                              // 清空动画状态
}

// 动画帧函数：根据时间戳刷新画面
function animationStep(timestamp) {
  drawAll(timestamp);                                  // 按当前时间绘制一帧
  if (!animationState) {                               // 若动画已结束
    animationRaf = 0;                                  // 重置句柄
    return;                                            // 结束调度
  }
  const elapsed = timestamp - animationState.start;    // 计算已进行时间
  if (elapsed >= ANIMATION_DURATION) {                 // 若动画时间已满
    animationState = null;                             // 清空状态
    animationRaf = 0;                                  // 重置句柄
    drawAll();                                         // 再绘制一次保证完全呈现
    return;                                            // 结束调度
  }
  animationRaf = requestAnimationFrame(animationStep); // 未完成则继续下一帧
}

// 启动淡入动画：cells 为需要淡入的单元格集合
function startAnimationForCells(cells) {
  cancelAnimation();                                   // 先取消可能存在的旧动画
  if (!ANIMATE || !SETTINGS.animate || !cells || cells.size === 0) { // 未启用或无动画单元格
    drawAll();                                         // 直接重绘静态画面
    return;                                            // 结束流程
  }
  animationState = { cells, start: performance.now() }; // 记录动画起点时间与单元格
  drawAll(animationState.start);                       // 立即绘制首帧（透明度接近 0）
  animationRaf = requestAnimationFrame(animationStep); // 安排后续帧调度
}

// 计算需要淡入的格子集合
function computeAnimatedCells(prevGrid, nextGrid) {
  const cells = new Set();                              // 使用 Set 存储坐标键
  const size = nextGrid.length;                         // 获取棋盘尺寸
  for (let r = 0; r < size; r++) {                      // 遍历行
    for (let c = 0; c < size; c++) {                    // 遍历列
      const before = prevGrid[r][c];                    // 读取移动前的数值
      const after = nextGrid[r][c];                     // 读取移动后的数值
      if (!after) continue;                             // 空格无需动画
      if (before === 0 || after > before) {             // 新生成或合并数值更大
        cells.add(`${r}-${c}`);                         // 将坐标加入集合
      }
    }
  }
  return cells;                                        // 返回计算结果
}

// 模拟一行/列的移动结果，返回是否发生变化
function simulateLine(line, reverse = false) {
  const arr = reverse ? line.slice().reverse() : line.slice(); // 根据方向拷贝并可选反转
  const filtered = arr.filter((v) => v !== 0);          // 去除所有 0
  const out = [];                                       // 输出数组
  for (let i = 0; i < filtered.length; i++) {           // 遍历有效数字
    if (i < filtered.length - 1 && filtered[i] === filtered[i + 1]) { // 相邻可合并
      out.push(filtered[i] * 2);                        // 推入合并后的数字
      i++;                                              // 跳过被合并的下一个元素
    } else {
      out.push(filtered[i]);                            // 无法合并则原样推入
    }
  }
  while (out.length < line.length) out.push(0);         // 补齐剩余位置为 0
  if (reverse) out.reverse();                           // 若之前反转则恢复原方向
  for (let i = 0; i < line.length; i++) {               // 比较新旧数组
    if (out[i] !== line[i]) return { changed: true, line: out }; // 任一位置不同即发生变化
  }
  return { changed: false, line: out };                 // 完全相同时视为未变化
}

// 判断指定方向是否会改变棋盘
function simulateMovePossible(grid, dir) {
  const size = grid.length;                             // 棋盘尺寸
  if (dir === 'left' || dir === 'right') {              // 左右方向按行处理
    const reverse = dir === 'right';                    // 是否反向
    for (let r = 0; r < size; r++) {                    // 遍历每一行
      const row = grid[r];                              // 读取当前行
      const result = simulateLine(row, reverse);        // 模拟合并
      if (result.changed) return true;                  // 任一行发生变化则可移动
    }
    return false;                                       // 所有行都未变化则不可移动
  }
  if (dir === 'up' || dir === 'down') {                 // 上下方向按列处理
    const reverse = dir === 'down';                     // 是否反向
    for (let c = 0; c < size; c++) {                    // 遍历每一列
      const col = [];                                   // 构建列数组
      for (let r = 0; r < size; r++) col.push(grid[r][c]); // 逐行取出对应列
      const result = simulateLine(col, reverse);        // 模拟列合并
      if (result.changed) return true;                  // 任一列可变即可移动
    }
    return false;                                       // 所有列都不变则不可移动
  }
  return false;                                         // 非法方向返回不可移动
}

// 解析 URL 查询参数并转换为设置补丁
function parseUrlOverrides() {
  const params = new URLSearchParams(window.location.search);
  if (params.size === 0) return null;
  const patch = {};
  if (params.has('canvasSize')) patch.canvasSize = params.get('canvasSize');
  if (params.has('gap')) patch.gap = params.get('gap');
  const lvl = {};
  if (params.has('size')) lvl.startSize = params.get('size');
  if (params.has('startSize')) lvl.startSize = params.get('startSize');
  if (params.has('carryScore')) lvl.carryScore = params.get('carryScore');
  if (params.has('targetFnKey')) lvl.targetFnKey = params.get('targetFnKey');
  if (Object.keys(lvl).length) patch.LEVELS = lvl;
  return patch;
}

// 基于当前 SETTINGS 创建新的 LevelManager 实例
function createLevelManagerFromSettings() {
  const key = sanitizeTargetFnKey(SETTINGS.LEVELS.targetFnKey, 'power'); // 确认目标函数键合法
  const targetFn = TARGET_FN_REGISTRY[key] || TARGET_FN_REGISTRY.power;  // 查找目标函数
  const seedTrimmed = typeof SETTINGS.seed === 'string' ? SETTINGS.seed.trim() : '';
  const options = {
    startSize: SETTINGS.LEVELS.startSize,
    carryScore: SETTINGS.LEVELS.carryScore,
    targetFn,
    targetFnKey: key,
    randomTileWeightsBySize: cloneWeightMap(SETTINGS.LEVELS.randomTileWeightsBySize)
  };
  if (seedTrimmed) {                                   // 有固定种子时附加伪随机参数
    options.rngSeed = seedTrimmed;
    options.rngFactory = makeLCG;
  }
  return new LevelManager(options);
}

// 将 SETTINGS 映射到表单 UI
function applySettingsToForm() {
  inputCanvasSize.value = SETTINGS.canvasSize;
  inputGap.value = SETTINGS.gap;
  inputAnimate.checked = Boolean(SETTINGS.animate);
  inputSeed.value = SETTINGS.seed;
  inputStartSize.value = SETTINGS.LEVELS.startSize;
  inputCarryScore.checked = SETTINGS.LEVELS.carryScore;
  inputTargetFn.value = sanitizeTargetFnKey(SETTINGS.LEVELS.targetFnKey, 'power');
}

// 从表单读取当前值构建设置补丁
function readSettingsFromForm() {
  return {
    canvasSize: inputCanvasSize.value,
    gap: inputGap.value,
    animate: inputAnimate.checked,
    seed: inputSeed.value,
    LEVELS: {
      startSize: inputStartSize.value,
      carryScore: inputCarryScore.checked,
      targetFnKey: inputTargetFn.value,
      randomTileWeightsBySize: SETTINGS.LEVELS.randomTileWeightsBySize // 表单未编辑该字段，直接沿用
    }
  };
}

// 保存 SETTINGS 到本地
function persistSettings() {
  saveJSON(STORE.settings, SETTINGS);
}

// 保存当前进度
function persistProgress() {
  if (!LM) return;
  saveJSON(STORE.progress, LM.toJSON());
}

// 保存最佳分
function persistBest() {
  try {
    localStorage.setItem(STORE.best, String(bestScore));
  } catch (err) {
    console.warn('[Stage2048] 写入最佳分失败：', err);
  }
}

// 更新最佳分并同步 HUD
function updateBestScore(curScore) {
  if (curScore > bestScore) {
    bestScore = curScore;
    persistBest();
  }
  elBest.textContent = `最佳 ${bestScore}`;
  elBest.setAttribute('aria-label', `最佳分 ${bestScore}`); // 初始化时同步最佳分朗读
  elBest.setAttribute('aria-label', `最佳分 ${bestScore}`); // 同步最佳分的朗读内容
}

// ===== 初始化流程 =====

function init() {
  // 步骤 1：加载设置默认值
  SETTINGS = cloneSettings(DEFAULT_SETTINGS);

  // 步骤 2：合并本地存储中的设置
  let storedSettings = loadStoredJSON(STORE.settings);
  if (!storedSettings) {                               // 若新版本不存在则尝试迁移旧数据
    const legacy = loadStoredJSON(LEGACY_STORE.settings);
    if (legacy) {
      storedSettings = legacy;
      saveJSON(STORE.settings, legacy);                // 写入新键
      removeStored(LEGACY_STORE.settings);             // 移除旧键
    }
  }
  if (storedSettings) SETTINGS = sanitizeSettings(storedSettings, SETTINGS);

  // 步骤 3：应用 URL 覆盖
  const urlPatch = parseUrlOverrides();
  if (urlPatch) SETTINGS = sanitizeSettings(urlPatch, SETTINGS);

  // 步骤 4：同步设置到表单
  applySettingsToForm();

  // 步骤 5：加载最佳分
  let storedBest = 0;
  try {
    storedBest = Number(localStorage.getItem(STORE.best) || 0);
  } catch (err) {
    console.warn('[Stage2048] 读取最佳分失败：', err);
    storedBest = 0;
  }
  bestScore = Number.isFinite(storedBest) && storedBest >= 0 ? storedBest : 0;
  elBest.textContent = `最佳 ${bestScore}`;

  // 步骤 6：尝试恢复进度
  let storedProgress = loadStoredJSON(STORE.progress);
  if (!storedProgress) {                               // 若新版本无数据则尝试迁移旧存档
    const legacyProg = loadStoredJSON(LEGACY_STORE.progress);
    if (legacyProg) {
      storedProgress = legacyProg;
      saveJSON(STORE.progress, legacyProg);
      removeStored(LEGACY_STORE.progress);
    }
  }
  if (storedProgress) {
    try {
      LM = LevelManager.fromJSON(storedProgress, TARGET_REGISTRY_WITH_RNG);
      SETTINGS.LEVELS.targetFnKey = sanitizeTargetFnKey(LM.targetFnKey, SETTINGS.LEVELS.targetFnKey);
      SETTINGS.LEVELS.randomTileWeightsBySize = cloneWeightMap(LM.randomTileWeightsBySize);
    } catch (err) {
      console.warn('[Stage2048] 进度恢复失败，改用新实例：', err);
      LM = createLevelManagerFromSettings();
    }
  } else {
    LM = createLevelManagerFromSettings();
  }

  // 步骤 7：获取 Game2048 实例
  game = LM.getGame();
  ops = [];                                             // 初始化操作序列
  undoSnapshot = null;                                  // 初始化撤销状态

  // 步骤 8：根据设置计算画布尺寸并绘制
  resizeCanvas();
  queueDraw();
  syncHud();

  // 步骤 9：存储一次清洗后的设置（确保格式统一）
  persistSettings();

  // 步骤 10：加载成就记录
  loadMaxTileFromStorage();
  updateAchievementDisplay(getGridMaxValue(game.getGrid()));
  if (inputHighContrast) {                              // 初始化高对比度开关状态
    inputHighContrast.checked = document.body.classList.contains('high-contrast'); // 同步复选框与当前类名
  }
}

// ===== 绘制与 HUD =====

function resizeCanvas() {
  const css = Math.max(300, SETTINGS.canvasSize);
  canvasCssSize = css;
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  canvas.style.width = css + 'px';
  canvas.style.height = css + 'px';
  canvas.width = Math.floor(css * dpr);
  canvas.height = Math.floor(css * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const size = game.size;
  tileSize = (css - SETTINGS.gap * (size + 1)) / size;
}

function roundRect(x, y, w, h, radius, fillStyle) {
  ctx.beginPath();
  const r = Math.min(radius, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function fitFont(text, maxW, maxH, family = 'system-ui, Segoe UI, Roboto, Helvetica, Arial', weight = '700') {
  let lo = 4, hi = Math.floor(maxH), best = lo;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    ctx.font = `${weight} ${mid}px ${family}`;
    const w = ctx.measureText(text).width;
    const h = mid;
    if (w <= maxW && h <= maxH) { best = mid; lo = mid + 1; }
    else { hi = mid - 1; }
  }
  return { size: best, css: `${weight} ${best}px ${family}` };
}

// 合帧调度函数：使用 rAF 合并多次绘制请求
function queueDraw() {
  if (animationState) return;                          // 若动画进行中则由动画循环负责绘制
  if (drawQueued) return;                              // 已有请求排队时不再重复申请
  drawQueued = true;                                   // 标记绘制请求已排队
  requestAnimationFrame((timestamp) => {               // 等待下一帧再统一绘制
    drawQueued = false;                                // 恢复可用状态
    drawAll(timestamp);                                // 调用实际绘制逻辑
  });
}

function drawAll(timestamp) {
  drawQueued = false;                                  // 调用绘制时重置节流标记
  ctx.clearRect(0, 0, canvasCssSize, canvasCssSize);  // 擦除整块画布
  const size = game.size;                             // 读取当前棋盘尺寸
  const now = typeof timestamp === 'number' ? timestamp : performance.now(); // 取本帧时间戳
  const animActive = SETTINGS.animate && animationState && animationState.cells; // 判断动画是否生效
  const animProgress = animActive ? Math.min(1, (now - animationState.start) / ANIMATION_DURATION) : 1; // 计算进度
  const animCells = animActive ? animationState.cells : null; // 提取需要淡入的单元格集合
  roundRect(0, 0, canvasCssSize, canvasCssSize, 10, '#bbada0');
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const x = SETTINGS.gap + c * (tileSize + SETTINGS.gap);
      const y = SETTINGS.gap + r * (tileSize + SETTINGS.gap);
      roundRect(x, y, tileSize, tileSize, 8, COLORS[0].bg);
    }
  }
  const grid = game.getGrid();
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const val = grid[r][c];
      if (!val) continue;
      const x = SETTINGS.gap + c * (tileSize + SETTINGS.gap);
      const y = SETTINGS.gap + r * (tileSize + SETTINGS.gap);
      const sty = COLORS[val] || { bg: '#3c3a32', fg: '#f9f6f2' };
      const key = `${r}-${c}`;                        // 构造单元格键
      if (animCells && animCells.has(key)) {          // 若该格需要淡入
        ctx.globalAlpha = animProgress;               // 按进度调整透明度
      } else {
        ctx.globalAlpha = 1;                          // 其余格保持不透明
      }
      roundRect(x, y, tileSize, tileSize, 8, sty.bg);
      const pad = Math.floor(tileSize * 0.12);
      const innerW = tileSize - pad * 2;
      const innerH = tileSize - pad * 2;
      const text = String(val);
      const font = fitFont(text, innerW, innerH);
      ctx.fillStyle = sty.fg;
      ctx.font = font.css;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const m = ctx.measureText(text);
      const ascent = m.actualBoundingBoxAscent || (font.size * 0.78);
      const descent = m.actualBoundingBoxDescent || (font.size * 0.22);
      const totalH = ascent + descent;
      const cx = x + tileSize / 2;
      const cy = y + tileSize / 2;
      const baselineY = cy + (ascent - totalH / 2);
      ctx.fillText(text, cx, baselineY);
    }
  }
  ctx.globalAlpha = 1;                                // 重置透明度避免影响后续绘制
  const cur = game.getScore();
  updateBestScore(cur);
  elScore.textContent = `得分 ${cur}`;
  elScore.setAttribute('aria-label', `得分 ${cur}`);   // 同步 aria-label 便于朗读
  const totalScore = LM.getTotalScore();               // 读取累计总分避免重复调用
  elTotal.textContent = `总分 ${totalScore}`;
  elTotal.setAttribute('aria-label', `总分 ${totalScore}`); // 同步总分提示
  updateAchievementDisplay(getGridMaxValue(grid));     // 同步成就徽章
}

function syncHud() {
  const size = game.size;
  const lv = LM.getLevel();
  const target = LM.getTarget();
  elLevel.textContent = `关卡 ${lv}（${size}×${size}）`;
  elLevel.setAttribute('aria-label', `当前关卡 ${lv}，棋盘 ${size} 乘 ${size}`); // 为关卡文本添加朗读提示
  elTarget.textContent = `目标 ${target}`;
  elTarget.setAttribute('aria-label', `当前目标 ${target}`); // 为目标文本添加朗读提示
}

// ===== 游戏逻辑操作 =====

function restartLevel() {
  if (demoActive) stopDemo('已因重开本关停止演示'); // 重开时关闭演示模式
  game.reset();
  persistProgress();
  ops = [];                                           // 清空操作序列
  undoSnapshot = null;                                // 清空撤销记录
  cancelAnimation();                                  // 确保无残余动画
  queueDraw();                                        // 重新绘制棋盘
  syncHud();                                          // 同步 HUD 文本
  announce('已重开本关');                             // 播报提示
}

function enterNextLevel() {
  if (demoActive) stopDemo('已因进入下一关停止演示'); // 进入下一关时关闭演示模式
  LM.nextLevel();
  game = LM.getGame();
  resizeCanvas();
  persistProgress();
  ops = [];                                           // 新关卡重置操作序列
  undoSnapshot = null;                                // 清空撤销记录
  cancelAnimation();                                  // 取消可能存在的动画
  queueDraw();                                        // 绘制新关卡
  syncHud();                                          // 更新 HUD
  announce('已进入下一关');                           // 播报提示
}

function doMove(dir, options = {}) {
  if (!game || !LM) return false;                      // 若实例尚未就绪则拒绝移动
  const mode = options.mode || 'user';                 // 标记操作来源
  const trackUndo = options.trackUndo !== false;       // 是否记录撤销快照
  const logMove = options.log !== false;               // 是否记录操作序列
  const allowAnimation = options.animate !== false;    // 是否允许淡入动画
  const prevGrid = ANIMATE && SETTINGS.animate && allowAnimation ? game.getGrid() : null; // 仅在需要动画时复制棋盘
  const snapshot = trackUndo ? LM.snapshot() : null;   // 在移动前抓取关卡快照
  const prevOpsLength = ops.length;                    // 记录移动前的操作序列长度
  const moved = game.move(dir);                        // 执行核心移动
  if (!moved) return false;                            // 若棋盘未发生变化则直接返回
  if (trackUndo && snapshot) {                         // 移动成功且需要撤销
    undoSnapshot = { lm: snapshot.lm, opsLength: prevOpsLength }; // 保存快照与序列长度
  }
  if (logMove && DIR_TO_LETTER[dir]) {                 // 根据配置记录操作序列
    ops.push(DIR_TO_LETTER[dir]);
  }
  persistProgress();                                   // 持久化最新状态
  if (ANIMATE && SETTINGS.animate && allowAnimation && prevGrid) {
    const cells = computeAnimatedCells(prevGrid, game.getGrid()); // 计算需要淡入的单元格
    startAnimationForCells(cells);                     // 启动动画
  } else {
    cancelAnimation();                                 // 禁用动画时直接重绘
    queueDraw();
  }
  syncHud();                                           // 同步 HUD 文本

  if (LM.checkPass()) {                                // 检查是否通关
    if (mode === 'demo') {                             // 演示模式下停止并提示
      stopDemo('演示达到目标，已暂停');
      window.alert('演示达到当前关卡目标，已自动暂停，可手动选择下一步。');
    } else if (mode === 'replay') {                    // 复盘模式仅播报，不弹确认
      announce('复盘达到关卡目标，已暂停。');
      isReplaying = false;
      replayQueue = null;
    } else {                                           // 普通模式沿用交互确认
      setTimeout(() => {
        const ok = window.confirm('通关，是否进入下一关？');
        if (ok) enterNextLevel();
      }, 10);
    }
    return true;
  }

  if (!game.canMove()) {                               // 检查是否无可用步
    if (mode === 'demo') {                             // 演示模式下停止并提示
      stopDemo('演示已无可用步，已暂停');
      window.alert('演示模式已无可用步，已自动暂停。');
    } else if (mode === 'replay') {                    // 复盘模式仅播报
      announce('复盘达到死局，已暂停。');
      isReplaying = false;
      replayQueue = null;
    } else {                                           // 普通模式继续弹窗提示
      setTimeout(() => { window.alert('无可用步，本关结束，可点击撤销或重开本关。'); }, 10);
    }
  }

  return true;                                         // 返回移动已执行
}

function handleUndo() {
  if (!undoSnapshot) {                                 // 若无可撤销快照
    announce('当前没有可撤销的步数');                   // 播报提示
    return;                                            // 直接结束
  }
  if (demoActive) stopDemo('已因撤销停止演示');         // 撤销时关闭演示
  if (isReplaying) {                                   // 撤销时终止复盘
    isReplaying = false;
    replayQueue = null;
    if (replayRaf) cancelAnimationFrame(replayRaf);
    replayRaf = 0;
  }
  try {
    const ok = LM.restore(undoSnapshot.lm, TARGET_REGISTRY_WITH_RNG); // 使用快照恢复状态
    if (!ok) throw new Error('restore failed');        // 恢复失败则抛出异常
    game = LM.getGame();                               // 更新 Game2048 实例引用
    ops.length = Math.max(0, undoSnapshot.opsLength);  // 回滚操作序列长度
    undoSnapshot = null;                               // 清空撤销快照
    persistProgress();                                 // 写入最新进度
    cancelAnimation();                                 // 取消动画并重绘
    queueDraw();
    syncHud();
    announce('已撤销一步');                             // 播报成功
  } catch (err) {
    console.warn('[Stage2048] 撤销失败：', err);         // 输出调试信息
    announce('撤销失败，请查看控制台');                 // 提示用户
  }
}

function tryDemoStep() {
  const grid = game.getGrid();                         // 获取当前棋盘
  const dirs = ['left', 'up', 'right', 'down'];        // 简单启发式：左→上→右→下
  for (const dir of dirs) {                            // 依次尝试每个方向
    if (!simulateMovePossible(grid, dir)) continue;    // 若该方向无变化则跳过
    const moved = doMove(dir, { mode: 'demo' });       // 执行移动
    if (moved) return true;                            // 成功移动后结束
  }
  return false;                                        // 所有方向均无法移动
}

function runDemoFrame(timestamp) {
  if (!demoActive) return;                             // 已关闭则不再调度
  if (!demoLastTick) demoLastTick = timestamp;         // 初始化时间戳
  if (timestamp - demoLastTick >= DEMO_INTERVAL) {     // 达到间隔后尝试移动
    const moved = tryDemoStep();                       // 执行演示步
    demoLastTick = timestamp;                          // 更新时间戳
    if (!moved) {                                      // 无法移动时停止演示
      stopDemo('演示模式已无可用步，已暂停');
      window.alert('演示模式没有可用步，已自动暂停。');
      return;
    }
  }
  demoRaf = requestAnimationFrame(runDemoFrame);       // 持续调度下一帧
}

function startDemo() {
  if (demoActive) return;                              // 避免重复开启
  if (isReplaying) {                                   // 复盘期间禁止演示
    announce('复盘进行中，无法开启演示模式');
    inputDemo.checked = false;
    return;
  }
  if (!game.canMove()) {                               // 无可用步时无法演示
    announce('当前棋盘无法演示');
    inputDemo.checked = false;
    return;
  }
  demoActive = true;                                   // 标记演示状态
  demoLastTick = 0;                                    // 重置计时
  announce('演示模式已开启');                           // 播报提示
  demoRaf = requestAnimationFrame(runDemoFrame);       // 启动帧循环
}

function stopDemo(reason) {
  if (!demoActive) {                                   // 若已关闭仍需同步开关
    if (inputDemo) inputDemo.checked = false;
    if (reason) announce(reason);
    return;
  }
  demoActive = false;                                  // 清除演示标记
  if (demoRaf) {                                       // 取消调度
    cancelAnimationFrame(demoRaf);
    demoRaf = 0;
  }
  demoLastTick = 0;                                    // 重置计时器
  if (inputDemo) inputDemo.checked = false;            // 复位界面开关
  announce(reason || '演示模式已关闭');                // 播报停用提示
}

function runReplayFrame(timestamp) {
  if (!isReplaying || !replayQueue) return;            // 若状态已结束则停止调度
  if (!replayLastTick) replayLastTick = timestamp;     // 初始化时间戳
  if (timestamp - replayLastTick >= DEMO_INTERVAL) {   // 达到间隔后执行一步
    const letter = replayQueue[replayIndex];           // 读取当前操作符
    const dir = LETTER_TO_DIR[letter];                 // 转换为方向字符串
    replayLastTick = timestamp;                        // 更新时间戳
    if (!dir) {                                        // 非法数据直接终止
      announce(`复盘失败：第 ${replayIndex + 1} 步无效`);
      isReplaying = false;
      replayQueue = null;
      replayRaf = 0;
      return;
    }
    const moved = doMove(dir, { mode: 'replay', trackUndo: false, log: false, animate: false }); // 执行复盘步
    if (!moved) {                                      // 若移动失败
      announce(`复盘失败：第 ${replayIndex + 1} 步无法执行`);
      isReplaying = false;
      replayQueue = null;
      replayRaf = 0;
      return;
    }
    replayIndex += 1;                                  // 递增索引
    ops = replayQueue.slice(0, replayIndex);           // 同步已执行的操作序列
    if (replayIndex >= replayQueue.length) {           // 全部执行完毕
      isReplaying = false;
      replayQueue = null;
      replayRaf = 0;
      announce('复盘完成');                             // 播报完成
      return;
    }
  }
  replayRaf = requestAnimationFrame(runReplayFrame);   // 调度下一帧
}

function startReplay(seed, sequence) {
  if (!Array.isArray(sequence) || sequence.length === 0) { // 参数校验
    announce('复盘脚本为空，已跳过复盘');
    return;
  }
  if (demoActive) stopDemo('复盘开始，演示已停止');   // 开始复盘时关闭演示
  if (replayRaf) {                                     // 若存在旧的调度
    cancelAnimationFrame(replayRaf);
    replayRaf = 0;
  }
  isReplaying = true;                                  // 标记复盘状态
  replayQueue = sequence.slice();                      // 拷贝操作序列
  replayIndex = 0;                                     // 重置索引
  replayLastTick = 0;                                  // 重置计时
  undoSnapshot = null;                                 // 清空撤销记录
  const seedStr = seed === null || seed === undefined ? '' : String(seed).trim(); // 规范化种子
  SETTINGS.seed = seedStr;                             // 写入设置对象
  applySettingsToForm();                               // 同步表单显示
  persistSettings();                                   // 保存设置
  LM = createLevelManagerFromSettings();               // 基于种子重建关卡
  game = LM.getGame();                                 // 更新游戏实例
  resizeCanvas();                                      // 根据设置更新画布
  ops = [];                                            // 清空操作序列
  cancelAnimation();                                   // 取消动画并绘制初始状态
  queueDraw();
  syncHud();
  announce(`开始复盘，共 ${sequence.length} 步`);      // 播报复盘信息
  replayRaf = requestAnimationFrame(runReplayFrame);   // 启动复盘循环
}

// ===== 设置与存档操作 =====

function handleSettingsChange() {
  const patch = readSettingsFromForm();
  SETTINGS = sanitizeSettings(patch, SETTINGS);
  persistSettings();
  removeStored(STORE.progress);
  if (demoActive) stopDemo('已因修改设置停止演示');
  if (isReplaying) {                                   // 设置变更时终止复盘
    isReplaying = false;
    replayQueue = null;
    if (replayRaf) cancelAnimationFrame(replayRaf);
    replayRaf = 0;
  }
  if (!suppressSettingsNotice) window.alert('设置已更新，当前关卡已按新配置重置。');
  LM = createLevelManagerFromSettings();
  game = LM.getGame();
  resizeCanvas();
  persistProgress();
  ops = [];
  undoSnapshot = null;
  cancelAnimation();
  queueDraw();
  syncHud();
}

function handleResetProgress() {
  removeStored(STORE.progress);
  if (demoActive) stopDemo('已因重置进度停止演示');
  if (isReplaying) {
    isReplaying = false;
    replayQueue = null;
    if (replayRaf) cancelAnimationFrame(replayRaf);
    replayRaf = 0;
  }
  LM = createLevelManagerFromSettings();
  game = LM.getGame();
  resizeCanvas();
  persistProgress();
  ops = [];
  undoSnapshot = null;
  cancelAnimation();
  queueDraw();
  syncHud();
  window.alert('进度已重置，当前关卡回到设置指定的起始尺寸。');
  announce('进度已重置');
}

function handleClearBest() {
  bestScore = 0;
  persistBest();
  cancelAnimation();
  queueDraw();
  window.alert('最佳分已清空。');
  announce('最佳分已清空');
}

function handleExport() {
  if (!LM) return;
  const payload = {
    settings: SETTINGS,
    progress: LM.toJSON(),
    bestScore,
    replay: { seed: SETTINGS.seed, ops: ops.slice() }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `stage2048-web-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  announce('导出文件已生成，可在浏览器下载列表查看'); // 播报导出结果
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      applyImportedState(data);
      window.alert('设置与进度已导入成功。');
    } catch (err) {
      console.error('[Stage2048] 导入失败：', err);
      window.alert('导入失败，请检查文件格式。');
      announce('导入失败，请查看控制台以了解详情');      // 播报导入失败提示
    } finally {
      inputImport.value = '';
    }
  };
  reader.onerror = () => {
    console.error('[Stage2048] 文件读取失败：', reader.error);
    window.alert('文件读取失败，请重试。');
    inputImport.value = '';
    announce('文件读取失败，请重新选择 JSON 文件');     // 播报文件读取失败
  };
  reader.readAsText(file, 'utf-8');
}

function applyImportedState(data) {
  if (!data || typeof data !== 'object') throw new Error('数据结构无效'); // 校验入参
  if (demoActive) stopDemo('已因导入停止演示');         // 导入前确保演示关闭
  if (isReplaying) {                                   // 导入前终止复盘
    isReplaying = false;
    replayQueue = null;
    if (replayRaf) cancelAnimationFrame(replayRaf);
    replayRaf = 0;
  }
  const nextSettings = sanitizeSettings(data.settings, DEFAULT_SETTINGS); // 清洗设置
  SETTINGS = nextSettings;                               // 写入全局设置
  suppressSettingsNotice = true;                         // 临时抑制提示
  applySettingsToForm();                                 // 同步 UI
  persistSettings();                                     // 持久化设置
  const importedBest = Number(data.bestScore);           // 解析最佳分
  bestScore = Number.isFinite(importedBest) && importedBest >= 0 ? importedBest : bestScore; // 合法时覆盖
  persistBest();                                         // 写入最佳分

  const replayData = data.replay && typeof data.replay === 'object' ? data.replay : null; // 提取复盘数据
  const hasReplay = replayData && Array.isArray(replayData.ops); // 判断是否存在复盘脚本

  if (hasReplay) {                                      // 若存在复盘脚本则直接进入复盘流程
    const seedStr = replayData.seed === null || replayData.seed === undefined ? '' : String(replayData.seed).trim(); // 规范化种子
    SETTINGS.seed = seedStr;                            // 覆盖种子
    applySettingsToForm();                              // 更新表单显示
    persistSettings();                                  // 保存设置
    suppressSettingsNotice = false;                     // 恢复提示
    startReplay(seedStr, replayData.ops.map((step) => String(step).trim().charAt(0).toUpperCase())); // 启动复盘（仅取首字符）
    return;                                             // 复盘流程会负责后续绘制
  }

  let nextManager = null;                               // 默认使用序列化进度
  if (data.progress && typeof data.progress === 'object') {
    try {
      nextManager = LevelManager.fromJSON(data.progress, TARGET_REGISTRY_WITH_RNG); // 优先尝试从存档恢复
    } catch (err) {
      console.warn('[Stage2048] 导入进度失败，将按设置重建：', err); // 记录异常
      nextManager = null;
    }
  }
  if (!nextManager) {                                   // 若无有效存档则按当前设置新建
    nextManager = createLevelManagerFromSettings();
  }
  LM = nextManager;                                     // 更新关卡管理器
  SETTINGS.LEVELS.targetFnKey = sanitizeTargetFnKey(LM.targetFnKey, SETTINGS.LEVELS.targetFnKey); // 同步目标函数键
  SETTINGS.LEVELS.randomTileWeightsBySize = cloneWeightMap(LM.randomTileWeightsBySize); // 同步权重
  game = LM.getGame();                                  // 获取游戏实例
  ops = Array.isArray(replayData?.ops) ? replayData.ops.slice() : []; // 如果 JSON 中附带历史操作则记录
  undoSnapshot = null;                                  // 导入后清空撤销状态
  persistSettings();                                    // 保存清洗后的设置
  persistProgress();                                    // 保存最新进度
  resizeCanvas();                                       // 重算画布
  cancelAnimation();                                    // 确保无动画遗留
  queueDraw();                                          // 绘制棋盘
  syncHud();                                            // 更新 HUD
  suppressSettingsNotice = false;                       // 恢复提示开关
  announce('设置与进度已导入');                         // 播报完成
}

// ===== 事件绑定 =====

function bindEvents() {
  document.addEventListener('keydown', (e) => {
    if (isReplaying) return;                            // 复盘期间忽略用户输入
    // 提示：Enter/Space 会交由浏览器触发按钮点击，保持默认行为即可支持键盘操作
    if (e.key === 'ArrowLeft')  { e.preventDefault(); doMove('left'); }
    if (e.key === 'ArrowRight') { e.preventDefault(); doMove('right'); }
    if (e.key === 'ArrowUp')    { e.preventDefault(); doMove('up'); }
    if (e.key === 'ArrowDown')  { e.preventDefault(); doMove('down'); }
  });

  canvas.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });

  canvas.addEventListener('touchend', (e) => {
    if (isReplaying) { touchStart = null; return; }     // 复盘期间忽略触控
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const min = 20;
    if (ax < min && ay < min) return;
    if (ax > ay) doMove(dx > 0 ? 'right' : 'left');
    else         doMove(dy > 0 ? 'down'  : 'up');
    touchStart = null;
  }, { passive: true });

  btnNew.addEventListener('click', () => { restartLevel(); });
  btnResetProgress.addEventListener('click', () => { handleResetProgress(); });
  btnClearBest.addEventListener('click', () => { handleClearBest(); });
  btnUndo.addEventListener('click', () => { handleUndo(); });
  btnExport.addEventListener('click', () => { handleExport(); });
  inputImport.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleImportFile(file);
  });
  inputDemo.addEventListener('change', (e) => {
    if (e.target.checked) startDemo();                 // 勾选即开启演示
    else stopDemo('演示模式已关闭');                   // 取消勾选则关闭演示
  });
  if (inputHighContrast) {                              // 绑定高对比度切换
    inputHighContrast.addEventListener('change', (e) => { // 监听高对比度复选框
      const enabled = Boolean(e.target.checked);        // 读取勾选状态
      document.body.classList.toggle('high-contrast', enabled); // 根据状态切换类名
      announce(enabled ? '高对比度模式已开启' : '高对比度模式已关闭'); // 播报切换结果
    });
  }
  form.addEventListener('change', () => { handleSettingsChange(); });
  window.addEventListener('resize', () => { resizeCanvas(); queueDraw(); });
}

// ===== 启动入口 =====

init();
bindEvents();
