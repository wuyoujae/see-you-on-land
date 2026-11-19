"""180 original direct calculation drills. No exam materials or copied questions.
Generator uses Fraction; verify.py independently parses displayed expressions using
Decimal and checks all transformation/rounding identities.
"""
from fractions import Fraction as F
from decimal import Decimal, localcontext, ROUND_HALF_UP
from pathlib import Path
from collections import Counter
from math import gcd
import ast
import json
import random
import hashlib

HERE=Path(__file__).resolve().parent
QUESTIONS=[]
SKILLS={
 'addition':('加减拆分',24), 'multiply':('速算乘法',24), 'percentage':('百分数运算',24),
 'division':('除法估算',36), 'base':('基期量',24), 'growth':('增长量',24),
 'share-average':('比重与平均数',24)}

def evaluate(expr):
    def walk(n):
        if isinstance(n,ast.Constant): return F(ast.get_source_segment(expr,n))
        if isinstance(n,ast.UnaryOp): return -walk(n.operand) if isinstance(n.op,ast.USub) else walk(n.operand)
        if isinstance(n,ast.BinOp):
            a,b=walk(n.left),walk(n.right)
            if isinstance(n.op,ast.Add): return a+b
            if isinstance(n.op,ast.Sub): return a-b
            if isinstance(n.op,ast.Mult): return a*b
            if isinstance(n.op,ast.Div): return a/b
            if isinstance(n.op,ast.Pow): return a**int(b)
        raise ValueError(ast.dump(n))
    return walk(ast.parse(expr,mode='eval').body)

