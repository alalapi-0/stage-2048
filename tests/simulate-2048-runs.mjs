// /tests/simulate-2048-runs.mjs
// 说明：通过随机策略多次模拟 2048 对局，输出平均步数与失败率，辅助分析难度。

import { LevelManager, TARGET_FN_REGISTRY } from '../core/levels.esm.js'; // 引入核心管理器与目标函数注册表

const totalRuns = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 50; // 读取模拟轮数，默认 50 局
const maxSteps = Number(process.argv[3]) > 0 ? Number(process.argv[3]) : 5000; // 读取单局最大步数，默认 5000 步

const dirs = ['left', 'right', 'up', 'down']; // 定义可能的移动方向

function randomStep(game) { // 定义执行一次随机合法移动的工具函数
  const pool = dirs.slice(); // 复制方向数组
  for (let i = pool.length - 1; i > 0; i--) { // 使用 Fisher-Yates 洗牌，确保方向尝试顺序随机
    const j = Math.floor(Math.random() * (i + 1)); // 随机选择交换索引
    [pool[i], pool[j]] = [pool[j], pool[i]]; // 交换元素
  }
  for (const dir of pool) { // 遍历打乱后的方向
    if (game.move(dir)) return true; // 一旦成功移动立即返回
  }
  return false; // 所有方向都无法移动时返回 false
}

let winCount = 0; // 统计通关局数
let failCount = 0; // 统计失败局数
let totalStepCount = 0; // 汇总总步数

for (let round = 0; round < totalRuns; round++) { // 遍历每一局
  const manager = new LevelManager({ startSize: 4, carryScore: false, targetFn: TARGET_FN_REGISTRY.power, targetFnKey: 'power' }); // 创建标准 4×4 开局
  const game = manager.getGame(); // 获取对应游戏实例
  let steps = 0; // 当前局已执行步数
  let passed = false; // 标记是否通关
  while (steps < maxSteps) { // 在上限内循环
    const moved = randomStep(game); // 执行一次随机合法移动
    if (!moved) break; // 若无法再移动则视为失败
    steps += 1; // 累加步数
    if (manager.checkPass()) { // 检查是否达到关卡目标
      passed = true; // 标记成功
      break; // 结束循环
    }
    if (!game.canMove()) break; // 若棋盘无可用步也结束
  }
  totalStepCount += steps; // 汇总步数
  if (passed) winCount += 1; // 根据结果累加通关计数
  else failCount += 1; // 失败计数加一
}

const averageSteps = totalStepCount / totalRuns; // 计算平均步数
const failRate = failCount / totalRuns; // 计算失败率

console.table([{ 指标: '总局数', 数值: totalRuns }, { 指标: '通关局数', 数值: winCount }, { 指标: '失败局数', 数值: failCount }, { 指标: '平均步数', 数值: averageSteps.toFixed(2) }, { 指标: '失败率', 数值: (failRate * 100).toFixed(2) + '%' }]); // 使用表格输出统计结果
