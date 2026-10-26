"""Import publicly collected national exam originals with per-paper provenance.

The source's heading '官方解析' is deliberately NOT used as a provider claim.
No UI writes, no deployment, no repository scripts are executed.
"""
from __future__ import annotations
import argparse, collections, hashlib, html, json, re, shutil
from pathlib import Path
from urllib.parse import quote, unquote, urlparse
from bs4 import BeautifulSoup, NavigableString, Tag
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
RESEARCH=ROOT/'tmp/national_exam_research'
RAW=RESEARCH/'raw/ERRRC'
OUT=ROOT/'data/question-bank'
ASSETS=ROOT/'assets/images/question-bank'
SUBJECTS=[('politics','政治理论','01-政治理论'),('common','常识判断','02-常识判断'),('language','言语理解与表达','03-言语理解与表达'),('quantity','数量关系','04-数量关系'),('reasoning','判断推理','05-判断推理'),('analysis','资料分析','06-资料分析')]
PROVIDER='公开整理题库参考答案'
# These two standalone arithmetic questions were placed after a material group
# in the upstream analysis module. Preserve the upstream locator separately.
RECLASSIFIED_QIDS={'5445878':'quantity','5893530':'quantity'}
repo_index=json.loads((RESEARCH/'errrc-national-index.json').read_text(encoding='utf8')) if (RESEARCH/'errrc-national-index.json').exists() else {}
COMMIT=repo_index.get('commit','main')
missing_images=set();used_images=set();download_provenance=[]

