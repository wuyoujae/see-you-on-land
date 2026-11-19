"""Create a reviewed GPL-3.0 OMIB adaptation; never executes upstream code."""
from __future__ import annotations
import collections,copy,hashlib,json,random,shutil,xml.etree.ElementTree as ET,zipfile
from pathlib import Path

HERE=Path(__file__).parent
PACKAGED=(HERE/'original-source').is_dir()
BASE=HERE.parent if PACKAGED else HERE
OUT=HERE if PACKAGED else BASE/'omib-adapted'
RAW=OUT/'original-source'
SVGS=OUT/'adapted-svg'
ASSETS=OUT/'assets/images/question-bank/focused'
SELECTED=[1,2,3,4,5,6,21,22,24,25,26,28,30,35,71,74,77,81,82,89,151,160,201,210]
NS='http://www.w3.org/2000/svg'
ET.register_namespace('',NS)
GROUP_NAMES=['角落黑三角','菱形边线','边缘黑矩形','中心图形','内圈黑三角']
POSITIONS=[['左上','左下','右下','右上'],['左上边','左下边','右下边','右上边'],['上','左','下','右'],['实心方形','空心方形','实心圆','空心圆'],['上','左','下','右']]
RULE_CN={'addition':'合并','subtraction':'相减','xor':'异或','intersection':'交集','rotation':'旋转','completeness':'补全'}
RULE_TEXT={
 'addition':'将前两格中出现的位置合并，重复位置只保留一个',
 'subtraction':'从第一格中删去第二格也出现的位置',
 'xor':'将前两格同位置都有的部分消去，只保留仅出现一次的部分',
 'intersection':'只保留前两格同位置都有的部分',
}

def tag(n):return f'{{{NS}}}{n}'
def clean(el):
    el=copy.deepcopy(el)
    for node in el.iter():
        node.attrib={k:v for k,v in node.attrib.items() if k not in ['id','class'] and not k.startswith('data-')}
    return el
def canonical(el):
    return (el.tag.split('}')[-1],tuple(sorted((k,v) for k,v in el.attrib.items() if k not in ['id','class'] and not k.startswith('data-'))))
def svgbytes(root):return ET.tostring(root,encoding='utf-8',xml_declaration=True)
def display(g,bits):
    found=[p for p,v in zip(POSITIONS[g],bits) if v=='1']
    if not found:return '无该类图形'
    return '、'.join(found)
def bitop(name,a,b):
    x,y=int(a,2),int(b,2)
    return f'{dict(addition=x|y,subtraction=x&(~y)&15,xor=x^y,intersection=x&y)[name]:04b}'
