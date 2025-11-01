// /core/game2048.esm.js
// 说明：实现平台无关的 2048 核心逻辑（ES 模块版本），所有注释均使用中文。
// 特点：棋盘从数值 1 起步，新方块按照 {1:0.9, 2:0.1} 的默认权重生成，相同数字合并后数值翻倍，并在移动产生变化时自动生成新方块。

export class Game2048 {
  // 构造函数：接收棋盘尺寸、权重与伪随机数生成器，提供默认值保证向下兼容
  constructor({ size = 4, randomTileWeights = { 1: 0.9, 2: 0.1 }, rng } = {}) {
    this.size = size;                               // 保存棋盘边长，例如 4 代表 4x4 棋盘
    this.randomTileWeights = randomTileWeights;     // 保存随机生成新方块的权重映射
    this._rng = typeof rng === 'function' ? rng : Math.random; // 记录伪随机数生成器，默认使用 Math.random
    this.score = 0;                                  // 初始化当前得分为 0
    this.grid = this._createEmpty();                 // 创建一个全部为 0 的二维数组表示棋盘
    this.addRandomTile();                            // 开局放置第一个随机方块
    this.addRandomTile();                            // 开局放置第二个随机方块
  }

  // 重置当前关卡：清空分数与棋盘，但保持棋盘尺寸不变
  reset() {
    this.score = 0;                                  // 重置得分为 0
    this.grid = this._createEmpty();                 // 重新创建空棋盘
    this.addRandomTile();                            // 重置后放置第一个随机方块
    this.addRandomTile();                            // 重置后放置第二个随机方块
  }

  // 获取当前棋盘的副本，防止外部直接修改内部状态
  getGrid() {
    return this.grid.map(row => row.slice());        // 对每一行执行浅拷贝，返回全新的二维数组
  }

  // 获取当前得分
  getScore() {
    return this.score;                               // 直接返回内部记录的分数
  }

  // 判断棋盘是否还能进行移动：存在空位或相邻可合并即为可移动
  canMove() {
    for (let r = 0; r < this.size; r++) {            // 遍历所有行
      for (let c = 0; c < this.size; c++) {          // 遍历所有列
        if (this.grid[r][c] === 0) return true;      // 若发现空位（值为 0）则可移动
      }
    }
    for (let r = 0; r < this.size; r++) {            // 再次遍历用于检测相邻可合并
      for (let c = 0; c < this.size; c++) {
        const v = this.grid[r][c];                   // 当前格子的值
        if (r + 1 < this.size && this.grid[r + 1][c] === v) return true; // 下方相同则可移动
        if (c + 1 < this.size && this.grid[r][c + 1] === v) return true; // 右侧相同则可移动
      }
    }
    return false;                                     // 无空位且无相邻相同数字则不可移动
  }

  // 在随机空位生成一个新方块，按权重分布抽取其数值
  addRandomTile() {
    const empty = [];                                 // 用于收集空位坐标
    for (let r = 0; r < this.size; r++) {             // 遍历所有行
      for (let c = 0; c < this.size; c++) {           // 遍历所有列
        if (this.grid[r][c] === 0) empty.push([r, c]); // 将空位坐标加入数组
      }
    }
    if (empty.length === 0) return false;             // 若没有空位则放置失败

    const [rr, cc] = empty[Math.floor(this._rng() * empty.length)];   // 通过伪随机数生成器选择空位
    const val = this._weightedRandom(this.randomTileWeights);         // 根据权重抽取数字
    this.grid[rr][cc] = val;                                          // 将新数值写入棋盘
    return true;                                                      // 返回成功放置
  }

  // 执行一次移动：dir 可取 'left'、'right'、'up'、'down'，若移动引起变化则生成新方块
  move(dir) {
    let moved = false;                               // 标记本次移动是否改变了棋盘

    if (dir === 'left' || dir === 'right') {         // 如果是左右移动，则按行处理
      for (let r = 0; r < this.size; r++) {          // 遍历每一行
        const line = this.grid[r].slice();           // 拷贝当前行用于处理
        const merged = this._squashMerge(line, dir === 'right'); // 根据方向执行压缩与合并
        if (!this._arrEq(merged, this.grid[r])) {    // 如果合并结果与原行不同
          this.grid[r] = merged;                     // 写回新行数据
          moved = true;                              // 标记发生了移动
        }
      }
    } else if (dir === 'up' || dir === 'down') {     // 如果是上下移动，则按列处理
      for (let c = 0; c < this.size; c++) {          // 遍历每一列
        const col = [];                              // 存放列数据的临时数组
        for (let r = 0; r < this.size; r++) col.push(this.grid[r][c]); // 取出该列
        const merged = this._squashMerge(col, dir === 'down');         // 处理列数据
        for (let r = 0; r < this.size; r++) {        // 将合并结果写回棋盘
          if (this.grid[r][c] !== merged[r]) moved = true; // 任一格改变即说明发生移动
          this.grid[r][c] = merged[r];               // 更新当前格子的值
        }
      }
    } else {
      return false;                                  // 如果方向非法则直接返回失败
    }

    if (moved) this.addRandomTile();                  // 若棋盘发生变化则补充一个新方块
    return moved;                                     // 返回是否发生了移动
  }

