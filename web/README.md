# Web 版本说明（含 Canvas 渲染与关卡 HUD）

> 本文件逐行使用中文描述，介绍如何在浏览器端运行 2048 关卡版，并说明可覆盖的配置项。

## 打开方法
1. 直接双击 `index.html` 或使用任意本地静态服务器访问 `web/index.html`，即可在浏览器中体验关卡模式。
2. 游戏支持键盘方向键与触摸滑动操作，桌面端与移动端均可完成数字合并。

## 参数覆盖示例
> 如需调整画布尺寸、间距或关卡参数，可在 `index.html` 的 `<head>` 部分新增如下脚本片段：

```html
<script>
  window.CANVAS_2048_CONFIG = {
    CANVAS_CSS_SIZE: 420,
    GAP: 10,
    LEVELS: { startSize: 2, carryScore: true, randomTileWeightsBySize: { 4: { 2: 0.9, 4: 0.1 } } }
  };
</script>
```

## 已知差异
- 不同浏览器对 `CanvasRenderingContext2D.measureText` 的上伸与下伸支持差异较大，本项目在缺失时使用比例近似，因此垂直居中可能存在像素级偏差。

## 故障排查
- 若发现画布模糊，请检查系统缩放比例与设备像素比；本项目会在窗口尺寸变化时重新计算画布大小并自动重绘。