def dump(path:Path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf8')

def source_url(path:Path):
    rel=path.relative_to(RAW).as_posix()
    return f'https://github.com/ERRRC/xingcezhenti/blob/{COMMIT}/'+quote(rel,safe='/')

def picture(src:str,md:Path,alt='',formula=False,attrs=None):
    src=unquote(src).split('?')[0]
    if src.startswith(('http://','https://','data:')):
        missing_images.add('external:'+src)
        return {'type':'paragraph','text':'[原图待核：'+src+']'}
    p=(md.parent/src).resolve()
    try:rel=p.relative_to(RAW.resolve())
    except ValueError:
        missing_images.add('outside:'+str(p));return {'type':'paragraph','text':'[原图路径待核]'}
    # Keep original image bytes; image names preserve their source identities.
    category='formula' if '公式图' in rel.parts else 'question'
    dest=ASSETS/'errrc'/category/p.name
    used_images.add(str(p))
    if p.exists():
        dest.parent.mkdir(parents=True,exist_ok=True)
        if not dest.exists() or dest.stat().st_size!=p.stat().st_size:shutil.copy2(p,dest)
        try:
            with Image.open(p) as im:width,height=im.size
        except Exception:width=height=0
    else:
        missing_images.add(str(rel));width=height=0
    block={'type':'image','src':dest.relative_to(ROOT).as_posix(),'alt':alt or ('原题公式' if formula or category=='formula' else '原题图示')}
    if width and height:block.update(width=width,height=height)
    if formula or category=='formula':block['isFormula']=True
    return block

SUP=str.maketrans('0123456789+-=()','⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾')
SUB=str.maketrans('0123456789+-=()','₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎')
def rich(text:str,md:Path):
    """Convert a small allowed HTML/Markdown subset into inert ordered blocks."""
    text=re.sub(r'!\[([^\]]*)\]\(([^)]+)\)',lambda m:'<img alt="'+html.escape(m.group(1),quote=True)+'" src="'+html.escape(m.group(2),quote=True)+'">',text)
    text=re.sub(r'!\[\[([^\]]+)\]\]',lambda m:'<img src="../'+html.escape(m.group(1),quote=True)+'">',text)
    text=text.replace('**','').replace('　✅','').replace('✅','')
    text=re.sub(r'(?m)^---\s*$','',text)
    fragments=re.split(r'\n\s*\n',text.strip())
    result=[];buffer=[];parts=[]
    def flush_text():
        s=re.sub(r'[\t\r\n ]+',' ',''.join(buffer));buffer.clear()
        if s:parts.append({'type':'text','text':html.unescape(s)})
    def flush():
        flush_text()
        if parts:
            if parts[0].get('type')=='text':parts[0]['text']=parts[0]['text'].lstrip()
            if parts[-1].get('type')=='text':parts[-1]['text']=parts[-1]['text'].rstrip()
            nonempty=[p for p in parts if p.get('type')!='text' or p.get('text')]
            text=''.join(p.get('text','') for p in nonempty)
            if any(p.get('type')=='image' or p.get('underline') for p in nonempty):
                result.append({'type':'paragraph','text':text,'parts':nonempty})
            elif text:result.append({'type':'paragraph','text':text})
        parts.clear()
    def walk(node):
        if isinstance(node,NavigableString):buffer.append(str(node));return
        if not isinstance(node,Tag):return
        name=node.name.lower()
        if name in ('script','style','iframe','object','embed'):return
        if name=='u' and not node.find('img'):
            flush_text()
            value=node.get_text('',strip=False)
            value=re.sub(r'[\t\r\n ]+',' ',value)
            parts.append({'type':'text','text':value if value.strip() else '________','underline':True})
            return
        if name=='img':
            formula=node.get('flag')=='tex' or '公式图' in unquote(node.get('src',''))
            if formula:
                flush_text();b=picture(node.get('src',''),md,node.get('alt',''),True,node.attrs)
                if b.get('type')=='image':b['inline']=True
                parts.append(b)
            else:
                flush();result.append(picture(node.get('src',''),md,node.get('alt',''),False,node.attrs))
            return
        if name=='table':
            flush();rows=[];headers=[]
            for tr in node.find_all('tr'):
                cells=tr.find_all(['th','td'],recursive=False)
                vals=[c.get_text(' ',strip=True) for c in cells]
                if cells and all(c.name=='th' for c in cells) and not headers:headers=vals
                elif vals:rows.append(vals)
            if headers or rows:result.append({'type':'table','headers':headers,'rows':rows})
            for image in node.find_all('img'):result.append(picture(image.get('src',''),md,image.get('alt',''),image.get('flag')=='tex'))
            return
        if name in ('sup','sub'):
            val=node.get_text('',strip=True)
            buffer.append(val.translate(SUP if name=='sup' else SUB) if re.fullmatch(r'[0-9+\-=()]+',val) else ('^('+val+')' if name=='sup' else '_('+val+')'));return
        boundary=name in ('p','div','br','li','ul','ol','h1','h2','h3','h4','blockquote')
        if boundary:flush()
        for child in node.children:walk(child)
        if boundary:flush()
    for fragment in fragments:
        soup=BeautifulSoup(fragment,'html.parser')
        for node in soup.contents:walk(node)
        flush()
    return result

def plain(blocks):
    return '\n'.join(b['text'] for b in blocks if b['type']=='paragraph')

def variant_of(title):
    if '行政执法' in title:return 'law-enforcement','行政执法'
    if '副省' in title:return 'provincial','副省级'
    if '地市' in title:return 'municipal','地市级'
    return 'unified','统一卷'

def parse_md(md:Path,subject_id:str):
    text=md.read_text(encoding='utf-8-sig')
    year=int(re.search(r'(20\d{2})年',md.name).group(1))
    slug,variant=variant_of(md.stem)
    paper_id=f'national-{year}-{slug}'
    label='网友回忆版' if '网友回忆' in md.stem else '公开整理版（未核实为官方发布）'
    headers=list(re.finditer(r'(?m)^(#{2,3})\s+(材料\s*\d+|第\s*\d+\s*题[^\n]*)\n',text))
    material=None;material_remaining=0;output=[];issues=[]
    for i,m in enumerate(headers):
        body=text[m.end():headers[i+1].start() if i+1<len(headers) else len(text)].strip()
        if m.group(2).startswith('材料'):
            material={'id':'material-'+hashlib.sha1(body.encode()).hexdigest()[:16],'blocks':rich(body,md)}
            # Upstream keeps emitting ### headings after a material group and
            # supplies no closing marker. National exam material sets here are
            # five questions; the 2021 language split is 2 + 3 + 5, ended by the
            # next material header. Do not attach the last passage to every
            # following independent analogy, fill-in, or arithmetic question.
            material_remaining=5
            continue
        if m.group(1)=='##' or material_remaining<=0:material=None
        if material:material_remaining-=1
        qid=re.search(r'qid\s*(\d+)',m.group(2))
        number=int(re.search(r'第\s*(\d+)\s*题',m.group(2)).group(1))
        if not qid:issues.append({'file':str(md),'number':number,'issue':'missing_qid'});continue
        qid=qid.group(1)
        am=re.search(r'(?m)^\*\*答案\*\*[：:]\s*([^\n]+)',body)
        if not am:issues.append({'file':str(md),'number':number,'qid':qid,'issue':'missing_answer'});continue
        opt_matches=list(re.finditer(r'(?m)^-\s*\*\*([A-H])\*\*[.．、]\s*(.*)$',body[:am.start()]))
        if not opt_matches:issues.append({'file':str(md),'number':number,'qid':qid,'issue':'missing_options'});continue
        stem_raw=body[:opt_matches[0].start()].strip()
        opts=[]
        for j,o in enumerate(opt_matches):
            stop=opt_matches[j+1].start() if j+1<len(opt_matches) else am.start()
            option_body=body[o.start():stop]
            option_body=re.sub(r'^-\s*\*\*[A-H]\*\*[.．、]\s*','',option_body).strip().replace('✅','').strip()
            option_blocks=rich(option_body,md)
            option={'value':o.group(1),'label':plain(option_blocks) or ('选项 '+o.group(1)+'（见图）')}
            if any(b['type']!='paragraph' or b.get('parts') for b in option_blocks):option['blocks']=option_blocks
            opts.append(option)
        answer_raw=am.group(1).strip()
        answer=''.join(re.findall(r'[A-H]',answer_raw))
        if not answer or any(x not in [o['value'] for o in opts] for x in answer):
            issues.append({'file':str(md),'number':number,'qid':qid,'issue':'unsupported_answer','raw':answer_raw});continue
        explanation_raw=body[am.end():].strip()
        explanation_raw=re.sub(r'^\*\*官方解析\*\*\s*','',explanation_raw).strip()
        stem_blocks=rich(stem_raw,md)
        explanation=rich(explanation_raw,md)
        final_subject=RECLASSIFIED_QIDS.get(qid,subject_id)
        ref={'paperId':paper_id,'year':year,'variant':variant,'subjectId':final_subject,'url':source_url(md),'answerUrl':source_url(md)}
        source={'year':year,'variant':variant,'sourceModuleId':subject_id,'sourceModuleNumber':number,'url':source_url(md),'answerUrl':source_url(md),'repoCommit':COMMIT,'qid':qid,'versionLabel':label}
        if final_subject==subject_id:
            ref['moduleNumber']=number;source['moduleNumber']=number
        else:
            ref.update(sourceModuleId=subject_id,sourceModuleNumber=number)
            source['classificationNote']='独立数学运算题；上游误置于资料分析，未附加该模块前面的无关材料。'
        question={'id':'national-qid-'+qid,'subjectId':final_subject,'type':'single' if len(answer)==1 else 'multiple',
            'stem':plain(stem_blocks) or '请根据原题图示作答。','stemBlocks':stem_blocks,'options':opts,'answer':answer if len(answer)==1 else list(answer),
            'sourceAnswer':{'answer':answer if len(answer)==1 else list(answer),'explanationBlocks':explanation,'provider':PROVIDER,'url':source_url(md)},
            'source':source,'paperRefs':[ref]}
        if material and final_subject==subject_id:question.update(materialId=material['id'],materialBlocks=material['blocks'])
        output.append(question)
    expected=re.search(r'(?m)^题数:\s*"?(\d+)',text)
    if expected and int(expected.group(1))!=len(output):issues.append({'file':str(md),'issue':'count_mismatch','expected':int(expected.group(1)),'parsed':len(output)})
    return {'id':paper_id,'title':md.stem,'year':year,'variant':variant,'versionLabel':label},output,issues

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    questions={};papers={};issues=[];source_counts=[];conflicts=[]
    for subject_id,title,folder in SUBJECTS:
        files=sorted((RAW/folder).glob('*.md'))
        for md in files:
            if '国家公务员' not in md.name:continue
            year=int(md.name[:4])
            if not 2014<=year<=2026:continue
            paper,parsed,problems=parse_md(md,subject_id);issues.extend(problems)
            source_counts.append({'file':md.relative_to(RESEARCH).as_posix(),'url':source_url(md),'paperId':paper['id'],'subjectId':subject_id,'questionCount':len(parsed)})
            p=papers.setdefault(paper['id'],{**paper,'questionIds':[],'subjectCounts':{},'sourceUrls':[],'ordering':'按六大类与来源模块内题号排列；不声称恢复原卷全局题号'})
            p['sourceUrls'].append(source_url(md))
            for q in parsed:
                if q['id'] in questions:
                    old=questions[q['id']]
                    if old['stemBlocks']!=q['stemBlocks'] or old['options']!=q['options'] or old.get('materialBlocks')!=q.get('materialBlocks'):
                        suffix=hashlib.sha1(json.dumps([q['stemBlocks'],q['options'],q.get('materialBlocks')],ensure_ascii=False).encode()).hexdigest()[:8]
                        q['id']+='-v'+suffix
                        conflicts.append({'kind':'same_qid_content_variant','qid':q['source']['qid'],'id':q['id'],'paperId':p['id']})
                    elif old['answer']!=q['answer']:
                        conflicts.append({'kind':'answer_disagreement','id':q['id'],'answers':[old['answer'],q['answer']],'urls':[old['source']['url'],q['source']['url']]})
                        old['answerStatus']='conflicting_reference_answers'
                        old.setdefault('referenceAnswers',[old['sourceAnswer']]).append(q['sourceAnswer'])
                        old['answer']=None
                if q['id'] in questions:
                    old=questions[q['id']]
                    for ref in q['paperRefs']:
                        if ref not in old['paperRefs']:old['paperRefs'].append(ref)
                else:questions[q['id']]=q
                if q['id'] not in p['questionIds']:p['questionIds'].append(q['id'])
    # Early-year extractor is independent; no invented answers or source replacement.
    eq=RESEARCH/'early/early-questions.json';ep=RESEARCH/'early/early-papers.json'
    if eq.exists():
        for q in json.loads(eq.read_text(encoding='utf-8-sig')):
            q['sourceAnswer']['provider']=PROVIDER
            questions[q['id']]=q
    if ep.exists():
        for p in json.loads(ep.read_text(encoding='utf-8-sig')):
            p.setdefault('ordering','按独立原卷PDF确证的全局题号排列')
            papers[p['id']]=p
    supplement=RESEARCH/'supplement/supplement-questions.json'
    if supplement.exists():
        for q in json.loads(supplement.read_text(encoding='utf-8-sig')):
            questions[q['id']]=q
            for ref in q['paperRefs']:
                p=papers[ref['paperId']]
                if q['id'] not in p['questionIds']:p['questionIds'].append(q['id'])
                p.setdefault('sourceUrls',[])
                for u in [q['source']['url'],q['sourceAnswer']['url']]:
                    if u not in p['sourceUrls']:p['sourceUrls'].append(u)
    subject_records=[]
    for subject_id,title,folder in SUBJECTS:
        values=[q for q in questions.values() if q['subjectId']==subject_id]
        values.sort(key=lambda q:(min(r['year'] for r in q['paperRefs']),q['id']))
        path=OUT/'subjects'/f'{subject_id}.json'
        dump(path,{'id':subject_id,'title':title,'questions':values})
        subject_records.append({'id':subject_id,'title':title,'path':path.relative_to(ROOT).as_posix(),'questionCount':len(values),'questionIds':[q['id'] for q in values]})
    paper_records=[]
    subject_rank={sid:i for i,(sid,_,_) in enumerate(SUBJECTS)}
    for p in sorted(papers.values(),key=lambda p:(p['year'],p['id'])):
        if p['year']>=2016:
            # Keep stable upstream order within each broad subject. Questions
            # corrected from a wrong source module and the one supplement join
            # their correct subject, without inventing a global question number.
            original_position={qid:i for i,qid in enumerate(p['questionIds'])}
            p['questionIds'].sort(key=lambda qid:(subject_rank[questions[qid]['subjectId']],original_position[qid]))
            p['ordering']='按六大类及来源模块内顺序排列；补缺题置于对应大类末尾，不声称恢复原卷全局题号'
        p['subjectCounts']=dict(collections.Counter(questions[qid]['subjectId'] for qid in p['questionIds']))
        p['questionCount']=len(p['questionIds'])
        path=OUT/'papers'/f"{p['id']}.json";dump(path,p)
        paper_records.append({k:p[k] for k in ('id','title','year','variant','questionCount','subjectCounts')}|{'path':path.relative_to(ROOT).as_posix()})
    def image_paths(obj):
        if isinstance(obj,dict):
            if obj.get('type')=='image':yield obj['src']
            for v in obj.values():yield from image_paths(v)
        elif isinstance(obj,list):
            for v in obj:yield from image_paths(v)
    all_images=set(image_paths(list(questions.values())))
    sources=[{'id':'ERRRC/xingcezhenti','url':'https://github.com/ERRRC/xingcezhenti','repoCommit':COMMIT,'versionLabel':'公开整理/网友回忆版','licenseStatus':'未在上游根目录发现独立LICENSE；不将整理者解析表述为官方答案'}]
    if supplement.exists() or eq.exists():
        sources.append({'id':'Yaoyuan-Zhang319/AdministrativeAptitudeTest','url':'https://github.com/Yaoyuan-Zhang319/AdministrativeAptitudeTest','versionLabel':'公开收集PDF原题与参考解析','usage':'2014/2015原题及答案绑定、2022副省级第4题原图及参考答案补缺；逐题链接保留在source/sourceAnswer中'})
    manifest={'version':1,'title':'2014—2026 年国考行测真题','yearRange':[2014,2026],
        'answerProviderNotice':'答案与解析来自公开整理题库或所列参考来源，非考试主管机关官方答案。回忆版按来源如实标注。',
        'subjects':subject_records,'papers':paper_records,'totals':{'subjectCount':6,'paperCount':len(paper_records),'questionCount':len(questions),'paperQuestionCount':sum(p['questionCount'] for p in paper_records),'imageCount':len(all_images)},
        'sources':sources}
    dump(OUT/'manifest.json',manifest)
    coverage={'totals':manifest['totals'],'papers':paper_records,'sourceCounts':source_counts,'parseIssues':issues,'conflicts':conflicts,'missingImages':sorted(missing_images)}
    dump(RESEARCH/'import-audit.json',coverage)
    sample=[q for q in questions.values() if q['subjectId'] in ('reasoning','analysis','quantity')][-6:]
    dump(RESEARCH/'sample-questions.json',sample)
    print(json.dumps({'totals':manifest['totals'],'parseIssues':len(issues),'conflicts':len(conflicts),'missingImages':len(missing_images)},ensure_ascii=False))
if __name__=='__main__':main()
