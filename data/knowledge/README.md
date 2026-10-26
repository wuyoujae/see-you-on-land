# 常识思维导图知识库

本目录由 `scripts/import_knowledge.py` 从 `assets/xiaohei` 的 8 份原始 PDF 生成。原文件不作修改。浏览器只按需加载清单、当前页 JSON 和 WebP；SQLite 供后续服务端查询、维护和导出使用。

## 内容与坐标

- `manifest.json`：8 册的目录、页码、来源文件 SHA-256、页面和题目总数。
- `pages/<book-id>/<page-id>.json`：每页全部文字、来源块与行、字号、颜色、位置，以及彩色重点生成的填空。
- `pages/<book-id>/<page-id>.svg`：优先加载的矢量背景，原文字转为字形路径，放大保持清晰。只有出版水印进行了显示分辨率优化，知识表格/图示保留原始图像精度。
- `pages/<book-id>/<page-id>.webp`：原始思维导图的压缩背景，作为浏览器加载失败时的后备资源。
- `knowledge.sqlite`：`books`、`pages`、`text_blocks`、`text_nodes`、`questions`、`question_segments`、`raster_images` 和 `metadata` 表。
- `ocr/`：29 张嵌入图的原始本地 OCR 输出、置信度和可复用的视觉校正记录。
- `ocr-corrections.json`：默认重建优先读取的人工视觉校正，保留在本地知识源数据中。
- `import-report.json`：完整性核对、逐册统计、渲染参数和转换范围说明。

所有位置均为 PDF 点，以页面左上角为原点。`bbox` 始终为 `[x, y, width, height]`，与页面 `width` / `height` 使用相同坐标。`image` 指向 SVG，`imageFallback` 指向同一页 WebP；两种资源保持相同比例。`imagePixels` 提供 WebP 的实际像素大小。

题目 `segments` 逐一保存原字形片段。背景图中的答案应由题目位置上的输入框遮盖；提交后仍在同一位置切换自己的答案与标准答案。`answer` 来自原文；`aliases` 默认留空，没有生成推测的同义答案。`context` 保留同一行的黑色上下文，并隐藏所有彩色答案。

彩色判定基于原 PDF 的 RGB 饱和度；同一可视行内紧邻的彩色字形合并为一空。不同文字行分别成题，以免合并后遮住中间的黑色内容。页码、边缘出版标记不成题。保留全部原始文字块与位置，不推测原导图的语义父子关系。教材中的 D、G 等字母缩写保持原样。

原 PDF 含 29 张嵌入式知识图/表，采用本地 RapidOCR 补齐文字层，记录 `sourceKind=ocr`、`sourceImageId` 和置信度。表格可见网格线另转换成行列与单元格位置，合并单元格仍保留原图几何信息。这些图中的文字经视觉核对均为黑色，表头底色和图形线条的颜色不作为填空。每册最后的推广页标记为 `publisher-ad`，保留来源页面但不产生知识题目。OCR 低置信度行和已确认校正保存在导入报告中。

## 重新生成

在仓库根目录运行：

```powershell
python -m pip install -r requirements-knowledge.txt
python scripts/import_knowledge.py
```

可选 `--scale 1.75 --quality 90 --workers 4`。字体文字提取和所有 OCR 均在本地运行。生成过程会输出每册进度；只有全部 8 册完成后，清单 `complete` 才为 `true`，OCR 补齐后 `ocrComplete` 为 `true`。保存的视觉校正记录会在重新生成时复用。

已生成原生数据、只补入既有 OCR 结果时，可运行 `python scripts/import_knowledge.py --enrich-ocr tmp/pdfs/ocr-results`。仅排查原生 PDF 提取时可使用 `--skip-ocr`，但这不会补齐嵌入表格的文字层。

既有知识库只升级矢量背景时，运行 `python scripts/import_knowledge.py --upgrade-svg`，这会保留所有题目与坐标，并重建清单和 SQLite 的背景路径。
