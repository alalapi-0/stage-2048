// /miniprogram/pages/index/index.js
// 说明：小程序首页逻辑，新增设置与进度持久化，以及“重置进度”“清空最佳分”操作按钮。

const { LevelManager, TARGET_FN_REGISTRY } = require('../../core/levels.cjs.js'); // 引入关卡管理器与目标函数注册表
const sys = wx.getSystemInfoSync();                                              // 获取设备信息，用于计算画布尺寸

// 本地存储键位：区分设置、进度与最佳分
const STORE = {
  settings: 'stage2048.mp.settings.v1',                  // 保存小程序端设置
  progress: 'stage2048.mp.progress.v1',                  // 保存关卡进度
  best: 'stage2048.mp.bestScore.v1'                      // 保存最佳分
};

// 默认设置：包含 gap 与 LevelManager 相关配置（与 Web 保持一致）
const DEFAULT_SETTINGS = Object.freeze({
  gap: 12,                                               // 格子间隙
  LEVELS: {
    startSize: 2,                                        // 起始棋盘尺寸
    carryScore: true,                                    // 是否累计总分
    targetFnKey: 'power',                                // 默认目标函数
    randomTileWeightsBySize: {                           // 示例权重映射
      4: { 2: 0.9, 4: 0.1 }
    }
  }
});

// ===== 工具函数：设置克隆与校验 =====

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

function cloneSettings(source) {
  return {
    gap: source.gap,
    LEVELS: {
      startSize: source.LEVELS.startSize,
      carryScore: source.LEVELS.carryScore,
      targetFnKey: source.LEVELS.targetFnKey,
      randomTileWeightsBySize: cloneWeightMap(source.LEVELS.randomTileWeightsBySize)
    }
  };
}

function sanitizeNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

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

function sanitizeTargetFnKey(value, fallback) {
  if (typeof value === 'string' && TARGET_FN_REGISTRY[value]) return value;
  return TARGET_FN_REGISTRY[fallback] ? fallback : 'power';
}

function sanitizeSettings(patch, fallback = DEFAULT_SETTINGS) {
  const base = cloneSettings(fallback);
  if (!patch || typeof patch !== 'object') return base;
  if ('gap' in patch) {
    base.gap = sanitizeNumber(patch.gap, base.gap, { min: 4, max: 60 });
  }
  const lvlPatch = patch.LEVELS && typeof patch.LEVELS === 'object' ? patch.LEVELS : null;
  if (lvlPatch) {
    if ('startSize' in lvlPatch) {
      base.LEVELS.startSize = Math.max(2, Math.floor(sanitizeNumber(lvlPatch.startSize, base.LEVELS.startSize, { min: 2, max: 16 })));
    }
    if ('carryScore' in lvlPatch) {
      base.LEVELS.carryScore = sanitizeBoolean(lvlPatch.carryScore, base.LEVELS.carryScore);
    }
    if ('targetFnKey' in lvlPatch) {
      base.LEVELS.targetFnKey = sanitizeTargetFnKey(lvlPatch.targetFnKey, base.LEVELS.targetFnKey);
    }
    if ('randomTileWeightsBySize' in lvlPatch) {
      base.LEVELS.randomTileWeightsBySize = cloneWeightMap(lvlPatch.randomTileWeightsBySize);
    }
  }
  return base;
}

