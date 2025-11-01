// /web/main.mjs
// 说明：浏览器端的渲染与交互层，使用 <canvas> 绘制方格与数字
//      接入 /core/levels.esm.js 的 LevelManager 管理关卡推进
//      支持键盘与触摸操作，支持窗口缩放自适配，支持本地持久化最佳分

// 引入关卡管理器（ESM 版本）
import { LevelManager } from '../core/levels.esm.js';

// 读取页面可选的覆盖配置，没有则使用空对象
const OVERRIDE = window.CANVAS_2048_CONFIG || {};

// Web 端默认配置，随后用 OVERRIDE 合并
const CONFIG = Object.assign({
  // 画布 CSS 尺寸，脚本会按 DPR 放大实际像素尺寸
  CANVAS_CSS_SIZE: 480,
  // 格子间距，单位像素
  GAP: 12,
  // 数值颜色映射，0 表示空槽背景
  COLORS: {
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
  },
  // 关卡参数，支持起始尺寸和按尺寸覆盖新方块概率分布
  LEVELS: {
    startSize: 2,
    carryScore: true,
    randomTileWeightsBySize: {
      // 示例：4×4 及以上恢复传统 2 与 4 的生成分布
      4: { 2: 0.9, 4: 0.1 }
    }
  }
}, OVERRIDE);

// 获取页面元素引用
const canvas = document.getElementById('game');    // 画布节点
const ctx = canvas.getContext('2d');               // 2D 绘图上下文
const elLevel = document.getElementById('level');  // 关卡文本
const elTarget = document.getElementById('target');// 目标文本
const elScore = document.getElementById('score');  // 当前分数文本
const elTotal = document.getElementById('total');  // 总分文本
const elBest = document.getElementById('best');    // 最佳分文本
const btnNew = document.getElementById('btn-new'); // 重开按钮

// 运行时变量
let tileSize = 0;              // 单格尺寸，按画布 CSS 尺寸与间距计算
let canvasCssSize = CONFIG.CANVAS_CSS_SIZE; // 画布 CSS 尺寸缓存，便于绘制背景
let LM = null;                 // 关卡管理器实例
let game = null;               // 当前关卡的 Game2048 实例
let bestScore = 0;             // 本地最佳分

// 从本地存储读取最佳分，若无则为 0
try {
  bestScore = Number(localStorage.getItem('bestScore') || 0);
  if (!Number.isFinite(bestScore)) bestScore = 0;  // 若读取结果非数字则归零
} catch (_) {
  bestScore = 0;
}

// 初始化总流程：创建关卡、计算尺寸、首次绘制与 HUD
function init() {
  // 创建关卡管理器
  LM = new LevelManager(CONFIG.LEVELS);
  // 取出当前关卡的游戏实例
  game = LM.getGame();
  // 设置与计算画布尺寸
  resizeCanvas();
  // 绘制一次
  drawAll();
  // 同步顶部信息
  syncHud();
}

// 只重置本关，不修改关卡尺寸
function restartLevel() {
  game.reset();    // 重置当前关卡的棋盘与分数
  drawAll();       // 重新绘制
  syncHud();       // 重新同步 HUD
}

// 进入下一关，尺寸加一
function enterNextLevel() {
  LM.nextLevel();      // 推进关卡
  game = LM.getGame(); // 切换到新关卡实例
  resizeCanvas();      // 由于尺寸变化，需要重算格子尺寸
  drawAll();           // 重新绘制
  syncHud();           // 同步 HUD
}

// 设置画布的 CSS 尺寸并按 DPR 放大实际像素尺寸
function resizeCanvas() {
  // 读取目标 CSS 尺寸，至少取 300，避免过小导致字体难以适配
  const css = Math.max(300, CONFIG.CANVAS_CSS_SIZE);
  canvasCssSize = css; // 同步缓存，供绘制背景与清屏时使用
  // 读取设备像素比，转为整数下限 1
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  // 设置画布的 CSS 尺寸
  canvas.style.width = css + 'px';
  canvas.style.height = css + 'px';
  // 放大实际像素尺寸，保证高清屏不模糊
  canvas.width = Math.floor(css * dpr);
  canvas.height = Math.floor(css * dpr);
  // 将用户空间坐标系重置为 1:1 的 CSS 坐标
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 计算单格尺寸，使用 CSS 尺寸进行几何计算
  const size = game.size; // 当前棋盘尺寸
  tileSize = (css - CONFIG.GAP * (size + 1)) / size;
}

