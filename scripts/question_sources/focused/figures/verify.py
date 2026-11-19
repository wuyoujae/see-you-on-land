"""Independent geometric solver: never imports generation code or uses answer to solve."""
from pathlib import Path
import json,math,hashlib,xml.etree.ElementTree as ET
from collections import Counter
from PIL import Image,ImageChops
P=Path(__file__).resolve().parent;AS=P/'svg'
PNG=P.parents[3]/'assets/images/question-bank/focused'
qs=json.loads((P.parent/'figures.reviewed.json').read_text(encoding='utf8'));qs=[q for q in qs if q['id'].startswith('focus-figure-')];ms=json.loads((P/'models.json').read_text(encoding='utf8'))
def canonical(m):return json.dumps(m,sort_keys=True,separators=(',',':'))
def occupied(m):return set(map(tuple,m['cells']))
def transform(m,which):
 n=m['n'];answer=set()
 for x,y in occupied(m):
  u,v=x-(n-1)/2,y-(n-1)/2
  # Numerical orthogonal matrices; independent from generator coordinate cases.
  matrices={'i':(1,0,0,1),'r0':(1,0,0,1),'r1':(0,-1,1,0),'r2':(-1,0,0,-1),'r3':(0,1,-1,0),'v':(-1,0,0,1),'h':(1,0,0,-1),'d':(0,1,1,0),'a':(0,-1,-1,0)}
  a,b,c,d=matrices[which];answer.add((int(round(a*u+b*v+(n-1)/2)),int(round(c*u+d*v+(n-1)/2))))
 return answer

def op_pixels(a,b,op,n=4):
 result=set()
 for y in range(n):
  for x in range(n):
   u,v=(x,y) in a,(x,y) in b
   match={'xor':u!=v,'union':u or v,'intersection':u and v,'difference':u and not v}[op]
   if match:result.add((x,y))
 return result

def axes_and_center(m):
 points=occupied(m);cx=sum(x for x,y in points)/len(points);cy=sum(y for x,y in points)/len(points)
 def valid(a,b,c,d):
  mapped={(round(a*(x-cx)+b*(y-cy)+cx,5),round(c*(x-cx)+d*(y-cy)+cy,5)) for x,y in points}
  return mapped==points
 axes=[]
 for deg in [0,45,90,135]:
  rad=math.radians(2*deg)
  if valid(math.cos(rad),math.sin(rad),math.sin(rad),-math.cos(rad)):axes.append(deg)
 return axes,valid(-1,0,0,-1)

def planar_faces(model):
 segs=model['segments'];eps=1e-4
 def cross(a,b):return a[0]*b[1]-a[1]*b[0]
 def point_on(p,s):
  a=s[:2];b=s[2:];v=(b[0]-a[0],b[1]-a[1]);w=(p[0]-a[0],p[1]-a[1])
  return abs(cross(v,w))<eps*max(1,math.hypot(*v)) and min(a[0],b[0])-eps<=p[0]<=max(a[0],b[0])+eps and min(a[1],b[1])-eps<=p[1]<=max(a[1],b[1])+eps
 nodes=[tuple(s[:2]) for s in segs]+[tuple(s[2:]) for s in segs]
 for i,a in enumerate(segs):
  p=a[:2];r=(a[2]-a[0],a[3]-a[1])
  for b in segs[i+1:]:
   q=b[:2];s=(b[2]-b[0],b[3]-b[1]);d=cross(r,s)
   if abs(d)<1e-8:continue
   delta=(q[0]-p[0],q[1]-p[1]);t=cross(delta,s)/d;u=cross(delta,r)/d
   if -eps<=t<=1+eps and -eps<=u<=1+eps:nodes.append((p[0]+t*r[0],p[1]+t*r[1]))
 # Merge intersections within numerical tolerance, independently of input order.
 unique=[]
 for point in nodes:
  if not any(math.dist(point,v)<eps for v in unique):unique.append(point)
 edges=set()
 for seg in segs:
  on=[i for i,p in enumerate(unique) if point_on(p,seg)]
  on.sort(key=lambda i:math.dist(unique[i],seg[:2]))
  for a,b in zip(on,on[1:]):
   if a!=b:edges.add(tuple(sorted((a,b))))
 parent=list(range(len(unique)))
 def root(x):
  while parent[x]!=x:x=parent[x]
  return x
 for a,b in edges:parent[root(a)]=root(b)
 components=len({root(i) for i in range(len(unique))})
 return len(edges)-len(unique)+components

def count(model):
 if model['type']=='dots':return len(model['points'])
 if model['type']=='segments':
  # Each stroke must be separated, so counting segments is visually well-defined.
  ss=model['segments']
  for i,a in enumerate(ss):
   for b in ss[i+1:]:assert min(math.dist(a[:2],b[:2]),math.dist(a[:2],b[2:]),math.dist(a[2:],b[:2]),math.dist(a[2:],b[2:]))>8
  return len(ss)
 if model['type']=='partition':return planar_faces(model)
 raise AssertionError(model)

