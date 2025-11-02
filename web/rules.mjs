// 定义存储键常量，保持与主页面一致便于共享设置
const STORE_KEY = 'stage2048.settings.v2';
// 定义默认配置常量，覆盖画布、动画、插件与 LEVELS 结构
const DEFAULT_SETTINGS = Object.freeze({
  // 画布尺寸默认 480 像素
  canvasSize: 480,
  // 默认格子间隙为 12 像素
  gap: 12,
  // 默认关闭动画
  animate: false,
  // 默认随机种子为空字符串
  seed: '',
  // 默认无插件启用
  pluginNames: [],
  // LEVELS 配置包含起始尺寸、累计分数、目标函数与随机权重映射
  LEVELS: {
    // 默认起始尺寸 2×2
    startSize: 2,
    // 默认累计总分
    carryScore: true,
    // 默认目标函数为 power（2 的幂）
    targetFnKey: 'power',
    // 默认只对 4×4 配置 2 与 4 的生成概率
    randomTileWeightsBySize: {
      // 4×4 棋盘时的概率分布
      4: { 2: 0.9, 4: 0.1 }
    }
  }
});
// 约定概率校验误差允许范围，避免浮点误差导致失败
const PROBABILITY_TOLERANCE = 0.001;
// 记录页面需要访问的核心 DOM 元素，便于后续使用
const els = {
  // 画布尺寸输入框引用
  canvasSize: document.getElementById('input-canvas-size'),
  // 间隙输入框引用
  gap: document.getElementById('input-gap'),
  // 动画复选框引用
  animate: document.getElementById('input-animate'),
  // 随机种子输入框引用
  seed: document.getElementById('input-seed'),
  // 起始尺寸输入框引用
  startSize: document.getElementById('input-start-size'),
  // 累计总分复选框引用
  carryScore: document.getElementById('input-carry-score'),
  // 目标函数下拉框引用
  targetFn: document.getElementById('input-target-fn'),
  // 插件多选框引用
  plugins: document.getElementById('input-plugins'),
  // 插件提示文本引用
  pluginHint: document.getElementById('plugin-hint'),
  // 随机权重容器引用
  weightsContainer: document.getElementById('weights-container'),
  // 新增尺寸按钮引用
  addSizeButton: document.getElementById('btn-add-size'),
  // 导出按钮引用
  exportButton: document.getElementById('btn-export'),
  // 导入文件输入引用
  importInput: document.getElementById('input-import'),
  // 应用到游戏按钮引用
  applyButton: document.getElementById('btn-apply'),
  // 错误列表容器引用
  errorList: document.getElementById('error-list')
};
// 记录插件名列表，默认空数组，加载后填充
let pluginNames = [];
// 记录当前正在编辑的设置副本，初始化时会深拷贝默认配置
let currentSettings = cloneSettings(DEFAULT_SETTINGS);
// 在初始化时尝试加载的 i18n 模块缓存，若不存在则保持 null
let i18nModule = null;
// 初始化流程采用立即执行的异步函数，确保能使用 await
(async function init() {
  // 在初始化阶段尝试读取本地存储中的设置
  const storedSettings = loadStoredSettings();
  // 将读取到的设置与默认值合并，得到当前编辑对象
  currentSettings = mergeSettings(DEFAULT_SETTINGS, storedSettings);
  // 尝试加载插件注册表，若不存在则记录日志并保持空数组
  pluginNames = await loadPluginNames();
  // 根据插件列表更新下拉选项
  populatePluginOptions(pluginNames, currentSettings.pluginNames);
  // 尝试加载 i18n 模块，若不可用则按中文文案继续
  i18nModule = await tryLoadI18n();
  // 将当前设置渲染到表单控件中
  renderSettings(currentSettings);
  // 清空错误列表，确保初始状态干净
  displayErrors([]);
  // 绑定所有用户交互事件
  bindEventListeners();
})();
// 深拷贝设置对象，避免引用同一对象导致相互影响
function cloneSettings(source) {
  // 若来源为空则返回默认结构的拷贝
  if (!source) return cloneSettings(DEFAULT_SETTINGS);
  // 构造顶层对象副本
  const copy = {
    canvasSize: Number(source.canvasSize) || 0,
    gap: Number(source.gap) || 0,
    animate: Boolean(source.animate),
    seed: typeof source.seed === 'string' ? source.seed : (source.seed == null ? '' : String(source.seed)),
    pluginNames: Array.isArray(source.pluginNames) ? [...source.pluginNames] : [],
    LEVELS: {
      startSize: Number(source.LEVELS?.startSize) || 0,
      carryScore: Boolean(source.LEVELS?.carryScore),
      targetFnKey: typeof source.LEVELS?.targetFnKey === 'string' ? source.LEVELS.targetFnKey : 'power',
      randomTileWeightsBySize: {}
    }
  };
  // 遍历随机权重映射并逐项拷贝
  const map = source.LEVELS?.randomTileWeightsBySize;
  if (map && typeof map === 'object') {
    for (const sizeKey of Object.keys(map)) {
      const inner = map[sizeKey];
      if (!inner || typeof inner !== 'object') continue;
      const sizeCopy = {};
      for (const valueKey of Object.keys(inner)) {
        const prob = Number(inner[valueKey]);
        if (!Number.isFinite(prob)) continue;
        sizeCopy[valueKey] = prob;
      }
      copy.LEVELS.randomTileWeightsBySize[sizeKey] = sizeCopy;
    }
  }
  // 返回构造好的深拷贝结果
  return copy;
}
// 将存储中的设置与默认设置合并，缺失字段回退默认值
function mergeSettings(defaults, stored) {
  // 从默认值创建一个新对象，避免修改常量
  const merged = cloneSettings(defaults);
  // 若没有存储数据直接返回默认副本
  if (!stored) return merged;
  // 对顶层简单字段进行覆盖
  if (Number.isFinite(Number(stored.canvasSize))) merged.canvasSize = Number(stored.canvasSize);
  if (Number.isFinite(Number(stored.gap))) merged.gap = Number(stored.gap);
  if (typeof stored.animate === 'boolean') merged.animate = stored.animate;
  if (stored.seed != null) merged.seed = String(stored.seed);
  if (Array.isArray(stored.pluginNames)) merged.pluginNames = stored.pluginNames.filter((name) => typeof name === 'string');
  // 处理 LEVELS 嵌套对象
  if (stored.LEVELS && typeof stored.LEVELS === 'object') {
    if (Number.isFinite(Number(stored.LEVELS.startSize))) merged.LEVELS.startSize = Number(stored.LEVELS.startSize);
    if (typeof stored.LEVELS.carryScore === 'boolean') merged.LEVELS.carryScore = stored.LEVELS.carryScore;
    if (typeof stored.LEVELS.targetFnKey === 'string') merged.LEVELS.targetFnKey = stored.LEVELS.targetFnKey;
    if (stored.LEVELS.randomTileWeightsBySize && typeof stored.LEVELS.randomTileWeightsBySize === 'object') {
      merged.LEVELS.randomTileWeightsBySize = {};
      for (const sizeKey of Object.keys(stored.LEVELS.randomTileWeightsBySize)) {
        const rawSize = stored.LEVELS.randomTileWeightsBySize[sizeKey];
        if (!rawSize || typeof rawSize !== 'object') continue;
        const normalized = {};
        for (const valueKey of Object.keys(rawSize)) {
          const prob = Number(rawSize[valueKey]);
          if (!Number.isFinite(prob)) continue;
          normalized[valueKey] = prob;
        }
        merged.LEVELS.randomTileWeightsBySize[sizeKey] = normalized;
      }
    }
  }
  // 返回合并后的结果
  return merged;
}
// 尝试从 localStorage 读取设置，解析失败时返回 null
function loadStoredSettings() {
  // 从 localStorage 读取字符串
  const raw = window.localStorage.getItem(STORE_KEY);
  // 若不存在直接返回 null
  if (!raw) return null;
  try {
    // 尝试解析 JSON 字符串
    const parsed = JSON.parse(raw);
    // 若解析出的值是对象则返回，否则返回 null
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    // 捕获异常后在控制台记录错误，返回 null 继续使用默认值
    console.error('解析已保存设置失败，使用默认值继续：', err);
    return null;
  }
}
// 动态加载插件注册表，失败时输出提醒并返回空数组
async function loadPluginNames() {
  try {
    // 尝试导入插件注册表模块
    const mod = await import('../plugins/registry.esm.js');
    // 安全访问 PluginRegistry.list 方法
    const listFn = mod?.PluginRegistry?.list;
    // 若存在 list 方法则调用并提取 name 字段
    if (typeof listFn === 'function') {
      const list = listFn.call(mod.PluginRegistry);
      // 确保返回数组并过滤出字符串名称
      if (Array.isArray(list)) {
        return list.map((item) => item?.name).filter((name) => typeof name === 'string');
      }
    }
    // 若未获取到有效列表则返回空数组
    return [];
  } catch (err) {
    // 插件模块缺失或加载失败时输出提示并返回空数组
    console.info('插件/i18n 未发现，按空集或中文回退处理');
    return [];
  }
}
// 尝试加载 i18n 模块，若失败则返回 null 并记录日志
async function tryLoadI18n() {
  try {
    // 导入 i18n 模块以便未来扩展多语言能力
    const mod = await import('../i18n/i18n.esm.js');
    // 返回模块供后续使用
    return mod || null;
  } catch (err) {
    // 如未找到模块则输出提醒（与插件共用提示文案）
    console.info('插件/i18n 未发现，按空集或中文回退处理');
    return null;
  }
}
// 根据插件列表更新多选框选项并标记选中项
function populatePluginOptions(options, selectedNames) {
  // 若没有传入数组则使用空数组，确保逻辑健壮
  const list = Array.isArray(options) ? options : [];
  // 清空原有选项以便重新渲染
  els.plugins.innerHTML = '';
  // 遍历插件列表生成选项
  for (const name of list) {
    // 创建 option 元素并写入名称
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    // 若当前名称在已选列表中则标记选中
    if (selectedNames?.includes(name)) option.selected = true;
    // 将选项插入多选框
    els.plugins.appendChild(option);
  }
  // 若已有设置中的插件不在注册表里，则补充不可用选项提醒
  if (Array.isArray(selectedNames)) {
    for (const name of selectedNames) {
      if (!list.includes(name)) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = `${name}（未在注册表中发现）`;
        option.selected = true;
        els.plugins.appendChild(option);
      }
    }
  }
  // 根据是否存在选项决定下拉框是否禁用以及提示文案
  if (els.plugins.options.length === 0) {
    els.plugins.disabled = true;
    els.pluginHint.style.display = 'block';
  } else {
    els.plugins.disabled = false;
    els.pluginHint.style.display = 'none';
  }
}
// 将当前设置渲染到各个表单控件
function renderSettings(settings) {
  // 将画布尺寸写入输入框
  els.canvasSize.value = settings.canvasSize;
  // 将间隙写入输入框
  els.gap.value = settings.gap;
  // 设置动画复选框的勾选状态
  els.animate.checked = Boolean(settings.animate);
  // 设置随机种子输入框内容
  els.seed.value = settings.seed || '';
  // 设置起始尺寸输入框数值
  els.startSize.value = settings.LEVELS.startSize;
  // 设置累计总分复选框状态
  els.carryScore.checked = Boolean(settings.LEVELS.carryScore);
  // 设置目标函数下拉选中项
  els.targetFn.value = settings.LEVELS.targetFnKey;
  // 更新插件选项的选中状态
  populatePluginOptions(pluginNames, settings.pluginNames);
  // 渲染随机权重编辑表
  renderRandomWeights(settings.LEVELS.randomTileWeightsBySize);
}
// 渲染随机权重编辑列表，将传入的映射转换为多个尺寸块
function renderRandomWeights(weightMap) {
  // 清空容器中的既有元素
  els.weightsContainer.innerHTML = '';
  // 确保传入对象存在，否则使用空对象
  const entries = weightMap && typeof weightMap === 'object' ? weightMap : {};
  // 对尺寸键按照数值排序后渲染
  const sizeKeys = Object.keys(entries).sort((a, b) => Number(a) - Number(b));
  // 若映射为空则也添加一个默认尺寸以便编辑
  if (sizeKeys.length === 0) {
    const block = createSizeBlock(4, [{ value: 2, probability: 1 }]);
    els.weightsContainer.appendChild(block);
    updateSizeSumTip(block);
    return;
  }
  // 遍历尺寸键创建对应的尺寸块
  for (const key of sizeKeys) {
    const size = Number(key);
    const rawEntries = entries[key];
    // 将内部映射转换为数组结构便于创建行
    const pairs = [];
    if (rawEntries && typeof rawEntries === 'object') {
      for (const valueKey of Object.keys(rawEntries)) {
        pairs.push({ value: Number(valueKey), probability: Number(rawEntries[valueKey]) });
      }
    }
    // 若未读取到权重项则提供默认行
    if (pairs.length === 0) pairs.push({ value: 2, probability: 1 });
    // 创建尺寸块并插入容器
    const block = createSizeBlock(Number.isFinite(size) ? size : 4, pairs);
    els.weightsContainer.appendChild(block);
    // 渲染完毕后更新当前尺寸的概率和提示
    updateSizeSumTip(block);
  }
}
// 创建单个尺寸块 DOM 结构，包含尺寸输入、权重表和操作按钮
function createSizeBlock(size, entries) {
  // 创建尺寸块根容器
  const block = document.createElement('div');
  block.className = 'size-block';
  // 创建头部容器
  const header = document.createElement('div');
  header.className = 'size-header';
  // 创建尺寸标签
  const sizeLabel = document.createElement('span');
  sizeLabel.textContent = '棋盘尺寸';
  // 创建尺寸输入框
  const sizeInput = document.createElement('input');
  sizeInput.type = 'number';
  sizeInput.className = 'input-size';
  sizeInput.min = '2';
  sizeInput.max = '10';
  sizeInput.step = '1';
  sizeInput.value = Number.isFinite(size) ? size : 4;
  // 创建删除尺寸按钮
  const removeSizeButton = document.createElement('button');
  removeSizeButton.type = 'button';
  removeSizeButton.className = 'btn-remove-size';
  removeSizeButton.textContent = '删除尺寸';
  // 将头部元素组装进容器
  header.appendChild(sizeLabel);
  header.appendChild(sizeInput);
  header.appendChild(removeSizeButton);
  // 创建权重表格与表头
  const table = document.createElement('table');
  table.className = 'weight-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const thValue = document.createElement('th');
  thValue.textContent = '方块数值';
  const thProb = document.createElement('th');
  thProb.textContent = '概率 (0,1]';
  const thOps = document.createElement('th');
  thOps.textContent = '操作';
  headRow.appendChild(thValue);
  headRow.appendChild(thProb);
  headRow.appendChild(thOps);
  thead.appendChild(headRow);
  const tbody = document.createElement('tbody');
  // 根据 entries 创建多行权重项
  for (const item of entries) {
    const row = createWeightRow(item.value, item.probability);
    tbody.appendChild(row);
  }
  // 创建新增权重项按钮
  const addWeightButton = document.createElement('button');
  addWeightButton.type = 'button';
  addWeightButton.className = 'btn-add-weight';
  addWeightButton.textContent = '新增权重项';
  // 创建概率和提示元素
  const sumTip = document.createElement('div');
  sumTip.className = 'sum-tip';
  sumTip.textContent = '当前概率和：0.000';
  // 将结构装配到尺寸块
  table.appendChild(thead);
  table.appendChild(tbody);
  block.appendChild(header);
  block.appendChild(table);
  block.appendChild(addWeightButton);
  block.appendChild(sumTip);
  // 返回构建完成的尺寸块
  return block;
}
// 创建单行权重项，包含值输入、概率输入与删除按钮
function createWeightRow(value, probability) {
  const row = document.createElement('tr');
  const cellValue = document.createElement('td');
  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.className = 'input-weight-value';
  valueInput.value = value != null ? String(value) : '';
  cellValue.appendChild(valueInput);
  const cellProb = document.createElement('td');
  const probInput = document.createElement('input');
  probInput.type = 'number';
  probInput.className = 'input-weight-prob';
  probInput.min = '0';
  probInput.max = '1';
  probInput.step = '0.001';
  probInput.value = Number.isFinite(Number(probability)) ? Number(probability) : '';
  cellProb.appendChild(probInput);
  const cellOps = document.createElement('td');
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'btn-remove-weight';
  removeButton.textContent = '删除';
  cellOps.appendChild(removeButton);
  row.appendChild(cellValue);
  row.appendChild(cellProb);
  row.appendChild(cellOps);
  return row;
}
// 更新某个尺寸块的概率和提示文字与颜色
function updateSizeSumTip(block) {
  // 定位尺寸块内的所有概率输入框
  const probInputs = block.querySelectorAll('.input-weight-prob');
  // 累计有效概率值
  let sum = 0;
  for (const input of probInputs) {
    const value = Number(input.value);
    if (Number.isFinite(value)) sum += value;
  }
  // 根据概率和生成提示文本
  const tip = block.querySelector('.sum-tip');
  if (!tip) return;
  tip.textContent = `当前概率和：${sum.toFixed(3)}`;
  // 根据误差范围调整颜色提示
  if (Math.abs(sum - 1) <= PROBABILITY_TOLERANCE) {
    tip.style.color = '#2f855a';
  } else {
    tip.style.color = '#b36b00';
  }
}
// 绑定页面中所有需要的交互事件
function bindEventListeners() {
  // 监听新增尺寸按钮点击事件
  els.addSizeButton.addEventListener('click', () => {
    addNewSizeBlock();
    displayErrors([]);
  });
  // 监听随机权重容器的点击事件，实现事件委派
  els.weightsContainer.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.classList.contains('btn-remove-size')) {
      const block = target.closest('.size-block');
      if (block) {
        block.remove();
        displayErrors([]);
      }
    } else if (target.classList.contains('btn-add-weight')) {
      const block = target.closest('.size-block');
      if (block) {
        const tbody = block.querySelector('tbody');
        if (tbody) {
          tbody.appendChild(createWeightRow(2, 0.5));
          updateSizeSumTip(block);
          displayErrors([]);
        }
      }
    } else if (target.classList.contains('btn-remove-weight')) {
      const row = target.closest('tr');
      const block = target.closest('.size-block');
      if (row && block) {
        row.remove();
        updateSizeSumTip(block);
        displayErrors([]);
      }
    }
  });
  // 监听随机权重容器的输入事件，实时更新概率和提示
  els.weightsContainer.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const block = target.closest('.size-block');
    if (block) {
      updateSizeSumTip(block);
    }
  });
  // 监听导出按钮点击事件
  els.exportButton.addEventListener('click', () => {
    const { settings, errors } = collectSettingsFromForm();
    if (errors.length > 0) {
      displayErrors(errors);
      return;
    }
    displayErrors([]);
    exportSettings(settings);
  });
  // 监听导入文件选择事件
  els.importInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const { settings, errors } = validateAndNormalizeSettings(parsed);
      if (errors.length > 0) {
        displayErrors(errors);
      } else {
        currentSettings = settings;
        renderSettings(settings);
        displayErrors([]);
      }
    } catch (err) {
      displayErrors(['导入失败：无法解析 JSON 文件']);
      console.error('导入规则时解析失败：', err);
    } finally {
      event.target.value = '';
    }
  });
  // 监听应用按钮点击事件
  els.applyButton.addEventListener('click', () => {
    const { settings, errors } = collectSettingsFromForm();
    if (errors.length > 0) {
      displayErrors(errors);
      return;
    }
    displayErrors([]);
    window.localStorage.setItem(STORE_KEY, JSON.stringify(settings));
    currentSettings = settings;
    const shouldBack = window.confirm('设置已保存。是否立即返回主页面生效？\n提示：新规则可能需要在主页面重置进度。');
    if (shouldBack) {
      window.location.href = './index.html';
    }
  });
}
// 新增一个尺寸块，选择尚未使用的尺寸值并附带默认权重
function addNewSizeBlock() {
  const existingSizes = Array.from(els.weightsContainer.querySelectorAll('.size-block .input-size'))
    .map((input) => Number(input.value))
    .filter((value) => Number.isInteger(value));
  let candidate = 4;
  for (let size = 2; size <= 10; size += 1) {
    if (!existingSizes.includes(size)) {
      candidate = size;
      break;
    }
  }
  const block = createSizeBlock(candidate, [{ value: 2, probability: 1 }]);
  els.weightsContainer.appendChild(block);
  updateSizeSumTip(block);
}
// 从表单控件读取数据并执行校验，返回设置对象与错误列表
function collectSettingsFromForm() {
  const raw = buildRawSettingsFromDom();
  return validateAndNormalizeSettings(raw);
}
// 将 DOM 中的表单值组装成原始对象，稍后交由校验函数处理
function buildRawSettingsFromDom() {
  const rawWeights = {};
  const blocks = els.weightsContainer.querySelectorAll('.size-block');
  blocks.forEach((block) => {
    const sizeInput = block.querySelector('.input-size');
    const sizeValue = sizeInput ? sizeInput.value : '';
    const rows = block.querySelectorAll('tbody tr');
    const rowList = [];
    rows.forEach((row) => {
      const valueInput = row.querySelector('.input-weight-value');
      const probInput = row.querySelector('.input-weight-prob');
      rowList.push({
        value: valueInput ? valueInput.value : '',
        probability: probInput ? probInput.value : ''
      });
    });
    rawWeights[sizeValue] = rowList;
  });
  const raw = {
    canvasSize: els.canvasSize.value,
    gap: els.gap.value,
    animate: els.animate.checked,
    seed: els.seed.value,
    pluginNames: Array.from(els.plugins.selectedOptions).map((opt) => opt.value),
    LEVELS: {
      startSize: els.startSize.value,
      carryScore: els.carryScore.checked,
      targetFnKey: els.targetFn.value,
      randomTileWeightsBySize: rawWeights
    }
  };
  return raw;
}
// 校验并规范化设置对象，返回合法的设置副本与错误数组
function validateAndNormalizeSettings(raw) {
  const errors = [];
  const settings = cloneSettings(DEFAULT_SETTINGS);
  // 校验画布尺寸
  const canvasSize = Number(raw?.canvasSize);
  if (Number.isFinite(canvasSize) && canvasSize >= 200 && canvasSize <= 1024) {
    settings.canvasSize = Math.round(canvasSize);
  } else {
    errors.push('画布尺寸必须在 200 到 1024 之间');
  }
  // 校验格子间隙
  const gap = Number(raw?.gap);
  if (Number.isFinite(gap) && gap >= 0 && gap <= 48) {
    settings.gap = Math.round(gap);
  } else {
    errors.push('格子间隙必须在 0 到 48 之间');
  }
  // 解析动画开关
  settings.animate = Boolean(raw?.animate);
  // 解析随机种子，允许空字符串
  settings.seed = typeof raw?.seed === 'string' ? raw.seed : (raw?.seed == null ? '' : String(raw.seed));
  // 解析插件名称数组
  if (Array.isArray(raw?.pluginNames)) {
    settings.pluginNames = raw.pluginNames.filter((name) => typeof name === 'string' && name.length > 0);
  } else {
    settings.pluginNames = [];
  }
  // 校验 LEVELS 起始尺寸
  const startSize = Number(raw?.LEVELS?.startSize);
  if (Number.isInteger(startSize) && startSize >= 2 && startSize <= 10) {
    settings.LEVELS.startSize = startSize;
  } else {
    errors.push('起始棋盘尺寸必须是 2 到 10 的整数');
  }
  // 解析累计总分开关
  settings.LEVELS.carryScore = Boolean(raw?.LEVELS?.carryScore);
  // 解析目标函数键
  if (typeof raw?.LEVELS?.targetFnKey === 'string') {
    settings.LEVELS.targetFnKey = raw.LEVELS.targetFnKey;
  } else {
    settings.LEVELS.targetFnKey = DEFAULT_SETTINGS.LEVELS.targetFnKey;
  }
  // 校验随机权重映射
  const map = raw?.LEVELS?.randomTileWeightsBySize;
  const normalized = {};
  if (map && typeof map === 'object') {
    for (const sizeKey of Object.keys(map)) {
      const sizeNum = Number(sizeKey);
      if (!Number.isInteger(sizeNum) || sizeNum < 2 || sizeNum > 10) {
        errors.push(`尺寸 ${sizeKey} 必须是 2 到 10 的整数`);
        continue;
      }
      const entries = map[sizeKey];
      if (!Array.isArray(entries) && typeof entries !== 'object') {
        errors.push(`尺寸 ${sizeKey} 的权重必须是对象或数组`);
        continue;
      }
      const pairs = [];
      const iterable = Array.isArray(entries) ? entries : Object.entries(entries).map(([value, probability]) => ({ value, probability }));
      iterable.forEach((item) => {
        const valueNum = Number(item?.value ?? item?.[0]);
        const probNum = Number(item?.probability ?? item?.[1]);
        if (!Number.isFinite(valueNum)) {
          errors.push(`尺寸 ${sizeKey} 存在无法解析的数值键`);
          return;
        }
        if (!Number.isFinite(probNum) || probNum <= 0 || probNum > 1) {
          errors.push(`尺寸 ${sizeKey} 的概率必须在 (0,1] 区间`);
          return;
        }
        pairs.push({ value: valueNum, probability: probNum });
      });
      if (pairs.length === 0) {
        errors.push(`尺寸 ${sizeKey} 至少需要一条权重项`);
        continue;
      }
      const sum = pairs.reduce((acc, item) => acc + item.probability, 0);
      if (Math.abs(sum - 1) > PROBABILITY_TOLERANCE) {
        errors.push(`尺寸 ${sizeKey} 的概率和为 ${sum.toFixed(3)}，未在允许误差范围内`);
      }
      pairs.sort((a, b) => a.value - b.value);
      normalized[sizeNum] = {};
      pairs.forEach((item) => {
        normalized[sizeNum][item.value] = item.probability;
      });
    }
  } else {
    errors.push('随机权重映射不可为空');
  }
  settings.LEVELS.randomTileWeightsBySize = normalized;
  return { settings, errors };
}
// 将设置对象导出为 JSON 文件并触发下载
function exportSettings(settings) {
  const filename = buildExportFilename();
  const data = JSON.stringify(settings, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
// 根据当前时间生成导出文件名
function buildExportFilename() {
  const now = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `rules-${yyyy}${mm}${dd}-${hh}${mi}${ss}.json`;
}
// 将校验错误渲染到错误列表容器中
function displayErrors(errors) {
  els.errorList.innerHTML = '';
  if (!errors || errors.length === 0) return;
  for (const message of errors) {
    const li = document.createElement('li');
    li.textContent = message;
    els.errorList.appendChild(li);
  }
}