function readJSON(key) {
  try {
    const raw = wx.getStorageSync(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[Stage2048][mini] 读取存储失败：', key, err);
    return null;
  }
}

function writeJSON(key, value) {
  try {
    wx.setStorageSync(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[Stage2048][mini] 写入存储失败：', key, err);
  }
}

function removeStorage(key) {
  try {
    wx.removeStorageSync(key);
  } catch (err) {
    console.warn('[Stage2048][mini] 移除存储失败：', key, err);
  }
}

function createManager(settings) {
  const key = sanitizeTargetFnKey(settings.LEVELS.targetFnKey, 'power');
  const targetFn = TARGET_FN_REGISTRY[key] || TARGET_FN_REGISTRY.power;
  return new LevelManager({
    startSize: settings.LEVELS.startSize,
    carryScore: settings.LEVELS.carryScore,
    targetFn,
    targetFnKey: key,
    randomTileWeightsBySize: cloneWeightMap(settings.LEVELS.randomTileWeightsBySize)
  });
}

Page({
  data: {
    canvasPx: 360,          // 画布目标像素尺寸（运行时计算覆盖）
    gap: 12,                // 格子间隙（从设置同步）
    size: 2,                // 当前棋盘尺寸（由关卡决定）
    level: 1,               // 关卡号（2×2 视为第 1 关）
    target: 32,             // 当前关卡目标值
    score: 0,               // 当前分数
    totalScore: 0,          // 总分（含此前关卡累计）
    bestScore: 0            // 本地最佳分
  },

  onLoad() {
    this.SETTINGS = cloneSettings(DEFAULT_SETTINGS);           // 初始化设置副本
    const storedSettings = readJSON(STORE.settings);           // 读取本地设置
    if (storedSettings) this.SETTINGS = sanitizeSettings(storedSettings, this.SETTINGS);
    this.setData({ gap: this.SETTINGS.gap });                  // 同步 gap 到 data

    const best = Number(wx.getStorageSync(STORE.best) || 0);   // 读取最佳分
    this.bestScore = Number.isFinite(best) && best >= 0 ? best : 0;
    this.setData({ bestScore: this.bestScore });

    const storedProgress = readJSON(STORE.progress);           // 尝试恢复进度
    if (storedProgress) {
      try {
        this.LM = LevelManager.fromJSON(storedProgress, TARGET_FN_REGISTRY);
        this.SETTINGS.LEVELS.targetFnKey = sanitizeTargetFnKey(this.LM.targetFnKey, this.SETTINGS.LEVELS.targetFnKey);
        this.SETTINGS.LEVELS.randomTileWeightsBySize = cloneWeightMap(this.LM.randomTileWeightsBySize);
      } catch (err) {
        console.warn('[Stage2048][mini] 进度恢复失败，使用默认配置：', err);
        this.LM = createManager(this.SETTINGS);
      }
    } else {
      this.LM = createManager(this.SETTINGS);
    }

    this.game = this.LM.getGame();                              // 获取 Game2048 实例
    writeJSON(STORE.settings, this.SETTINGS);                    // 存储一次清洗后的设置

    const px = Math.min(Math.max(300, sys.windowWidth - 32), 480); // 计算画布像素
    this.setData({ canvasPx: Math.floor(px) });
  },

  onReady() {
    this.ctx = wx.createCanvasContext('game', this);            // 创建 2D 画布上下文
    this._computeTileSize();                                   // 计算单格尺寸
    this._syncHud();                                           // 同步 HUD
    this._drawAll();                                           // 首次绘制
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
      const h = mid;
      if (w <= maxW && h <= maxH) { best = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    return best;
  },

  _drawAll() {
    const ctx = this.ctx;
    const gap = this.SETTINGS.gap;
    const size = this.game.size;
    const S = this.data.canvasPx;
    const T = this.tileSize;

    this._roundRect(0, 0, S, S, 10, '#bbada0');

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const x = gap + c * (T + gap);
        const y = gap + r * (T + gap);
        this._roundRect(x, y, T, T, 8, '#cdc1b4');
      }
    }

    const COLORS = {
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

    const grid = this.game.getGrid();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = grid[r][c];
        if (!v) continue;
        const x = gap + c * (T + gap);
        const y = gap + r * (T + gap);
        const sty = COLORS[v] || { bg: '#3c3a32', fg: '#f9f6f2' };
        this._roundRect(x, y, T, T, 8, sty.bg);
        const pad = Math.floor(T * 0.12);
        const innerW = T - pad * 2;
        const innerH = T - pad * 2;
        const text = String(v);
        const fontSize = this._fitFont(text, innerW, innerH);
        ctx.setFillStyle(sty.fg);
        ctx.setFontSize(fontSize);
        ctx.setTextAlign('center');
        ctx.setTextBaseline('middle');
        const cx = x + T / 2;
        const cy = y + T / 2;
        ctx.fillText(text, cx, cy);
      }
    }

    const cur = this.game.getScore();
    if (cur > this.bestScore) {
      this.bestScore = cur;
      try { wx.setStorageSync(STORE.best, String(this.bestScore)); } catch (err) { console.warn('[Stage2048][mini] 写入最佳分失败：', err); }
      this.setData({ bestScore: this.bestScore });
    }

    ctx.draw();

    this.setData({
      score: cur,
      totalScore: this.LM.getTotalScore()
    });
  },

  _syncHud() {
    this.setData({
      size: this.game.size,
      level: this.LM.getLevel(),
      target: this.LM.getTarget()
    });
  },

  _persistProgress() {
    if (!this.LM) return;
    writeJSON(STORE.progress, this.LM.toJSON());
  },

  onRestart() {
    this.game.reset();
    this._persistProgress();
    this._computeTileSize();
    this._syncHud();
    this._drawAll();
  },

  _enterNextLevel() {
    this.LM.nextLevel();
    this.game = this.LM.getGame();
    this._persistProgress();
    this._computeTileSize();
    this._syncHud();
    this._drawAll();
  },

  _doMove(dir) {
    const moved = this.game.move(dir);
    if (!moved) return;
    this._persistProgress();
    this._drawAll();
    if (this.LM.checkPass()) {
      wx.showModal({
        title: '通关',
        content: '是否进入下一关',
        success: (res) => {
          if (res.confirm) this._enterNextLevel();
        }
      });
      return;
    }
    if (!this.game.canMove()) {
      wx.showToast({ title: '无可用步', icon: 'none' });
    }
  },

  onTouchStart(e) {
    const t = e.touches[0];
    this._t0 = { x: t.clientX, y: t.clientY };
  },

  onTouchEnd(e) {
    if (!this._t0) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - this._t0.x;
    const dy = t.clientY - this._t0.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const min = 20;
    if (ax < min && ay < min) return;
    if (ax > ay) this._doMove(dx > 0 ? 'right' : 'left');
    else         this._doMove(dy > 0 ? 'down'  : 'up');
    this._t0 = null;
  },

  onResize() {
    const info = wx.getSystemInfoSync();
    const px = Math.min(Math.max(300, info.windowWidth - 32), 480);
    this.setData({ canvasPx: Math.floor(px) }, () => {
      this._computeTileSize();
      this._drawAll();
    });
  },

  onResetProgress() {
    removeStorage(STORE.progress);
    this.LM = createManager(this.SETTINGS);
    this.game = this.LM.getGame();
    this._persistProgress();
    this._computeTileSize();
    this._syncHud();
    this._drawAll();
    wx.showToast({ title: '进度已重置', icon: 'success' });
  },

  onClearBest() {
    this.bestScore = 0;
    try { wx.removeStorageSync(STORE.best); } catch (err) { console.warn('[Stage2048][mini] 清空最佳分失败：', err); }
    this.setData({ bestScore: 0 });
    wx.showToast({ title: '最佳分已清空', icon: 'success' });
  }
});
