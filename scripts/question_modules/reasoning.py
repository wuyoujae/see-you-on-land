"""Map question content to the existing reasoning curriculum.

The reviewed map takes precedence over recognizable question formats. New content
with no unambiguous signature raises instead of silently entering a catch-all.
"""
from pathlib import Path
import json
import re
import hashlib
from functools import lru_cache

REVIEW_PATH = Path(__file__).with_name('reasoning-reviewed.json')
EXTRAS = [('reasoning-figures', '图形推理'), ('reasoning-definition', '定义判断'),
          ('reasoning-analogy', '类比推理'), ('reasoning-science', '科学推理'),
          ('reasoning-induction', '归纳推理')]

def module_definitions(courses_subject):
    return [{'id':g['id'], 'title':g['title'], 'courseGroupId':g['id']}
            for g in courses_subject['groups']] + [
                {'id':id_, 'title':title} for id_, title in EXTRAS]

def text_content(value):
    if isinstance(value, dict):
        return ' '.join(str(v) for k,v in value.items() if k in ('text','label')) + ' ' + ' '.join(
            text_content(v) for k,v in value.items() if isinstance(v,(list,dict)))
    if isinstance(value,list):return ' '.join(text_content(v) for v in value)
    return ''

@lru_cache(maxsize=1)
def reviewed_records():
    return json.loads(REVIEW_PATH.read_text(encoding='utf8')) if REVIEW_PATH.exists() else {}

def classify(question):
    reviewed = reviewed_records()
    item = reviewed.get(question['id'])
    if item:
        if item.get('stemHash') and item['stemHash'] != hashlib.sha256(question.get('stem','').encode()).hexdigest():
            raise ValueError('Reviewed content changed: '+question['id'])
        return {'topicId':item['topicId'], 'method':'content-reviewed', 'evidence':item['evidence']}
    source_category=question.get('source',{}).get('category')
    # Science was explicitly corrected against original paper section boundaries.
    # Other upstream labels are NOT authoritative: some Guangdong logic/premise
    # questions were mislabeled analogy/definition by that source.
    source_topics={'科学推理':'science'}
    if source_category in source_topics:
        return {'topicId':'reasoning-'+source_topics[source_category], 'method':'source-category-reviewed',
                'evidence':'按原卷分节与题面核对：'+source_category+'。'}
    stem=question.get('stem','')
    explanation=text_content(question.get('sourceAnswer',{}).get('explanationBlocks',[]))
    if re.search(r'(?:根据|据|按照|依照).{0,8}定义|定义的关键词|定义关键词',stem+' '+explanation[:250]):
        return {'topicId':'reasoning-definition', 'method':'question-format', 'evidence':'依据题干给定定义判断选项是否符合定义。'}
    if '相当于' in stem or re.search(r'词语间.{0,4}逻辑关系|词语.{0,3}逻辑关系',explanation[:160]) or (len(stem)<90 and re.search('[:：].+[^:：]$',stem.strip()) and not re.search('图|规律|问号|选项|所给|哪|根据|以下|下列|[。？，]',stem)):
        return {'topicId':'reasoning-analogy', 'method':'question-format', 'evidence':'比较题干词语和选项词语的对应关系。'}
    if re.search(r'图形|问号处|纸盒|多面体|折叠|外表面|立体图',stem):
        return {'topicId':'reasoning-figures', 'method':'question-format', 'evidence':'依据原题图示判断图形规律、空间关系或图形分类。'}
    raise ValueError('Question requires reviewed topic: '+question['id'])
