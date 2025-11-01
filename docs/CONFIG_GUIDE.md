# 配置参数指南

> 本文档对应 `/core/config.schema.md`，进一步说明每个字段的含义、默认值与跨端载入顺序，并给出序列化结构与目标函数扩展方法。

## LevelManager 序列化结构

通过 `LevelManager.toJSON()` 可获得以下结构，用于保存关卡进度与当前盘面：

```json
{
  "size": 4,
  "carryScore": true,
  "totalScoreBeforeThisLevel": 512,
  "game": {
    "size": 4,
    "score": 256,
    "grid": [[0,2,4,8],[0,4,8,16],[2,0,0,0],[0,0,0,0]],
    "randomTileWeights": {"2": 0.9, "4": 0.1}
  },
  "targetFnKey": "power",
  "randomTileWeightsBySize": {
    "4": {"2": 0.9, "4": 0.1}
  }
}
```

- `size`、`carryScore`、`totalScoreBeforeThisLevel`：记录当前关卡尺寸与累计分策略。
- `game`：保存 `Game2048` 的尺寸、分数、棋盘二维数组与新方块权重。
- `targetFnKey`：目标函数标识，用于从注册表中恢复函数实现。
- `randomTileWeightsBySize`：保存尺寸→权重映射，确保恢复后仍使用原有概率分布。

调用 `LevelManager.fromJSON(json, TARGET_FN_REGISTRY)` 可在任意端恢复状态；若某字段缺失或类型不符，将自动回退到默认值，并在控制台提示一次警告。

## TARGET_FN_REGISTRY 使用说明

核心层导出 `TARGET_FN_REGISTRY`，内置两种目标函数：

| 键 | 含义 | 公式 |
| --- | --- | --- |
| `power` | 默认目标函数 | `size => 2 ** (size + 3)` |
| `fibonacci` | 示例目标函数 | `size => Fibonacci(size + 7)`，即尺寸 2 起目标为 34、55、89… |

如需自定义，可新增键值对并在设置中指定 `targetFnKey`。若恢复存档时找不到对应键，会自动回退到 `power`。

## URL Query 覆盖示例（Web）

在浏览器地址栏追加查询参数即可覆盖本地设置：

```
index.html?size=3&gap=8&targetFnKey=power
```

- `size` 对应 `LEVELS.startSize`。
- `gap` 对应画布格子间距（像素）。
- `targetFnKey` 对应目标函数注册表键。

参数解析顺序：URL Query → 本地存储 → 代码默认值。

## 导入 / 导出流程（Web）

1. 设置面板位于画布下方，可调整画布尺寸、格子间隙、起始尺寸、是否累计分数与目标函数。
2. 点击“导出设置/进度（JSON）”会生成包含 `{ settings, progress, bestScore }` 的文本文件，可用于备份。
3. 点击“导入设置/进度（选择文件）”并选择上述 JSON 文件，可恢复设置、关卡进度与最佳分。
4. 导入成功后会覆盖当前本地存储，并自动重绘棋盘。

## 小程序端持久化

- 设置与进度分别存储在 `wx.setStorageSync` 的 `stage2048.mp.settings.v1` 与 `stage2048.mp.progress.v1` 键下。
- 最佳分独立存储在 `stage2048.mp.bestScore.v1`，并可通过“清空最佳分”按钮清除。
- “重置进度”按钮会删除进度存档，并依据当前设置重新创建 `LevelManager`。

## 相关文件

- `/core/config.schema.md`：字段列表与载入优先级。
- `/web/main.mjs`：浏览器端设置读取、URL 覆盖、导入/导出实现。
- `/miniprogram/pages/index/index.js`：小程序端设置同步与按钮操作逻辑。
