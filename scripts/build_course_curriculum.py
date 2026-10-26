"""Build complete, first-person course cards from the audited local notes.

No network calls and no deployment. All provenance is kept in source metadata.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/courses'
LESSONS = OUT / 'lessons'
AUDIT = ROOT / 'tmp/course_curriculum'
HEADER = re.compile(r'^(\d{1,2})[.．、](?!\d)\s*(.+)$')
EXAMPLE = re.compile(r'^(?:正式)?例题(?:\s*\d+)?\s*(?:[：:（(]|$)')
OPTION = re.compile(r'^([A-H])[.．、]\s*(.*)$')
TIME = re.compile(r'(?<!\d)(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?!\d)')
ANSWER = re.compile(r'(?:所以|因此|综上|综合下来|这道题|本题|该题|最终|最后|答案)[^。\n]{0,34}?(?:选择|选|答案(?:是|为)?)[\s的就是：:]*([A-H])(?:[。 ，,、\s]|$)')

SOURCES = {
    'language': {'title': '言语理解', 'videoId': '7677994152398834998', 'videoTitle': '言语理解完整复盘', 'duration': 9451,
        'files': [f'tmp/verbal_7677994152398834998/notes_part{i}.txt' for i in range(1, 5)]},
    'reasoning': {'title': '判断推理', 'videoId': '7686460560006794547', 'videoTitle': '判断推理完整复盘', 'duration': 10776,
        'files': [f'tmp/video_7686460560006794547/notes_part{i}.txt' for i in range(1, 5)]},
    'quantity': {'title': '数量关系', 'reviewed': 'data/courses/sources/quantity-wy27-reviewed.json'},
    'analysis': {'title': '资料分析', 'videoId': '7668729047387524358', 'videoTitle': '资料分析完整复盘', 'duration': 4713,
        'files': [f'tmp/two_courses_20261025/data_analysis/notes_part{i}.txt' for i in range(1, 3)]},
}

def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8-sig').replace('\r\n', '\n')

def paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r'\n\s*\n', text.strip()) if p.strip()]

def times(text: str) -> dict:
    matches = list(TIME.finditer(text))
    if not matches:
        return {}
    values = [int(m.group(1) or 0)*3600 + int(m.group(2))*60 + int(m.group(3)) for m in matches]
    return {'startSeconds': values[0], **({'endSeconds': values[1]} if len(values)>1 else {}), 'timeLabel': matches[0].group(0) + ('—'+matches[1].group(0) if len(matches)>1 else '')}

def is_meta(line: str) -> bool:
    return bool(re.match(r'^(?:【视频|\[视频|[（(]视频|（本部分|\(本部分|本部分对应视频|本部分覆盖|范围[:：])', line) or re.match(r'^.{1,65}[（(]\d{1,2}:\d{2}.*[）)]$',line))

def public_source(source: dict) -> dict:
    allowed={'videoId','videoTitle','startSeconds','endSeconds','timeLabel','examLabel'}
    return {key:value for key,value in source.items() if key in allowed and value not in ('',None)}

def blocks(text: str) -> list[dict]:
    result=[]
    lines=text.splitlines()
    i=0
    while i<len(lines):
        line=lines[i].strip()
        if not line or is_meta(line):
            i+=1; continue
        if line.startswith('公式：') or line.startswith('公式:'):
            result.append({'type':'formula','latex':line[3:].strip()}); i+=1; continue
        if line.startswith('|') and i+1<len(lines) and re.match(r'^\|[\s:|\-]+\|?$', lines[i+1].strip()):
            split=lambda s:[c.strip() for c in s.strip().strip('|').split('|')]
            headers=split(line); rows=[]; i+=2
            while i<len(lines) and lines[i].strip().startswith('|'):
                rows.append(split(lines[i])); i+=1
            result.append({'type':'table','headers':headers,'rows':rows}); continue
        # Preserve intentional short lines, numbered premises and ordering sentences.
        result.append({'type':'paragraph','text':line})
        i+=1
    return result

def chunk_blocks(items: list[dict], limit=760, max_blocks=8) -> list[list[dict]]:
    # Short subheadings travel with their explanation; formulas travel with context.
    units=[]; i=0
    while i<len(items):
        unit=[items[i]]; i+=1
        text=unit[0].get('text','')
        subhead=unit[0]['type']=='paragraph' and len(text)<95 and bool(re.match(r'^(?:[（(][一二三四五六七八九十0-9]+[）)]|[一二三四五六七八九十]+[、.])',text))
        if subhead and i<len(items):unit.append(items[i]);i+=1
        if unit[-1]['type']=='paragraph':
            while i<len(items) and items[i]['type']=='formula' and len(unit)<5:
                unit.append(items[i]);i+=1
        units.append(unit)
    out=[]; pending=[]; size=0
    for unit in units:
        n=sum(len(item.get('text',item.get('latex',''))) + (len(json.dumps(item,ensure_ascii=False)) if item['type']=='table' else 0) for item in unit)
        if pending and (size+n>limit or len(pending)+len(unit)>max_blocks):
            out.append(pending);pending=[];size=0
        pending.extend(unit);size+=n
    if pending: out.append(pending)
    return out

def group_for(subject: str, part: int, ordinal: int, title: str, section: str) -> tuple[str,str]:
    if subject=='language':
        if part==4:return ('language-logical-fill','逻辑填空')
        if part==3:
            if ordinal<=2:return ('language-sentence-fill','语句填入')
            if ordinal<=8:return ('language-sentence-order','语句排序')
            return ('language-detail','细节判断')
        if part==2:
            if ordinal==1:return ('language-news','新闻类中心理解')
            if ordinal<=4:return ('language-title','标题选择')
            if ordinal<=12:return ('language-next-paragraph','下文推断')
            return ('language-sentence-fill','语句填入')
        if ordinal<=2:return ('language-main-idea-basics','中心理解基础')
        if ordinal<=8:return ('language-argumentative','说理类中心理解')
        if ordinal<=19:return ('language-expository','科普介绍类中心理解')
        return ('language-news','新闻类中心理解')
    if subject=='reasoning':
        if part==1:
            if ordinal<=10:return ('reasoning-causal','归因论证')
            if ordinal<=18:return ('reasoning-weaken','一般质疑')
            return ('reasoning-strengthen','一般支持')
        if part==2:
            start=times(title+'\n'+section[:250]).get('startSeconds',0)
            if start<4568:return ('reasoning-strengthen','一般支持')
            if start<5095:return ('reasoning-assumption','前提假设')
            if start<5308:return ('reasoning-explain','解释说明')
            if start<5734:return ('reasoning-special-strengthen','变化与比较支持')
            return ('reasoning-propositions','命题与形式逻辑基础')
        if part==3:return ('reasoning-conditional','条件推理')
        if ordinal<=3:return ('reasoning-syllogism','直言命题与三段论')
        if ordinal<=8:return ('reasoning-truth','真假推理')
        if ordinal<=10:return ('reasoning-analytical','分析推理')
        return ('reasoning-patterns','推理形式')
    if subject=='quantity':return ('quantity-proportion','比例、百分数与倍数')
    if part==1:
        if ordinal<=6:return ('analysis-abrx','基期、现期、增长率与增长量')
        if ordinal<=9:return ('analysis-share','比重')
        return ('analysis-mixture','混合与十字交叉')
    if ordinal==1:return ('analysis-mixture','混合与十字交叉')
    if ordinal<=5:return ('analysis-comparison','比较大小')
    if ordinal<=10:return ('analysis-average','平均数与倍数')
    return ('analysis-annual','年均增长')

def sections(subject: str, path: str, part: int) -> list[dict]:
    text=read(path)
    lines=text.splitlines()
    found=[]
    for n,line in enumerate(lines):
        m=HEADER.match(line.strip())
        if m and len(m.group(2))>=3:
            found.append((n,m.group(2)))
        elif subject=='reasoning' and part==2 and line.startswith('解释说明题：'):
            found.append((n,line.strip()))
    result=[]
    for ordinal,(start,title) in enumerate(found,1):
        end=found[ordinal][0] if ordinal<len(found) else len(lines)
        clean_title=re.sub(r'\s*[（(]\d{1,2}:\d{2}.*$', '', title).strip()
        body='\n'.join(lines[start+1:end]).strip()
        group_id,group_title=group_for(subject,part,ordinal,title,body)
        result.append({'subjectId':subject,'part':part,'ordinal':ordinal,'title':clean_title,'body':body,'sourceFile':path,'line':start+1,
            'groupId':group_id,'groupTitle':group_title,'source':{'notesFile':path,'notesLine':start+1,**times(lines[start]+'\n'+body[:300])}})
    return result

def text_cards(lesson_id: str, role: str, title: str, text: str, question_id: str|None=None, limit=760) -> list[dict]:
    chunks=chunk_blocks(blocks(text),limit)
    cards=[]
    for i,chunk in enumerate(chunks,1):
        card={'id':f'{lesson_id}-{role}-{hashlib.sha1((title+text).encode()).hexdigest()[:7]}-{i:02d}','type':'text','role':role,'title':title+(f' · {i}' if len(chunks)>1 else ''),'blocks':chunk}
        if question_id:card['questionId']=question_id
        cards.append(card)
    return cards

def parse_question(raw: str, question_id: str, fallback_title: str, source: dict) -> tuple[dict,list[dict],dict]:
    lines=raw.splitlines()
    heading=lines.pop(0).strip()
    title=re.sub(r'^(?:正式)?例题\s*\d*\s*[：:]?\s*','',heading).strip()
    if not title or title.startswith(('（','(')):title=fallback_title
    question_source={**source,**times(heading+'\n'+'\n'.join(lines[:3]))}
    meta=[]
    while lines and (not lines[0].strip() or is_meta(lines[0].strip()) or re.match(r'^【\d{4}年.+】$',lines[0].strip())):
        item=lines.pop(0).strip()
        if item:meta.append(item)
    option_at=[i for i,line in enumerate(lines) if OPTION.match(line.strip())]
    if not option_at:raise ValueError(f'No options: {question_id} {heading}')
    first=option_at[0]
    stem_lines=lines[:first]
    options=[]; i=first
    expected='A'
    while i<len(lines):
        line=lines[i].strip()
        if not line:
            i+=1
            if options and i<len(lines) and not OPTION.match(lines[i].strip()):break
            continue
        m=OPTION.match(line)
        if not m or m.group(1)!=expected:break
        options.append({'value':m.group(1),'label':m.group(2).strip()})
        expected=chr(ord(expected)+1); i+=1
    explanation='\n'.join(lines[i:]).strip()
    candidates=[m.group(1) for m in ANSWER.finditer(explanation)]
    if not candidates:
        fallback=re.findall(r'(?:选|答案是|答案为)\s*([A-H])(?:[。 ，,、\s]|$)',explanation)
        candidates=fallback
    if not candidates:
        candidates=re.findall(r'(?m)^([A-H])[，,、][^\n]{0,100}(?:选它|保留它)',explanation)
    answer=candidates[-1] if candidates else ''
    if not answer:
        AUDIT.mkdir(parents=True,exist_ok=True)
        (AUDIT/'parse-error.json').write_text(json.dumps({'id':question_id,'heading':heading,'raw':raw,'explanation':explanation,'source':source},ensure_ascii=False,indent=2),encoding='utf-8')
        raise ValueError(f'Missing answer: {question_id} {heading}')
    stem='\n'.join(line.strip() for line in stem_lines if line.strip() and not is_meta(line.strip()))
    if not stem:
        stem=title
        title=fallback_title+' · 原题'
    stem_items=blocks(stem)
    q={'id':question_id,'type':'single','stem':stem,'options':options,'answer':answer}
    if any(b['type']!='paragraph' for b in stem_items):q['stemBlocks']=stem_items
    card={'id':f'{question_id}-question','type':'question','title':title,'question':q,'source':public_source({**question_source,'originalTitle':heading,'examLabel':' '.join(meta)})}
    report={'id':question_id,'title':title,'answer':answer,'answerCandidates':candidates,'optionCount':len(options),'stemChars':len(stem),'explanationChars':len(explanation),'notesFile':source['notesFile']}
    return card,text_cards(question_id,'explanation','我们这样分析',explanation,question_id),report

def build_lesson(section: dict, q_start: int) -> tuple[dict,list[dict]]:
    subject=section['subjectId']; part=section['part']; ordinal=section['ordinal']
    lesson_id=f'{subject}-p{part}-l{ordinal:02d}'
    if subject=='language' and part==4:
        names=['basics','idiom-parts','causal','figurative','semantic','tone','consistency']
        lesson_id=f'language-logical-fill-{names[ordinal-1]}'
    body=section['body']
    implicit=False
    if subject=='analysis' and not re.search(r'(?m)^(?:正式)?例题',body) and re.search(r'(?m)^A[.．、]',body):
        a=re.search(r'(?m)^A[.．、]',body).start()
        prior=body[:a].rstrip()
        split=prior.rfind('\n\n')
        prefix=prior[:split] if split>=0 else ''
        stem=prior[split+2:] if split>=0 else prior
        body=prefix+'\n\n例题：年均增长率的格尺定位\n\n'+stem+'\n\n'+body[a:]
        implicit=True
    starts=[m.start() for m in re.finditer(r'(?m)^(?:正式)?例题(?:\s*\d+)?\s*(?:[：:（(]|$)',body)]
    cards=[]; reports=[]
    intro=body[:starts[0]] if starts else body
    intro=re.sub(r'(?m)^【视频[^\n]*\n?','',intro).strip()
    if subject=='language' and part==4 and ordinal==1:
        cards=[{'id':lesson_id+'-knowledge-01','type':'text','role':'knowledge','title':'我们先抓住两条本质','blocks':[
            {'type':'list','items':['文段和词语的逻辑关系对应','词语含义的积累和理解']},*blocks(intro)]}]
    elif subject=='language' and part==4:
        type_names=['','成语拆分','因果关系','比喻与形象化表达','语义对应','感情色彩与搭配','用词一致']
        numerals=['','一','二','三','四','五','六']
        cards.append({'id':lesson_id+'-intro','type':'text','role':'intro','title':f'题型{numerals[ordinal-1]}：{type_names[ordinal-1]}','blocks':[]})
        cards.extend(text_cards(lesson_id,'method','我们的解题思路',intro))
    else:
        cards.extend(text_cards(lesson_id,'knowledge',section['title'],intro))
    for n,start in enumerate(starts):
        end=starts[n+1] if n+1<len(starts) else len(body)
        raw=body[start:end].strip()
        question_id=f'{subject}-q{q_start+len(reports):03d}'
        private_source={**section['source'],'videoId':SOURCES[subject]['videoId'],'videoTitle':SOURCES[subject]['videoTitle']}
        q_card,analysis,report=parse_question(raw,question_id,section['title'],private_source)
        if implicit:
            teaching=[]
            for explanation_card in analysis:
                kept=[]
                for item in explanation_card['blocks']:
                    if item['type']=='table' or ('格尺法先准备' in item.get('text','')):
                        teaching.append(item)
                    else:kept.append(item)
                explanation_card['blocks']=kept
            if teaching:
                cards.append({'id':lesson_id+'-method-anchors','type':'text','role':'method','title':'我们先记住这些锚点','blocks':teaching})
            analysis=[c for c in analysis if c['blocks']]
        # Reuse any earlier, explicitly provided table as question material.
        if subject=='analysis' and not any(b['type']=='table' for b in q_card['question'].get('stemBlocks',[])):
            prior_tables=[b for c in cards for b in c.get('blocks',[]) if b['type']=='table']
            if prior_tables:q_card['question']['stemBlocks']=[*prior_tables[-1:],*blocks(q_card['question']['stem'])]
        cards.append(q_card); cards.extend(analysis); reports.append(report)
    if not cards:cards=text_cards(lesson_id,'knowledge',section['title'],body)
    return {'id':lesson_id,'subjectId':subject,'groupId':section['groupId'],'title':section['title'],
        'source':public_source({**section['source'],'videoId':SOURCES[subject]['videoId'],'videoTitle':SOURCES[subject]['videoTitle']}),'cards':cards},reports

def build(sample=False) -> None:
    LESSONS.mkdir(parents=True,exist_ok=True)
    manifest={'version':1,'subjects':[],'totals':{}}
    audit=[]; lesson_count=card_count=question_count=0; generated=set()
    for subject,config in SOURCES.items():
        if sample and subject!='language':continue
        if subject=='quantity':
            if not (ROOT/config['reviewed']).is_file():
                raise FileNotFoundError('Reviewed Wang Yan handout source is required; the retired four-example course will not be restored.')
            manifest['subjects'].append({'id':subject,'title':config['title'],'groups':[]})
            continue
        record={'id':subject,'title':config['title'],'groups':[]}; groups={}; qnum=1
        for part,path in enumerate(config['files'],1):
            if sample and part!=4:continue
            for section in sections(subject,path,part):
                lesson,reports=build_lesson(section,qnum);qnum+=len(reports)
                audit.extend(reports)
                p=LESSONS/f"{lesson['id']}.json"
                generated.add(p.resolve())
                p.write_text(json.dumps(lesson,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
                gid=section['groupId']
                if gid not in groups:
                    groups[gid]={'id':gid,'title':section['groupTitle'],'lessons':[]};record['groups'].append(groups[gid])
                groups[gid]['lessons'].append({'id':lesson['id'],'title':lesson['title'],'cardCount':len(lesson['cards']),
                    'questionCount':len(reports),'cardIds':[c['id'] for c in lesson['cards']],
                    'questionIds':[c['question']['id'] for c in lesson['cards'] if c['type']=='question'],
                    'path':p.relative_to(ROOT).as_posix()})
                lesson_count+=1;card_count+=len(lesson['cards']);question_count+=len(reports)
        manifest['subjects'].append(record)
    manifest['totals']={'subjectCount':len(manifest['subjects']),'groupCount':sum(len(s['groups']) for s in manifest['subjects']),
        'lessonCount':lesson_count,'cardCount':card_count,'questionCount':question_count}
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    AUDIT.mkdir(parents=True,exist_ok=True)
    (AUDIT/'coverage-audit.json').write_text(json.dumps({'sample':sample,'totals':manifest['totals'],'questions':audit},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    if not sample:
        # Delete only stale JSON files made by this generator, inside its verified folder.
        assert LESSONS.resolve().parent == OUT.resolve() and OUT.resolve().parent == (ROOT/'data').resolve()
        for p in LESSONS.glob('*.json'):
            if p.resolve() not in generated and re.fullmatch(r'(?:language|reasoning|quantity|analysis)-(?:p\d-l\d+|logical-fill-[a-z-]+)\.json',p.name):p.unlink()
        for filename in ('coverage-audit.json','parse-error.json'):
            p=OUT/filename
            if p.is_file():p.unlink()
    if not sample:
        from build_quantity_wy27 import build as build_quantity
        build_quantity(ROOT)
        manifest=json.loads((OUT/'manifest.json').read_text(encoding='utf-8'))
    print(json.dumps(manifest['totals'],ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--sample',action='store_true')
    build(parser.parse_args().sample)
