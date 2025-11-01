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
  maxTile: 'stage2048.mp.maxTile.v1'                                                // 历史最大方块
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
  const key = sanitizeTargetFnKey(settings.LEVELS.targetFnKey, 'power');
  const targetFn = TARGET_FN_REGISTRY[key] || TARGET_FN_REGISTRY.power;
  const opts = {
    startSize: settings.LEVELS.startSize,
    carryScore: settings.LEVELS.carryScore,
    targetFn,
    targetFnKey: key,
    randomTileWeightsBySize: cloneWeightMap(settings.LEVELS.randomTileWeightsBySize)
  };
  const seed = typeof settings.seed === 'string' ? settings.seed.trim() : '';
  if (seed) {
    opts.rngSeed = seed;
    opts.rngFactory = makeLCG;
  }
  return new LevelManager(opts);
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
    statusText: ''                  // 状态播报文本
  },

  onLoad() {
    this.SETTINGS = cloneSettings(DEFAULT_SETTINGS);                         // 初始化设置副本
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

    this.game = this.LM.getGame();                                           // 获取 Game2048 实例
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

  _persistProgress() { writeJSON(STORE.progress, this.LM.toJSON()); },
  _persistSettings() { writeJSON(STORE.settings, this.SETTINGS); },
  _persistBest() { wx.setStorageSync(STORE.best, String(this.bestScore)); },

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
    this.LM.nextLevel();
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
