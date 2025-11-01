// /core/rng.cjs.js
// 说明：提供简单的线性同余伪随机数生成器，仅用于重现与复盘，不具备密码学安全性。

const MOD32 = 0x100000000;                               // 常量：2^32，线性同余计算所用模数
const LCG_A = 1664525;                                   // 常量：线性同余乘数（取自 Numerical Recipes）
const LCG_C = 1013904223;                                // 常量：线性同余增量

// 工具：将任意字符串或数字转换为 32 位无符号整数种子
function normalizeSeed(input) {
  if (typeof input === 'number' && Number.isFinite(input)) { // 若为有限数字
    return (input >>> 0) || 1;                              // 转换为无符号整数，0 则回退为 1
  }
  if (typeof input === 'string') {                          // 若为字符串
    let state = 0;                                          // 初始化状态为 0
    for (let i = 0; i < input.length; i++) {                // 遍历每个字符
      state = (state * 31 + input.charCodeAt(i)) >>> 0;     // 采用简单多项式滚动哈希
    }
    return state || 1;                                      // 结果为 0 时回退为 1
  }
  return 1;                                                 // 其它类型回退为默认种子 1
}

// 导出：根据种子字符串或数字生成返回 [0,1) 浮点数的函数
function makeLCG(seedInput) {
  let state = normalizeSeed(seedInput);                    // 将输入规范化为 32 位无符号整数
  const rng = function () {
    state = (LCG_A * state + LCG_C) >>> 0;                 // 执行线性同余递推，保持无符号 32 位
    return state / MOD32;                                  // 将结果映射到 [0, 1) 区间
  };
  rng.peekState = () => state;                             // 暴露当前内部状态（调试/复盘用）
  rng.restoreState = (nextState) => {                      // 恢复内部状态，支持撤销与复盘
    const num = Number(nextState);                         // 将输入转换为数字
    if (!Number.isFinite(num)) return;                     // 非数字忽略
    const normalized = (num >>> 0) || 1;                   // 规范化为 32 位无符号整数
    state = normalized;                                    // 写回内部状态
  };
  return rng;                                              // 返回具备状态访问能力的伪随机函数
}

module.exports = { makeLCG };                              // 导出工厂函数供 CommonJS 环境使用
