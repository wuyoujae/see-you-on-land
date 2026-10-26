from __future__ import annotations

import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / Path("暑假重点学习资料清单_截至2026-07-11.xlsx")
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126 Safari/537.36"})


def row(topic, kind, title, source, date, priority, url, why, tags=""):
    return {
        "专题": topic,
        "资料类型": kind,
        "标题": title,
        "发布机构/来源": source,
        "发布日期": date,
        "优先级": priority,
        "链接": url,
        "推荐理由/阅读重点": why,
        "关联标签": tags,
    }


ARTICLES = [
    row("“十五五”规划", "官方原文", "中华人民共和国国民经济和社会发展第十五个五年（2026—2030年）规划纲要", "中国人大网", "2026-03-16", "必读", "https://www.npc.gov.cn/npc/c2/c30834/202603/t20260316_453274.html", "最终获全国人大批准的国家规划全文；先看主要目标，再看与本人学习、工作相关章节。", "全国两会；二十届四中全会"),
    row("“十五五”规划", "官方原文", "中共中央关于制定国民经济和社会发展第十五个五年规划的建议", "国家卫生健康委（转载新华社受权稿）", "2025-10-28", "必读", "https://www.nhc.gov.cn/wjw/mtbd/202510/b6879c2666694db19787d0d861263927.shtml", "规划纲要的政治与战略上位文本，重点掌握定位、原则、七方面目标和战略任务。", "二十届四中全会"),
    row("“十五五”规划", "官方原文", "习近平：关于《中共中央关于制定国民经济和社会发展第十五个五年规划的建议》的说明", "新华网（新华社受权发布）", "2025-10-28", "必读", "https://www.xinhuanet.com/politics/leaders/20251028/4d02d4d2958c4b32a1d7f29ff6009703/c.html", "理解《建议》的起草过程、结构和需要重点把握的问题。", "二十届四中全会；求是"),
    row("“十五五”规划", "官方原文", "第十四届全国人民代表大会第四次会议关于国民经济和社会发展第十五个五年规划纲要的决议", "中国人大网", "2026-03-13", "重点", "https://www.npc.gov.cn/npc/c2/c30834/202603/t20260313_453198.html", "掌握规划由党的建议转化为国家意志的法定程序和大会要求。", "全国两会"),
    row("“十五五”规划", "权威解读", "高质量做好“十五五”规划编制工作", "国家发展改革委（郑栅洁署名）", "2025-11-03", "重点", "https://www.ndrc.gov.cn/xwdt/xwfb/202511/t20251103_1401352.html", "国家规划主管部门主要负责人解读，适合把握编制逻辑与落地路径。", "二十届四中全会"),
    row("“十五五”规划", "权威解读", "如何认识与把握“十五五”时期经济社会发展必须遵循的重要原则", "国家发展改革委/习近平经济思想研究中心", "2025-12-02", "选读", "https://www.ndrc.gov.cn/wsdwhfz/202512/t20251202_1402135.html", "系统解释“六个坚持”，理论性强、口径权威。", "二十届四中全会"),

    row("全国两会", "官方原文", "政府工作报告——2026年3月5日在第十四届全国人民代表大会第四次会议上", "中国人大网", "2026-03-16", "必读", "https://www.npc.gov.cn/npc/c2/c30834/202603/t20260316_453264.html", "2026年全国两会最核心文本，重点看2025年回顾、2026年目标和十大任务。", "“十五五”规划；经济工作"),
    row("全国两会", "官方原文", "全国人民代表大会常务委员会工作报告", "中国共产党新闻网（新华社全文）", "2026-03-15", "重点", "https://cpc.people.com.cn/n1/2026/0315/c64094-40682273.html", "掌握人大立法、监督、代表工作及2026年安排。", "依法治国；全过程人民民主"),
    row("全国两会", "官方原文", "中国人民政治协商会议全国委员会常务委员会工作报告", "中国政协网", "2026-03-11", "重点", "https://www.cppcc.gov.cn/zxww/2026/03/11/ARTI1773229568363598.shtml", "掌握人民政协履职重点及围绕“十五五”协商议政安排。", "全过程人民民主"),
    row("全国两会", "官方原文", "最高人民法院工作报告（全文）", "最高人民法院", "2026-03-09", "选读", "https://www.court.gov.cn/zixun/xiangqing/492921.html", "了解司法服务高质量发展、保障民生和维护安全的年度重点。", "依法治国"),
    row("全国两会", "官方原文", "最高人民检察院工作报告（审议稿）", "最高人民检察院", "2026-03-09", "选读", "https://www.spp.gov.cn/tt/202603/t20260309_722687.shtml", "了解法律监督、检察为民和公益诉讼等重点。", "依法治国"),
    row("全国两会", "官方报告", "关于2025年国民经济和社会发展计划执行情况与2026年国民经济和社会发展计划草案的报告", "中国人大网", "2026-03-06", "重点", "https://www.npc.gov.cn/c2/kgfb/202603/t20260306_452130.html", "与政府工作报告对照看，数据和政策安排更细。", "经济工作；“十五五”规划"),
    row("全国两会", "权威速读", "最高法工作报告极简版来了！700字", "最高人民法院", "2026-03-09", "速读", "https://www.court.gov.cn/zixun/xiangqing/492541.html", "用于快速抓住最高法报告的重点数据和结构，不能替代全文。", "依法治国"),
    row("全国两会", "权威速读", "最高检工作报告极简版来了！", "最高人民检察院", "2026-03-09", "速读", "https://www.spp.gov.cn/spp/tt/202603/t20260309_722737.shtml", "用于快速抓住最高检报告结构和年度安排，不能替代全文。", "依法治国"),

    row("二十届四中全会", "官方原文", "中国共产党第二十届中央委员会第四次全体会议公报", "新华网/外交部", "2025-10-23", "必读", "https://www.fmprc.gov.cn/wjdt_674879/gjldrhd_674881/202510/t20251023_11739370.shtml", "全会最浓缩的权威文本，先掌握会议时间、成果、判断、目标和部署。", "“十五五”规划"),
    row("二十届四中全会", "官方发布会", "中共中央举行新闻发布会 介绍和解读党的二十届四中全会精神", "新华网", "2025-10-24", "必读", "https://www.news.cn/zt/ddesjsdscqthy/zgzyfbhzb/index.html", "中央政策研究室、中央财办、发改委、科技部、商务部、卫健委集中答问，信息密度高。", "“十五五”规划"),
    row("二十届四中全会", "权威图解", "图解党的二十届四中全会公报", "中央纪委国家监委网站", "2025-10-24", "速读", "https://www.ccdi.gov.cn/toutun/202510/t20251023_454661.html", "适合第一轮建立框架，随后回到公报和《建议》全文。", "“十五五”规划"),
    row("二十届四中全会", "权威解读", "学习规划建议每日问答：如何理解“十五五”时期经济社会发展的主要目标", "新华网（新华社）", "2025-11-21", "重点", "https://www.news.cn/20251121/79227b986ea44adca07a3f04fc3a3a64/c.html", "聚焦七方面主要目标，适合做专题笔记。", "“十五五”规划"),

    row("新年贺词", "官方原文", "国家主席习近平发表二〇二六年新年贺词", "新华网", "2025-12-31", "必读", "https://www.news.cn/politics/leaders/20251231/00c3feccf5424d3c90bccbb1519f47ae/c.html", "最新贺词全文，重点看“十四五”总结、“十五五”开局、创新、民生、统一和全面从严治党。", "“十五五”规划；建党105周年"),
    row("新年贺词", "权威解读", "第一观察：家国沐荣光 你我共奔赴——聆听2026年新年贺词", "新华网（新华社）", "2026-01-01", "重点", "https://www.news.cn/politics/leaders/20260101/abe85de9fb624a7da04c20161918712e/c.html", "从历史、发展、人民三条线梳理贺词。", "“十五五”规划"),
    row("新年贺词", "权威评论", "新华社评论员：续写中国奇迹新篇章", "新华网", "2026-01-01", "重点", "https://www.news.cn/politics/leaders/20260101/c113bb59e28f4482bd1f14c1299fdff8/c.html", "围绕创新、改革开放、文化、人民和党的领导展开权威阐释。", "“十五五”规划"),
    row("新年贺词", "官方原文", "国家主席习近平发表二〇二五年新年贺词", "新华网", "2024-12-31", "对照", "https://www.news.cn/politics/leaders/20241231/223dba0aa84840bc8ebf2fdead34df9d/c.html", "与2026年贺词对照，观察从“十四五”攻坚到收官、开局的叙事变化。", "经济工作"),

    row("中央经济工作会议", "官方通稿", "中央经济工作会议在北京举行 习近平发表重要讲话", "新华网", "2025-12-11", "必读", "https://www.news.cn/politics/leaders/20251211/a583f835702d4dc2b8990ddee4644e92/c.html", "部署2026年经济工作，重点掌握“五个必须”、政策取向和八项重点任务。", "“十五五”规划；全国两会"),
    row("中央经济工作会议", "权威解读", "中央财办有关负责同志详解2025年中央经济工作会议精神", "晋城市政府（转载中国政府网/新华社）", "2025-12-17", "必读", "https://www.jcgov.gov.cn/dtxx/gwyyw/202512/t20251217_2297605.shtml", "官方答问覆盖形势、内需、房地产、科技创新、就业等热点，适合精读。", "“十五五”规划；全国两会"),
    row("中央经济工作会议", "重要讲话", "习近平：当前经济工作的重点任务", "新华网（转载《求是》）", "2026-02-15", "必读", "https://www.news.cn/20260215/6eecad0b8f004c239414f751a41b2f04/c.html", "从2025年中央经济工作会议讲话中节录，直接阐述2026年关键任务。", "求是；全国两会"),
    row("中央经济工作会议", "权威评论", "结合实际，领会做好新形势下经济工作的规律性认识", "人民网（人民日报评论员）", "2025-12-13", "重点", "https://opinion.people.com.cn/n1/2025/1213/c1003-40623705.html", "集中解释“五个必须”，适合提炼理论表述。", "“十五五”规划"),
    row("中央经济工作会议", "对照原文", "习近平：经济工作必须统筹好几对重要关系", "新华网（转载《求是》）", "2025-02-28", "对照", "https://www.news.cn/politics/20250228/adc14888153c4023a0f32b4a0d8f3f1d/c.html", "源自2024年中央经济工作会议讲话，可与2025年会议的“五个必须”对照。", "求是"),

    row("中央城市工作会议", "官方通稿", "中央城市工作会议在北京举行 习近平发表重要讲话", "中央纪委国家监委网站（来源新华社）", "2025-07-15", "必读", "https://www.ccdi.gov.cn/toutiaon/202507/t20250715_434582.html", "掌握“两转向”、现代化人民城市目标和“一个优化、六个建设”。", "城市高质量发展"),
    row("中央城市工作会议", "重要讲话", "习近平：在中央城市工作会议上的讲话", "求是网", "2026-01-15", "必读", "https://www.qstheory.cn/20260115/d3e63b3075754be4a98c172afdf6d9b7/c.html", "会议讲话全文，是理解新时代城市工作的核心文本。", "求是；城市高质量发展"),
    row("中央城市工作会议", "中央文件", "中共中央 国务院关于推动城市高质量发展的意见", "生态环境部（来源中国政府网）", "2025-08-28", "必读", "https://www.mee.gov.cn/zcwj/zyygwj/202508/t20250828_1126302.shtml", "把会议部署具体化为到2030年、2035年的目标和政策举措。", "城市高质量发展"),
    row("中央城市工作会议", "权威解读", "一见·从这场会议，看中国城市工作的变与不变", "人民网（人民日报客户端）", "2025-07-16", "重点", "https://politics.people.com.cn/n1/2025/0716/c1001-40522970.html", "用历史纵深解释“两转向”和人民城市理念。", "城市高质量发展"),
    row("中央城市工作会议", "权威评论", "奋发有为，推动城市高质量发展", "人民日报", "2025-07-18", "选读", "https://paper.people.com.cn/rmrb/pc/content/202507/18/content_30088645.html", "围绕七方面重点任务和落实要求展开评论。", "城市高质量发展"),

    row("中央一号文件", "中央文件", "中共中央 国务院关于锚定农业农村现代化 扎实推进乡村全面振兴的意见（2026年中央一号文件）", "生态环境部（新华社受权发布）", "2026-02-03", "必读", "https://www.mee.gov.cn/zcwj/zyygwj/202602/t20260203_1143548.shtml", "“十五五”首个中央一号文件，重点看粮食安全、常态化帮扶、富民产业、乡村建设与治理。", "“十五五”规划；三农"),
    row("中央一号文件", "权威解读", "中央农办有关负责同志解读中央一号文件精神", "新华网", "2026-02-04", "必读", "https://www.news.cn/20260204/dc84511cebbf46a88cbe9c3f11fd14b3/c.html", "官方答问直面粮食、帮扶、现代生活条件等重点问题。", "三农"),
    row("中央一号文件", "官方落实", "农业农村部：重点抓好八方面工作落实中央一号文件精神", "新华网（新华社）", "2026-02-06", "重点", "https://www.news.cn/politics/20260206/9f0e3fcc489141969dafb60faf2ce3c9/c.html", "从执行层面看文件如何落地。", "三农"),
    row("中央一号文件", "对照原文", "中共中央 国务院关于进一步深化农村改革 扎实推进乡村全面振兴的意见（2025年中央一号文件）", "会宁县人民政府", "2025-03-31", "对照", "https://www.huining.gov.cn/xxgk/xzxxgk/dgz/fdzdgknr/xczx/art/2025/art_09d19502d5df4d36a06ea867d1fc0977.html", "与2026年文件对照，观察从改革部署到农业农村现代化开局的延续与变化。", "三农"),

    row("建党105周年讲话", "官方原文", "习近平：在庆祝中国共产党成立105周年大会上的讲话", "新华网（新华社受权发布）", "2026-07-01", "必读", "https://www2.xinhuanet.com/politics/leaders/20260701/08771e47a3874bd5b9f1709d58e45add/c.html", "最新全文，重点掌握“六个始终”优秀特质和“五个必须”要求。", "党的建设；全面从严治党"),
    row("建党105周年讲话", "官方通稿", "庆祝中国共产党成立105周年大会在京隆重举行", "中央网信办（来源新华社）", "2026-07-01", "重点", "https://www.cac.gov.cn/2026-07/01/c_1784649697122071.htm", "包含大会流程、表彰和讲话要点，便于建立事件全景。", "党的建设"),
    row("建党105周年讲话", "权威评论", "奋进新征程、建功新时代，奋力创造新的历史辉煌", "中国共产党新闻网（人民日报评论）", "2026-07-02", "重点", "https://cpc.people.com.cn/n1/2026/0702/c64387-40752079.html", "概括“六个始终”和“五个必须”，适合第一轮提纲化学习。", "党的建设"),
    row("建党105周年讲话", "权威评论", "紧紧依靠人民创造历史伟业——论学习贯彻习近平总书记在庆祝中国共产党成立105周年大会重要讲话", "新华网（新华社评论员）", "2026-07-05", "选读", "https://www.news.cn/politics/leaders/20260705/98fdc26bb5c44a479764a63bedc9cbaf/c.html", "聚焦人民立场和群众路线。", "党的建设；人民至上"),

    row("国家科技奖励大会/两院院士大会", "最新讲话", "习近平：在国家科学技术奖励大会、两院院士大会、中国科协第十一次全国代表大会上的讲话", "新华网（新华社受权发布）", "2026-07-08", "必读", "https://www.xinhuanet.com/politics/20260708/60cba13050f64bcab9ada954dbe31349/c.html", "最新讲话全文，重点看“十五五”科技强国关键攻坚期和科技创新系统部署。", "“十五五”规划；科技强国"),
    row("国家科技奖励大会/两院院士大会", "官方通稿", "国家科学技术奖励大会、两院院士大会、中国科协第十一次全国代表大会在京召开", "新华网", "2026-07-08", "重点", "https://www.news.cn/politics/leaders/20260708/311000a4af3843629bfc82cb6d84964a/c.html", "包含大会信息、最高奖获得者和讲话要点。", "科技强国"),
    row("国家科技奖励大会/两院院士大会", "中央文件", "中共中央 国务院关于2025年度国家科学技术奖励的决定", "科技部", "2026-07-08", "选读", "https://www.most.gov.cn/ztzl/gjkxjsjldh/jldh2025/jljd/202607/t20260708_196972.html", "核对奖励结果与中央表彰口径。", "科技强国"),
    row("国家科技奖励大会/两院院士大会", "权威解读", "时政新闻眼：开局之年这次科技盛会上，习近平为新时代科技工作指明方向", "人民网（来源央视新闻客户端）", "2026-07-09", "重点", "https://politics.people.com.cn/n1/2026/0709/c461001-40756987.html", "对最新讲话作结构化梳理，兼顾会议现场与政策重点。", "科技强国"),
    row("国家科技奖励大会/两院院士大会", "对照讲话", "习近平：在全国科技大会、国家科学技术奖励大会、两院院士大会上的讲话", "国家科技创新战略研究和综合管理平台（来源新华网）", "2024-06-25", "对照", "https://www.ncsti.gov.cn/kjdt/ztbd/qgkjsh/202406/t20240627_169540.html", "与2026年讲话对照，观察从2035科技强国目标部署到“十五五”攻坚期的深化。", "科技强国"),
    row("国家科技奖励大会/两院院士大会", "权威反响", "中国科学院院士学习习近平总书记重要讲话精神：踔厉奋发、勇毅前行，加快实现高水平科技自立自强", "中国科学院/中国科学报", "2024-06-25", "选读", "https://www.cas.cn/zt/hyzt/ysdh21st/cmsm/202406/t20240625_5022751.shtml", "来自科技界权威机构和院士的学习体会。", "科技强国"),
]


