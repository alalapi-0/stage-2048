// /web/main.mjs
// 说明：浏览器端的渲染与交互层，新增统一配置加载、进度持久化、导入导出与设置面板联动。

import { LevelManager, TARGET_FN_REGISTRY } from '../core/levels.esm.js'; // 引入关卡管理器与目标函数注册表

// 本地存储键位常量，区分设置、进度与最佳分
const STORE = {
  settings: 'stage2048.settings.v1',                  // 保存 Web 端设置
  progress: 'stage2048.progress.v1',                  // 保存关卡进度
  best: 'stage2048.bestScore.v1'                      // 保存最佳分
};

// 默认配置对象：包含画布尺寸、间隙以及 LevelManager 相关参数
const DEFAULT_SETTINGS = Object.freeze({
  canvasSize: 480,                                     // 默认画布 CSS 尺寸
  gap: 12,                                             // 默认格子间隙
  LEVELS: {                                            // 关卡相关配置
    startSize: 2,                                      // 起始棋盘尺寸
    carryScore: true,                                  // 是否累计总分
    targetFnKey: 'power',                              // 默认目标函数标识
    randomTileWeightsBySize: {                         // 示例：4×4 时恢复经典 2/4 概率
      4: { 2: 0.9, 4: 0.1 }
    }
  }
});

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

// 读取页面元素引用
const canvas = document.getElementById('game');        // 画布节点
const ctx = canvas.getContext('2d');                   // 2D 绘图上下文
const elLevel = document.getElementById('level');      // 关卡文本
const elTarget = document.getElementById('target');    // 目标文本
const elScore = document.getElementById('score');      // 当前分数文本
const elTotal = document.getElementById('total');      // 总分文本
const elBest = document.getElementById('best');        // 最佳分文本
const btnNew = document.getElementById('btn-new');     // 重开按钮
const btnResetProgress = document.getElementById('btn-reset-progress'); // 重置进度按钮
const btnClearBest = document.getElementById('btn-clear-best');         // 清空最佳分按钮
const btnExport = document.getElementById('btn-export');                // 导出按钮
const inputImport = document.getElementById('input-import');            // 导入文件输入
const form = document.getElementById('settings-form');                 // 设置表单
const inputCanvasSize = document.getElementById('input-canvas-size');  // 画布尺寸输入框
const inputGap = document.getElementById('input-gap');                 // 间隙输入框
const inputStartSize = document.getElementById('input-start-size');    // 起始尺寸输入框
const inputCarryScore = document.getElementById('input-carry-score');  // 累计总分复选框
const inputTargetFn = document.getElementById('input-target-fn');      // 目标函数下拉框

// 运行时变量
let SETTINGS = cloneSettings(DEFAULT_SETTINGS);        // 当前生效的设置（深拷贝）
let LM = null;                                        // 当前关卡管理器实例
let game = null;                                      // 当前 Game2048 实例
let tileSize = 0;                                     // 单格尺寸（绘制用）
let canvasCssSize = SETTINGS.canvasSize;              // 画布 CSS 尺寸缓存
let bestScore = 0;                                    // 本地最佳分
let touchStart = null;                                // 触摸起点记录
let suppressSettingsNotice = false;                   // 控制导入/初始化时不弹出提示

// ===== 工具函数区域 =====

