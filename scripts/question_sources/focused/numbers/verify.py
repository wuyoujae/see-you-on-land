"""Independently verify literal authored terms and candidate substitutions.

Uses exact rational arithmetic. No external question/code source. Alternative-rule
screening is bounded to conventional simple rules, not a claim of mathematical
uniqueness of finite sequences among arbitrary interpolating functions.
"""
from fractions import Fraction as F
from pathlib import Path
from collections import Counter
from itertools import product
from math import prod
import json
import hashlib

def fib(n):
    a,b=0,1
    for _ in range(n): a,b=b,a+b
    return a

def prime(n):
    found=[]; k=2
    while len(found)<n:
        if all(k%p for p in found if p*p<=k): found.append(k)
        k+=1
    return found[-1]

def digits(x):
    assert F(x).denominator==1
    return [int(c) for c in str(abs(int(x)))]

ENV=dict(F=F,fib=fib,prime=prime,concat=lambda *x:int(''.join(str(int(t)) for t in x)),
 dsum=lambda x:sum(digits(x)),dprod=lambda x:prod(digits(x)),
 dsquares=lambda x:sum(d*d for d in digits(x)),reverse=lambda x:int(str(int(x))[::-1]),
 int=int,str=str,range=range)

def calc(expression,**context):
    return eval(expression,{'__builtins__':{},**ENV,**context})