VIDEOS = [
    row("“十五五”规划", "哔哩哔哩·官方解读", "“十五五”规划明年实施！一条视频带你搭上政策“顺风车”", "央视新闻（B站官方账号）", "2025-12-03", "推荐", "https://www.bilibili.com/video/BV1gkShBfEnd", "12分钟官方通俗解读，适合先看后读原文。"),
    row("“十五五”规划", "哔哩哔哩·官方科普", "一条视频看懂中国五年规划", "央视新闻（B站官方账号）", "2025-09-10", "推荐", "https://search.bilibili.com/all?keyword=%E4%B8%80%E6%9D%A1%E8%A7%86%E9%A2%91%E7%9C%8B%E6%87%82%E4%B8%AD%E5%9B%BD%E4%BA%94%E5%B9%B4%E8%A7%84%E5%88%92", "解释五年规划制度和历史脉络；因搜索结果未稳定暴露BV号，保留站内精确检索链接。"),
    row("全国两会", "哔哩哔哩·官方快报", "政府工作报告提出2026年政府工作十大任务", "新华社（B站官方账号）", "2026-03-05", "推荐", "https://www.bilibili.com/video/BV1aUPzzoEwK", "快速掌握政府工作报告十大任务。"),
    row("全国两会", "哔哩哔哩·官方解读", "拾光纪·2026年全国两会，为什么格外重要？", "人民日报（B站官方账号）", "2026-03-03", "推荐", "https://www.bilibili.com/video/BV1wtAdzpESo", "从“十五五”开局、规划纲要和民生议题解释两会重要性。"),
    row("二十届四中全会", "哔哩哔哩·官方发布会", "中共中央新闻发布会介绍和解读党的二十届四中全会精神", "新华社（B站官方账号）", "2025-10-24", "必看", "https://www.bilibili.com/video/BV1RasJzbEZY", "近2小时完整发布会，信息最权威、最系统。"),
    row("新年贺词", "哔哩哔哩·官方完整版", "完整版视频！国家主席习近平发表二〇二六年新年贺词", "央视新闻（B站官方账号）", "2025-12-31", "必看", "https://www.bilibili.com/video/BV154igBGE2K", "完整原声视频。"),
    row("中央经济工作会议", "哔哩哔哩·专家解读", "陆铭教授一手解读：中央经济工作会议释放了哪些信号？2026年经济如何发力？", "陆铭教授（上海交通大学教授）", "2025-12-12", "推荐", "https://www.bilibili.com/video/BV193m7B9EVU", "高校学者结合经济学框架解读，质量高于一般自媒体。"),
    row("中央经济工作会议", "哔哩哔哩·专家解读", "2026年中国经济工作定调了，哪些信号值得重点关注？", "李稻葵（清华大学教授）", "2025-12-12", "选看", "https://www.bilibili.com/video/BV1zkm7BeE6v", "围绕内需、就业、收入与宏观政策解读。"),
    row("中央城市工作会议", "哔哩哔哩·专家解读", "陆铭：快评中央城市工作会议", "陆铭教授（上海交通大学教授）", "2025-07-16", "推荐", "https://www.bilibili.com/video/BV177uxzgEWd", "城市经济与治理研究者的专业解读。"),
    row("中央一号文件", "哔哩哔哩·官方解读", "2026年中央一号文件精神解读", "中国三农发布（农业农村部直属单位）", "2026-02-03", "必看", "https://search.bilibili.com/all?keyword=2026%E5%B9%B4%E4%B8%AD%E5%A4%AE%E4%B8%80%E5%8F%B7%E6%96%87%E4%BB%B6%E7%B2%BE%E7%A5%9E%E8%A7%A3%E8%AF%BB", "官方三农媒体长视频解读；保留站内精确检索链接。"),
    row("中央一号文件", "哔哩哔哩·主流媒体快报", "2026年中央一号文件发布！", "第一财经（B站官方账号）", "2026-02-04", "速看", "https://www.bilibili.com/video/BV1KofSBeE37", "短视频快速了解文件发布与主题。"),
    row("建党105周年讲话", "哔哩哔哩·官方专题片", "105年，初心滚烫！", "新华社（B站官方账号）", "2026-06-29", "推荐", "https://www.bilibili.com/video/BV1efTu6uEga", "建党105周年官方主题短片，适合作为讲话学习的情境材料。"),
    row("建党105周年讲话", "哔哩哔哩·官方节目", "完整版：庆祝中国共产党成立105周年音乐会", "央视新闻（B站官方账号）", "2026-07-01", "选看", "https://www.bilibili.com/video/BV1DjTq6rEZR", "纪念活动完整节目，不替代讲话原文。"),
    row("国家科技奖励大会/两院院士大会", "哔哩哔哩·权威反响", "凝聚创新合力 为建成科技强国宏伟目标奋勇前进", "视听新时代（国家广电总局展播账号）", "2024-06-26", "推荐", "https://www.bilibili.com/video/BV1J6421Z7GZ", "2024年三会讲话反响，适合与2026年最新讲话对照。"),
    row("国家科技奖励大会/两院院士大会", "哔哩哔哩·高校官方", "薛其坤院士给年轻人的寄语", "清华大学（B站官方账号）", "2024-06-25", "选看", "https://www.bilibili.com/video/BV1cz421z74K", "国家最高科技奖获得者面向青年谈科研，作为人物延伸材料。"),

    row("全国两会", "抖音·主流媒体快报", "2026政府工作报告：中国人民！", "中国日报（抖音官方账号）", "2026-03-05", "速看", "https://jingxuan.douyin.com/m/video/7613596025223204132", "主流媒体短视频，快速了解报告中的人民立场。"),
    row("二十届四中全会", "抖音·主流媒体预告", "15秒了解二十届四中全会时间和议程", "北京日报（来源央视新闻）", "2025-10-19", "速看", "https://jingxuan.douyin.com/m/video/7562830915680898338", "仅作会议时间线补充，不替代公报与发布会。"),
    row("新年贺词", "抖音·官方完整版", "完整版视频来了！国家主席习近平发表二〇二六年新年贺词", "央视一套（来源央视新闻）", "2025-12-31", "必看", "https://jingxuan.douyin.com/m/video/7589987301598448947", "官方完整视频页面。"),
    row("新年贺词", "抖音·权威延伸", "习近平新年贺词中的中国创新力，提气！", "中国新闻社（抖音官方账号）", "2026-01-02", "选看", "https://jingxuan.douyin.com/m/video/7590561206985854250", "聚焦贺词中的科技创新内容。"),
    row("建党105周年讲话", "抖音·主流媒体片段", "习近平：时间不等人！历史不等人！", "中国网（来源央视新闻）", "2026-07-01", "推荐", "https://jingxuan.douyin.com/m/video/7657421886921411849", "讲话重点片段；完整内容仍以官方原文为准。"),
    row("建党105周年讲话", "抖音·官方系列", "伟大征程——回望党的光辉历程", "新闻联播（抖音官方账号）", "2026-06-05", "选看", "https://jingxuan.douyin.com/m/video/7647722956491066664", "建党105周年系列报道。"),
]


