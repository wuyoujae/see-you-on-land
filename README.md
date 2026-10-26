# 时政学习应用

基于原生 HTML、CSS 和 JavaScript 的静态学习应用。

## 真题刷题

“做题学习”分为学习和做题。做题入口 `#/study` 读取2014—2026国考六大类真题，可按科目或完整套卷练习，题量为1至当前筛选全部题目。提交后在当前题目展开来源答案/解析和超级思维解析，手机上下排列，平板和电脑左右排列。正确答案标绿，错选标红；提交前不显示答案，提交后锁定作答。AI仅在当前题目提交后显示解析时生成，已开始的请求在翻页后继续，结果按题目内容、思路版本、模型和服务地址缓存。

新练习会话使用独立存储，刷新保留固定题序。来源答案、AI完整缓存、课程进度均纳入备份；历史导图与旧错题数据保留兼容导出，界面不再提供导图做题或自动错题调查。

题库覆盖、出处与参考分歧见 [题库说明](docs/question-bank.md)，AI接口见 [解析服务](docs/ai-explanation.md)。

## GitHub Actions 与 Pages

推送 `main` 后，工作流会运行离线课程、题库、AI状态和打包测试，再发布 GitHub Pages。定时任务保留原有整点频率；先补缺日、再刷新今天，只有实质内容变化才提交及部署。Pages产物只保留1天。

云端直接打包已审核的JSON和图片，不需要原PDF、视频、OCR、SQLite或AI密钥。`scripts/validate_pages_artifact.py` 检查完整白名单、JSON值一致、资源引用及1GB站点上限。当前产物约245MiB，单文件小于8MB，无需Git LFS。

```powershell
python scripts/assemble_static_site.py
python scripts/validate_pages_artifact.py
```

原PDF、视频、数据库、模型、临时笔记及生成包均保留本地，不进入Git。可选离线导入工具的依赖见 `requirements-knowledge.txt`，它不用于Actions发布；数量课可用已有reviewed源独立重建，其他视频课以已生成课程JSON作为发布输入。

## 本地运行

在项目根目录运行：

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

打开 <http://127.0.0.1:8000/>。必须从项目根目录提供静态文件。

## 目录

```text
index.html                 页面入口与应用结构
assets/
  css/                     字体、设计变量、页面与各功能模块样式
  js/                      应用入口及各功能模块
  fonts/                   本地字体文件
  xiaohei/                 原始思维导图 PDF，保留本地、不进入网站资源包
  vendor/cropper/           第三方图片裁剪组件及许可证
data/                      学习资料、时政数据、考试日期与错题分类
  knowledge/               结构化 SQLite、导图图片及按页 JSON
scripts/                   数据采集、导出、构建及 Windows 定时更新
docs/                      研究文档与学习资料源表格
tests/                     现有浏览器验证脚本
.github/workflows/         自动更新与 GitHub Pages 部署
```

`assets/js/app.js` 负责学习清单、时政内容和页面切换；其他脚本按计时、错题、搜索、备份、裁剪、导航、首页和做题划分。样式按字体、设计变量、基础页面、功能模块及响应布局依次加载。新增尺寸、字号和间距使用 `rem`，复用 `tokens.css` 中的 CSS 变量；第三方组件保留上游实现。

页面切换统一使用 `assets/js/page-transitions.js` 的 `PageTransitions.enter`，只在导航发生时调用，不用于流式回复或计时刷新；快速切换取消旧动画，并遵循系统的减少动态效果设置。搜题页的题型选择在右上角，输入区仅保留提问与图片操作；设置和会话记录共用底部滑入、滑出面板。搜题对话不调用录错工具，历史记录仍保留。

## 做题学习

学习与做题使用独立入口。学习课程按科目、题型和知识点展开，以知识卡和例题组成；例题提交后原地展开全部关联解析，下一页进入后续知识点或题目。旧解析卡链接和历史进度兼容保留。做题读取2014—2026国考真题库，支持按科目或套卷连续刷题。政治理论与常识判断使用普通题目卡。

学习进度、答题草稿和结果在浏览器保存并随备份合并恢复。数量关系新课以《王炎·27数量关系大满贯·讲义》为底层，包含15节349题，来源页码和必要原图可查看；5道有来源疑点的题可学习但不计分。其他课程和真题库维持原内容。详见 [讲义课程说明](docs/quantity-wy27.md)。

### 课程学习资料