  // ===== 内部工具方法：以下方法仅供类内部调用 =====

  // 创建一个空棋盘：生成 size×size 的二维数组并填充为 0
  _createEmpty() {
    return Array.from({ length: this.size }, () => Array(this.size).fill(0)); // 使用 Array.from 构建二维数组
  }

  // 判断两个一维数组是否完全相等，用于检测移动前后是否改变
  _arrEq(a, b) {
    if (a.length !== b.length) return false;         // 长度不同则直接返回不相等
    for (let i = 0; i < a.length; i++) {             // 遍历所有元素
      if (a[i] !== b[i]) return false;               // 只要有元素不同则返回不相等
    }
    return true;                                     // 完全一致时返回 true
  }

  // 根据权重随机选择一个数字，weights 形如 {1:0.9, 2:0.1}
  _weightedRandom(weights) {
    const items = Object.keys(weights).map(k => ({ v: Number(k), w: Number(weights[k]) })); // 将映射转换为数组形式
    const sum = items.reduce((s, it) => s + it.w, 0); // 计算权重总和
    let rnd = this._rng() * sum;                     // 使用伪随机数生成器产生 0 到总权重之间的随机数
    for (const it of items) {                        // 遍历所有项
      rnd -= it.w;                                   // 逐项减去权重
      if (rnd <= 0) return it.v;                     // 当随机数小于等于 0 时返回对应的值
    }
    return items[0].v;                               // 理论上不会执行到此处，作为兜底返回第一项
  }

  // 合并逻辑：去除零、处理相邻合并、补零，并可根据 reverse 控制方向
  _squashMerge(line, reverse = false) {
    const arr = reverse ? line.slice().reverse() : line.slice(); // 若需要反向处理则先反转
    const a = arr.filter(v => v !== 0);            // 去掉所有 0，只保留有效数字
    const out = [];                                // 准备输出数组
    for (let i = 0; i < a.length; i++) {           // 遍历有效数字
      if (i < a.length - 1 && a[i] === a[i + 1]) { // 如果当前数字与下一个数字相同
        const v = a[i] * 2;                        // 合并后的数字是原来的两倍
        out.push(v);                               // 将合并结果推入输出数组
        this.score += v;                           // 将合并值计入分数
        i++;                                       // 跳过下一个元素（已合并）
      } else {
        out.push(a[i]);                            // 若无法合并则直接放入当前值
      }
    }
    while (out.length < this.size) out.push(0);    // 如果长度不足则补充 0 直至满足棋盘长度
    return reverse ? out.reverse() : out;          // 若之前反向处理，则此处再次反转恢复原方向
  }

  // 观察当前状态：返回棋盘深拷贝与得分，用于撤销或复盘（非正式调试 API）
  peekState() {
    return {
      grid: this.grid.map(row => row.slice()),       // 为每一行创建副本，避免外部修改内部数组
      score: this.score                              // 返回当前得分
    };
  }

  // 从快照恢复状态：仅在信任调用方的情况下使用（非正式调试 API）
  restoreState(state) {
    if (!state || typeof state !== 'object') return; // 若输入非法则直接忽略
    const gridSrc = Array.isArray(state.grid) ? state.grid : []; // 提取快照中的棋盘数据
    const newGrid = [];                               // 准备新的棋盘数组
    for (let r = 0; r < this.size; r++) {             // 遍历行索引
      const rowSrc = Array.isArray(gridSrc[r]) ? gridSrc[r] : []; // 获取对应快照行
      const row = [];                                  // 为当前行构建新数组
      for (let c = 0; c < this.size; c++) {            // 遍历列索引
        const val = Number(rowSrc[c]);                 // 尝试读取并转换为数字
        row.push(Number.isFinite(val) ? val : 0);      // 非数字值回退为 0
      }
      newGrid.push(row);                               // 将处理后的行推入新棋盘
    }
    this.grid = newGrid;                               // 用新棋盘替换内部状态
    const scoreNum = Number(state.score);              // 解析快照中的得分
    if (Number.isFinite(scoreNum)) this.score = scoreNum; // 合法得分写回当前实例
  }
}