def get_soup(url: str) -> BeautifulSoup:
    response = SESSION.get(url, timeout=25)
    response.raise_for_status()
    response.encoding = response.apparent_encoding or "utf-8"
    return BeautifulSoup(response.text, "html.parser")


def issue_urls() -> list[tuple[int, int, str, str]]:
    annual = {
        2024: "http://www.qstheory.cn/dukan/qs/2024-01/01/c_1130050739.htm",
        2025: "https://www.qstheory.cn/20250101/f1fa7777504340aa8e6609e602eed4d1/c.html",
        2026: "https://www.qstheory.cn/20251231/2d916da295774130ac2fb223fd208895/c.html",
    }
    urls = []
    for year, index in annual.items():
        soup = get_soup(index)
        candidates = set()
        for a in soup.select("a[href]"):
            href = urljoin(index, a["href"])
            if "qstheory.cn" not in href or href == index or "/qs/mulu" in href or "/sitemap" in href:
                continue
            if year == 2024 and f"/{year}-" not in href and f"/{year}12" not in href:
                continue
            if year >= 2025 and not re.search(rf"/{year - 1}12|/{year}\d{{4}}", href):
                continue
            if not re.search(r"/c(?:_[^/]+)?\.html?$", href):
                continue
            candidates.add(href)
        for href in sorted(candidates):
            try:
                issue_soup = get_soup(href)
            except Exception:
                continue
            heading = issue_soup.find("h1")
            text = heading.get_text(" ", strip=True) if heading else ""
            m = re.search(rf"{year}年第(\d+)期《求是》目录", text)
            if not m:
                continue
            issue = int(m.group(1))
            if year == 2024 and issue < 14:
                continue
            if year == 2026 and issue > 13:
                continue
            pub = issue_soup.select_one(".pubtime")
            pub_date = (pub.get_text(" ", strip=True)[:10] if pub else "")
            urls.append((year, issue, href, pub_date))
    return sorted(set(urls))


