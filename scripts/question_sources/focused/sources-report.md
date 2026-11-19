# 数字找规律与图形推理题源核查

核查日期：2026-11-18。仅执行来源研究与本地候选素材制作；没有改生产数据、提交 Git 或部署。

## 本次实际产出

采用 OMIB 官方开放图形题库的 24 道题，新增四选一选项与中文解析，完整候选见 `omib-adapted/candidates.json`。原题库有 220 道正式题以及 6 道锚题图；本次实取 226 个原 SVG、220 行答案/规则表和 20 个构造部件。24 道候选有 120 张独立 PNG，所用原始资料、对应 SVG 源文件、GPL v3 全文、来源证据、改编说明和复现脚本均在 `omib-adapted`。

**优先建议**：数字数列按公开规律原创并验证；图形题采用本次 OMIB 24 道 GPL 改编题，配合原创非矩阵类图形练习。原创题标记为原创专项，OMIB 标记为开放题库改编，均不冒充公务员真题。没有把新分类的既有题计为新增题。

## 候选来源及使用判断

| 来源 | 实查数量/形式 | 许可及适配判断 |
|---|---|---|
| [Open Matrices Item Bank / OMIB](https://osf.io/4km79/) | 220 正式矩阵题、6 锚题 SVG；20 部件；220 行答案与规则 | 作者[论文摘要](https://pmc.ncbi.nlm.nih.gov/articles/PMC9326670/)明确**题库 GPLv3**。论文自己的 CC BY 与题库不同。原格式是构造答案，现已完成 24 道四选一改编，保留 GPL、署名和源材料。 |
| [reasoning-gym](https://github.com/open-thought/reasoning-gym/tree/5aea50d292a6427f12c63c77873ec8ae945cd2c0) | 可生成数列，默认虚拟 size=500；非固定 500 道已审题。含数值答案和规则元数据 | Apache-2.0，可参考或复用代码并遵守 NOTICE。当前 `number_sequences.py` 中 ALTERNATE 未实现、随机 COMPOSE 子规则为空，HALF 为向下整除但文字写 halve，失败后退化为简单等差数列；不建议直接当成完善中文四选一题库。 |
| [ARC-AGI](https://github.com/fchollet/ARC-AGI/tree/399030444e0ab0cc8b4e199870fb20b863846f34) | 400 training + 400 evaluation 的彩色格变换任务；含输出答案 | Apache-2.0，可改编但缺中文解析/选项，形态不等同行测。适合另建图形变换训练，不宜冒充现成图推选择题。 |
| [Sandia Matrices](https://github.com/sandialabs/Matrices/tree/b87eedf827c3acc75a1ec743c145bd0dbd9633e2) | ZIP 实查 840 题干 PNG + 840 个八选项面板，XLS 有答案键；1层96、2层184、3层500、逻辑60 | 源码压缩包内主代码有 BSD 三条款；固定题图 ZIP 没有单独许可证，README 仅说 available for use。不能直接推定主代码许可覆盖题图。暂不导入，已有可用 OMIB。 |
| [RAVEN](https://github.com/WellyZhang/RAVEN/tree/77927ba3fe26485f66f2d6698909175a347eb059) | 作者论文 70,000 题、7 配置、8 选项、结构规则 XML；未下载整库 | 代码 GPL-3.0；另托管数据分发范围需单独确认。科研矩阵形式单一，且没有中文逐题解析。本轮不采用。 |
| [DeepMind PGM](https://github.com/google-deepmind/abstract-reasoning-matrices/tree/6d8ae046f32fb30f6baae72a3dbab753ae111c99) | 各 regime 大规模 NPZ 图形任务，含 target 与规则 | GitHub 代码标为 Apache-2.0，但 README 明示**数据仅非商业研究用途**，不可据代码许可把数据公开成练习网站。本轮排除。 |
| [OpenQB](https://github.com/Enyu-Zhou/OpenQB/tree/889ca4eaa027d5c07aa96d192e40d502469dd49a) | 157 文件，实查全部题目为高考数学/排版资源；未发现行测专项 | CC BY 4.0 仅项目有权授权部分；第三方试题遵循原授权。当前匹配专项的可直接采用题量为 0。 |
| [Timothy-yqw19/qiuzhao-epi-bank](https://github.com/Timothy-yqw19/qiuzhao-epi-bank/tree/c52a22b9a1171993e33423c656083443cddb0d32) | README 声称 200 生成数列 + 14 手工数列、117 生成图形 + 11 手工图形；未逐题核实 | 无仓库 LICENSE，GitHub license=null。README 区分第三方版权真题仅本地使用。本轮不复制。 |
| [ERRRC/xingcezhenti](https://github.com/ERRRC/xingcezhenti/tree/278984401124db40da5163a31275b8deb9c282f4) | README 515 卷/58,890 题；数量模块 6,448、判断模块 16,859，后两者含非目标专项 | 无仓库 LICENSE。当前已有导入与此次研究分开处理，本轮不以公开可见作为新批量复制授权。 |
| [MaRs-IB](https://pmc.ncbi.nlm.nih.gov/articles/PMC6837216/) | 80 模板 × 3 图形变体，可形成 240 图版；4 选项 | 论文 CC BY 不等于题库许可，作者明确题库仅非商业使用。未确定网站用途前不作为通用可复用源。本轮不采用。 |
| [ICAR 官方说明](https://sms.statistik.tu-dortmund.de/en/research/projects/completed-research-projects/international-cognitive-ability-resource-icar/) | 早期资料宣称 60 题含数字/字母序列与矩阵 | 当前维护者页面限制研究用途并禁止公开放在商业或非商业主页。旧 public-domain 简介和反应数据 CC0 不能替代题目现行分发条件。本轮排除。 |

## 可复核证据

- `repository-audits.json` 与每个仓库目录中的 `audit.json`、`tree.json`、README、LICENSE 固定了提交号、原始 URL 和 SHA-256。
- `open-matrices-item-bank/archive-audit.json` 记录四份官方 OSF 下载、文件尺寸与 SHA-256；`workbook-summary.json` 记录表头。完整原题答案表中 `Item Solution` 为 20 位键，`Complete Item Code` 为九个 20 位格编码。
- `omib-adapted/license-evidence.json` 记录作者对题库 GPLv3 的明确声明来源；`GPL-3.0.txt` 为未修改的 GPL v3 正文。
- `omib-adapted/verification-results.json` 记录逐题独立校验。全部 24 道的八个已知格与官方 SVG 原语相等，原键/九格编码相等；计算三行规则成立；四个 PNG 内容各异；不借用原规则标签枚举六类规则后，仍仅目标选项符合。
- `omib-adapted/review/contact-01.png` 至 `contact-06.png` 已逐张目视，题面没有答案面板或解析泄漏。预览上的答案标签仅用于内部审阅，不属于发布题图。

## 质量边界

本次改编保留原矩阵和原键，新增干扰项及中文说明。四选一形式没有重新进行原论文的心理测量标定；网站只作专项练习，不使用原参数产生智商分数。数列序列本身可被无限多函数拟合，原创练习应按明确教学规律设计、给足已知项，并筛除常见替代规律下也能成立的干扰项。
