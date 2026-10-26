"""Build the reviewed Wang Yan handout course and its AI method library.

This consumes audited teaching content, never raw OCR or a generated AI answer.
The private source PDF and OCR files are deliberately not build inputs.
"""
from __future__ import annotations
import argparse
import copy
import json
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
REVIEWED=Path('data/courses/sources/quantity-wy27-reviewed.json')
EXPECTED=[27,22,25,25,25,22,20,20,20,29,26,26,19,21,22]

def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def chunks(blocks,limit=620):
    result=[];current=[];size=0
    for block in blocks:
        length=len(block.get('text',block.get('latex','')))
        if current and (size+length>limit or len(current)>=6) and block.get('type')!='formula':
            result.append(current);current=[];size=0
        current.append(block);size+=length
    if current:result.append(current)
    return result

def source(document,pages,originals=None):
    value={'type':'pdf','documentId':document['id'],'title':document['title'],
           'pages':sorted(set(pages)),'printedPages':sorted(set(p-6 for p in pages))}
    if originals:value['originalImages']=copy.deepcopy(originals)
    return value

def build(root=ROOT):
    root=Path(root)
    reviewed=read(root/REVIEWED)
    assert reviewed['version']==1 and len(reviewed['sections'])==15
    document=reviewed['document'];groups=[];lessons=[];all_questions=[];methods=[]
    for index,section in enumerate(reviewed['sections'],1):
        assert section['sectionNumber']==index
        qs=section['questions'];assert len(qs)==EXPECTED[index-1]
        gid=f'quantity-wy27-s{index:02}'
        group={'id':gid,'title':section['title'],'lessons':[]}
        method_ids=[item['id'] for item in section['methods']];assert method_ids
        methods.extend(copy.deepcopy(section['methods']))
        topic_ids=list(dict.fromkeys(q['id'].split('-')[-3] for q in qs if q['group']!='drill'))
        def save_lesson(lid,title,cards,pages):
            lesson={'id':lid,'subjectId':'quantity','groupId':gid,'title':title,
                    'source':source(document,pages),'cards':cards}
            entry={'id':lid,'title':title,'cardCount':len(cards),
                   'questionCount':sum(c['type']=='question' for c in cards),
                   'cardIds':[c['id'] for c in cards],
                   'questionIds':[c['question']['id'] for c in cards if c['type']=='question'],
                   'path':f'data/courses/lessons/{lid}.json'}
            group['lessons'].append(entry);lessons.append(lesson)
        def question_cards(q):
            assert q['id'].startswith(gid+'-') and q['answer'] in 'ABCD'
            assert len(q['options'])==4 and [x['value'] for x in q['options']]==list('ABCD')
            assert all(str(x.get('label','')).strip() or x.get('blocks') for x in q['options'])
            assert q['stem'].strip() and len(q['blocks'])>=1 and q['takeaway'].strip()
            assert q.get('sourceAnswer')
            reference=q['sourceAnswer']['answer'] if isinstance(q['sourceAnswer'],dict) else q['sourceAnswer']
            assert reference in 'ABCD'
            question={'id':q['id'],'type':'single','stem':q['stem'],
                      'options':copy.deepcopy(q['options']),'answer':q['answer'],
                      'sourceAnswer':reference}
            if q.get('diagramImages'):
                question['stemBlocks']=[{'type':'paragraph','text':q['stem']}]+copy.deepcopy(q['diagramImages'])
            for key in ['grading','sourceIssue','reviewNote']:
                if q.get(key):question[key]=q[key]
            src=source(document,q['pages'],q.get('originalImages'))
            label={'mother':'母题精讲','practice':'思维精练','drill':'实战精刷'}[q['group']]
            cards=[{'id':q['id']+'-question','type':'question','title':f'{label} · 第{q["number"]}题',
                    'question':question,'source':copy.deepcopy(src)}]
            solution=[{'type':'paragraph','text':f'讲义参考答案：{reference}'+('（本题条件待核，不计分）' if q.get('grading')=='unverified' else '')}]
            solution+=copy.deepcopy(q['blocks'])
            solution+=[{'type':'heading','level':3,'text':'这道题记住什么'}, {'type':'paragraph','text':q['takeaway']}]
            for part,block_group in enumerate(chunks(solution),1):
                cards.append({'id':q['id']+f'-explanation-{part:02}','type':'text','role':'explanation',
                              'title':'我们这样分析'+(f' · {part}' if part>1 else ''),
                              'questionId':q['id'],'blocks':block_group,'source':copy.deepcopy(src)})
            all_questions.append(question)
            return cards
        know=section['knowledge']
        assert know
        for ti,tid in enumerate(topic_ids):
            topic_qs=[q for q in qs if q['id'].split('-')[-3]==tid and q['group']!='drill']
            knowledge=know if len(topic_ids)==1 else [know[ti]]
            title=knowledge[0]['topicTitle']
            lid=gid+'-'+tid
            cards=[];all_pages=[]
            for ki,k in enumerate(knowledge,1):
                pages=[p+6 for p in k['printedPages']];all_pages+=pages
                for bi,block_group in enumerate(chunks(k['blocks']),1):
                    cards.append({'id':lid+f'-knowledge-{ki:02}-{bi:02}','type':'text','role':'knowledge' if bi==1 else 'method',
                                  'title':k['topicTitle'] if bi==1 else '我们的解题思路',
                                  'blocks':copy.deepcopy(block_group),'source':source(document,pages)})
            for q in topic_qs:cards+=question_cards(q);all_pages+=q['pages']
            save_lesson(lid,title,cards,all_pages)
        drills=[q for q in qs if q['group']=='drill']
        for offset in range(0,len(drills),4):
            batch=drills[offset:offset+4];cards=[];pages=[]
            for q in batch:cards+=question_cards(q);pages+=q['pages']
            numbers=f'{batch[0]["number"]}—{batch[-1]["number"]}题' if len(batch)>1 else f'第{batch[0]["number"]}题'
            save_lesson(gid+f'-drill-{offset//4+1:02}',f'实战精刷 · {numbers}',cards,pages)
        groups.append(group)
    assert len(all_questions)==349 and len({q['id'] for q in all_questions})==349
    # Validate everything before replacing any active runtime course file.
    for q in all_questions:
        assert q.get('grading')!='unverified' or q.get('sourceIssue'),q['id']
    manifest=read(root/'data/courses/manifest.json')
    subject=next(s for s in manifest['subjects'] if s['id']=='quantity')
    old_paths=[root/m['path'] for g in subject['groups'] for m in g['lessons']]
    subject['groups']=groups;subject['source']={'documentId':document['id'],'title':document['title'],'revision':reviewed['revision']}
    active_paths={root/f'data/courses/lessons/{lesson["id"]}.json' for lesson in lessons}
    for lesson in lessons:write(root/f'data/courses/lessons/{lesson["id"]}.json',lesson)
    for path in old_paths:
        if path not in active_paths:
            assert path.parent==root/'data/courses/lessons' and path.name.startswith(('quantity-p1-','quantity-wy27-'))
            path.unlink(missing_ok=True)
    all_lessons=[read(root/entry['path']) for s in manifest['subjects'] for g in s['groups'] for entry in g['lessons']]
    manifest['totals']={'subjectCount':len(manifest['subjects']),
        'groupCount':sum(len(s['groups']) for s in manifest['subjects']),
        'lessonCount':len(all_lessons),'cardCount':sum(len(l['cards']) for l in all_lessons),
        'questionCount':sum(c['type']=='question' for l in all_lessons for c in l['cards'])}
    write(root/'data/courses/manifest.json',manifest)
    library={'version':1,'revision':reviewed['revision'],
             'source':{'id':document['id'],'title':document['title'],'pageCount':169},'topics':methods}
    guide=(root/'assets/prompts/quantity.md').read_text(encoding='utf-8')
    guide_start=guide.index('我们是一名')
    library['teachingGuide']=guide[guide_start:].strip()
    write(root/'assets/prompts/quantity-wy27-methods.json',library)
    totals=manifest['totals']
    lines=['# 学习课程大纲','',
        f"{totals['subjectCount']} 个板块、{totals['groupCount']} 个题型、{totals['lessonCount']} 个学习条目、{totals['cardCount']} 张卡片、{totals['questionCount']} 道例题。",'',
        '数量关系以《王炎·27数量关系大满贯·讲义》为底层，覆盖15节349题。知识与解析统一用第一人称“我们”；题目提交后进入解析，长段落分卡。来源疑点与构建见 [数量关系讲义说明](quantity-wy27.md)。','']
    for s in manifest['subjects']:
        lines+=['## '+s['title'],'']
        for g in s['groups']:
            lines+=['### '+g['title'],'']
            lines+=[f"{i}. {e['title']}（{e['cardCount']}页，{e['questionCount']}题）" for i,e in enumerate(g['lessons'],1)]
            lines.append('')
    (root/'docs').mkdir(exist_ok=True)
    (root/'docs/course-outline.md').write_text('\n'.join(lines),encoding='utf-8')
    fixture=root/'tests/fixtures/learning-reviewed-answers.json'
    if fixture.exists():
        verified=read(fixture)
        verified['description']='Other subjects retain audited video answers; quantity uses the handout answer key plus independently written, reviewed derivations. Unverified source questions are excluded from grading.'
        verified['sourceQuestionCounts']['quantity']=349
        verified['answers']={k:v for k,v in verified['answers'].items() if not k.startswith('quantity-')}
        verified['answers'].update({q['id']:q['sourceAnswer'] for q in all_questions})
        verified.setdefault('sourceQuestionIds',{})['quantity']=[q['id'] for q in all_questions]
        verified['ungradedQuestions']=[q['id'] for q in all_questions if q.get('grading')=='unverified']
        write(fixture,verified)
    return {'sections':15,'lessons':len(lessons),'questions':len(all_questions),
            'cards':sum(len(x['cards']) for x in lessons),'methods':len(methods),
            'ungraded':sum(q.get('grading')=='unverified' for q in all_questions)}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=ROOT)
    args=parser.parse_args();print(json.dumps(build(args.root),ensure_ascii=False))