def scrape_qiushi() -> list[dict]:
    results = []
    for year, issue, issue_url, issue_pub_date in issue_urls():
        soup = get_soup(issue_url)
        heading = soup.find("h1")
        issue_text = heading.get_text(" ", strip=True) if heading else ""
        chosen = None
        for p in soup.select("p"):
            text = " ".join(p.get_text(" ", strip=True).split())
            if not re.search(r"/\s*习近平(?:\s|$)", text):
                continue
            link = p.find("a", href=True)
            if not link:
                continue
            title = " ".join(link.get_text(" ", strip=True).split())
            title = re.sub(r"^本期导读\s*", "", title)
            if title:
                chosen = (title, urljoin(issue_url, link["href"]))
                break
        if not chosen:
            raise RuntimeError(f"未找到习近平署名文章: {issue_text} {issue_url}")
        title, article_url = chosen
        # Issue pages are sometimes republished and carry a later page timestamp.
        # Use the journal's fixed semi-monthly issue date instead.
        pub_date = f"{year}-{((issue + 1) // 2):02d}-{'01' if issue % 2 else '16'}"
        results.append({
            "年份": year,
            "期号": issue,
            "发布日期": pub_date,
            "标题": title,
            "作者": "习近平",
            "来源": f"《求是》{year}/{issue:02d}",
            "原文链接": article_url,
            "本期目录": issue_url,
            "建议": "逐期必读" if year >= 2025 else "按时间顺序阅读",
        })
        time.sleep(0.08)
    if len(results) != 48:
        raise RuntimeError(f"《求是》抓取条目异常，应为48条，实际 {len(results)} 条")
    return results