// 绘制圆角矩形的工具函数
function roundRect(x, y, w, h, radius, fillStyle) {
  // 开始路径
  ctx.beginPath();
  // 圆角半径限制为不超过宽高的一半
  const r = Math.min(radius, w / 2, h / 2);
  // 依次沿四边绘制带圆角的路径
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  // 闭合路径
  ctx.closePath();
  // 设置填充色
  ctx.fillStyle = fillStyle;
  // 填充形状
  ctx.fill();
}

// 使用二分法计算合适的字号，尽量占满给定宽高
function fitFont(text, maxW, maxH, family = 'system-ui, Segoe UI, Roboto, Helvetica, Arial', weight = '700') {
  // 最小字号 4，最大字号取内高的整数部分
  let lo = 4, hi = Math.floor(maxH), best = lo;
  // 二分搜索
  while (lo <= hi) {
    // 取中间字号
    const mid = Math.floor((lo + hi) / 2);
    // 设置字体
    ctx.font = `${weight} ${mid}px ${family}`;
    // 测量文本宽度
    const w = ctx.measureText(text).width;
    // 以字号近似文本高度
    const h = mid;
    // 若宽高均能放下，则尝试增大
    if (w <= maxW && h <= maxH) { best = mid; lo = mid + 1; }
    // 否则缩小
    else { hi = mid - 1; }
  }
  // 返回字号与可直接使用的 font 字符串
  return { size: best, css: `${weight} ${best}px ${family}` };
}

// 绘制整个棋盘与数字
function drawAll() {
  // 清空画布，避免残影
  ctx.clearRect(0, 0, canvasCssSize, canvasCssSize);
  // 读取当前棋盘尺寸
  const size = game.size;
  // 背板绘制，使用整块圆角矩形
  roundRect(0, 0, canvasCssSize, canvasCssSize, 10, '#bbada0');

  // 绘制空槽：按行列循环，计算每个槽的位置
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const x = CONFIG.GAP + c * (tileSize + CONFIG.GAP);
      const y = CONFIG.GAP + r * (tileSize + CONFIG.GAP);
      roundRect(x, y, tileSize, tileSize, 8, CONFIG.COLORS[0].bg);
    }
  }

  // 获取网格数据
  const grid = game.getGrid();
  // 逐格绘制方块与数字
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const val = grid[r][c];       // 当前格子的数值
      if (!val) continue;           // 值为 0 表示空，跳过绘制数字块
      // 计算该格子的绘制位置
      const x = CONFIG.GAP + c * (tileSize + CONFIG.GAP);
      const y = CONFIG.GAP + r * (tileSize + CONFIG.GAP);
      // 根据数值取颜色映射，未定义的值使用回退颜色
      const sty = CONFIG.COLORS[val] || { bg: '#3c3a32', fg: '#f9f6f2' };
      // 绘制方块背景
      roundRect(x, y, tileSize, tileSize, 8, sty.bg);

      // 计算文字可绘制的内框区域尺寸
      const pad = Math.floor(tileSize * 0.12);
      const innerW = tileSize - pad * 2;
      const innerH = tileSize - pad * 2;
      // 将数值转为字符串
      const text = String(val);
      // 二分法计算可容纳的最大字号
      const font = fitFont(text, innerW, innerH);

      // 设置前景色与字体
      ctx.fillStyle = sty.fg;
      ctx.font = font.css;
      // 文本水平居中
      ctx.textAlign = 'center';
      // 使用 alphabetic 基线，结合度量数据求垂直居中
      ctx.textBaseline = 'alphabetic';

      // 获取度量信息，优先使用实际上伸下伸，缺失时用比例近似
      const m = ctx.measureText(text);
      const ascent = m.actualBoundingBoxAscent || (font.size * 0.78);
      const descent = m.actualBoundingBoxDescent || (font.size * 0.22);
      const totalH = ascent + descent;

      // 计算文本绘制位置，使其在方块内居中
      const cx = x + tileSize / 2;
      const cy = y + tileSize / 2;
      const baselineY = cy + (ascent - totalH / 2);

      // 绘制文本
      ctx.fillText(text, cx, baselineY);
    }
  }

  // 更新分数区域，同时维护本地最佳分
  const cur = game.getScore();
  if (cur > bestScore) {
    bestScore = cur;
    try { localStorage.setItem('bestScore', String(bestScore)); } catch (_) {}
  }
  // 设置文本内容
  elScore.textContent = `得分 ${cur}`;
  elTotal.textContent = `总分 ${LM.getTotalScore()}`;
  elBest.textContent = `最佳 ${bestScore}`;
}