// 深拷贝设置对象，确保嵌套结构互不影响
function cloneSettings(source) {
  return {
    canvasSize: source.canvasSize,
    gap: source.gap,
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
  return new LevelManager({
    startSize: SETTINGS.LEVELS.startSize,
    carryScore: SETTINGS.LEVELS.carryScore,
    targetFn,
    targetFnKey: key,
    randomTileWeightsBySize: cloneWeightMap(SETTINGS.LEVELS.randomTileWeightsBySize)
  });
}

// 将 SETTINGS 映射到表单 UI
function applySettingsToForm() {
  inputCanvasSize.value = SETTINGS.canvasSize;
  inputGap.value = SETTINGS.gap;
  inputStartSize.value = SETTINGS.LEVELS.startSize;
  inputCarryScore.checked = SETTINGS.LEVELS.carryScore;
  inputTargetFn.value = sanitizeTargetFnKey(SETTINGS.LEVELS.targetFnKey, 'power');
}

// 从表单读取当前值构建设置补丁
function readSettingsFromForm() {
  return {
    canvasSize: inputCanvasSize.value,
    gap: inputGap.value,
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
}

// ===== 初始化流程 =====

function init() {
  // 步骤 1：加载设置默认值
  SETTINGS = cloneSettings(DEFAULT_SETTINGS);

  // 步骤 2：合并本地存储中的设置
  const storedSettings = loadStoredJSON(STORE.settings);
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
  const storedProgress = loadStoredJSON(STORE.progress);
  if (storedProgress) {
    try {
      LM = LevelManager.fromJSON(storedProgress, TARGET_FN_REGISTRY);
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

  // 步骤 8：根据设置计算画布尺寸并绘制
  resizeCanvas();
  drawAll();
  syncHud();

  // 步骤 9：存储一次清洗后的设置（确保格式统一）
  persistSettings();
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

function drawAll() {
  ctx.clearRect(0, 0, canvasCssSize, canvasCssSize);
  const size = game.size;
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
  const cur = game.getScore();
  updateBestScore(cur);
  elScore.textContent = `得分 ${cur}`;
  elTotal.textContent = `总分 ${LM.getTotalScore()}`;
}

function syncHud() {
  const size = game.size;
  const lv = LM.getLevel();
  const target = LM.getTarget();
  elLevel.textContent = `关卡 ${lv}（${size}×${size}）`;
  elTarget.textContent = `目标 ${target}`;
}

// ===== 游戏逻辑操作 =====

function restartLevel() {
  game.reset();
  persistProgress();
  drawAll();
  syncHud();
}

function enterNextLevel() {
  LM.nextLevel();
  game = LM.getGame();
  resizeCanvas();
  persistProgress();
  drawAll();
  syncHud();
}

function doMove(dir) {
  const moved = game.move(dir);
  if (!moved) return;
  persistProgress();
  drawAll();
  if (LM.checkPass()) {
    setTimeout(() => {
      const ok = window.confirm('通关，是否进入下一关？');
      if (ok) enterNextLevel();
    }, 10);
    return;
  }
  if (!game.canMove()) {
    setTimeout(() => { window.alert('无可用步，本关结束，可点击重开本关或重置进度。'); }, 10);
  }
}

// ===== 设置与存档操作 =====

function handleSettingsChange() {
  const patch = readSettingsFromForm();
  SETTINGS = sanitizeSettings(patch, SETTINGS);
  persistSettings();
  removeStored(STORE.progress);
  if (!suppressSettingsNotice) window.alert('设置已更新，当前关卡已按新配置重置。');
  LM = createLevelManagerFromSettings();
  game = LM.getGame();
  resizeCanvas();
  persistProgress();
  drawAll();
  syncHud();
}

function handleResetProgress() {
  removeStored(STORE.progress);
  LM = createLevelManagerFromSettings();
  game = LM.getGame();
  resizeCanvas();
  persistProgress();
  drawAll();
  syncHud();
  window.alert('进度已重置，当前关卡回到设置指定的起始尺寸。');
}

function handleClearBest() {
  bestScore = 0;
  persistBest();
  drawAll();
  window.alert('最佳分已清空。');
}

function handleExport() {
  if (!LM) return;
  const payload = {
    settings: SETTINGS,
    progress: LM.toJSON(),
    bestScore
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
    } finally {
      inputImport.value = '';
    }
  };
  reader.onerror = () => {
    console.error('[Stage2048] 文件读取失败：', reader.error);
    window.alert('文件读取失败，请重试。');
    inputImport.value = '';
  };
  reader.readAsText(file, 'utf-8');
}

function applyImportedState(data) {
  if (!data || typeof data !== 'object') throw new Error('数据结构无效');
  const nextSettings = sanitizeSettings(data.settings, DEFAULT_SETTINGS);
  SETTINGS = nextSettings;
  suppressSettingsNotice = true;
  applySettingsToForm();
  persistSettings();
  let nextManager = null;
  if (data.progress && typeof data.progress === 'object') {
    nextManager = LevelManager.fromJSON(data.progress, TARGET_FN_REGISTRY);
  }
  if (!nextManager) {
    nextManager = createLevelManagerFromSettings();
  }
  LM = nextManager;
  SETTINGS.LEVELS.targetFnKey = sanitizeTargetFnKey(LM.targetFnKey, SETTINGS.LEVELS.targetFnKey);
  SETTINGS.LEVELS.randomTileWeightsBySize = cloneWeightMap(LM.randomTileWeightsBySize);
  game = LM.getGame();
  const importedBest = Number(data.bestScore);
  bestScore = Number.isFinite(importedBest) && importedBest >= 0 ? importedBest : bestScore;
  persistBest();
  persistSettings();
  persistProgress();
  resizeCanvas();
  drawAll();
  syncHud();
  suppressSettingsNotice = false;
}

// ===== 事件绑定 =====

function bindEvents() {
  document.addEventListener('keydown', (e) => {
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
  btnExport.addEventListener('click', () => { handleExport(); });
  inputImport.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleImportFile(file);
  });
  form.addEventListener('change', () => { handleSettingsChange(); });
  window.addEventListener('resize', () => { resizeCanvas(); drawAll(); });
}

// ===== 启动入口 =====

init();
bindEvents();