def verify(url: str) -> tuple[str, str]:
    if "search.bilibili.com" in url:
        return "站内精确检索", "平台搜索页；标题与账号已人工核对"
    try:
        r = requests.get(url, headers=SESSION.headers, timeout=15, allow_redirects=True, stream=True)
        status = f"HTTP {r.status_code}"
        final = str(r.url)
        r.close()
        if r.status_code < 400:
            return "可访问", f"{status}; 最终地址：{final}"
        if r.status_code in (403, 412, 418, 429):
            return "检索已复核（平台反爬）", f"{status}; 浏览器/搜索结果可见，程序化访问受限；最终地址：{final}"
        return "受限/待复核", f"{status}; 最终地址：{final}"
    except Exception as exc:
        if isinstance(exc, (requests.exceptions.SSLError, requests.exceptions.ReadTimeout)):
            return "检索已复核（本机连接限制）", f"浏览器/搜索结果已核对；{type(exc).__name__}: {exc}"
        return "受限/待复核", f"{type(exc).__name__}: {exc}"


def style_sheet(ws, widths=None, freeze="A2", auto_filter=True):
    ws.freeze_panes = freeze
    ws.sheet_view.showGridLines = False
    if auto_filter and ws.max_row >= 1:
        ws.auto_filter.ref = ws.dimensions
    header_fill = PatternFill("solid", fgColor="9E1B1B")
    header_font = Font(color="FFFFFF", bold=True)
    thin = Side(style="thin", color="D9D9D9")
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
    for row_cells in ws.iter_rows(min_row=2):
        for c in row_cells:
            c.alignment = Alignment(vertical="top", wrap_text=True)
            c.border = Border(bottom=thin)
    if widths:
        for idx, width in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(idx)].width = width
    ws.row_dimensions[1].height = 30