def rounded(value,places):
    value=F(value); scale=10**places; a=abs(value)
    n=(2*a.numerator*scale+a.denominator)//(2*a.denominator)
    n=n if value>=0 else -n
    if places==0: return str(n)
    sign='-' if n<0 else ''; n=abs(n)
    return sign+str(n//scale)+'.'+str(n%scale).zfill(places)

def clean(value):
    s=rounded(F(value),6)
    return s.rstrip('0').rstrip('.') if '.' in s else s

def rounded_unit(value,places,unit=None):
    if unit is None: return rounded(value,places)
    return rounded(F(rounded(F(value)/F(unit),0))*F(unit),places)

def human(expr):
    return expr.replace('**2','²').replace('*','×').replace('/','÷').replace('+','＋').replace('-','－')

def p(text): return dict(type='paragraph',text=text)

def add(skill,expr,hint,transform=None,places=0,display=None,output='number',technique=None,rounding_unit=None,approximation=None):
    index=len(QUESTIONS)+1
    local=sum(q['skillId']=='calc-'+skill for q in QUESTIONS)
    size=SKILLS[skill][1]
    difficulty='foundation' if local<size//3 else 'standard' if local<size*5//6 else 'challenge'
    exact=evaluate(expr); answer_value=rounded_unit(exact,places,rounding_unit)
    if transform is not None: assert evaluate(transform)==exact,(skill,expr,transform)
    suffix='%' if output=='percentage' else ''
    shown=display or human(expr)
    prec='四舍五入到整数' if places==0 else f'四舍五入保留 {places} 位小数'
    if rounding_unit: prec='四舍五入到'+{10:'整十',100:'整百'}[rounding_unit]
    stem=('计算 '+shown+'，以百分数表示（百分数数值'+prec+'；填写数值部分，无需 %）。' if output=='percentage'
          else '计算 '+shown+'（'+prec+'）。')
    # Distractors represent one-place mistakes, lost terms and scale errors.
    v=F(answer_value)
    if skill=='percentage': wrong=[v*10,v/10,v+max(F(1),abs(v)/10)]
    elif skill=='multiply': wrong=[v/10,v*10,v+max(F(1),abs(v)/20)]
    elif skill=='division': wrong=[v-F(1,10**max(0,places-1)),v+F(2,10**max(0,places-1)),v*10]
    elif skill=='base': wrong=[v+max(F(10),abs(v)/20),v-max(F(10),abs(v)/20),v*F(11,10)]
    elif skill=='growth': wrong=[v+max(F(1),abs(v)/10),v-max(F(1),abs(v)/10),v*F(6,5)]
    elif skill=='share-average': wrong=[v*10,v+max(F(1),abs(v)/10),v-max(F(1),abs(v)/10)]
    else: wrong=[v+10,v-10,v+100] if places==0 else [v+F(1,10),v-F(1,10),v+1]
    wrong_strings=[]
    for x in wrong:
        candidate=rounded_unit(x,places,rounding_unit)
        while candidate==answer_value or candidate in wrong_strings:
            x+=F(rounding_unit) if rounding_unit else F(1,10**places)
            candidate=rounded_unit(x,places,rounding_unit)
        wrong_strings.append(candidate)
    rng=random.Random(20261118+index); rng.shuffle(wrong_strings)
    correct=(index-1)%4; wrong_strings.insert(correct,answer_value)
    options=[dict(value='ABCD'[i],label=value+suffix) for i,value in enumerate(wrong_strings)]
    explanation=[p(hint)]
    if transform:
        approx=rounded(exact,max(places+2,3)); symbol='＝' if F(approx)==exact else '≈'
        explanation.append(p(('百分数的数值＝' if output=='percentage' else '原式＝')+human(transform)+symbol+approx+'。'))
    explanation.append(p('按题目精度得到 '+answer_value+suffix+'。'))
    answer_format=dict(kind='percent' if output=='percentage' else 'number',decimalPlaces=places)
    if rounding_unit: answer_format['roundingUnit']=rounding_unit
    QUESTIONS.append(dict(id=f'focus-calc-{index:03d}',kind='calculation',skillId='calc-'+skill,
      skillTitle=SKILLS[skill][0],difficulty=difficulty,form='calculation',stem=stem,
      answerFormat=answer_format,
      stemBlocks=[p(stem)],options=options,answer='ABCD'[correct],explanationBlocks=explanation,
      sourceLabel='原创速算练习，非真题',origin=dict(type='original',isPastExam=False,authoredAt='2026-11-18'),
      verification=dict(expression=expr,displayExpression=shown,exactValue=str(exact),
        precision=places,roundingMode='ROUND_HALF_UP',roundingUnit=str(rounding_unit or F(1,10**places)),roundedValue=answer_value,correctValue=answer_value,
        approximationExpression=approximation,
        outputFormat=output,transformationExpression=transform,technique=technique or hint,
        check='Fraction 精确值与独立 Decimal 解析、舍入交叉复核；逐个验证四选项。')))

# 1–24: compensation, grouping, cancellation, decimal-point alignment.
ADDITION=[
 ('786+498','把 498 拆成 500－2，先凑整再回补。','786+500-2',0),
 ('943-397','把减去 397 改成减去 400，再补回 3。','943-400+3',0),
 ('1286+714+395','先配成整千：1286＋714＝2000，再加 395。','2000+395',0),
 ('2503-998','先减 1000，再补回 2。','2503-1000+2',0),
 ('864+136+579','先用 864＋136 凑成 1000。','1000+579',0),
 ('4725-1987','把 1987 看成 2000－13，减 2000 后加回 13。','4725-2000+13',0),
 ('38.7+61.3+24.6','先把 38.7 与 61.3 配成 100，注意小数点对齐。','100+24.6',1),
 ('82.4-19.8','减去 20 后补回 0.2。','82.4-20+0.2',1),
 ('1638+2457-638','先把 1638 与－638 合并为 1000。','1000+2457',0),
 ('8247-3159-1841','两个减数先相加：3159＋1841＝5000。','8247-5000',0),
 ('1498+2503+999','分别写成 1500－2、2500＋3、1000－1，三个修正数相消。','1500+2500+1000',0),
 ('6002-2998','两个数同时加 2，差不变：6004－3000。','6004-3000',0),
 ('97.6+28.7-47.6','先合并 97.6－47.6＝50，再加 28.7。','50+28.7',1),
 ('318.5-99.7+81.5','先用 318.5＋81.5 凑 400，再减 100、补 0.3。','400-100+0.3',1),
 ('4736+2869-1736-1869','按相同尾数配对：4736－1736＝3000，2869－1869＝1000。','3000+1000',0),
 ('9998+10003+19997','分别以 10000、10000、20000 为基准，修正数为－2、＋3、－3。','10000+10000+20000-2+3-3',0),
 ('72.48+27.52-16.79','前两项恰好凑成 100，再减 16.79。','100-16.79',2),
 ('403.06-198.97','减数写成 200－1.03，先减 200，再补 1.03。','403.06-200+1.03',2),
 ('1542-768+458-232','正项凑 2000，负项凑 1000，再相减。','2000-1000',0),
 ('28.36+19.87+71.64-9.87','按尾数配对：28.36＋71.64＝100，19.87－9.87＝10。','100+10',2),
 ('10000-3968-2032+497','先合并两个减数为 6000，497 写成 500－3。','10000-6000+500-3',0),
 ('756.84-298.76-201.24','两个减数相加恰为 500，不必逐次借位。','756.84-500',2),
 ('2199+3804-1197-2806','配对得 2199－1197＝1002，3804－2806＝998，再凑整。','1002+998',0),
 ('85.07-39.98+14.93-20.02','正项之和为 100，减数之和为 60；保留两位小数。','100-60',2),
]
for expr,hint,t,dp in ADDITION: add('addition',expr,hint,t,dp,technique='凑整、配对、补偿与小数对齐')

# 25–48: distinct multiplier structures, not merely different large inputs.
MULTIPLY=[
 ('784*25','25＝100÷4，先除 4 再乘 100。','784/4*100',0),
 ('368*125','125＝1000÷8，先除 8 再乘 1000。','368/8*1000',0),
 ('928*12.5','12.5＝100÷8，先除 8 再乘 100。','928/8*100',0),
 ('648*2.5','2.5＝10÷4，先除 4 再乘 10。','648/4*10',0),
 ('1564*0.25','0.25＝1/4，直接除以 4。','1564/4',0),
 ('736*0.125','0.125＝1/8，直接除以 8。','736/8',0),
 ('467*99','99＝100－1，用百倍减去自身。','467*100-467',0),
 ('589*101','101＝100＋1，用百倍加上自身。','589*100+589',0),
 ('346*98','98＝100－2，用百倍减去两倍。','346*100-346*2',0),
 ('427*102','102＝100＋2，用百倍加上两倍。','427*100+427*2',0),
 ('864*15','15＝10＋5，即十倍加一半的十倍。','864*10+864*10/2',0),
 ('248*35','35＝（7÷2）×10，先将 248 减半再乘 7、乘 10。','248/2*7*10',0),
 ('336*45','45＝50－5，先算五十倍，再减去五倍。','336*50-336*5',0),
 ('128*75','75＝100×3/4，先除 4，再乘 3 和 100。','128/4*3*100',0),
 ('675*0.8','0.8＝4/5，先除 5 再乘 4。','675/5*4',0),
 ('432*1.25','1.25＝5/4，先除 4 再乘 5。','432/4*5',0),
 ('726*9.9','9.9＝10－0.1，用十倍减去十分之一。','726*10-726/10',1),
 ('428*11','11＝10＋1，十倍与本数错位相加。','4280+428',0),
 ('863*1.01','1.01＝1＋0.01，用本数加百分之一，按小数点对齐。','863+8.63',2),
 ('624*7.5','7.5＝（10÷4）×3，先除 4，再乘 30。','624/4*30',0),
 ('48*52','两个因数以 50 为中心，利用平方差：50²－2²。','50**2-2**2',0),
 ('97*103','两个因数以 100 为中心，利用平方差：100²－3²。','100**2-3**2',0),
 ('24.8*4.5','4.5＝5－0.5，五倍减去一半。','24.8*5-24.8/2',1),
 ('63.6*0.75','0.75＝3/4，先除 4，再乘 3；不要把 0.75 当成 75。','63.6/4*3',1),
]
for expr,hint,t,dp in MULTIPLY: add('multiply',expr,hint,t,dp,technique='特殊倍数、拆乘、错位加减或平方差')

# 49–72: percentage arithmetic. Transformation preserves exact decimal percent.
PERCENT=[
 ('928','12.5','928/8','12.5%＝1/8，直接除 8。',0),
 ('764','25','764/4','25%＝1/4，直接除 4。',0),
 ('832','37.5','832/8*3','37.5%＝3/8，先除 8 再乘 3。',0),
 ('648','62.5','648/8*5','62.5%＝5/8，先除 8 再乘 5。',0),
 ('1260','20','1260/5','20%＝1/5，直接除 5。',0),
 ('384','75','384/4*3','75%＝3/4，先除 4 再乘 3。',0),
 ('1600','6.25','1600/16','6.25%＝1/16，直接除 16。',0),
 ('2480','2.5','2480/40','2.5%＝1/40，直接除 40。',0),
 ('675','12','675/10+675/50','12%＝10%＋2%，十分之一加五十分之一。',1),
 ('842','15','842/10+842/20','15%＝10%＋5%，十分之一加二十分之一。',1),
 ('936','18','936/5-936/50','18%＝20%－2%，先算五分之一，再减五十分之一。',2),
 ('1450','4','1450/25','4%＝1/25，直接除 25。',0),
 ('720','7.5','720/40*3','7.5%＝3/40，先除 40 再乘 3。',0),
 ('864','22.5','864/5+864/40','22.5%＝20%＋2.5%，分别化为 1/5 和 1/40。',1),
 ('560','17.5','560/5-560/40','17.5%＝20%－2.5%，先算五分之一再减四十分之一。',0),
 ('3180','0.5','3180/200','0.5%＝1/200，除以 200，注意不是除以 2。',1),
 ('2540','1.2','2540/100+2540/500','1.2%＝1%＋0.2%，分别除 100 和 500。',2),
 ('875','99','875-875/100','99%＝100%－1%，用本数减百分之一。',2),
 ('640','102.5','640+640/40','102.5%＝100%＋2.5%，用本数加四十分之一。',0),
 ('924','8.5','924/10-924*1.5/100','8.5%＝10%－1.5%，先算十分之一，再作补偿。',2),
 ('1236','16.7','1236/6+1236/3000','16.7% 比 1/6 恰好多 1/3000；先除 6，再补这一小项。',2),
 ('1485','33.3','1485/3-1485/3000','33.3% 比 1/3 恰好少 1/3000；先除 3，再减去小修正。',2),
 ('2142','14.3','2142/7+2142/7000','14.3% 比 1/7 恰好多 1/7000；不能把近似分数当成完全相等。',2),
 ('768','3.125','768/32','3.125%＝1/32，连续除以 2 五次即可。',0),
]
for x,r,t,hint,dp in PERCENT:
    add('percentage',f'{x}*{r}/100',hint,t,dp,f'{x}×{r}%',technique='百分数化分数、拆分与误差补偿')

def division_hint(x,y,places,mode=0,rounding_unit=None):
    a,b=F(x),F(y); v=a/b; integer=v.numerator//v.denominator; rem=a-integer*b
    if rem==0:
        return f'先找整倍数：{clean(y)}×{integer}＝{clean(x)}，所以商直接为 {integer}。'
    unit=F(rounding_unit) if rounding_unit else F(1,10**places)
    trial=F(rounded_unit(v,places,rounding_unit)); diff=abs(a-b*trial); limit=b*unit/2
    if diff==0: return f'把除法改为试乘：{clean(b)}×{clean(trial)}＝{clean(a)}，商正好为 {clean(trial)}。'
    intro='先估计商的量级，再用邻近结果试乘。'
    if mode==2 and b>=100:
        digits=len(str(int(b))); cut_unit=10**max(0,digits-2)
        cut=int(F(rounded(b/cut_unit,0)))*cut_unit
        intro=f'先把分母 {clean(b)} 约为 {cut}，定位商约 {rounded(a/cut,0 if v>=1 else 1)}。'
    return intro+f'{clean(b)}×{clean(trial)}＝{clean(b*trial)}，与 {clean(a)} 相差 {clean(diff)}，小于半个舍入单位对应的 {clean(b)}×{clean(unit/2)}＝{clean(limit)}，因此取 {clean(trial)}。'

# 73–108: familiar factors, scale placement, then near-divisor estimates.
DIVISION=[
 (1728,48,0),(1365,35,0),(2772,126,0),(3248,112,0),
 (2580,160,1),(4725,225,0),(3456,128,0),(1836,72,1),
 ('268.8','8.4',1),('94.5','2.7',1),('36.48','1.6',1),('7.56','0.24',1),
 (4387,612,1),(7932,247,1),(5268,73,1),(2486,498,1),
 (6845,203,1),(12048,302,1),(9375,418,1),(5678,153,1),
 (8246,397,1),(15932,624,1),(3461,86,1),(7285,243,1),
 ('846.7','31.6',1),('593.8','24.7',1),('47.83','6.2',1),('5.784','0.37',1),
 (2587,6042,2),(3769,8124,2),(9127,317,2),(6485,237,2),
 (3847,986,2),('126.86','7.36',2),('48.72','0.83',2),(17963,428,2),
]
for i,(a,b,dp) in enumerate(DIVISION):
    if i>=30: dp=0
    add('division',f'{a}/{b}',division_hint(a,b,dp,i%3),None,dp,
        technique=['约分直除','整商与余数','截位定位后修正'][i%3])

# 109–132: direct base-period formula, including negative rate denominator.
BASE=[
 (6250,'25',0),(4680,'20',0),(7200,'12.5',0),(5940,'10',0),
 (5832,'8',0),(4992,'4',0),(7140,'2',0),(5100,'6.25',0),
 (6364,'7.5',1),(8217,'9.6',1),(7138,'13.4',1),(9246,'17.8',1),
 (3840,'-20',0),(6125,'-12.5',0),(7290,'-10',0),(4608,'-4',0),
 (8736,'5',1),(6543,'3.2',1),(9328,'1.6',1),(5876,'14.3',1),
 (12346,'2.8',2),(8468,'11.7',2),(15736,'-6.4',2),(9610,'0.8',2),
]
for x,rate,dp in BASE:
    if x==9246: x=9224
    r=F(rate)/100; den=1+r; mul=1/den
    sign='＋' if r>=0 else '－'
    shown=f'{x}÷（1{sign}{abs(F(rate))}%）'
    if F(rate).denominator!=1: shown=f'{x}÷（1{sign}{clean(abs(F(rate)))}%）'
    t=f'{x}/{mul.denominator}*{mul.numerator}'
    hint=f'先把分母 1{sign}{clean(abs(F(rate)))}% 写成 {den.numerator}/{den.denominator}，除以它就是先除 {mul.denominator} 再乘 {mul.numerator}。'
    exact=F(x)/den; unit=None
    if exact.denominator!=1:
        dp=0; unit=100; t=None
        trial=F(rounded_unit(exact,0,unit)); diff=abs(F(x)-trial*den)
        hint=f'先把分母算成 {clean(den)}，按整百估商并试乘：{clean(trial)}×{clean(den)}＝{clean(trial*den)}。它与 {x} 相差 {clean(diff)}，小于 {clean(den)}×50＝{clean(den*50)}，所以四舍五入到整百为 {clean(trial)}。'
    add('base',f'{x}/(1+({rate})/100)',hint,t,dp,shown,technique='分母 1+r 转换、整百试乘',rounding_unit=unit)

# 133–156: direct growth increment; shortcuts derive from r/(1+r), not x*r.
GROWTH=[
 (6450,'25',0),(7260,'20',0),(8352,'12.5',0),(6930,'10',0),
 (9180,'6.25',0),(7560,'5',0),(8060,'4',0),(8610,'2.5',0),
 (7040,'37.5',0),(8320,'62.5',0),(7560,'75',0),(8120,'16',0),
 (5837,'8',1),(7629,'12',1),(9456,'15',1),(6527,'18',1),
 (8736,'7.5',1),(10935,'9.6',1),(14872,'13.4',1),(9371,'3.2',1),
 (12740,'16.7',2),(15642,'33.3',2),(11347,'14.3',2),(9846,'2.8',2),
]
for x,rate,dp in GROWTH:
    r=F(rate)/100; factor=r/(1+r); t=f'{x}/{factor.denominator}*{factor.numerator}'
    unit=None; approximation=None
    if factor.numerator==1:
        hint=f'{rate}%＝1/{(1/r).numerator}，因此 r÷（1＋r）＝1/{factor.denominator}；原式直接除以 {factor.denominator}。'
    else:
        hint=f'先把 {rate}% 化为 {r.numerator}/{r.denominator}，再约去复合分母，r÷（1＋r）＝{factor.numerator}/{factor.denominator}；先除后乘。'
    if (F(x)*factor).denominator!=1:
        dp=0; unit=10; t=None
        numerator=x*factor.numerator
        hint=f'先把增长量化为 {numerator}÷{factor.denominator}。'+division_hint(numerator,factor.denominator,0,rounding_unit=10)
    if rate in ('16.7','33.3','14.3','2.8'):
        reference={'16.7':7,'33.3':4,'14.3':8,'2.8':37}[rate]
        approximation=f'{x}/{reference}'
        trial=F(rounded_unit(F(x,reference),0,10))
        hint=f'{rate}% 接近 1/{reference-1}，增长量约为 {x}÷{reference}；用 {reference}×{clean(trial)}＝{clean(reference*trial)} 定位，按本题整十精度取 {clean(trial)}。'
    add('growth',f'{x}*({rate}/100)/(1+{rate}/100)',hint,t,dp,
        f'{x}×{rate}%÷（1＋{rate}%）',technique='增长量分数法与 n+1 转换',rounding_unit=unit,approximation=approximation)

# 157–180: share percentages, average quotients, weighted averages, average-rate terms.
SHARES=[
 (862,4310,1),(1176,6272,2),(1485,5940,1),(2436,13920,1),
 (791,6328,1),(1848,5544,1),(2185,9200,2),(2648,6620,1),
 (5371,28460,2),(3187,16742,2),(4219,19386,2),(2786,21473,2),
]
for a,b,dp in SHARES:
    fraction=F(a,b); t=f'{fraction.numerator}*100/{fraction.denominator}'
    hint=f'先把 {a}/{b} 约为 {fraction.numerator}/{fraction.denominator}，再乘 100 得百分数的数值；小数点要向右移两位。'
    if fraction.denominator>100:
        value=fraction*100; anchor=value.numerator//value.denominator
        rem=F(a)-F(b*anchor,100)
        correction=rem*100/b
        hint=f'先取 {anchor}%：{b}×{anchor}%＝{clean(F(b*anchor,100))}，还差 {clean(rem)}；差额占整体约 {rounded(correction,dp+2)} 个百分点，再加回 {anchor}%。'
        t=f'{anchor}+({a}-{b}*{anchor}/100)*100/{b}'
    add('share-average',f'{a}/{b}*100',hint,t,dp,f'{a}÷{b}',output='percentage',technique='比重约分与小数百分数转换')

AVERAGES=[
 ('16896/48','先把分子分母同时除 12，化为 1408÷4。','1408/4',1),
 ('28635/75','75＝3×25，先除 3 再除 25；除 25 可乘 4 后除 100。','28635/3*4/100',1),
 ('43782/126','先把分子分母同时除 6，化为 7297÷21。','7297/21',1),
 ('57386/238','先用 238×240＝57120 定位，原式为 240＋266÷238。','240+266/238',1),
 ('9376/32','32＝2⁵，可以连续减半五次。','9376/2/2/2/2/2',1),
 ('14875/64','64＝8×8，先除 8 再除 8。','14875/8/8',2),
 ('(348*24+420*16)/(24+16)','以 348 为基准，较高一组多 72，权重为 16/40，所以只补 72×16/40。','348+72*16/40',1),
 ('(126*35+154*21)/(35+21)','以 126 为基准，另一组高 28，权重为 21/56＝3/8，补上 28×3/8。','126+28*3/8',1),
 ('(72.5*18+81.5*30)/(18+30)','以 72.5 为基准，另一组高 9，权重 30/48＝5/8，补上 9×5/8。','72.5+9*5/8',2),
 ('(286*45+334*27)/(45+27)','以 286 为基准，高出 48 的一组占 27/72＝3/8，补上 48×3/8。','286+48*3/8',1),
]
for expr,hint,t,dp in AVERAGES: add('share-average',expr,hint,t,dp,technique='平均数除法与基准加权补差')
add('share-average','((1+18/100)/(1+8/100)-1)*100',
    '用“拆一”把（1.18÷1.08）－1 化为（1.18－1.08）÷1.08，再写成百分数。',
    '(18-8)/(1+8/100)',2,'（1＋18%）÷（1＋8%）－1',output='percentage',technique='平均数增幅拆一')
add('share-average','((1+13.6/100)/(1+4.8/100)-1)*100',
    '先减去分母所对应的 1：分子只剩 13.6%－4.8%＝8.8%；再除 1.048，转成百分数。',
    '(13.6-4.8)/(1+4.8/100)',2,'（1＋13.6%）÷（1＋4.8%）－1',output='percentage',technique='平均数增幅拆一')

def main():
    from verify import verify_all
    from teaching import enrich_questions
    enrich_questions(QUESTIONS)
    report=verify_all(QUESTIONS)
    for q in QUESTIONS: q['verification']['status']='passed'
    content=json.dumps(QUESTIONS,ensure_ascii=False,indent=2)+'\n'
    (HERE/'candidates.json').write_text(content,encoding='utf-8',newline='\n')
    report['sha256']=hashlib.sha256(content.encode('utf-8')).hexdigest()
    (HERE/'verification-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    lines=['# 资料速算逐题审阅表','','全部为原创直接计算练习，非真题；所有题干均明确四舍五入精度。','',
      '| ID | 难度 | 模块 | 算式 | 精度 | 答案 | 方法 |','|---|---|---|---|---|---|---|']
    for q in QUESTIONS:
        v=q['verification']; unit='%' if v['outputFormat']=='percentage' else ''
        lines.append('| '+q['id']+' | '+q['difficulty']+' | '+q['skillTitle']+' | '+v['displayExpression']+' | '+str(v['precision'])+' | '+q['answer']+'='+v['roundedValue']+unit+' | '+q['explanationBlocks'][0]['text']+' |')
    (HERE/'review-all.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='checks'},ensure_ascii=False,indent=2))

if __name__=='__main__': main()
