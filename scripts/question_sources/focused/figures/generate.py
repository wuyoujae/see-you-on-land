"""Deterministic original figure assets. All geometry is authored here, not copied."""
from pathlib import Path
import random,json,math,hashlib,sys
P=Path(__file__).parent
import cairosvg
from PIL import Image,ImageDraw,ImageFont
AS=P/'assets';AS.mkdir(exist_ok=True);PRE=P/'previews';PRE.mkdir(exist_ok=True)
INK='#17212b';LIGHT='#c4ccd2'
def stable(v):return json.dumps(v,sort_keys=True,separators=(',',':'))
def tiles(c,n=4,grid=True):return {'type':'tiles','n':n,'cells':sorted([list(p) for p in set(map(tuple,c))]),'grid':grid}
def pts(m):return set(map(tuple,m['cells']))
def action(m,op):
 n=m['n'];s=pts(m)
 if op=='r1':s={(n-1-y,x) for x,y in s}
 elif op=='r2':s={(n-1-x,n-1-y) for x,y in s}
 elif op=='r3':s={(y,n-1-x) for x,y in s}
 elif op=='v':s={(n-1-x,y) for x,y in s}
 elif op=='h':s={(x,n-1-y) for x,y in s}
 elif op=='d':s={(y,x) for x,y in s}
 elif op=='a':s={(n-1-y,n-1-x) for x,y in s}
 return tiles(s,n,m['grid'])
def asymmetric(rng,n=4,grid=True):
 while True:
  m=tiles(rng.sample([(x,y) for x in range(n) for y in range(n)],rng.randint(4,7)),n,grid)
  if len({stable(action(m,o)) for o in ['i','r1','r2','r3','v','h','d','a']})==8:return m

def boolean(a,b,op):
 x,y=pts(a),pts(b);s={'xor':x^y,'union':x|y,'intersection':x&y,'difference':x-y}[op]
 return tiles(s,a['n'])
def rndpair(rng):
 while True:
  a,b=asymmetric(rng),asymmetric(rng)
  outs=[boolean(a,b,o) for o in ['xor','union','intersection','difference']]
  if min(len(m['cells']) for m in outs)>=2 and len({stable(x) for x in outs})==4:return a,b

def shift(m,dx,dy):
 n=m['n'];return {'type':'symbols','n':n,'items':[[s,(x+dx)%n,(y+dy)%n] for s,x,y in m['items']]}
def orbit(a,b):return {'type':'orbit','positions':[a%8,b%8]}
def number(kind,n,seed):
 rng=random.Random(seed)
 if kind=='dots':
  slots=[(x,y) for y in [35,65,95,125] for x in [35,65,95,125]]
  return {'type':'dots','points':[list(p) for p in rng.sample(slots,n)]}
 if kind=='lines':
  slots=rng.sample([(x,y) for x in [35,80,125] for y in [35,80,125]],n)
  seg=[]
  for x,y in slots:
   dx,dy=rng.choice([(12,0),(0,12),(9,9),(9,-9)])
   seg.append([x-dx,y-dy,x+dx,y+dy])
  return {'type':'segments','segments':seg}
 if kind=='regions':
  mode=seed%3;segs=[]
  if mode==0: # rectangle, n bands
   v=[(25,30),(135,30),(135,130),(25,130)]
   segs=[[25+110*i/n,30,25+110*i/n,130] for i in range(1,n)]
  elif mode==1: # triangle, n fan cells
   v=[(80,22),(138,132),(22,132)]
   segs=[[80,22,22+116*i/n,132] for i in range(1,n)]
  else: # trapezoid, n bands
   v=[(48,25),(112,25),(140,132),(20,132)]
   segs=[[48+64*i/n,25,20+120*i/n,132] for i in range(1,n)]
  segs += [[*v[i],*v[(i+1)%len(v)]] for i in range(len(v))]
  return {'type':'partition','segments':[[round(z,6) for z in s] for s in segs]}

