"""Independent integer/set verification of all 24 OMIB adaptations. GPL-3.0."""
import collections,hashlib,json
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
BASE=Path(__file__).parent
items=json.loads((BASE/'candidates.json').read_text(encoding='utf-8'))
reports=[]
for q in items:
    v=q['verification'];parts=v['originalCompleteCode'].split(',');key=v['originalAnswerCode']
    assert len(parts)==9 and all(len(x)==20 and set(x)<={'0','1'} for x in parts)
    assert parts[-1]==key and v['optionCodes'][q['answer']]==key
    computed=['0000']*5
    for check in v['groupChecks']:
        g=check['group'];values=[int(s[4*g:4*g+4],2) for s in parts];name=check['rule']
        for row in range(3):
            a,b,c=values[3*row:3*row+3]
            if name=='addition':expected=a|b
            elif name=='subtraction':expected=a&(~b)&15
            elif name=='xor':expected=a^b
            elif name=='intersection':expected=a&b
            elif name=='rotation':
                k=check['rotationSteps'];rotate=lambda x:((x>>k)|(x<<(4-k)))&15
                assert rotate(a)==b
                expected=rotate(b)
            elif name=='completeness':
                full=collections.Counter(values[:3]);left=full-collections.Counter([a,b])
                assert sum(left.values())==1 and collections.Counter([a,b,c])==full
                expected=next(iter(left))
            else:raise AssertionError(name)
            assert expected==c,(q['id'],g,row,expected,c)
        computed[g]=f'{expected:04b}'
    assert ''.join(computed)==key
    assert len(set(v['optionCodes'].values()))==4
    assert sum(code==key for code in v['optionCodes'].values())==1
    # Also test all six simple rule families without using the source's rule
    # labels: no distractor may fit another obvious row rule for every group.
    allowed={}
    for g in range(5):
        vs=[int(s[4*g:4*g+4],2) for s in parts[:8]];pred=set()
        for fn in [lambda a,b:a|b,lambda a,b:a&(~b)&15,lambda a,b:a^b,lambda a,b:a&b]:
            if fn(vs[0],vs[1])==vs[2] and fn(vs[3],vs[4])==vs[5]:pred.add(fn(vs[6],vs[7]))
        if g!=3:
            for k in [1,2,3]:
                f=lambda n:((n>>k)|(n<<(4-k)))&15
                if all(f(vs[r])==vs[r+1] and f(vs[r+1])==vs[r+2] for r in [0,3]) and f(vs[6])==vs[7]:pred.add(f(vs[7]))
        c=collections.Counter(vs[:3]);known=collections.Counter(vs[6:8]);left=c-known
        if c==collections.Counter(vs[3:6]) and not known-c and sum(left.values())==1:pred.add(next(iter(left)))
        allowed[g]=pred
    accepted=[letter for letter,code in v['optionCodes'].items() if all(int(code[4*g:4*g+4],2) in allowed[g] for g in range(5))]
    assert accepted==[q['answer']],('alternative plausible option',q['id'],accepted)
    image_hashes=[]
    for option in q['options']:
        f=BASE/option['blocks'][0]['src'];im=Image.open(f).convert('RGB');assert im.size==(208,208)
        image_hashes.append(hashlib.sha256(im.tobytes()).hexdigest())
    assert len(set(image_hashes))==4,('rendered duplicate',q['id'])
    stem=Image.open(BASE/q['stemBlocks'][0]['src']);assert stem.size==(640,640)
    q['verification']['status']='passed'
    reports.append({'id':q['id'],'originalItemId':v['originalItemId'],'allThreeRows':True,'correctOptions':1,'allFourImagesDistinct':True,'sourceKeyMatch':True,'unrestrictedSixRuleAlternatives':accepted})

# Four complete questions per review sheet; no answer or explanation is embedded
# into the user-facing question or option assets.
try:font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',22)
except OSError:
    try:font=ImageFont.truetype('DejaVuSans.ttf',22)
    except OSError:font=ImageFont.load_default()
for batch in range(6):
    sheet=Image.new('RGB',(1400,1000),'#e7edf3');draw=ImageDraw.Draw(sheet)
    for index,q in enumerate(items[4*batch:4*batch+4]):
        x=(index%2)*700;y=(index//2)*500
        draw.text((x+18,y+10),f"{q['id']} / source {q['verification']['originalItemId']} / key {q['answer']}",fill='black',font=font)
        stem=Image.open(BASE/q['stemBlocks'][0]['src']).convert('RGB').resize((380,380))
        sheet.paste(stem,(x+18,y+52))
        for i,o in enumerate(q['options']):
            ox=x+425+(i%2)*130;oy=y+55+(i//2)*195
            draw.text((ox,oy),o['value'],fill='black',font=font)
            im=Image.open(BASE/o['blocks'][0]['src']).convert('RGB').resize((114,114));sheet.paste(im,(ox,oy+30))
    sheet.save(BASE/'review'/f'contact-{batch+1:02d}.png')
(BASE/'verification-results.json').write_text(json.dumps({'count':len(reports),'passed':len(reports),'results':reports},ensure_ascii=False,indent=2),encoding='utf-8')
(BASE/'candidates.json').write_text(json.dumps(items,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'verified':len(reports),'reviewSheets':6,'assets':len(list((BASE/'assets/images/question-bank/focused').glob('*.png')))}))