def matches(values,rule):
    vals=list(map(F,values)); mode=rule['mode']
    try:
        if mode=='formula':
            return all(x==calc(rule['expression'],n=i+1) for i,x in enumerate(vals))
        if mode=='differences':
            return all(vals[i]-vals[i-1]==calc(rule['expression'],n=i) for i in range(1,len(vals)))
        if mode=='recurrence':
            seed=rule.get('seeds',1)
            return all(vals[i]==calc(rule['expression'],n=i+1,p=vals[i-1],q=vals[i-2] if i>=2 else None,r=vals[i-3] if i>=3 else None) for i in range(seed,len(vals)))
        if mode=='lanes':
            count=len(rule['lanes'])
            return all(matches(vals[i::count],r) for i,r in enumerate(rule['lanes']))
        if mode=='groups':
            assert len(vals)%3==0
            return all(vals[i+2]==calc(rule['expression'],a=vals[i],b=vals[i+1],g=i//3+1) for i in range(0,len(vals),3))
    except (ZeroDivisionError,ValueError,AssertionError): return False
    raise AssertionError(rule)

def matrix_matches(rows,rule):
    try:
        return all(calc(rule['equation'],**dict(zip('abcd',map(F,row[:-1]))),z=F(row[-1])) for row in rows)
    except ZeroDivisionError: return False

def polynom(values,degree):
    if len(values)<degree+3: return False
    differences=list(values)
    for _ in range(degree): differences=[b-a for a,b in zip(differences,differences[1:])]
    return len(set(differences))==1

def geometric(v):
    return len(v)>=4 and all(v[i]*v[i-2]==v[i-1]**2 for i in range(2,len(v))) and all(v)

def basic_lane(v): return polynom(v,1) or polynom(v,2) or geometric(v)

GROUP_EXPRESSIONS=['a+b','a-b','b-a','a*b','a/b','b/a','a*b+1','a*b-1','2*(a+b)-1',
 '2*(a+b)+1','a*a-b','a*a+b','a*b+a+b','a*b+a-b','a*b-a+b','a*a+b*b','(a+b)**2',
 '(a-b)**2','a*a-b*b','a+b+g','a+b+g*g','a+b+2*g','a*b+g','a*b-g']

def sequence_alternatives(values):
    v=list(map(F,values)); hits=[]
    for degree in (1,2,3):
        if polynom(v,degree): hits.append('constant-difference-order-'+str(degree))
    if geometric(v): hits.append('geometric')
    for a in range(-3,5):
        b=v[1]-a*v[0]
        if b.denominator==1 and abs(b)<=12 and all(y==a*x+b for x,y in zip(v,v[1:])):
            hits.append(f'affine({a},{b})')
    if len(v)>=7:
        for a,b,c in product(range(-2,4),range(-2,4),range(-3,4)):
            if all(v[i]==a*v[i-1]+b*v[i-2]+c for i in range(2,len(v))):
                hits.append(f'recurrence2({a},{b},{c})')
    d=[b-a for a,b in zip(v,v[1:])]
    if geometric(d): hits.append('geometric-first-differences')
    if len(v)>=8 and all(basic_lane(v[i::2]) for i in range(2)):
        hits.append('two-basic-lanes')
    if len(v)>=12 and len(v)%3==0:
        for expr in GROUP_EXPRESSIONS:
            if matches(v,dict(mode='groups',expression=expr)): hits.append('triples:'+expr)
    return hits

def matrix_alternative_formulas(q):
    v=q['verification']; arity=v['rule']['arity']; complete=v['values'][:-1]
    # Standalone common-rule catalog; do not import or execute the generator.
    families = {2: ['a*b'], 3: ['(a+b)*(c-1)', '(a+b)**2-c', '(a+b)*c', '(a+b)/c', '(a+b+c)/2', '(a-b)**2+c', '(a-b)*c', '2*(a-b)+c', '2*a+b+c', '3*a-b+c', 'a*(b+c)', 'a*(b-c)', 'a*a+b*b-c', 'a*a+b+c', 'a*a-b*b+c', 'a*a-b-c', 'a*b+b*c', 'a*b+c', 'a*b-c', 'a*b/c', 'a+(b+c)/2', 'a+2*(b-c)', 'a+2*b-c', 'a+b+c', 'a+b-2*c', 'a+b-c', 'a+b/c', 'a-b+c', 'a-b-c', 'a/(b+c)', 'a/b+c'], 4: ['(a+b)*(c+d)', '(a+b)/(c+d)', 'a*b+c*d', 'a*c-b*d']}
    formulas = set(families[arity])
    if arity==3:
        formulas.update(['a+b+c+1','a+b+c-1','a*b*c','a+b*c','a*b/c','a/b*c','a/(b-c)',
                         '(a+b)/c','(a-b)/c','(a+c)/b','(a-c)/b','a*a+b*c','a*a-b*c'])
        # Four known rows constrain three coefficients and a small intercept.
        for co in product(range(-2,4),repeat=3):
            intercept=F(complete[0][-1])-sum(F(x)*c for x,c in zip(complete[0][:-1],co))
            if abs(intercept)<=4 and all(F(row[-1])==sum(F(x)*c for x,c in zip(row[:-1],co))+intercept for row in complete):
                formulas.add('+'.join(f'({c})*{s}' for c,s in zip(co,'abc'))+f'+({intercept})')
    elif arity==2:
        formulas.update(['a+b','a-b','a/b','a*a+b','a+b*b','a*b+1','a*b-1'])
    candidates=[]
    for expr in sorted(formulas):
        try:
            if all(F(row[-1])==calc(expr,**dict(zip('abcd',map(F,row[:-1])))) for row in complete): candidates.append(expr)
        except ZeroDivisionError: pass
    return candidates

def alternative_hits(q):
    v=q['verification']; out=[]
    if q['form']=='sequence':
        for option in q['options']:
            if option['value']==q['answer']: continue
            values=v['values'].copy(); values[v['missingIndex']]=option['label']
            for formula in sequence_alternatives(values): out.append(dict(option=option['value'],formula=formula))
    else:
        formulas=matrix_alternative_formulas(q)
        for option in q['options']:
            if option['value']==q['answer']: continue
            row=list(map(F,v['values'][-1])); row[v['missingCell'][1]]=F(option['label'])
            for formula in formulas:
                try:
                    if row[-1]==calc(formula,**dict(zip('abcd',row[:-1]))): out.append(dict(option=option['value'],formula=formula))
                except ZeroDivisionError: pass
    return out

def verify_all(questions):
    assert len(questions)==120
    assert Counter(q['form'] for q in questions)==dict(sequence=84,matrix=36)
    assert Counter(q['answer'] for q in questions)=={x:30 for x in 'ABCD'}
    assert len({q['id'] for q in questions})==120
    assert len({q['stem'] for q in questions})==120
    checks=[]
    for q in questions:
        v=q['verification']; rule=v['rule']
        assert q['sourceLabel']=='原创专项练习，非真题'
        assert len(q['options'])==4 and [o['value'] for o in q['options']]==list('ABCD')
        assert len({F(o['label']) for o in q['options']})==4,q['id']
        assert q['stem'].count('？')==(1 if q['form']=='sequence' else 2),q['id']
        winners=[]
        if q['form']=='sequence':
            assert matches(v['values'],rule),(q['id'],v)
            for option in q['options']:
                values=v['values'].copy(); values[v['missingIndex']]=option['label']
                if matches(values,rule): winners.append(option['value'])
            assert q['stemBlocks'][1]['text']=='，'.join(v['values'][:-1]+['（？）'])
        else:
            assert matrix_matches(v['values'],rule),(q['id'],v)
            for option in q['options']:
                rows=[r.copy() for r in v['values']]; r,c=v['missingCell']; rows[r][c]=option['label']
                if matrix_matches(rows,rule): winners.append(option['value'])
            rendered=[r.copy() for r in v['values']]; r,c=v['missingCell']; rendered[r][c]='？'
            assert rendered==q['stemBlocks'][1]['rows']
        assert winners==[q['answer']],(q['id'],winners,q['answer'])
        assert next(o['label'] for o in q['options'] if o['value']==q['answer'])==v['correctValue']
        assert not alternative_hits(q),(q['id'],alternative_hits(q))
        assert q['explanationBlocks'] and all(b['type']=='paragraph' for b in q['explanationBlocks'])
        checks.append(dict(id=q['id'],allGivenValues=True,uniqueCorrectOption=True,
            exactArithmetic=True,conventionalAlternativeScreen=True,stemEncoding=True))
    return dict(total=120,countsByForm=dict(Counter(q['form'] for q in questions)),
      countsBySkill=dict(Counter(q['skillTitle'] for q in questions)),
      countsByDifficulty=dict(Counter(q['difficulty'] for q in questions)),
      countsByAnswer=dict(Counter(q['answer'] for q in questions)),
      unresolved=[],checks=checks)

if __name__=='__main__':
    path=Path(__file__).resolve().parent.parent/'numbers.reviewed.json'
    report=verify_all(json.loads(path.read_text(encoding='utf-8')))
    report['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
    print(json.dumps({k:v for k,v in report.items() if k!='checks'},ensure_ascii=False,indent=2))