def symmetry(m):
 s=pts(m);cx=sum(x for x,y in s)/len(s);cy=sum(y for x,y in s)/len(s)
 def eq(f):return {(round(f(x,y)[0],6),round(f(x,y)[1],6)) for x,y in s}==s
 tests={'v':lambda x,y:(2*cx-x,y),'h':lambda x,y:(x,2*cy-y),'d':lambda x,y:(cx+y-cy,cy+x-cx),'a':lambda x,y:(cx-y+cy,cy-x+cx)}
 return ([o for o,f in tests.items() if eq(f)],eq(lambda x,y:(2*cx-x,2*cy-y)))
def symmetric_sample(rng,kind):
 while True:
  s=set(rng.sample([(x,y) for x in range(5) for y in range(5)],rng.randint(3,7)))
  if kind in ['one','two','four','central']:
   if kind=='one':op=rng.choice(['v','h','d','a']);s|=pts(action(tiles(s,5,False),op))
   if kind=='two':s|=pts(action(tiles(s,5,False),'v'));s|=pts(action(tiles(s,5,False),'h'))
   if kind=='four':
    for op in ['v','h','d','a','r1','r2','r3']:s|=pts(action(tiles(s,5,False),op))
   if kind=='central':s|=pts(action(tiles(s,5,False),'r2'))
  m=tiles(s,5,False);axes,center=symmetry(m)
  ok={'none':len(axes)==0 and not center,'one':len(axes)==1,'two':len(axes)==2,'four':len(axes)==4,'central':center and len(axes)==0}[kind]
  if ok and 4<=len(s)<=21:return m

def contour(seed,closed):
 # Irregular, simple convex loops, optionally with a clearly visible missing side.
 rng=random.Random(seed);n=3+seed%5;angle=rng.random()*2*math.pi
 points=[[round(80+54*math.cos(angle+2*math.pi*i/n),4),round(80+48*math.sin(angle+2*math.pi*i/n),4)] for i in range(n)]
 if closed:points.append(points[0])
 return {'type':'contour','points':points}

def glyph(shape,x,y,size,fill='outline'):
 color=INK if fill=='solid' else 'white';style=f'fill="{color}" stroke="{INK}" stroke-width="2.5"'
 if shape==0:s=f'<circle cx="{x}" cy="{y}" r="{size}" {style}/>'
 elif shape==1:s=f'<rect x="{x-size}" y="{y-size}" width="{2*size}" height="{2*size}" {style}/>'
 elif shape==2:s=f'<polygon points="{x},{y-size-2} {x+size+1},{y+size} {x-size-1},{y+size}" {style}/>'
 else:s=f'<polygon points="{x},{y-size-2} {x+size+2},{y} {x},{y+size+2} {x-size-2},{y}" {style}/>'
 if fill=='dot':s+=f'<circle cx="{x}" cy="{y}" r="{size/3}" fill="{INK}"/>'
 return s

def render(m):
 if m is None:return '<text x="80" y="95" text-anchor="middle" font-size="48" font-family="Arial" fill="#17212b">?</text>'
 t=m['type'];out=''
 if t in ['tiles','symbols']:
  n=m['n'];w=116/n;off=22
  if m.get('grid',True):
   for i in range(n+1):out+=f'<path d="M {off+i*w} {off} V {off+116} M {off} {off+i*w} H {off+116}" fill="none" stroke="{LIGHT}" stroke-width="1"/>'
  if t=='tiles':
   for x,y in m['cells']:out+=f'<rect x="{off+x*w+3}" y="{off+y*w+3}" width="{w-6}" height="{w-6}" fill="{INK}"/>'
  else:
   for s,x,y in m['items']:out+=glyph(s,off+(x+.5)*w,off+(y+.5)*w,w*.26,'solid' if s==0 else 'outline')
 elif t in ['orbit','compound-motion']:
  out=f'<circle cx="80" cy="80" r="52" fill="none" stroke="{LIGHT}" stroke-width="1.5"/>'
  for i in range(8):
   x=80+52*math.sin(i*math.pi/4);y=80-52*math.cos(i*math.pi/4)
   out+=f'<circle cx="{x}" cy="{y}" r="2" fill="{LIGHT}"/>'
  positions=m['positions'] if t=='orbit' else [m['position']]
  for k,i in enumerate(positions):
   x=80+52*math.sin(i*math.pi/4);y=80-52*math.cos(i*math.pi/4)
   out+=glyph(0,x,y,9,'solid' if k==0 else 'outline')
  if t=='compound-motion':
   for i in range(m['count']):
    ang=2*math.pi*i/m['count']+math.pi/7
    out+=f'<circle cx="{80+21*math.cos(ang)}" cy="{80+21*math.sin(ang)}" r="4" fill="{INK}"/>'
 elif t=='traversal':out=glyph(m['shape'],80,80,42,m['fill'])
 elif t=='dots':
  for x,y in m['points']:out+=f'<circle cx="{x}" cy="{y}" r="7" fill="{INK}"/>'
 elif t in ['segments','partition']:
  for x1,y1,x2,y2 in m['segments']:out+=f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{INK}" stroke-width="2.7" stroke-linecap="round"/>'
 elif t=='contour':out=f'<polyline points="'+ ' '.join(f'{x},{y}' for x,y in m['points'])+f'" stroke="{INK}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round" fill="none"/>'
 else:raise ValueError(t)
 return out