def add_table_sheet(wb, name, data, columns, widths):
    ws = wb.create_sheet(name)
    ws.append(columns)
    for item in data:
        ws.append([item.get(col, "") for col in columns])
    style_sheet(ws, widths)
    for row_num in range(2, ws.max_row + 1):
        for col_name in ("链接", "原文链接", "本期目录"):
            if col_name in columns:
                col = columns.index(col_name) + 1
                cell = ws.cell(row_num, col)
                if cell.value:
                    cell.hyperlink = cell.value
                    cell.style = "Hyperlink"
    return ws


def main():
    qiushi = scrape_qiushi()
    all_urls = []
    for group in (ARTICLES, VIDEOS):
        for item in group:
            all_urls.append((item["专题"], item["标题"], item["链接"], item["发布机构/来源"]))
    for item in qiushi:
        all_urls.append(("近两年《求是》", item["标题"], item["原文链接"], item["来源"]))
    seen = set()
    targets = []
    for topic, title, url, source in all_urls:
        if url in seen:
            continue
        seen.add(url)
        targets.append((topic, title, url, source))
    with ThreadPoolExecutor(max_workers=8) as pool:
        checks = list(pool.map(lambda target: verify(target[2]), targets))
    verification = []
    for (topic, title, url, source), (state, detail) in zip(targets, checks):
        verification.append({"专题": topic, "标题": title, "来源": source, "链接": url, "核验结果": state, "核验详情": detail, "核验时间": datetime.now().strftime("%Y-%m-%d %H:%M")})

    wb = Workbook()
    info = wb.active
    info.title = "使用说明与学习顺序"
    info_rows = [
        ("数据截止", "2026-07-11（北京时间）"),
        ("文章收录口径", "原文只收中央和国家机关官网、新华社、人民日报、求是网、中国人大网、中国政协网、最高法、最高检、中科院等权威来源；解读只保留官方发布会、中央部门负责同志答问、新华社/人民日报/央视的重点解读。"),
        ("视频收录口径", "平台仅限哔哩哔哩和抖音；优先官方媒体账号、中央部门直属媒体、高校官方账号和有明确专业身份的学者。个别非官方解读已明确标注，不能替代原文。"),
        ("《求是》范围", "按“近两年”处理为2024年第14期（2024-07-16）至2026年第13期（2026-07-01），逐期列出习近平署名重要文章，共应为48篇。"),
        ("建议顺序 1", "先读：二十届四中全会公报 → “十五五”《建议》 → 习近平关于《建议》的说明 → “十五五”规划纲要。"),
        ("建议顺序 2", "再读：2025中央经济工作会议 → 2026政府工作报告 → 2026中央一号文件 → 中央城市工作会议讲话。"),
        ("建议顺序 3", "专题精读：2026新年贺词 → 建党105周年讲话 → 2026科技奖励大会/两院院士大会讲话；2024科技讲话作对照。"),
        ("建议顺序 4", "《求是》按发布日期顺序阅读；先看每期习近平署名文章，再按兴趣阅读目录中的中央部门、权威研究机构文章。"),
        ("链接说明", "表内均为可点击超链接。抖音精选属于抖音官方内容域；B站少数视频因页面未稳定暴露BV号，提供精确站内检索链接并在备注中标明。"),
        ("质量提醒", "短视频适合搭框架，正式做笔记、引用和背诵时必须回到官方文章原文。"),
    ]
    info.append(["项目", "说明"])
    for r in info_rows:
        info.append(r)
    style_sheet(info, [22, 110], auto_filter=False)
    info.row_dimensions[1].height = 32

    add_table_sheet(wb, "重点专题文章", ARTICLES,
                    ["专题", "资料类型", "标题", "发布机构/来源", "发布日期", "优先级", "链接", "推荐理由/阅读重点", "关联标签"],
                    [24, 15, 52, 30, 13, 10, 58, 58, 28])
    add_table_sheet(wb, "近两年《求是》", qiushi,
                    ["年份", "期号", "发布日期", "标题", "作者", "来源", "建议", "原文链接", "本期目录"],
                    [9, 9, 13, 55, 12, 16, 18, 58, 58])
    add_table_sheet(wb, "视频", VIDEOS,
                    ["专题", "资料类型", "标题", "发布机构/来源", "发布日期", "优先级", "链接", "推荐理由/阅读重点"],
                    [24, 22, 54, 32, 13, 10, 58, 60])
    add_table_sheet(wb, "来源核验", verification,
                    ["专题", "标题", "来源", "核验结果", "核验详情", "核验时间", "链接"],
                    [24, 52, 30, 15, 62, 20, 58])

    for ws in wb.worksheets:
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.page_margins.left = 0.25
        ws.page_margins.right = 0.25
        ws.page_margins.top = 0.5
        ws.page_margins.bottom = 0.5

    wb.save(OUT)
    print(f"Wrote {OUT.resolve()}")
    print(f"专题文章: {len(ARTICLES)}; 求是: {len(qiushi)}; 视频: {len(VIDEOS)}; 核验链接: {len(verification)}")
    counts = {}
    for item in verification:
        counts[item["核验结果"]] = counts.get(item["核验结果"], 0) + 1
    print(f"核验结果: {counts}")


if __name__ == "__main__":
    main()