def rot(s,k):return s[-k:]+s[:-k]
def hash_file(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    for p in [OUT,RAW,SVGS,ASSETS,OUT/'review']:p.mkdir(parents=True,exist_ok=True)
    source=RAW if PACKAGED else BASE/'open-matrices-item-bank'
    zmat=zipfile.ZipFile(source/'Figural Matrices.zip')
    zparts=zipfile.ZipFile(source/'Construction Elements.zip')
    components=[]
    for i in range(1,21):
        b=zparts.read(f'Option{i}.svg');(RAW/f'Option{i}.svg').write_bytes(b)
        components.append([clean(e) for e in ET.fromstring(b) if e.tag!=tag('defs')])
    for name in ['Item Data.xlsx','Instructions for Implementation.docx','instructions-text.txt','archive-audit.json']:
        if (source/name).resolve()!=(RAW/name).resolve():shutil.copyfile(source/name,RAW/name)
    if not PACKAGED:shutil.copyfile(BASE/'WellyZhang__RAVEN/LICENSE',OUT/'GPL-3.0.txt')
    audit=json.loads(((RAW if PACKAGED else BASE)/'omib-model-audit.json').read_text(encoding='utf-8'))
    byid={x['item']:x for x in audit}
    candidates=[]; render=[];checks=[]
    answer_positions=[0,1,2,3]*6
    random.Random(20261118).shuffle(answer_positions)
    def component_svg(bits):
        root=ET.Element(tag('svg'),{'viewBox':'-2 -2 104 104'})
        ET.SubElement(root,tag('rect'),{'x':'-2','y':'-2','width':'104','height':'104','fill':'white'})
        ET.SubElement(root,tag('rect'),{'x':'0','y':'0','width':'100','height':'100','fill':'white','stroke':'black','stroke-width':'1'})
        for enabled,parts in zip(bits,components):
            if enabled=='1':
                for el in parts:root.append(copy.deepcopy(el))
        return root
    for serial,item in enumerate(SELECTED,1):
        m=byid[item];assert m['eligible'] and len(m['assignments'])==1
        assignment=m['assignments'][0]['groups'];cells=m['code'].split(',');correct=m['answer'];assert cells[-1]==correct
        raw=zmat.read(f'Item_{item}.svg');(RAW/f'Item_{item}.svg').write_bytes(raw)
        stem=ET.fromstring(raw)
        visible=[el for el in stem if el.tag==tag('svg')]
        assert len(visible)==8,(item,'visible cell count',len(visible))
        # Match every visible geometric primitive to the original 20-bit encoding.
        for cell_idx,cell in enumerate(visible):
            actual=collections.Counter(canonical(el) for el in cell if el.tag!=tag('defs'))
            expected=collections.Counter(canonical(el) for enabled,parts in zip(cells[cell_idx],components) if enabled=='1' for el in parts)
            assert actual==expected,(item,cell_idx,actual,expected)
        stem=clean(stem)
        stem.insert(0,ET.Element(tag('rect'),{'x':'0','y':'0','width':'320','height':'320','fill':'white'}))
        ET.SubElement(stem,tag('text'),{'x':'270','y':'280','text-anchor':'middle','font-family':'Arial','font-size':'36','fill':'#555'}).text='?'
        prefix=f'omib-{serial:03d}'
        fstem=SVGS/f'{prefix}-stem.svg';fstem.write_bytes(svgbytes(stem))
        render.append({'input':fstem.relative_to(OUT).as_posix(),'output':(ASSETS/f'{prefix}-stem.png').relative_to(OUT).as_posix(),'width':640,'height':640})

        # Wrong choices alter a single actual component group. Prefer plausible
        # wrong operations/copying/rotation; never introduce an absent shape family.
        wrong_pools={}
        for gs,rule in assignment.items():
            g=int(gs);a=cells[6][4*g:4*g+4];b=cells[7][4*g:4*g+4];right=correct[4*g:4*g+4]
            vals=[]
            if g==3:
                vals=[('复制已知中心图形',s) for s in [a,b]]+[('混淆中心图形种类',f'{1<<k:04b}') for k in range(4)]
            else:
                vals=[('误用'+RULE_CN[k],bitop(k,a,b)) for k in ['addition','subtraction','xor','intersection']]
                vals += [('倒置相减顺序',bitop('subtraction',b,a)),('复制第一格',a),('复制第二格',b)]
                vals += [('旋转方向或角度混淆',rot(b,k)) for k in [1,2,3]]
                vals += [('漏计或多计一个部件',right[:k]+('0' if right[k]=='1' else '1')+right[k+1:]) for k in range(4)]
            seen={correct};pool=[]
            for why,v in vals:
                code=correct[:4*g]+v+correct[4*g+4:]
                if code in seen:continue
                seen.add(code);pool.append({'code':code,'group':g,'reason':why,'replacement':v})
            # Keep comparable density before large omissions while remaining deterministic.
            pool.sort(key=lambda x:(abs(x['code'].count('1')-correct.count('1')),x['reason'].startswith('漏计')))
            wrong_pools[g]=pool
        wrong=[];used={correct};groups=list(wrong_pools)
        for round_no in range(12):
            for g in groups:
                pool=wrong_pools[g]
                if round_no>=len(pool):continue
                v=pool[round_no]
                if v['code'] in used:continue
                wrong.append(v);used.add(v['code'])
                if len(wrong)==3:break
            if len(wrong)==3:break
        assert len(wrong)==3
        # A/B/C/D each occurs exactly six times across this 24-item set.
        correct_index=answer_positions[serial-1]
        choices=wrong[:];random.Random(10000+item).shuffle(choices)
        choices.insert(correct_index,{'code':correct,'reason':'原题答案'})
        options=[]
        for k,choice in enumerate(choices):
            letter='ABCD'[k];svg=SVGS/f'{prefix}-{letter.lower()}.svg';svg.write_bytes(svgbytes(component_svg(choice['code'])))
            render.append({'input':svg.relative_to(OUT).as_posix(),'output':(ASSETS/f'{prefix}-{letter.lower()}.png').relative_to(OUT).as_posix(),'width':208,'height':208})
            options.append({'value':letter,'label':letter,'blocks':[{'type':'image','src':f'assets/images/question-bank/focused/{prefix}-{letter.lower()}.png','alt':f'选项{letter}图形'}]})
        answer='ABCD'[correct_index]
        paragraphs=['按行观察，把不同种类的图形分开寻找规律。' if m['ruleCount']>1 else '按行观察前两格与第三格之间的关系。']
        group_checks=[]
        for gs,f in assignment.items():
            g=int(gs);r=f['rule'];v=[c[4*g:4*g+4] for c in cells]
            if r in RULE_TEXT:
                ruletext=f'每行第三格的生成方法是：{RULE_TEXT[r]}'
            elif r=='rotation':
                angle={1:'逆时针旋转90°',2:'旋转180°',3:'顺时针旋转90°'}[f['step']]
                ruletext=f'从左到右，每次{angle}'
            else:
                names=[display(g,x) for x in f['collection']]
                ruletext='每行都包含同一组图形：'+'、'.join(names)+'，每种恰好出现一次'
            sentence=f'{GROUP_NAMES[g]}：{ruletext}。第三行前两格分别为“{display(g,v[6])}”和“{display(g,v[7])}”，所以待补部分为“{display(g,v[8])}”。'
            paragraphs.append(sentence)
            group_checks.append({'group':g,'groupName':GROUP_NAMES[g],'rule':r,'ruleName':RULE_CN[r],'rotationSteps':f.get('step'),'collection':f.get('collection'),'visibleGroups':v[:8],'predicted':f['predicted']})
        paragraphs.append(f'将各类图形的结果合在同一格，只有选项{answer}完全符合，故选{answer}。')
        obj={'id':f'focus-omib-{serial:03d}','kind':'figures','skillId':'figure-open-matrices','skillTitle':'矩阵综合',
             'difficulty':'standard' if m['ruleCount']<=2 else 'challenge',
             'stem':'从四个选项中选择最合适的一项填入问号处，使每行图形遵循相同规律。',
             'stemBlocks':[{'type':'image','src':f'assets/images/question-bank/focused/{prefix}-stem.png','alt':'三行三列的图形矩阵，右下格待补'}],
             'options':options,'answer':answer,'explanationBlocks':[{'type':'paragraph','text':p} for p in paragraphs],
             'verification':{'status':'pending','originalItemId':item,'originalAnswerCode':correct,'originalCompleteCode':m['code'],
                 'constructionRules':[RULE_CN[r] for r in m['rules']],'ruleCount':m['ruleCount'],'groupChecks':group_checks,
                 'optionCodes':{l:x['code'] for l,x in zip('ABCD',choices)},'distractors':{l:{k:v for k,v in x.items() if k!='code'} for l,x in zip('ABCD',choices) if l!=answer},
                 'visiblePrimitiveComparison':{'cells':8,'status':'exact-source-match'},'sourceSvgSha256':hashlib.sha256(raw).hexdigest(),
                 'sourceAnswerTableSha256':hash_file(source/'Item Data.xlsx'),
                 'method':'Infer component rules from eight visible cells, compare with original key, verify all source SVG primitives; independently recheck all rows and four options.'},
             'provenance':{'kind':'adapted-open','provider':'Open Matrices Item Bank (Koch, Spinath, Greiff & Becker, 2022)',
                 'sourceUrl':'https://osf.io/4km79/','originalItemId':item,'license':'GPL-3.0','licenseUrl':'https://www.gnu.org/licenses/gpl-3.0.html',
                 'licenseEvidenceUrl':'https://pmc.ncbi.nlm.nih.gov/articles/PMC9326670/',
                 'adaptationNote':'保留原矩阵及原答案，用原构造部件新增四选一选项；中文解析、干扰项与难度标签为本项目编写，非原作者解析。',
                 'explanationProvenance':'本项目依据原题部件编码和构造规则编写并复核。'}}
        candidates.append(obj)
        checks.append({'id':obj['id'],'sourceItem':item,'rules':obj['verification']['constructionRules'],'optionsDistinct':len({c['code'] for c in choices})==4,'correctOptions':sum(c['code']==correct for c in choices)})
    (OUT/'candidates.json').write_text(json.dumps(candidates,ensure_ascii=False,indent=2),encoding='utf-8')
    (OUT/'render-manifest.json').write_text(json.dumps(render,ensure_ascii=False,indent=2),encoding='utf-8')
    (OUT/'build-checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf-8')
    (OUT/'ATTRIBUTION.md').write_text('''# Open Matrices Item Bank adaptation

Original item bank: Koch, M., Spinath, F. M., Greiff, S., & Becker, N. (2022). Development and Validation of the Open Matrices Item Bank. Journal of Intelligence, 10(3), 41. https://doi.org/10.3390/jintelligence10030041

Source distribution: https://osf.io/4km79/ . Original authors explicitly distribute the **item bank under GPLv3** in the abstract of https://pmc.ncbi.nlm.nih.gov/articles/PMC9326670/ . The article's separate CC BY license must not be substituted for the item bank license.

These adapted matrices, options, SVGs, data, and adaptation helper are distributed under GNU GPL v3. See GPL-3.0.txt. Preserve this notice and the corresponding source when redistributing. This staging directory includes original SVG stems, the 20 original component SVGs, the original answer table, and reproducible adaptation source. It does not claim endorsement by the original authors.

Changes: add a question mark; render PNGs on an opaque white background; compose four single-choice answer figures from original components; write Chinese explanations and distractor rationales. Difficulty labels refer to practice rule complexity, not an IQ score. The original study's psychometric parameters were not recalibrated for this modified choice format.

Original selected item IDs: 1, 2, 3, 4, 5, 6, 21, 22, 24, 25, 26, 28, 30, 35, 71, 74, 77, 81, 82, 89, 151, 160, 201, 210.
''',encoding='utf-8')
    print(json.dumps({'candidates':len(candidates),'renderJobs':len(render),'answers':dict(collections.Counter(q['answer'] for q in candidates)),'difficulty':dict(collections.Counter(q['difficulty'] for q in candidates))},ensure_ascii=False))

if __name__=='__main__':main()