// 同步关卡与目标显示
function syncHud() {
  const size = game.size;          // 当前棋盘尺寸
  const lv = LM.getLevel();        // 当前关卡编号（2×2 视为第 1 关）
  const target = LM.getTarget();   // 当前关卡目标值
  // 显示“关卡 N（S×S）”
  elLevel.textContent = `关卡 ${lv}（${size}×${size}）`;
  // 显示目标数值
  elTarget.textContent = `目标 ${target}`;
}

// 执行一次移动并处理通关与死局
function doMove(dir) {
  // 移动后若网格发生变化返回 true
  const moved = game.move(dir);
  // 若有变化则重绘并继续判断
  if (moved) {
    // 重绘画面
    drawAll();

    // 若达成目标则询问进入下一关
    if (LM.checkPass()) {
      // 使用原生对话框简单提示
      setTimeout(() => {
        const ok = window.confirm('通关，是否进入下一关');
        if (ok) enterNextLevel();
      }, 10);
      return;
    }

    // 若无可用步，则提示并重开本关
    if (!game.canMove()) {
      setTimeout(() => { window.alert('无可用步，本关结束，可点击重开本关'); }, 10);
    }
  }
}

// 键盘事件，拦截方向键并触发移动
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft')  { e.preventDefault(); doMove('left');  }
  if (e.key === 'ArrowRight') { e.preventDefault(); doMove('right'); }
  if (e.key === 'ArrowUp')    { e.preventDefault(); doMove('up');    }
  if (e.key === 'ArrowDown')  { e.preventDefault(); doMove('down');  }
});

// 触摸手势支持，记录起点与终点计算滑动方向
let touchStart = null; // 触摸起点
canvas.addEventListener('touchstart', (e) => {
  const t = e.touches[0];                 // 取第一根手指
  touchStart = { x: t.clientX, y: t.clientY }; // 记录起点坐标
}, { passive: true });

canvas.addEventListener('touchend', (e) => {
  if (!touchStart) return;                         // 若未记录起点则返回
  const t = e.changedTouches[0];                   // 取结束点
  const dx = t.clientX - touchStart.x;             // 水平位移
  const dy = t.clientY - touchStart.y;             // 垂直位移
  const ax = Math.abs(dx), ay = Math.abs(dy);      // 取绝对值
  const min = 20;                                  // 最小判定阈值
  if (ax < min && ay < min) return;                // 小于阈值忽略
  if (ax > ay) doMove(dx > 0 ? 'right' : 'left');  // 横向滑动
  else         doMove(dy > 0 ? 'down'  : 'up');    // 纵向滑动
  touchStart = null;                                // 清空起点
}, { passive: true });

// 重开按钮绑定，重置当前关卡
btnNew.addEventListener('click', () => { restartLevel(); });

// 窗口尺寸变化时重新计算画布并重绘
window.addEventListener('resize', () => { resizeCanvas(); drawAll(); });

// 初始化入口
init();
