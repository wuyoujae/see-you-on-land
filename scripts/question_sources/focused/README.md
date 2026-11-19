# 专项练习题源与构建

这些是与历年真题分开的非真题练习。现有真题编号、试卷、作答记录及 3,810 题统计保持独立。

| 专项 | 题量 | 内容 |
| --- | ---: | --- |
| 数字规律 | 120 | 84 道数列、36 道数字图阵，10 个模块 |
| 图形推理 | 144 | 120 道原创图推、24 道 OMIB 开放矩阵改编，16 个模块 |
| 资料速算 | 180 | 加减拆分、速算乘法、百分数运算、除法估算、基期量、增长量、比重与平均数，7 个模块 |

`*.reviewed.json` 保存完整题目、解析、难度和逐题校验证据；浏览器文件由 `scripts/build_focused_practice.py` 生成。题干、选项、答案必须独立核验通过，构建器才会发布。题量由实际题目计算。改变题目内容时会改变 revision，使 AI 解析缓存重新生成。

## 题源与许可

数字规律、资料速算及 `focus-figure-*` 均为本项目原创练习；教学资料仅用于核对考点与方法，未复制商业机构的题干、图片或解析。来源和核验说明见各目录的 `sources.json` / `AUDIT.md`。

`focus-omib-*` 改编自 Koch、Spinath、Greiff、Becker（2022）的 [Open Matrices Item Bank](https://osf.io/4km79/)。作者在[论文摘要](https://pmc.ncbi.nlm.nih.gov/articles/PMC9326670/)明确题库使用 GPLv3；不能将论文的 CC BY 许可替代题库许可。原矩阵和原答案保留，四选一干扰项与中文解析由本项目编写。这些改编内容及对应源文件沿用 GPLv3；完整署名、许可、原图、原答案表、可编辑 SVG 和改编脚本见 [omib](omib/README.md)。本说明不改变网站其他独立内容的许可。网页解析区提供原始来源、许可和对应源码链接。

## 复核与发布

在仓库根目录运行：

```text
python -X utf8 scripts/question_sources/focused/numbers/verify.py
python -X utf8 scripts/question_sources/focused/figures/verify.py
python -X utf8 scripts/question_sources/focused/omib/verify.py
python -X utf8 scripts/question_sources/focused/calculation/verify.py
python -X utf8 scripts/build_focused_practice.py
python -X utf8 scripts/build_focused_practice.py --check
```

数字规则以精确有理数核验全部已知项和候选值，并筛查常见替代规则。有限数列和图形的唯一性指常见规则族与给定选项下的唯一性，不声称排除人为构造的任意规律。图推独立几何求解器复核实际线段、区域、坐标变换和全部选项，所有题图还经过完整视觉审阅。图形验算需要 Pillow；重新渲染原创图推另需 CairoSVG，OMIB 复现依赖见其 README。线上构建无需这些渲染依赖。

浏览器仅发布 `data/question-bank/practice/*.json`、引用的 PNG 和许可通知；内部审阅拼图、校验证据、生成器及下载原件不进入 Pages 资源包。源码在本公开仓库提供。数字与图形练习支持模块、难度筛选；资料速算只呈现算式并填写结果，明示精度，提交后提供速算步骤及精确复核。四选一候选仅保留在作者核验数据中，运行时不发布选项。百分数可填写数值部分或带 %，数值等价的 12 / 12.0 不会误判。

速算计时记录当前可见页面中未提交题目的作答时间，提交后冻结、页面隐藏时暂停；刷新与跳题保留已记录时间。每轮结果展示正确率及已提交题目的平均用时，不包含解析阅读时间。计时数据兼容原有备份及恢复格式。
