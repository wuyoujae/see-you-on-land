"""Independent Decimal validation of rendered arithmetic and rational metadata.
The verifier does not import the generator. All numeric literals originate in the
rendered expression; percent scaling and rounding are checked separately.
"""
from pathlib import Path
from decimal import Decimal as D, localcontext, ROUND_HALF_UP
from fractions import Fraction
from collections import Counter
import ast
import re
import json
import hashlib

EXPECTED={'加减拆分':24,'速算乘法':24,'百分数运算':24,'除法估算':36,'基期量':24,'增长量':24,'比重与平均数':24}

def decimal_eval(expr):
    def walk(node):
        if isinstance(node,ast.Constant): return D(ast.get_source_segment(expr,node))
        if isinstance(node,ast.UnaryOp): return -walk(node.operand) if isinstance(node.op,ast.USub) else walk(node.operand)
        if isinstance(node,ast.BinOp):
            x,y=walk(node.left),walk(node.right)
            if isinstance(node.op,ast.Add): return x+y
            if isinstance(node.op,ast.Sub): return x-y
            if isinstance(node.op,ast.Mult): return x*y
            if isinstance(node.op,ast.Div): return x/y
            if isinstance(node.op,ast.Pow): return x**int(y)
        raise ValueError(ast.dump(node))
    return walk(ast.parse(expr,mode='eval').body)

def parse_display(display):
    text=display.translate(str.maketrans({'×':'*','÷':'/','＋':'+','－':'-','（':'(','）':')'})).replace('²','**2')
    return re.sub(r'(\d+(?:\.\d+)?)%',r'(\1/100)',text)

def to_decimal(value):
    f=Fraction(value)
    return D(f.numerator)/D(f.denominator)


def verify_teaching(question):
    """Verify the displayed worked arithmetic, residuals and error intervals."""
    proof=question['verification'].get('teaching')
    assert proof and proof['version']=='worked-mental-arithmetic-2',question['id']
    blocks=question['explanationBlocks']; content='\n'.join(b['text'] for b in blocks)
    assert len(blocks)==5 and all(b['text'].startswith('**'+title+'**') for b,title in zip(blocks,['切入点','口算步骤','精度检查','易错提醒','下次这样用']))
    assert hashlib.sha256(json.dumps(blocks,ensure_ascii=False,sort_keys=True).encode()).hexdigest()==proof['explanationSha256']
    assert proof['identities'],question['id']
    with localcontext() as context:
        context.prec=120; tolerance=D('1e-100')
        for identity in proof['identities']:
            assert identity['text'] in content,(question['id'],'missing displayed identity')
            assert abs(decimal_eval(identity['expression'])-to_decimal(identity['result']))<tolerance
            left,right=identity['text'].split('＝')
            assert abs(decimal_eval(parse_display(left))-decimal_eval(parse_display(right)))<tolerance,(question['id'],identity['text'])
        for estimate in proof['estimates']:
            assert estimate['text'] in content
            left,right=estimate['text'].split('≈'); quantum=to_decimal(estimate['unit'])
            expected=(decimal_eval(parse_display(left))/quantum).quantize(D(1),rounding=ROUND_HALF_UP)*quantum
            assert expected==decimal_eval(parse_display(right))==to_decimal(estimate['result'])
        for comparison in proof['comparisons']:
            assert comparison['text'] in content
            a,b=decimal_eval(comparison['left']),decimal_eval(comparison['right'])
            relation=comparison['relation']
            assert (a<b if relation=='<' else a>=b if relation=='>=' else a<=b)
            left,right=comparison['text'].split({'<':'＜','>=':'≥','<=':'≤'}[relation])
            assert abs(decimal_eval(parse_display(left))-a)<tolerance
            assert abs(decimal_eval(parse_display(right))-b)<tolerance
        if 'division' in proof:
            v=proof['division']; a,b,q,r,u=(Fraction(v[k]) for k in ('numerator','denominator','truncated','remainder','unit'))
            assert a==b*q+r and 0<=r<b*u
        if 'approximation' in proof:
            v=proof['approximation']; x,rate,r0=(Fraction(v[k]) for k in ('current','rate','referenceRate'))
            exact=x*rate/(1+rate); approx=x*r0/(1+r0)
            assert abs(exact-approx)<Fraction(v['bound'])
            assert Fraction(v['lower'])<=exact<=Fraction(v['upper'])
            assert Fraction(v['roundingLower'])<=Fraction(v['lower'])<Fraction(v['upper'])<Fraction(v['roundingUpper'])
    return len(proof['identities'])

