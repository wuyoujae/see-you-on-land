# OMIB 四选一专项候选

24 道开放题库改编；14 standard、10 challenge。仅使用官方 Item Data 表中有完整原键的正式题，不使用六道缺少本表答案的锚题。正式题 source ID 与候选 ID 的映射在 candidates.json 的 verification 字段中。

- candidates.json：完整候选，含原题 ID、原键、四选项编码、分组规则、中文原创解析及来源。
- assets/images/question-bank/focused/：120 张 PNG；题干 640×640，独立选项 208×208，即原设计尺寸的 2 倍。
- adapted-svg/：PNG 对应的可编辑源 SVG；题干只增加问号和不透明白底。
- original-source/：原 SVG、20 个原构造部件、官方 XLSX、原下载 ZIP、哈希与说明。
- GPL-3.0.txt、ATTRIBUTION.md、license-evidence.json：许可、归属、改编说明及作者许可声明的原始 URL。
- verification-results.json：所有题计算及图像唯一性检查。
- review/：六张审阅拼图；拼图带答案标签，仅供内部核查，不作为发布题图。
- visual-review.json：全部 24 道题的目视复核记录。
- SHA256SUMS.json：最终文件指纹（不包含它自己）。

## 复现

所有脚本都是本次独立编写，不执行上游下载的代码。需要 Python 的 openpyxl/Pillow，以及 Node.js 的 sharp；Windows 默认字体仅用于内部审阅拼图。

```text
python -X utf8 build_omib_adapted.py
node render.cjs
python -X utf8 verify.py
```

render.cjs 首选正常的 `require('sharp')`，可以通过 OMIB_SHARP_PATH 指向已有的 sharp 模块。源码 ZIP 只供保存来源与复现，无需运行其内容。所有文件路径相对本目录；移动整个目录后仍可重建。

这里提供的是专项练习改编。正确答案来自官方 20 位答案键；四选一干扰项、中文解析、标签由本项目编写。四选一形式与原研究的构造答案形式不同，未重新标定心理测量参数。
