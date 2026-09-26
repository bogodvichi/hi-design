# HUI Usage

海康 HUI 企业级安防设计系统 —— Open Design 包使用指南(供 agent 与评审阅读)。

## Read Order

1. 先读本文件,了解包契约与双层 token 结构。
2. 读 `DESIGN.md`,理解视觉基调、色彩/字体规则、组件与文案规范、反模式。
3. 把 `tokens.css` 的 `:root` 整块粘进首个 artifact 的 `<style>`,再写组件 CSS。
4. 用 `components.manifest.json` 查组件清单;需要精确选择器/状态时打开 `components.html`。
5. 图标见 `fonts/h-icon.css`(font-family `h-icon`,类名 `.h-icon-*`)。
6. 需要视觉抽查时看 `preview/` 三页(colors / typography / spacing)。

## Design Highlights

- 视觉基调:企业级、数据密集、克制专业的安防软件界面。
- 品牌主色:`--accent` = `#2080F7`(HUI 蓝);hover 变亮 `#50A2F9`,active 变暗 `#1461CC`。
- 中性色:文字用半透明黑(`rgba(0,0,0,.7/.5/.4)`),灰底白卡(`--bg` #F5F5F5 / `--surface` #FFF)。
- 圆角锐利(4/6/10),控件紧凑(默认高度 32px),字体默认微软雅黑。
- 双层 token:56 个 Open Design 契约 token(通用组件用)+ 完整 HUI 原生 `--h-*` token(海康组件用)。

## Do

- 复制 `:root` 时保持契约 token 名不变,跨品牌切换才可靠。
- 通用组件用契约 token(`--accent` 主色、`--focus-ring` 焦点、`--radius-sm` 控件圆角)。
- 海康专有语义用原生层 `--h-*`(如 `--h-color-core-brand-hover`、`--h-shadow-z2`、四级边框)。
- 主色仅用于主操作、选中、链接、焦点等关键信号,一屏克制使用。
- 文案遵循海康规范:按钮用动词、标签后不加冒号、提示用 `{操作}{对象}成功/失败。`、"暂无数据"不加句号、数字用阿拉伯数字、范围用 `~`、数字与单位间空格。

## Avoid

- 不要在复制的 `:root` 之外散写裸色值(hex/rgba)。
- 不要脱离 `tokens.css` 另行定义 Tailwind 或 design-token 值。
- 不要让通用跨品牌组件引用 `--h-*` 原生 token(它们是 HUI 专有)。
- 不要新增 `components.html` / `DESIGN.md` 未覆盖的组件配方。
- 文案不要出现代码标识符、内部/未知错误、专业术语缩写或人称代词("请您…")。
