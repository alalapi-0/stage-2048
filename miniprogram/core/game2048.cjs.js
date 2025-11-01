// /miniprogram/core/game2048.cjs.js
// 说明：复制自 /core/game2048.cjs.js 的 CommonJS 逻辑，用于微信小程序端复用；保持 1 起步与 {1:0.9, 2:0.1} 权重设定。

class Game2048 {
  // 构造函数：接收棋盘尺寸与新方块权重分布，可选参数提供默认值
  constructor({ size = 4, randomTileWeights = { 1: 0.9, 2: 0.1 } } = {}) {
    this.size = size;                               // 保存棋盘边长
    this.randomTileWeights = randomTileWeights;     // 保存随机生成新方块的权重映射
    this.score = 0;                                  // 初始化当前得分
    this.grid = this._createEmpty();                 // 创建空棋盘
    this.addRandomTile();                            // 开局放置第一个随机方块
    this.addRandomTile();                            // 开局放置第二个随机方块
  }

  // 重置当前关卡：清空分数并重建棋盘
  reset() {
    this.score = 0;                                  // 重置得分
    this.grid = this._createEmpty();                 // 重建空棋盘
    this.addRandomTile();                            // 重置后放置第一个随机方块
    this.addRandomTile();                            // 重置后放置第二个随机方块
  }

  // 获取当前棋盘的副本
  getGrid() {
    return this.grid.map(row => row.slice());        // 逐行浅拷贝返回副本
  }

  // 获取当前得分
  getScore() {
    return this.score;                               // 返回内部记录的分数
  }

  // 判断是否还能移动：存在空位或相邻可合并则为 true
  canMove() {
    for (let r = 0; r < this.size; r++) {            // 遍历行
      for (let c = 0; c < this.size; c++) {          // 遍历列
        if (this.grid[r][c] === 0) return true;      // 只要存在空位则可移动
      }
    }
    for (let r = 0; r < this.size; r++) {            // 再次遍历判断相邻是否可合并
      for (let c = 0; c < this.size; c++) {
        const v = this.grid[r][c];                   // 当前格子的值
        if (r + 1 < this.size && this.grid[r + 1][c] === v) return true; // 下方相等则可移动
        if (c + 1 < this.size && this.grid[r][c + 1] === v) return true; // 右侧相等则可移动
      }
    }
    return false;                                     // 无空位且无法合并时返回 false
  }

  // 在随机空位生成新方块
  addRandomTile() {
    const empty = [];                                 // 收集空位列表
    for (let r = 0; r < this.size; r++) {             // 遍历所有行
      for (let c = 0; c < this.size; c++) {           // 遍历所有列
        if (this.grid[r][c] === 0) empty.push([r, c]); // 将空位坐标加入数组
      }
    }
    if (empty.length === 0) return false;             // 如果没有空位则失败

    const [rr, cc] = empty[Math.floor(Math.random() * empty.length)]; // 随机挑选一个空位
    const val = this._weightedRandom(this.randomTileWeights);         // 根据权重抽取数值
    this.grid[rr][cc] = val;                                          // 写入棋盘
    return true;                                                      // 返回成功标记
  }

  // 执行一次移动，dir 取值 'left'、'right'、'up'、'down'
  move(dir) {
    let moved = false;                               // 记录是否发生变化

    if (dir === 'left' || dir === 'right') {         // 处理左右方向
      for (let r = 0; r < this.size; r++) {          // 遍历每一行
        const line = this.grid[r].slice();           // 拷贝行数据
        const merged = this._squashMerge(line, dir === 'right'); // 根据方向执行合并
        if (!this._arrEq(merged, this.grid[r])) {    // 若合并后与原行不同
          this.grid[r] = merged;                     // 写回新行
          moved = true;                              // 标记发生变化
        }
      }
    } else if (dir === 'up' || dir === 'down') {     // 处理上下方向
      for (let c = 0; c < this.size; c++) {          // 遍历每一列
        const col = [];                              // 临时存储列数据
        for (let r = 0; r < this.size; r++) col.push(this.grid[r][c]); // 抽取列
        const merged = this._squashMerge(col, dir === 'down');         // 执行合并
        for (let r = 0; r < this.size; r++) {        // 写回列数据
          if (this.grid[r][c] !== merged[r]) moved = true; // 任意格子变化则视为移动
          this.grid[r][c] = merged[r];               // 更新当前格子的值
        }
      }
    } else {
      return false;                                  // 非法方向直接返回 false
    }

    if (moved) this.addRandomTile();                  // 若发生变化则补充随机方块
    return moved;                                     // 返回移动是否生效
  }

  // ===== 内部工具方法：以下方法仅供类内部使用 =====

  // 创建空棋盘
  _createEmpty() {
    return Array.from({ length: this.size }, () => Array(this.size).fill(0)); // 生成 size×size 的全零二维数组
  }

  // 判断两个一维数组是否完全相同
  _arrEq(a, b) {
    if (a.length !== b.length) return false;         // 长度不同必然不相同
    for (let i = 0; i < a.length; i++) {             // 遍历所有索引
      if (a[i] !== b[i]) return false;               // 发现不同立即返回 false
    }
    return true;                                     // 全部相同则返回 true
  }

  // 按照权重随机返回一个数字
  _weightedRandom(weights) {
    const items = Object.keys(weights).map(k => ({ v: Number(k), w: Number(weights[k]) })); // 将权重映射转换为数组
    const sum = items.reduce((s, it) => s + it.w, 0); // 计算权重总和
    let rnd = Math.random() * sum;                   // 生成 0 到总权重之间的随机数
    for (const it of items) {                        // 遍历每一项
      rnd -= it.w;                                   // 减去当前项的权重
      if (rnd <= 0) return it.v;                     // 当随机数不大于 0 时返回对应的值
    }
    return items[0].v;                               // 理论上不会执行到此处，作为兜底返回第一项
  }

  // 合并逻辑：去零、合并、补零，可根据 reverse 控制方向
  _squashMerge(line, reverse = false) {
    const arr = reverse ? line.slice().reverse() : line.slice(); // 根据需要复制并反转数组
    const a = arr.filter(v => v !== 0);            // 去除所有 0
    const out = [];                                // 初始化输出数组
    for (let i = 0; i < a.length; i++) {           // 遍历有效数字
      if (i < a.length - 1 && a[i] === a[i + 1]) { // 如果当前数字和下一个数字相同
        const v = a[i] * 2;                        // 合并后的数字是原来的两倍
        out.push(v);                               // 推入输出数组
        this.score += v;                           // 累加分数
        i++;                                       // 跳过被合并的下一个元素
      } else {
        out.push(a[i]);                            // 若无法合并则直接推入原值
      }
    }
    while (out.length < this.size) out.push(0);    // 不足长度时补零
    return reverse ? out.reverse() : out;          // 如果之前反转过则再次反转以还原方向
  }
}

module.exports = Game2048; // 导出类供 CommonJS 环境使用