言语理解、判断推理、数量关系和资料分析的运行时入口是 `data/courses/manifest.json`，每课内容单独保存在 `data/courses/lessons/*.json`。学习卡正文、题干与选项支持段落、标题、列表、公式、原题图片和表格；`assets/js/rich-content.js` 负责安全渲染，KaTeX 及 WOFF2 字体放在 `assets/vendor/katex/`，不依赖运行时 CDN。题目图片保存在 `assets/images/courses/`，保留原图比例并可打开大图。

公开构建只额外纳入课程 manifest 和 `lessons/` 下直接一级的 JSON，不会递归发布整个课程目录。审计报告、导入错误、原笔记、转写、原视频及 `tmp/` 均不属于网站资源。课程 JSON 的来源采用视频标识与时间段，或讲义名称、PDF物理页与印刷页，不放本机私人路径。完整内部追溯信息留在本地审计文件。

言语、判断和资料课程从本地笔记重新生成后，需接着执行图片挂接脚本，补回四张已核对的资料分析原板书图；它按稳定卡片 ID 定位，可重复执行，不增加卡片、不改变题目和来源元数据。带解题内容的图片只挂到对应解析卡。

```powershell
python scripts/build_course_curriculum.py
python scripts/attach_course_images.py
# 仅重建数量关系（无需原PDF或其他私有笔记）
python scripts/build_quantity_wy27.py
```

图片本身保存在公开资源目录并随源仓库保留，挂接脚本只读取这些图片，无须在发布源仓库放入原始视频或私人笔记。只打包已有课程 JSON 时，无须重新执行课程生成器。

课程相关验证：

```powershell
node --test tests/rich-content.cjs
python -m unittest discover -s tests -p "test_course_public_build.py"
python -m unittest discover -s tests -p "test_course_images.py"
```

首页“每日一个知识点”从政治、常识的完整原文陈述库随机抽取。每次新访问展示一条，同一轮读完前不重复；阅读记录独立于做题统计。`points.json` 提供完整题目索引，`daily-points.json` 提供去重后的可读陈述，`scripts/build_knowledge_points.py` 可单独重建，PDF 导入结束也会自动重建。

`assets/js/ui.js` 与 `assets/css/ui.css` 提供全站自定义下拉、日期时间、数值步进、确认弹窗和统一交互。原表单字段保留为状态源；文件和相机继续使用系统选择器。学习时钟支持专注/做题模式、今日累计、日期记录与统计。

考试日期与官方来源集中维护在 `data/exams.json`；省考预估日期与正式日期使用不同状态，不将预估当作公告。

重新导入本地导图：

```powershell
python -m pip install -r requirements-knowledge.txt
python scripts/import_knowledge.py
```

导入器保留原 PDF，提取原生文字与彩色重点，使用本机 RapidOCR 补充嵌入图片文字，并输出 `data/knowledge/knowledge.sqlite`、逐页 JSON 和 SVG / WebP 背景。原文位置、颜色、页码、来源哈希、OCR 置信度及人工校正均保留；题目答案来自原文。`--skip-ocr` 可仅做原生导入，`--upgrade-svg` 可只升级已有页面的矢量背景。

## 数据与发布

```powershell
python scripts/update_current_affairs.py --backfill
python scripts/update_current_affairs.py --force
python scripts/build_summer_reading_list.py
python scripts/export_site_data.py
python scripts/assemble_static_site.py
python scripts/assemble_static_site.py --output dist/client
python scripts/build_public_site.py
```

数据采集依赖见根目录 `requirements.txt`；源表格生成与导出还需要 `openpyxl`。`assemble_static_site.py` 生成 `_site`，`build_public_site.py` 生成 `dist/server/index.js`，两者共用公开资源清单。原始 PDF、SQLite 和转换报告保留在本地，网站只加载所需的逐页 JSON、导图图片和运行时资源。

当前浏览器交互和课程读取均可由静态文件承载。GitHub Pages 使用默认 `_site`；Sites 使用 `python scripts/assemble_static_site.py --output dist/client`，将 `static.directory` 配置为支持的 `dist/client`。命令仅接受这两个固定输出，会先检查目标及父目录没有重定向，再重建选定目录；构建 `dist/client` 不会删除 `dist/server`。

旧 Worker 构建是兼容入口，会把所有资源嵌入一份 JavaScript；新增图片和字体后没有必要继续扩大该内嵌包。Sites 发布仍须在既有源仓库中保留原 project ID 和访问范围，由发布流程选择静态产物；本地构建命令不会发布或修改托管配置。

Windows 定时更新的安装入口是 `scripts/install-daily-update.ps1`。根目录 `update-current-affairs.ps1` 是原有计划任务的兼容入口，实际逻辑位于 `scripts/`。