def verify_all(questions):
    assert len(questions)==180
    assert len({q['id'] for q in questions})==180
    assert len({q['stem'] for q in questions})==180
    assert Counter(q['skillTitle'] for q in questions)==EXPECTED
    assert Counter(q['answer'] for q in questions)=={letter:45 for letter in 'ABCD'}
    assert Counter(q['difficulty'] for q in questions)==dict(foundation=60,standard=90,challenge=30)
    checks=[]; boundary=[]
    with localcontext() as context:
        context.prec=120
        tolerance=D('1e-105')
        for q in questions:
            verify_teaching(q)
            v=q['verification']; dp=v['precision']; percent=v['outputFormat']=='percentage'
            display_result=decimal_eval(parse_display(v['displayExpression']))
            if percent: display_result*=100
            exact=to_decimal(v['exactValue'])
            assert abs(display_result-exact)<tolerance,(q['id'],'display expression mismatch')
            assert abs(decimal_eval(v['expression'])-exact)<tolerance,(q['id'],'metadata mismatch')
            if v['transformationExpression']:
                assert abs(decimal_eval(v['transformationExpression'])-exact)<tolerance,(q['id'],'invalid shortcut')
            quantum=to_decimal(v['roundingUnit'])
            result=(display_result/quantum).quantize(D(1),rounding=ROUND_HALF_UP)*quantum
            assert result==D(v['roundedValue']),(q['id'],result,v['roundedValue'])
            assert v['roundingMode']=='ROUND_HALF_UP'
            assert '四舍五入' in q['stem'] and v['displayExpression'] in q['stem']
            if quantum>=10: assert ('到整十' if quantum==10 else '到整百') in q['stem']
            elif dp: assert f'保留 {dp} 位小数' in q['stem']
            else: assert '到整数' in q['stem']
            assert q['stemBlocks']==[dict(type='paragraph',text=q['stem'])]
            expected_format=dict(kind='percent' if percent else 'number',decimalPlaces=dp)
            if quantum>=10: expected_format['roundingUnit']=int(quantum)
            assert q['answerFormat']==expected_format
            if v.get('approximationExpression'):
                approx=decimal_eval(v['approximationExpression'])
                approx_rounded=(approx/quantum).quantize(D(1),rounding=ROUND_HALF_UP)*quantum
                assert approx_rounded==result,(q['id'],'approximation crosses rounding boundary')
            assert not any(re.search(r'选择\s*[ABCD]',block['text']) for block in q['explanationBlocks'])
            if percent: assert '填写数值部分，无需 %' in q['stem']
            assert len(q['options'])==4 and [o['value'] for o in q['options']]==list('ABCD')
            values=[]; winners=[]
            for option in q['options']:
                assert option['label'].endswith('%')==percent
                value=D(option['label'].rstrip('%'))
                assert value.as_tuple().exponent==-dp,(q['id'],'option precision')
                values.append(value)
                if value==result: winners.append(option['value'])
            assert len(set(values))==4 and winners==[q['answer']],(q['id'],winners)
            assert q['origin']['isPastExam'] is False and '原创' in q['sourceLabel']
            assert len(q['stem'])<140,(q['id'],'not a short direct calculation')
            assert all(x['type']=='paragraph' for x in q['explanationBlocks'])
            # Exact half-unit bound, using rational comparison independent of Decimal.
            rational=Fraction(v['exactValue']); rounded_rational=Fraction(v['roundedValue'])
            half=Fraction(v['roundingUnit'])/2
            assert rounded_rational-half<=rational<rounded_rational+half,(q['id'],'rounding bounds')
            distance=min(abs(rational-(rounded_rational-half)),abs(rational-(rounded_rational+half)))
            if distance<half/10: boundary.append(dict(id=q['id'],distanceToBoundary=str(distance),halfUnit=str(half)))
            checks.append(dict(id=q['id'],displayMatchesExact=True,shortcutEquivalent=True,
                decimalMatchesFraction=True,roundingBounds=True,uniqueCorrectOption=True,
                workedArithmetic=True,explanationHashMatches=True))
    return dict(total=180,countsBySkill=dict(Counter(q['skillTitle'] for q in questions)),
        countsByDifficulty=dict(Counter(q['difficulty'] for q in questions)),
        countsByAnswer=dict(Counter(q['answer'] for q in questions)),
        percentOutputCount=sum(q['verification']['outputFormat']=='percentage' for q in questions),
        countsByRoundingUnit=dict(Counter(q['verification']['roundingUnit'] for q in questions)),
        teaching=dict(version='worked-mental-arithmetic-2',questions=len(questions),
            displayedIdentities=sum(len(q['verification']['teaching']['identities']) for q in questions),
            residualProofs=sum('division' in q['verification']['teaching'] for q in questions),
            approximationIntervals=sum('approximation' in q['verification']['teaching'] for q in questions)),
        nearRoundingBoundary=boundary,unresolved=[],checks=checks)

if __name__=='__main__':
    path=Path(__file__).resolve().parent.parent/'calculation.reviewed.json'
    report=verify_all(json.loads(path.read_text(encoding='utf-8')))
    report['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
    print(json.dumps({k:v for k,v in report.items() if k!='checks'},ensure_ascii=False,indent=2))