def svg_panels(models,layout):
 cols=3 if layout=='matrix' else len(models);rows=math.ceil(len(models)/cols)
 gap=10;w=cols*160+(cols-1)*gap;h=rows*160+(rows-1)*gap
 out=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}"><rect width="100%" height="100%" fill="white"/>'
 for i,m in enumerate(models):
  x=(i%cols)*170;y=(i//cols)*170
  out+=f'<g transform="translate({x} {y})"><rect x="1.5" y="1.5" width="157" height="157" rx="6" fill="white" stroke="#a7b1bb" stroke-width="1.5"/>'+render(m)+'</g>'
 return out+'</svg>'

def asset(name,svg):
 (AS/(name+'.svg')).write_text(svg,encoding='utf8')
 cairosvg.svg2png(bytestring=svg.encode(),write_to=str(AS/(name+'.png')),scale=2)
 return 'assets/images/question-bank/focused/'+name+'.png'

FAMILIES=[
 ('translate','位置·整体平移','foundation'),('orbit','位置·环形位移','standard'),
 ('rotate','位置·整体旋转','foundation'),('reflect','位置·轴向翻转','standard'),
 ('xor','样式·去同存异','standard'),('union','样式·叠加合并','foundation'),
 ('intersection','样式·保留公共部分','standard'),('traversal','样式·双属性遍历','challenge'),
 ('dots','数量·点数变化','foundation'),('lines','数量·直线计数','standard'),
 ('regions','数量·封闭区域','standard'),('symmetry','属性·对称特征','challenge'),
 ('closure','属性·开放与封闭','foundation'),('rotate-xor','复合·旋转后叠加','challenge'),
 ('motion-count','复合·位移与数量','challenge')]
ALL=[];MODELS=[]
for fi,(family,title,defaultdiff) in enumerate(FAMILIES):
 for v in range(8):
  idx=fi*8+v+1;rng=random.Random(2026111800+idx);layout='sequence';params={};note='';diff=defaultdiff
  if family=='translate':
   n=4;positions=rng.sample([(x,y) for x in range(n) for y in range(n)],3)
   base={'type':'symbols','n':n,'items':[[k,*p] for k,p in enumerate(positions)]};dx,dy=[(1,0),(0,1),(-1,0),(0,-1),(1,1),(-1,1),(2,1),(1,-2)][v]
   known=[shift(base,k*dx,k*dy) for k in range(4)];correct=shift(base,4*dx,4*dy)
   bad=[shift(known[-1],*d) for d in [(0,0),(-dx,-dy),(dy,-dx),(dx,0),(0,dy),(1,2)]]
   params={'dx':dx,'dy':dy,'n':n};desc=f'三个符号保持自身形状，整体每步横向{dx}格、纵向{dy}格移动（向右、向下记为正），越过边界后从对边继续。'
   if v>=4:diff='standard'
  elif family=='orbit':
   da,db=[(1,1),(2,2),(-1,-1),(-2,-2),(1,-1),(-1,1),(2,-2),(-2,2)][v]
   while True:
    a,b=rng.sample(range(8),2)
    if all((a+k*da)%8!=(b+k*db)%8 for k in range(5)):break
   known=[orbit(a+k*da,b+k*db) for k in range(4)];correct=orbit(a+4*da,b+4*db)
   bad=[orbit(a+4*da,b+3*db),orbit(a+3*da,b+4*db),orbit(a+4*da+1,b+4*db+1),orbit(a+4*da,b+4*db+2)]
   bad=[m for m in bad if len(set(m['positions']))==2]
   params={'steps':[da,db]};desc=f'沿圆周的八个位置观察，实心圆每次移动{abs(da)}格，方向为'+('顺时针' if da>0 else '逆时针')+f'；空心圆每次移动{abs(db)}格，方向为'+('顺时针' if db>0 else '逆时针')+'。两种圆分别按各自规律移动。'
  elif family=='rotate':
   base=asymmetric(rng);k=1 if v%2==0 else 3;known=[action(base,'r'+str((i*k)%4)) for i in range(4)];correct=action(base,'r'+str((4*k)%4))
   bad=[action(correct,o) for o in ['r1','r2','r3','v']];params={'quarterTurns':k};desc='黑色方块组成的整体每次绕中心'+('顺时针' if k==1 else '逆时针')+'旋转90°，黑块的相对结构不变。'
  elif family=='reflect':
   layout='matrix';op1,op2=[('v','h'),('h','v'),('d','a'),('a','d'),('v','d'),('h','a'),('d','v'),('a','h')][v]
   bases=[asymmetric(rng) for _ in range(3)];known=[]
   for b in bases:known += [b,action(b,op1),action(b,op2)]
   correct=known.pop();bad=[action(bases[-1],o) for o in ['i','r1','r2','r3',op1]]
   params={'second':op1,'third':op2};names={'v':'竖直中轴','h':'水平中轴','d':'左上—右下对角线','a':'右上—左下对角线'};desc=f'逐行观察：第二幅是第一幅沿{names[op1]}的镜像，第三幅是第一幅沿{names[op2]}的镜像。第三行保持同样关系。'
  elif family in ['xor','union','intersection']:
   layout='matrix';known=[]
   for row in range(3):
    a,b=rndpair(rng);known += [a,b,boolean(a,b,family)]
   correct=known.pop();bad=[boolean(a,b,o) for o in ['xor','union','intersection','difference'] if o!=family]
   desc={'xor':'每一行将前两幅对应位置叠加：只有一幅为黑的格保留，两幅同为黑或同为空的格不保留。','union':'每一行将前两幅对应位置合并：任意一幅为黑，该位置就为黑；重叠的黑格只保留一次。','intersection':'每一行只保留前两幅共同为黑的位置；只在其中一幅出现的黑格不保留。'}[family]
   params={'operator':family}
  elif family=='traversal':
   layout='matrix';shapes=rng.sample([0,1,2],3);fills=rng.sample(['outline','solid','dot'],3);known=[]
   for r in range(3):
    for c in range(3):known.append({'type':'traversal','shape':shapes[(r+c)%3],'fill':fills[(r+2*c)%3]})
   correct=known.pop();bad=[{'type':'traversal','shape':s,'fill':f} for s in shapes for f in fills];params={'attributes':['shape','fill']}
   desc='每行、每列都恰好出现一次圆形、方形和三角形；空心、实心、中心带点三种样式也各出现一次。问号要同时补齐形状和样式。'
  elif family=='dots':
   a,d=[(1,1),(2,1),(2,2),(1,2),(9,-2),(10,-2),(7,-1),(8,-1)][v]
   known=[number('dots',a+k*d,idx*100+k) for k in range(4)];target=a+4*d;correct=number('dots',target,idx*100+4)
   nums=[target+1,target+2,target+3,max(1,target-1),max(1,target-2),a+3*d]
   bad=[number('dots',n,idx*100+4) for n in dict.fromkeys(nums) if n!=target];params={'difference':d}
   desc='忽略散点的位置，只计黑点个数。已知四幅依次为'+ '、'.join(str(a+k*d) for k in range(4))+f'，每次{("增加" if d>0 else "减少")}{abs(d)}个，下一幅应有{target}个黑点。'
  elif family in ['lines','regions']:
   layout='matrix';known=[];pairs=[]
   for row in range(3):
    a,b=rng.choice([(1,3),(2,3),(3,2),(2,4),(4,1),(1,4),(3,3),(2,2)])
    if family=='regions':a=max(a,2);b=max(b,2)
    pairs.append([a,b]);known += [number(family,n,idx*100+row*10+j) for j,n in enumerate([a,b,a+b])]
   correct=known.pop();target=a+b;ns=[target-1,target+1,max(1,abs(a-b)),a,b,2]
   bad=[number(family,n,idx*100+22) for n in dict.fromkeys(ns) if n!=target][:3];params={'relation':'sum','pairs':pairs}
   noun='彼此分离的直线段' if family=='lines' else '内部封闭区域'
   desc=f'逐行数{noun}，第三幅的数量等于前两幅数量之和。前两行验证了相同关系，第三行应为{a}+{b}={target}。题图外侧的展示框不计入。'
  elif family=='symmetry':
   layout='class';targetkind=['one','one','one','one','two','two','central','central'][v]
   known=[symmetric_sample(rng,targetkind) for _ in range(3)];correct=symmetric_sample(rng,targetkind)
   if targetkind=='central':bad=[symmetric_sample(rng,k) for k in ['none','one','one']]
   else:bad=[symmetric_sample(rng,k) for k in ['none','one','two','four'] if k!=targetkind]
   params={'property':targetkind}
   desc={'one':'题干三幅黑块图都恰好有一条对称轴，方向可以不同。选项应保持“恰好一条轴”这一共同特征。','two':'题干三幅黑块图都恰好有两条对称轴。选项也须恰好两条，不能只看是否存在对称性。','central':'题干三幅黑块图均绕中心旋转180°后与原图重合，即中心对称。逐项旋转核对，只有正确选项满足这一共同特征。'}[targetkind]+'只观察黑块本身，不把外侧展示框作为图形部分。'
  elif family=='closure':
   layout='class';closed=v%2==0;known=[contour(idx*10+k,closed) for k in range(3)];correct=contour(idx*10+4,closed);bad=[contour(idx*10+5+k,not closed) for k in range(3)]
   params={'closed':closed};desc='只观察框内粗黑线，题干三幅图形均'+('首尾相接，形成封闭轮廓' if closed else '留有开口，线条首尾不相接')+'。正确选项保留这一共同属性，其他选项的开闭状态不同。外侧浅色展示框不参与判断。'
  elif family=='rotate-xor':
   layout='matrix';k=1 if v%2==0 else 3
   while True:
    known=[]
    for row in range(3):
     a,b=rndpair(rng);known += [a,b,boolean(action(a,'r'+str(k)),b,'xor')]
    # exclude empty outputs and transformations that the two complete rows cannot disambiguate
    if min(len(known[j]['cells']) for j in [2,5,8])<2:continue
    fits=[]
    for turn in range(4):
     for op in ['xor','union','intersection','difference']:
      if all(pts(boolean(action(known[r*3],'r'+str(turn)),known[r*3+1],op))==pts(known[r*3+2]) for r in range(2)):fits.append([turn,op])
    if fits==[[k,'xor']]:break
   correct=known.pop();bad=[boolean(a,b,'xor'),boolean(action(a,'r'+str(4-k)),b,'xor'),boolean(action(a,'r'+str(k)),b,'union'),boolean(action(a,'r'+str(k)),b,'intersection')]
   params={'quarterTurns':k,'operator':'xor'};desc='每行先将第一幅整体'+('顺时针' if k==1 else '逆时针')+'旋转90°，再与第二幅按对应格叠加，去同存异。两个步骤缺一不可；只旋转、忘记旋转或直接合并都会得到干扰图。'
  elif family=='motion-count':
   step=[1,-1,2,-2,1,-1,2,-2][v];start=rng.randrange(8);startnum=1 if v<4 else 6;delta=1 if v<4 else -1
   known=[{'type':'compound-motion','position':(start+k*step)%8,'count':startnum+k*delta} for k in range(4)]
   correct={'type':'compound-motion','position':(start+4*step)%8,'count':startnum+4*delta};p=correct['position'];n=correct['count']
   bad=[{'type':'compound-motion','position':p,'count':n-delta},{'type':'compound-motion','position':(p-step)%8,'count':n},{'type':'compound-motion','position':(p+step)%8,'count':n+delta}]
   params={'step':step,'countDelta':delta};desc=f'外侧大圆每步沿八个位置{("顺时针" if step>0 else "逆时针")}移动{abs(step)}格；内侧小点每步{("增加" if delta>0 else "减少")}1个。问号处须同时满足外圆位置和内点数量。'
  else:raise ValueError(family)
  # Structural distractors are preferred. Fallback only completes geometric
  # alternatives; every proposed option is independently re-solved later.
  distinct=[];seen={stable(correct)}
  for m in bad:
   if stable(m) not in seen:distinct.append(m);seen.add(stable(m))
  if len(distinct)<3:
   if family=='orbit':
    for a in range(8):
     for b in range(8):
      m=orbit(a,b)
      if a!=b and stable(m) not in seen:distinct.append(m);seen.add(stable(m))
   else:raise AssertionError((family,v,len(distinct)))
  rng.shuffle(distinct);opts=distinct[:3];answerpos=(idx-1)%4;opts.insert(answerpos,correct)
  qid=f'focus-figure-{idx:03d}';stemmodels=known+[None]
  stemsrc=asset(qid+'-stem',svg_panels(stemmodels,'matrix' if layout=='matrix' else 'sequence'))
  options=[]
  for j,m in enumerate(opts):
   label='ABCD'[j];src=asset(qid+'-'+label.lower(),svg_panels([m],'option'))
   options.append({'value':label,'label':label,'blocks':[{'type':'image','src':src,'alt':'选项'+label+'图形'}]})
  stem='从四个选项中选择最合适的一项填入问号处，使图形呈现一定规律。' if layout!='class' else '从四个选项中选出与题干三幅图形具有共同特征的一项。'
  q={'id':qid,'kind':'figures','skillId':'figure-'+family,'skillTitle':title,'difficulty':diff,'stem':stem,'stemBlocks':[{'type':'image','src':stemsrc,'alt':('九宫格题图，右下角待补' if layout=='matrix' else '一组已知图形与待补图形')}],'options':options,'answer':'ABCD'[answerpos],'explanationBlocks':[{'type':'paragraph','text':desc},{'type':'paragraph','text':'按上述规律逐项核对，选'+ 'ABCD'[answerpos]+'。'}],'verification':{'status':'pending-independent-check','generatorVersion':'original-figures-1','ruleFamily':family},'originality':{'type':'original-practice','isPastExam':False}}
  ALL.append(q);MODELS.append({'id':qid,'family':family,'layout':layout,'known':known,'options':opts,'parameters':params})
(P/'candidates.json').write_text(json.dumps(ALL,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
(P/'models.json').write_text(json.dumps(MODELS,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
# Contact sheets: every question, all known panels and all choices, eight per page.
try:font=ImageFont.truetype('arial.ttf',18)
except OSError:font=ImageFont.load_default()
for fi,(family,_,_) in enumerate(FAMILIES):
 sheet=Image.new('RGB',(1800,1840),'white');d=ImageDraw.Draw(sheet)
 for v in range(8):
  q=ALL[fi*8+v];x=(v%2)*900;y=(v//2)*460
  d.text((x+12,y+10),q['id']+'   '+q['difficulty'],font=font,fill='black')
  im=Image.open(AS/(q['id']+'-stem.png')).convert('RGB');im.thumbnail((860,285))
  sheet.paste(im,(x+20+(860-im.width)//2,y+40))
  for j,letter in enumerate('abcd'):
   op=Image.open(AS/(q['id']+'-'+letter+'.png')).convert('RGB');op.thumbnail((112,112))
   ox=x+180+j*145;sheet.paste(op,(ox,y+335));d.text((ox-20,y+376),letter.upper(),font=font,fill='black')
 sheet.save(PRE/f'{fi+1:02d}-{family}.png')
print('Generated',len(ALL),'questions;',len(list(AS.glob('*.svg'))),'SVG;',len(list(AS.glob('*.png'))),'PNG')
