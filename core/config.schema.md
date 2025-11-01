# Stage2048 配置架构说明

> 本文件定义 Stage2048 在 Web 与小程序端共享的配置字段、载入优先级与默认值。所有字段均支持序列化，并可通过本轮新增的设置面板或本地存储覆盖。

| 字段 | 载入层级（优先高→低） | 位置 | 类型/示例 | 默认 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `startSize` | URL Query / 本地设置 / 代码默认 | LEVELS | number | 2 | 起始关卡尺寸（2 表示 2×2） |
| `carryScore` | URL Query / 本地设置 / 代码默认 | LEVELS | boolean | true | 是否在晋级时累计总分 |
| `randomTileWeightsBySize` | URL Query / 本地设置 / 代码默认 | LEVELS | map | `{4:{2:0.9,4:0.1}}` | 按尺寸覆写新方块生成分布 |
| `gap` | URL Query / 本地设置 / 代码默认 | Web/小程序运行时 | number(px) | 12 | 格子间距（像素） |
| `canvasSize` | URL Query / 本地设置 / 代码默认 | Web | number(px) | 480 | 画布 CSS 尺寸（仅 Web 使用） |
| `targetFnKey` | URL Query / 本地设置 / 代码默认 | LEVELS | enum | `"power"` | 目标函数标识，对应注册表键 |
| `bestScore` | 本地存储 | Web/小程序 | number | 0 | 历史最佳分，按平台分别保存 |

> 说明：当 URL Query 指定 `size=3&gap=8` 时，将直接覆盖设置面板与本地存储中的值；未指定的字段会继续遵循“本地存储 → 默认配置”的回退策略。
