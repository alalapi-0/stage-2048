<!-- 文档标题，说明本文件描述 Stage2048 规则 JSON 结构 -->
# Stage2048 规则 JSON 规范
<!-- 简介段落，概述规则文件的用途 -->
Stage2048 的规则 JSON 描述了 Web 端游戏的外观、关卡逻辑与随机生成概率，用于在规则编辑器与主页面之间传递一致的 SETTINGS 配置。
<!-- 顶层结构小节标题，方便快速定位主要字段 -->
## 顶层结构
<!-- 段落说明顶层 JSON 对象包含的字段 -->
顶层对象包含以下键值，除标注可选外均应提供：
<!-- 画布尺寸字段说明 -->
- `canvasSize`：必填，画布 CSS 尺寸（像素），建议范围 [200,1024]。
<!-- 间隙字段说明 -->
- `gap`：必填，棋盘格子之间的间隙（像素）。
<!-- 动画开关字段说明 -->
- `animate`：必填，布尔值，表示是否启用淡入动画。
<!-- 种子字段说明 -->
- `seed`：必填，字符串，可为空，固定随机数生成器的起始种子。
<!-- 插件数组字段说明 -->
- `pluginNames`：可选，字符串数组，记录启用的插件标识。
<!-- LEVELS 字段简介 -->
- `LEVELS`：必填对象，包含关卡与随机生成的详细配置。
<!-- LEVELS 嵌套字段标题 -->
### LEVELS 字段
<!-- LEVELS.startSize 说明 -->
- `startSize`：必填整数，初始棋盘尺寸，范围 2~10。
<!-- LEVELS.carryScore 说明 -->
- `carryScore`：必填布尔值，决定是否跨关累计总分。
<!-- LEVELS.targetFnKey 说明 -->
- `targetFnKey`：必填字符串，目标函数键名（如 `power` 或 `fibonacci`）。
<!-- LEVELS.randomTileWeightsBySize 说明 -->
- `randomTileWeightsBySize`：必填对象，键为棋盘尺寸，值为权重映射。
<!-- 权重映射小节标题 -->
## 随机权重映射格式
<!-- 段落说明键类型与范围 -->
`randomTileWeightsBySize` 的每个键必须是字符串形式的整数（保存时会转换为数字键），表示棋盘尺寸，取值范围同样为 2~10。
<!-- 段落说明内部权重结构 -->
每个尺寸对应的值为一个对象，其键为生成的方块数值（允许字符串形式输入），值为概率权重，满足以下约束：
<!-- 约束列表第一条 -->
1. 每项概率必须在 (0,1] 范围内。
<!-- 约束列表第二条 -->
2. 同一尺寸下所有概率之和需在 1±0.001 的容差范围内。
<!-- 约束列表第三条 -->
3. 至少提供一项权重数据。
<!-- 段落说明编辑器校验策略 -->
规则编辑器会在导入、导出与应用时校验上述约束，并在保存到 localStorage 前保持用户输入的原始顺序，仅在展示时按数值排序。
<!-- 默认值示例标题 -->
## 默认值示例
<!-- 段落说明默认配置用途 -->
默认配置对应项目内置的经典 4×4 规则，方便快速恢复基础体验：
<!-- 默认配置代码块说明 -->
```json
{
  "canvasSize": 480,
  "gap": 12,
  "animate": false,
  "seed": "",
  "pluginNames": [],
  "LEVELS": {
    "startSize": 2,
    "carryScore": true,
    "targetFnKey": "power",
    "randomTileWeightsBySize": {
      "4": { "2": 0.9, "4": 0.1 }
    }
  }
}
```
<!-- 最小可用示例标题 -->
## 最小可用示例
<!-- 段落说明示例用途 -->
以下示例展示最小 2×2 棋盘，仅生成数字 1，适用于调试：
<!-- 最小示例代码块 -->
```json
{
  "canvasSize": 300,
  "gap": 8,
  "animate": false,
  "seed": "test",
  "pluginNames": [],
  "LEVELS": {
    "startSize": 2,
    "carryScore": false,
    "targetFnKey": "power",
    "randomTileWeightsBySize": {
      "2": { "1": 1 }
    }
  }
}
```
<!-- 经典分布示例标题 -->
## 4×4 经典分布示例
<!-- 段落说明该示例用于参考 -->
下列示例延续 4×4 棋盘常见的 90% 生成 2、10% 生成 4 的分布：
<!-- 经典示例代码块 -->
```json
{
  "canvasSize": 480,
  "gap": 12,
  "animate": true,
  "seed": "",
  "pluginNames": ["demo-plugin"],
  "LEVELS": {
    "startSize": 4,
    "carryScore": true,
    "targetFnKey": "fibonacci",
    "randomTileWeightsBySize": {
      "4": { "2": 0.9, "4": 0.1 }
    }
  }
}
```
<!-- 结尾说明 -->
如需扩展更多尺寸，只需在 `randomTileWeightsBySize` 中添加对应尺寸的概率表，并确保满足上述校验条件。
