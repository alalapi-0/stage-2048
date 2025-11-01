// /tests/smoke-core.mjs
// 说明：最小化依赖的冒烟脚本，快速验证 LevelManager 与 Game2048 的核心流程。

import { LevelManager, TARGET_FN_REGISTRY } from '../core/levels.esm.js'; // 引入关卡管理器与目标函数注册表

console.log('开始 Stage2048 核心冒烟测试'); // 输出测试起始提示

const manager = new LevelManager({ startSize: 3, carryScore: true, targetFn: TARGET_FN_REGISTRY.power, targetFnKey: 'power' }); // 创建关卡管理器实例
const game = manager.getGame(); // 获取 Game2048 实例
console.assert(game.size === 3, '关卡起始尺寸应为 3'); // 验证初始棋盘尺寸

const moves = ['left', 'right', 'up', 'down']; // 定义方向数组供随机取用
for (let step = 0; step < 16; step++) { // 进行若干次随机移动
  const dir = moves[Math.floor(Math.random() * moves.length)]; // 随机选取方向
  const moved = game.move(dir); // 执行移动
  if (moved) { // 若移动成功
    manager.getGame(); // 访问实例确保引用保持一致
  }
}
console.assert(typeof manager.getTotalScore() === 'number', '总分应为数字类型'); // 验证总分类型

manager.nextLevel(); // 推进到下一关
const nextGame = manager.getGame(); // 取得新关卡实例
console.assert(nextGame.size === 4, '推进后棋盘尺寸应为 4'); // 验证关卡尺寸增长

const json = manager.toJSON(); // 序列化当前管理器
const restored = LevelManager.fromJSON(json, TARGET_FN_REGISTRY); // 通过 JSON 恢复实例
const restoredGame = restored.getGame(); // 获取恢复后的游戏实例

console.assert(restoredGame.size === nextGame.size, '恢复实例的棋盘尺寸应一致'); // 比较棋盘尺寸
console.assert(restored.getTotalScore() === manager.getTotalScore(), '恢复实例的总分应一致'); // 比较总分
console.assert(JSON.stringify(restoredGame.getGrid()) === JSON.stringify(nextGame.getGrid()), '恢复实例的棋盘网格应一致'); // 比较网格结构

console.log('冒烟测试完成，如未触发断言则核心流程正常'); // 输出测试完成提示