reports=[];signatures=set()
for q,m in zip(qs,ms):
 assert q['id']==m['id'];known=m['known'];options=m['options'];family=m['family'];witness={};fits=[]
 if family=='translate':
  n=known[0]['n'];first={s:(x,y) for s,x,y in known[0]['items']};second={s:(x,y) for s,x,y in known[1]['items']}
  ds={((second[s][0]-p[0])%n,(second[s][1]-p[1])%n) for s,p in first.items()};assert len(ds)==1;dx,dy=next(iter(ds))
  for a,b in zip(known,known[1:]):assert {s:((x+dx)%n,(y+dy)%n) for s,x,y in a['items']}=={s:(x,y) for s,x,y in b['items']}
  expected={s:((x+dx)%n,(y+dy)%n) for s,x,y in known[-1]['items']}
  fits=[i for i,o in enumerate(options) if {s:(x,y) for s,x,y in o['items']}==expected];witness={'inferredShift':[dx,dy],'expectedSymbols':expected}
 elif family=='orbit':
  steps=[(known[1]['positions'][i]-known[0]['positions'][i])%8 for i in range(2)]
  for a,b in zip(known,known[1:]):assert [(a['positions'][i]+steps[i])%8 for i in range(2)]==b['positions']
  expected=[(known[-1]['positions'][i]+steps[i])%8 for i in range(2)]
  fits=[i for i,o in enumerate(options) if o['positions']==expected];witness={'inferredSteps':steps,'expectedPositions':expected}
 elif family=='rotate':
  rules=[op for op in ['r1','r2','r3'] if all(transform(a,op)==occupied(b) for a,b in zip(known,known[1:]))];assert len(rules)==1
  expected=transform(known[-1],rules[0]);fits=[i for i,o in enumerate(options) if occupied(o)==expected];witness={'inferredRotation':rules[0],'expectedCells':sorted(expected)}
 elif family=='reflect':
  rules=[]
  for column in [1,2]:
   candidates=[op for op in ['v','h','d','a'] if all(transform(known[r*3],op)==occupied(known[r*3+column]) for r in range(2))];assert len(candidates)==1
   rules.append(candidates[0])
  assert transform(known[6],rules[0])==occupied(known[7])
  expected=transform(known[6],rules[1]);fits=[i for i,o in enumerate(options) if occupied(o)==expected];witness={'inferredReflections':rules,'expectedCells':sorted(expected)}
 elif family in ['xor','union','intersection','rotate-xor']:
  possible=[]
  for turn in (range(4) if family=='rotate-xor' else [0]):
   for op in ['xor','union','intersection','difference']:
    if all(op_pixels(transform(known[r*3],'r'+str(turn)),occupied(known[r*3+1]),op)==occupied(known[r*3+2]) for r in range(2)):possible.append([turn,op])
  assert len(possible)==1,(q['id'],possible)
  turn,op=possible[0];expected=op_pixels(transform(known[6],'r'+str(turn)),occupied(known[7]),op)
  fits=[i for i,o in enumerate(options) if occupied(o)==expected];witness={'inferredOperation':possible[0],'expectedCells':sorted(expected)}
 elif family=='traversal':
  expected={}
  for key,values in [('shape',{0,1,2}),('fill',{'outline','solid','dot'})]:
   for row in range(2):assert {known[row*3+j][key] for j in range(3)}==values
   for col in range(2):assert {known[r*3+col][key] for r in range(3)}==values
   rowmissing=values-{known[6][key],known[7][key]};colmissing=values-{known[2][key],known[5][key]};assert rowmissing==colmissing and len(rowmissing)==1;expected[key]=next(iter(rowmissing))
  fits=[i for i,o in enumerate(options) if all(o[k]==v for k,v in expected.items())];witness={'missingAttributes':expected}
 elif family=='dots':
  counts=[count(o) for o in known];diffs=[b-a for a,b in zip(counts,counts[1:])];assert len(set(diffs))==1;expected=counts[-1]+diffs[0]
  fits=[i for i,o in enumerate(options) if count(o)==expected];witness={'knownCounts':counts,'expectedCount':expected,'optionCounts':[count(o) for o in options]}
 elif family in ['lines','regions']:
  counts=[count(o) for o in known];assert counts[0]+counts[1]==counts[2] and counts[3]+counts[4]==counts[5]
  expected=counts[6]+counts[7];fits=[i for i,o in enumerate(options) if count(o)==expected];witness={'knownCounts':counts,'expectedCount':expected,'optionCounts':[count(o) for o in options],'geometryMethod':'planar-Euler-bounded-faces' if family=='regions' else 'disjoint-strokes'}
 elif family=='symmetry':
  attrs=[axes_and_center(o) for o in known];target=m['parameters']['property']
  if target=='central':assert all(c for a,c in attrs);predicate=lambda o:axes_and_center(o)[1]
  else:
   numbers=[len(a) for a,c in attrs];assert len(set(numbers))==1;desired=numbers[0];predicate=lambda o:len(axes_and_center(o)[0])==desired
  fits=[i for i,o in enumerate(options) if predicate(o)];witness={'knownGeometry':attrs,'optionGeometry':[axes_and_center(o) for o in options]}
 elif family=='closure':
  flags=[o['points'][0]==o['points'][-1] for o in known];assert len(set(flags))==1
  fits=[i for i,o in enumerate(options) if (o['points'][0]==o['points'][-1])==flags[0]];witness={'knownClosed':flags,'optionClosed':[o['points'][0]==o['points'][-1] for o in options]}
 elif family=='motion-count':
  steps=[(b['position']-a['position'])%8 for a,b in zip(known,known[1:])];deltas=[b['count']-a['count'] for a,b in zip(known,known[1:])];assert len(set(steps))==len(set(deltas))==1
  expected={'position':(known[-1]['position']+steps[0])%8,'count':known[-1]['count']+deltas[0]}
  fits=[i for i,o in enumerate(options) if all(o[k]==v for k,v in expected.items())];witness={'inferredPositionStep':steps[0],'inferredCountStep':deltas[0],'expected':expected}
 else:raise AssertionError(family)
 assert len(fits)==1,(q['id'],fits,witness)
 assert 'ABCD'[fits[0]]==q['answer'],q['id']
 assert len({canonical(o) for o in options})==4
 # Independently inspect generated SVG geometry against the model counts.
 rasterhashes=[]
 for j,letter in enumerate('abcd'):
  svg=AS/(q['id']+'-'+letter+'.svg');tree=ET.fromstring(svg.read_text(encoding='utf8'))
  assert not any(e.tag.split('}')[-1] in ['script','foreignObject','image'] for e in tree.iter())
  assert not any(k.split('}')[-1].lower().startswith('on') or k.split('}')[-1] in ['href'] for e in tree.iter() for k in e.attrib)
  o=options[j]
  if o['type']=='dots':assert len([e for e in tree.iter() if e.tag.endswith('circle')])==count(o)
  if o['type']=='segments':assert len([e for e in tree.iter() if e.tag.endswith('line')])==count(o)
  if o['type']=='partition':
   drawn={'type':'partition','segments':[[float(e.get(k)) for k in ['x1','y1','x2','y2']] for e in tree.iter() if e.tag.endswith('line')]}
   assert planar_faces(drawn)==count(o)
  if o['type']=='tiles':assert len([e for e in tree.iter() if e.tag.endswith('rect') and e.get('fill')=='#17212b'])==len(o['cells'])
  png=Image.open(PNG/svg.with_suffix('.png').name).convert('RGB');assert png.size==(320,320)
  rasterhashes.append(hashlib.sha256(png.tobytes()).hexdigest())
  box=ImageChops.difference(png,Image.new('RGB',png.size,'white')).getbbox();assert box and box[0]>=0 and box[2]<=320
 assert len(set(rasterhashes))==4,(q['id'],'visual duplicate')
 stempath=AS/(q['id']+'-stem.svg');stemxml=ET.fromstring(stempath.read_text(encoding='utf8'));texts=[e.text for e in stemxml.iter() if e.tag.endswith('text')];assert texts==['?']
 stem_png=Image.open(PNG/stempath.with_suffix('.png').name);assert stem_png.size==(int(stemxml.get('width'))*2,int(stemxml.get('height'))*2)
 sig=hashlib.sha256(stem_png.tobytes()+''.join(rasterhashes).encode()).hexdigest();assert sig not in signatures;signatures.add(sig)
 q['verification']={'status':'passed','generatorVersion':'original-figures-1','validatorVersion':'independent-geometric-solver-1','ruleFamily':family,'knownPanelsChecked':len(known),'optionCount':4,'distinctOptionRasters':4,'matchingOptions':['ABCD'[i] for i in fits],'uniqueUnderInferredRule':True,'svgStemContainsOnlyQuestionMarkText':True,'pngScale':2,'witness':witness}
 reports.append({'id':q['id'],'family':family,'answer':q['answer'],'knownPanels':len(known),'matchingOptions':['ABCD'[i] for i in fits],'witness':witness,'assetDigest':sig})
assert len(qs)==120 and Counter(q['answer'] for q in qs)==dict.fromkeys('ABCD',30)
# Verification never mutates the reviewed question data.
(P/'validation.json').write_text(json.dumps({'passed':True,'count':len(qs),'answers':dict(Counter(q['answer'] for q in qs)),'difficulty':dict(Counter(q['difficulty'] for q in qs)),'families':dict(Counter(m['family'] for m in ms)),'questions':reports},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('PASS',len(qs),'unique rule matches;',Counter(q['difficulty'] for q in qs))
