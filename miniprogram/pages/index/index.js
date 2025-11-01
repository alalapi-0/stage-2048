// /miniprogram/pages/index/index.js
// 说明：小程序首页逻辑。使用 createCanvasContext 在 2D 画布上绘制格子与数字。
//       接入 /miniprogram/core 的 LevelManager 进行关卡管理，支持滑动操作与重开本关。

const { LevelManager } = require('../../core/levels.cjs.js');  // 引入关卡管理器（CJS）
const sys = wx.getSystemInfoSync();                            // 获取设备信息，用于计算画布尺寸

Page({
  // 页面绑定的数据
  data: {
    canvasPx: 360,          // 画布目标像素尺寸（运行时计算覆盖）
    gap: 12,                // 格子间隙（像素）
    size: 2,                // 当前棋盘尺寸（由关卡决定）
    level: 1,               // 关卡号（2×2 视为第 1 关）
    target: 32,             // 当前关卡目标值
    score: 0,               // 当前分数
    totalScore: 0,          // 总分（含此前关卡累计）
    bestScore: 0            // 本地最佳分
  },

  // 生命周期：页面加载
  onLoad() {
    // 读取本地最佳分（若没有则为 0）
    const best = Number(wx.getStorageSync('bestScore') || 0);
    this.setData({ bestScore: best });

    // 创建关卡管理器：从 2×2 起步，累计得分
    this.LM = new LevelManager({
      startSize: 2,
      carryScore: true,
      // 可按尺寸覆盖新方块分布：示例为 4×4 起使用传统 2/4。
      randomTileWeightsBySize: { 4: { 2: 0.9, 4: 0.1 } }
    });

    // 当前关卡的游戏实例
    this.game = this.LM.getGame();

    // 预计算画布像素尺寸：尽量贴合屏幕宽度，留出边距
    // 这里取 min(屏幕宽度 - 32, 480)，避免过大导致低端机卡顿
    const px = Math.min(Math.max(300, sys.windowWidth - 32), 480);
    this.setData({ canvasPx: Math.floor(px) });
  },

  // 生命周期：初次渲染完成
  onReady() {
    // 创建 2D 画布上下文对象
    this.ctx = wx.createCanvasContext('game', this);

    // 按当前棋盘尺寸计算每格像素大小
    this._computeTileSize();

    // 同步 HUD 信息到页面
    this._syncHud();

    // 首次绘制
    this._drawAll();
  },

  // 计算每格像素大小：依据画布像素尺寸、格子间隙与棋盘尺寸
  _computeTileSize() {
    const { canvasPx, gap } = this.data;
    const size = this.game.size;
    // (总宽度 - (间隙 * (格子数 + 1))) / 格子数
    this.tileSize = (canvasPx - gap * (size + 1)) / size;
  },

  // 绘制圆角矩形工具：使用二次贝塞尔曲线实现
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

  // 二分法拟合字号：仅以文本宽度为约束，小程序 measureText 只提供宽度
  _fitFont(text, maxW, maxH) {
    const ctx = this.ctx;
    let lo = 4, hi = Math.floor(maxH), best = lo;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      ctx.setFontSize(mid);                    // 设置字号
      const w = ctx.measureText(text).width;   // 测量宽度
      const h = mid;                           // 用字号近似高度
      if (w <= maxW && h <= maxH) { best = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    return best; // 返回最佳字号
  },

  // 绘制整棋盘
  _drawAll() {
    const ctx = this.ctx;
    const gap = this.data.gap;
    const size = this.game.size;
    const S = this.data.canvasPx;        // 画布像素边长
    const T = this.tileSize;             // 单格像素尺寸

    // 背板
    this._roundRect(0, 0, S, S, 10, '#bbada0');

    // 空槽
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const x = gap + c * (T + gap);
        const y = gap + r * (T + gap);
        this._roundRect(x, y, T, T, 8, '#cdc1b4');
      }
    }

    // 具体数值的颜色映射（保持与 Web 版一致的主色）
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

    // 绘制有效方块
    const grid = this.game.getGrid();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = grid[r][c];
        if (!v) continue;
        const x = gap + c * (T + gap);
        const y = gap + r * (T + gap);
        const sty = COLORS[v] || { bg: '#3c3a32', fg: '#f9f6f2' };

        // 背景方块
        this._roundRect(x, y, T, T, 8, sty.bg);

        // 计算文字框
        const pad = Math.floor(T * 0.12);
        const innerW = T - pad * 2;
        const innerH = T - pad * 2;

        // 拟合字号
        const text = String(v);
        const fontSize = this._fitFont(text, innerW, innerH);

        // 设置文字样式与居中
        ctx.setFillStyle(sty.fg);
        ctx.setFontSize(fontSize);
        ctx.setTextAlign('center');
        ctx.setTextBaseline('middle');

        // 中心点坐标
        const cx = x + T / 2;
        const cy = y + T / 2;

        // 绘制文本
        ctx.fillText(text, cx, cy);
      }
    }

    // 分数与最佳分
    const cur = this.game.getScore();
    let best = this.data.bestScore;
    if (cur > best) {
      best = cur;
      try { wx.setStorageSync('bestScore', String(best)); } catch (e) {}
      this.setData({ bestScore: best });
    }

    // 将缓冲区内容一次性提交到画布
    ctx.draw();

    // 同步分数相关数据到 HUD
    this.setData({
      score: cur,
      totalScore: this.LM.getTotalScore()
    });
  },

  // 同步关卡 HUD 文本
  _syncHud() {
    this.setData({
      size: this.game.size,
      level: this.LM.getLevel(),
      target: this.LM.getTarget()
    });
  },

  // 重开本关
  onRestart() {
    this.game.reset();
    this._computeTileSize();
    this._syncHud();
    this._drawAll();
  },

  // 进入下一关
  _enterNextLevel() {
    this.LM.nextLevel();
    this.game = this.LM.getGame();
    this._computeTileSize();
    this._syncHud();
    this._drawAll();
  },

  // 单步移动与通关/死局判定
  _doMove(dir) {
    const moved = this.game.move(dir);
    if (!moved) return;

    // 重绘
    this._drawAll();

    // 通关判定
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

    // 死局判定
    if (!this.game.canMove()) {
      wx.showToast({ title: '无可用步', icon: 'none' });
    }
  },

  // 触摸起点
  onTouchStart(e) {
    const t = e.touches[0];
    this._t0 = { x: t.clientX, y: t.clientY };
  },

  // 触摸结束，计算滑动方向
  onTouchEnd(e) {
    if (!this._t0) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - this._t0.x;
    const dy = t.clientY - this._t0.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const min = 20; // 最小滑动阈值
    if (ax < min && ay < min) return;
    if (ax > ay) this._doMove(dx > 0 ? 'right' : 'left');
    else         this._doMove(dy > 0 ? 'down'  : 'up');
    this._t0 = null;
  },

  // 适配窗口尺寸变化（开发者工具里有效）
  onResize() {
    const info = wx.getSystemInfoSync();             // 重新获取实时窗口信息
    const px = Math.min(Math.max(300, info.windowWidth - 32), 480); // 重新计算画布尺寸
    this.setData({ canvasPx: Math.floor(px) }, () => {
      this._computeTileSize();
      this._drawAll();
    });
  }
});
