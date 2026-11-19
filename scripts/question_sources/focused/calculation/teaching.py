"""Worked mental-arithmetic explanations, with independently checkable evidence.

Only explanationBlocks and authoring verification.teaching change. The problem,
answer, difficulty, precision and stable ID remain unchanged.
"""
from __future__ import annotations

import ast
from fractions import Fraction as F
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
VERSION = 'worked-mental-arithmetic-2'


def evaluate(expression):
    def walk(node):
        if isinstance(node, ast.Constant): return F(ast.get_source_segment(expression, node))
        if isinstance(node, ast.UnaryOp): return -walk(node.operand) if isinstance(node.op, ast.USub) else walk(node.operand)
        a, b = walk(node.left), walk(node.right)
        if isinstance(node.op, ast.Add): return a + b
        if isinstance(node.op, ast.Sub): return a - b
        if isinstance(node.op, ast.Mult): return a * b
        if isinstance(node.op, ast.Div): return a / b
        if isinstance(node.op, ast.Pow): return a ** int(b)
        raise ValueError(expression)
    return walk(ast.parse(expression, mode='eval').body)


def rounding(value, unit=F(1)):
    value, unit = F(value), F(unit)
    scaled = value / unit
    sign = -1 if scaled < 0 else 1
    scaled = abs(scaled)
    return sign * ((2 * scaled.numerator + scaled.denominator) // (2 * scaled.denominator)) * unit


def number(value):
    value = F(value)
    denominator = value.denominator
    for prime in (2, 5):
        while denominator % prime == 0: denominator //= prime
    if denominator != 1: return f'({value.numerator}/{value.denominator})'
    places, scale = 0, 1
    while scale % value.denominator:
        places += 1; scale *= 10
    n = abs(value.numerator * (scale // value.denominator))
    sign = '-' if value < 0 else ''
    return sign + str(n // scale) + ('.' + str(n % scale).zfill(places) if places else '')


def human(expression):
    return expression.replace('**2', '²').replace('*', '×').replace('/', '÷').replace('+', '＋').replace('-', '－')


class Evidence:
    def __init__(self): self.identities, self.comparisons, self.estimates = [], [], []

    def equation(self, expression):
        result = evaluate(expression)
        text = human(expression) + '＝' + human(number(result))
        self.identities.append({'expression': expression, 'result': str(result), 'text': text})
        return text

    def compare(self, left, relation, right):
        a, b = evaluate(left), evaluate(right)
        assert {'<': a < b, '>=': a >= b, '<=': a <= b}[relation]
        text = human(number(a)) + {'<': '＜', '>=': '≥', '<=': '≤'}[relation] + human(number(b))
        self.comparisons.append({'left': left, 'relation': relation, 'right': right, 'text': text})
        return text

    def estimate(self, expression):
        value=evaluate(expression)
        unit=F(1) if value>=1 else F(1,10)
        result=rounding(value, unit)
        text=human(expression)+'≈'+human(number(result))
        self.estimates.append({'expression':expression,'result':str(result),'unit':str(unit),'text':text})
        return text


def finite_trace(expression, evidence):
    """Expose actual intermediate operations, without false rounded equalities."""
    operations = []
    def walk(node):
        if isinstance(node, ast.Constant): return F(ast.get_source_segment(expression, node))
        if isinstance(node, ast.UnaryOp): return -walk(node.operand) if isinstance(node.op, ast.USub) else walk(node.operand)
        a, b = walk(node.left), walk(node.right)
        symbol = {ast.Add: '+', ast.Sub: '-', ast.Mult: '*', ast.Div: '/', ast.Pow: '**'}[type(node.op)]
        sub = f'{number(a)}{symbol}{number(b)}'
        # Each value remains exact; nonterminating rational sub-results are not
        # silently printed as a short decimal in an equality.
        equation = evidence.equation(sub)
        if equation not in operations:
            operations.append(equation)
        return evaluate(sub)
    walk(ast.parse(expression, mode='eval').body)
    return '；'.join(operations) + '。'


ADDITION_NOTES = [
 ('498只差2就到500，先做整百加法可以少一次进位。','刚才是多加2，最后应减2，不能再加2。','加数接近整百、整千时，先凑整，再减去多加的部分。'),
 ('397接近400，减整百比连续借位容易。','多减了3就补回3；把补偿写成减3会让结果更小。','减去“整百少一点”的数，可以先减整百，再补差。'),
 ('先扫一遍所有加数，1286和714能直接凑成2000。','不要固定从左到右算；交换加数不会改变总和。','多个加数先找尾数互补的一对，能省掉中间进位。'),
 ('998比1000少2，可以用减整千代替借位减法。','减1000比原题多减2，需要加回来。','遇到998、999这类减数，优先考虑整千补偿。'),
 ('864的尾数136正好补足1000，先配对。','579留到最后加，没必要同时处理三个数。','先凑整的一对通常由尾数决定，先看末三位。'),
 ('1987离2000差13，先减整千，再处理13。','减数往上调了13，结果应往上补13。','补偿方向由“原运算多算了什么”决定，别死记加减号。'),
 ('38.7和61.3的小数部分与整数部分一起凑成100。','重排数字时保留小数点；0.7＋0.3要进1。','小数加法也先找补成整数的一对。'),
 ('19.8接近20，先减20，再补0.2。','补偿是0.2，不是2；对齐小数点再加。','小数接近整数时，凑整后只处理小差额。'),
 ('1638和－638尾数相同，先相减只剩1000。','移动－638时要连同负号一起移动。','加减混合式可看成带符号的数相加，先消去相同尾数。'),
 ('两个减数3159和1841合起来正好5000。','a－b－c＝a－(b＋c)，括号内不是b－c。','连续减法先合并减数，尤其留意能凑整的尾数。'),
 ('三个数都挨着整百或整千，修正量－2、＋3、－1恰好抵消。','修正量也必须求和；不能各自四舍五入后默认误差为零。','多个数一起凑整时，把所有修正数单独加一遍。'),
 ('把两个数同时加2，减数就变成3000，而差保持不变。','只给减数加2会改变差；差不变要求两边同时加同一个数。','减数难算时可用同加、同减把它变整。'),
 ('97.6和－47.6小数部分相同，先相减成50。','重排－47.6时负号不变。','相同小数尾数做差，通常能先消掉小数。'),
 ('318.5与81.5凑400，再用99.7接近100做补偿。','从400减100后应加回0.3，别把补偿方向写反。','先配对凑整，再对剩余的难算数做一次补偿。'),
 ('两组相同尾数分别相减，都能整千消去。','负项换位置要带负号，不能把减法改成加法。','长式子先找相同尾数的正负配对。'),
 ('以10000、10000、20000为基准，最后合并三个很小的偏差。','修正数之和是－2，并非0。','数接近整万时，分开算“整万部分”和“偏差部分”。'),
 ('72.48与27.52恰好凑成100，先减少一个小数加法。','100－16.79要按100.00处理借位，不能只减整数。','先消掉能凑整的项，再处理唯一剩下的小数。'),
 ('198.97与200差1.03，整百减法后只需回补1.03。','1.03不是1.3；百分位和十分位不能混。','看清与整数的差额，再决定补偿的小数位。'),
 ('正项1542与458凑2000，减数768与232凑1000。','分别合并正项和负项，不能丢掉中间的减号。','四项以上先分成正项之和、减数之和。'),
 ('28.36与71.64凑100，19.87与－9.87相消小数。','先找整对的结构，不必逐项进位借位。','一对做和、一对做差，可以同时消掉小数部分。'),
 ('3968与2032是整6000，497再按500－3处理。','先合并两个减数，497仍是正项。','先合并同号项，再凑整剩下的一个数。'),
 ('298.76与201.24恰好为500，避免连续两次小数借位。','两个减数都要计入减去的总量。','连续减小数时先查减数的尾数能否互补。'),
 ('先配成1002和998，两者再凑2000，形成两次简单配对。','第一轮配对之后还可以再次凑整，别急着列竖式。','先局部消尾数，再检查中间结果是否互补。'),
 ('两项正数凑100，两项减数凑60，四项压成一次减法。','最终保留两位可写40.00，但数值等价的40也正确。','小数多不等于计算复杂，先检查正负两组的总和。'),
]

MULTIPLY_NOTES = [
 ('25是100的四分之一。','乘25不是除25，改写后还要乘100。','乘25：先除4再乘100；被乘数不整除4时也可先乘100再除4。'),
 ('125是1000的八分之一。','除8之后别漏乘1000。','乘125优先找因数8，把三位数乘法改成整除和补零。'),
 ('12.5是100的八分之一，这里没有百分号。','12.5与12.5%差100倍；本题不能只除8。','先看百分号，再决定12.5对应100/8还是1/8。'),
 ('2.5＝10/4，而648能被4整除。','除4之后还要乘10。','乘2.5可先除4、再乘10。'),
 ('0.25恰好是1/4。','乘小于1的正数，结果应比原数小。','认出0.25、0.125、0.75，通常直接转成熟悉分数。'),
 ('0.125＝1/8，连续减半三次也能完成。','0.125不是125，结果不应变大。','除8可以拆成三次除2。'),
 ('99只比100少1，可以用分配律。','减去的是一份467，不是减1。','乘“整百－小数”时，整百倍数减去相应份数。'),
 ('101只比100多1，用整百倍加一份。','补的是一份589，而非在58900上只加1。','乘101记成100份加1份。'),
 ('98＝100－2，整百倍减两份即可。','应减两倍346，不是减2。','接近100的乘数先拆100，再计算小倍数。'),
 ('102＝100＋2，整百倍再加两份。','102比100大，所以修正方向是加。','先判断乘数比整百大还是小，再决定补偿符号。'),
 ('15＝10＋5，5倍可以由10倍的一半得到。','5倍是10倍的一半，不是原数的一半。','乘15可以把十倍数再加半份十倍数。'),
 ('35＝7×5，把5改成10/2，248可以先减半。','先除2后仍要乘7和10，别漏一个因子。','优先把能整除的小因子移到前面，缩小中间数。'),
 ('45＝50－5，50倍又是一百倍的一半。','50倍减5倍，不能减原数5。','同一乘数可有多种拆法，选中间数更好算的一种。'),
 ('75＝100×3/4，128先除4能得到整32。','乘75后结果很大；不能误当成乘75%。','乘75用先除4、再乘3、再乘100。'),
 ('0.8＝4/5，675末尾是5，先除5很顺。','0.8是原数的五分之四，结果应略小于675。','乘4/5也能用“原数减去五分之一”。'),
 ('1.25＝5/4，比1多四分之一。','结果应比432大；若只算432÷4，就只算了增加部分。','乘1.25可用原数加四分之一，也可先除4再乘5。'),
 ('9.9离10差0.1，十倍减十分之一。','减少的是72.6，不能把9.9近似成10后直接交答案。','乘9.9保留精确补偿，不能忽略0.1份。'),
 ('11＝10＋1，用十倍数与本数相加。','三位数乘11可能连续进位，直接相加比硬背“中间相加”稳。','乘11先写十倍，再加原数，进位照常处理。'),
 ('1.01＝1＋1%，只需在本数上加百分之一。','加的是8.63，不是86.3；1%意味着除100。','乘1.01、1.02可看成本数加1%、2%。'),
 ('7.5＝30/4，而624可以先除4。','先除4得到的156还不是答案，必须乘30。','分数化后先约掉好除的分母，避免大数直接乘小数。'),
 ('48与52以50为中心，相差都是2，正负交叉项抵消。','(50－2)(50＋2)＝50²－2²，不能只减2。','两个因数围绕同一整数等距时，优先用平方差。'),
 ('97与103以100为中心，偏差为3。','平方差是10000－9，不是10000－3。','平方差只适用于“中心数－同一偏差”和“中心数＋同一偏差”。'),
 ('4.5＝5－0.5，五倍数减去一半更容易。','减的是12.4而非0.5，小数点要对齐。','乘4.5、9.5可用整数倍减去半份。'),
 ('0.75＝3/4，先除4能把63.6变成15.9。','0.75小于1，结果必须小于63.6。','乘3/4也可用原数减四分之一，任选更顺的一条。'),
]


def round_note(q, evidence):
    v = q['verification']; exact, unit = F(v['exactValue']), F(v['roundingUnit'])
    answer = v['roundedValue'] + ('%' if v['outputFormat'] == 'percentage' else '')
    lower = (exact // unit) * unit; residual = exact - lower
    if exact == F(v['roundedValue']):
        return f'本题算到的就是精确值 {answer}，不需要再估算。'
    if hasattr(evidence, 'division'):
        division = evidence.division
        remainder, denominator = F(division['remainder']), F(division['denominator'])
        threshold = denominator * unit / 2
        comparison = evidence.compare(str(remainder), '>=' if remainder >= threshold else '<', str(threshold))
        return f'保留{v["precision"]}位小数，半个末位就是{number(unit/2)}。前一步余数{comparison}（分母×半个末位），' + ('因此末位进1' if remainder >= threshold else '因此末位不进位') + f'，最终填写 {answer}。用余数判定即可，不必继续求长小数。'
    compare = evidence.compare(str(residual), '>=' if residual >= unit / 2 else '<', str(unit / 2))
    return f'先留到题目要求的位数，得到 {number(lower)}；剩余部分 {compare}，所以' + ('进一档' if residual >= unit / 2 else '保持这一档') + f'，写 {answer}。不要在中间步骤提前四舍五入。'


def division_work(a, b, places, evidence, rounding_unit=None):
    """Find integer and decimal chunks, then compare the residual to half a step."""
    a, b = F(a), F(b); assert a > 0 and b > 0
    value = a / b; unit=F(rounding_unit) if rounding_unit else F(1,10**places)
    integer = int((value//unit)*unit) if unit>=1 else value.numerator//value.denominator
    steps, remainder, quotient = [], a, F(0)
    def rough(value):
        return value if value<10 else rounding(value,10**max(0,len(str(int(value)))-2))
    ra=rough(a)
    rb=b if b<10 else rounding(b,10**(len(str(int(b)))-1))
    if value.denominator!=1 and (ra,rb)!=(a,b):
        steps.append(f'先用接近的{number(ra)}和{number(rb)}看量级：'+evidence.estimate(f'{number(ra)}/{number(rb)}')+'，这只是定位，下面仍用原数计算。')
    if integer == 0:
        steps.append(f'{number(a)}小于{number(b)}，商小于1，先写0，别丢掉小数点。' if value<1 else '先从0档开始，用余数判断是否进到下一档。')
    elif integer >= 10:
        magnitude = 10 ** (len(str(integer)) - 1)
        chunk = integer // magnitude * magnitude
        product = b * chunk
        steps.append('先试整' + ('百' if magnitude == 100 else '十' if magnitude == 10 else '千') + '倍：' + evidence.equation(f'{number(b)}*{chunk}') + '，余' + number(remainder-product) + '。')
        remainder -= product; quotient += chunk
    else:
        steps.append('先定整数部分：' + evidence.equation(f'{number(b)}*{integer}') + '，余' + number(remainder-b*integer) + '。')
        remainder -= b * integer; quotient += integer
    missing = integer - int(quotient)
    while missing:
        magnitude=10**(len(str(missing))-1); chunk=missing//magnitude*magnitude
        steps.append('再补' + str(chunk) + '倍：' + evidence.equation(f'{number(b)}*{chunk}') + '，余' + number(remainder-b*chunk) + '。')
        remainder -= b * chunk; quotient += chunk; missing -= chunk
    for digit in range(1, places+1):
        if remainder == 0: break
        step = F(1, 10**digit)
        take = int(remainder / (b * step))
        change = take * step
        steps.append(('十分位' if digit == 1 else '百分位') + '补' + number(change) + '：' + evidence.equation(f'{number(b)}*{number(change)}') + '，余' + number(remainder-b*change) + '。')
        remainder -= b * change; quotient += change
    if remainder:
        threshold = b * unit/2
        comparison = evidence.compare(str(remainder), '>=' if remainder >= threshold else '<', str(threshold))
        steps.append(f'现在商为{number(quotient)}。余数与“分母×半个末位”比较：' + evidence.equation(f'{number(b)}*{number(unit/2)}') + '；' + comparison + '，末位' + ('进1' if remainder >= threshold else '不进位') + f'，结果为{number(rounding(value,unit))}。')
    else:
        steps.append(f'余数为0，商{number(quotient)}是精确值。')
    assert rounding(quotient + remainder/b, unit) == rounding(value, unit)
    evidence.division = {'numerator': str(a), 'denominator': str(b), 'truncated': str(quotient), 'remainder': str(remainder), 'unit': str(unit)}
    return ''.join(steps)


def coarse_base(x, den, evidence):
    anchor = rounding(F(x), F(1000)); anchor = anchor or F(1000)
    trial = anchor * den; gap = F(x)-trial; per_hundred = den*100
    adjustment = rounding(gap/per_hundred)
    result = anchor+adjustment*100
    first = f'先拿整千数{number(anchor)}试算：' + evidence.equation(f'{number(anchor)}*{number(den)}') + f'，比题中{number(x)}' + ('少' if gap >= 0 else '多') + number(abs(gap)) + '。'
    if adjustment:
        first += '基期每调整100，对应的现期就调整' + number(per_hundred) + '；' + evidence.equation(f'{number(per_hundred)}*{number(abs(adjustment))}') + '接近这个差额，因此基期' + ('增加' if adjustment>0 else '减去') + number(abs(adjustment)*100) + f'，先定位到{number(result)}。'
    else:
        first += '差额不到一个整百档对应变化量的一半，基期暂不换档。'
    difference = abs(F(x)-result*den)
    check = '不用求出全部小数，反乘验证即可：' + evidence.equation(f'{number(result)}*{number(den)}') + '，误差为' + number(difference) + '；' + evidence.equation(f'{number(den)}*50') + '。因为' + evidence.compare(str(difference), '<', str(den*50)) + f'，真实商离{number(result)}不到50，取整百就确定为{number(result)}。'
    return first, check


def enrich(q):
    v = q['verification']; n = int(q['id'].rsplit('-',1)[1]); kind = q['skillId']
    evidence = Evidence(); hint = q['explanationBlocks'][0]['text']
    # Prefer a stable authored hint on subsequent runs, not yesterday's full lesson.
    hint = v.get('teaching', {}).get('originalHint', hint)
    exact, unit = F(v['exactValue']), F(v['roundingUnit'])
    transformed = v['transformationExpression']; error = transfer = ''
    check = None
    if kind == 'calc-addition':
        recognize, error, transfer = ADDITION_NOTES[n-1]
        if n == 16: transformed = '(10000+10000+20000)+(-2+3-3)'
        route = hint + ' ' + finite_trace(transformed, evidence)
    elif kind == 'calc-multiply':
        recognize, error, transfer = MULTIPLY_NOTES[n-25]
        route = hint + ' ' + finite_trace(transformed, evidence)
    elif kind == 'calc-percentage':
        x, rate = map(F, v['displayExpression'].rstrip('%').split('×'))
        ratio = rate/100
        recognize = f'先处理百分号：{number(rate)}%表示{number(rate)}÷100，而不是直接乘{number(rate)}。'
        if n in (69,70,71):
            denominator = {69:6,70:3,71:7}[n]; delta = ratio-F(1,denominator)
            recognize += f'它接近1/{denominator}，但本题保留两位小数，必须补回近似误差。'
            error = f'只做{number(x)}÷{denominator}会' + ('少' if delta>0 else '多') + f'算{number(abs(x*delta))}，本题精度下不能丢。'
            transfer = '看到16.7%、33.3%、14.3%时，先认出熟悉分数，再看精度是否允许忽略偏差；“接近”不等于“相等”。'
        elif ratio.denominator <= 100 and ratio.numerator <= 5:
            recognize += f'约分得到{ratio.numerator}/{ratio.denominator}，优先先除后乘。'
            error = '百分号只换算一次；已经化为分数后，不要再除100。'
            transfer = f'下次看到{number(rate)}%，先在脑中换成{ratio.numerator}/{ratio.denominator}，再找被除数是否方便整除。'
        else:
            recognize += '把百分数拆到10%、1%或熟悉分数，能减少直接乘小数的步骤。'
            error = '所有百分比部分都作用于同一个原数；例如补1%是补原数的百分之一，不是补1。'
            transfer = '先算容易的基准比例，再加减差额；低于100%的正比例结果应变小，高于100%应变大。'
        if n==64: error='0.5%＝0.005＝1/200；错写成0.5会放大100倍。'
        if n==67: error='102.5%＝1.025，要保留原数这一整份；只算2.5%得到的是增加部分。'
        route = hint + ' ' + finite_trace(transformed,evidence)
    elif kind == 'calc-division':
        a, b = map(F,v['expression'].split('/'))
        recognize = '先确定商的量级，再把除法拆成“整倍数＋小数位”。只需算到题目要求的末位，用余数判断进位即可。'
        scale=1
        while (a*scale).denominator!=1 or (b*scale).denominator!=1: scale*=10
        route = ''
        if scale>1:
            route = f'先把分子、分母同时乘{scale}，变为{number(a*scale)}÷{number(b*scale)}，商不变。'
        route += division_work(a*scale,b*scale,v['precision'],evidence)
        check=f'每补一档商，就扣掉“分母×这一档”。截到本题要求的末位后，余数应非负且小于分母×{number(unit)}；再与其一半比较，就能确定舍入方向。'
        if F(evidence.division['remainder'])==0:
            check=f'余数为0，说明分母×所得商恰好还原被除数，{v["roundedValue"]}就是精确答案，无需再判断进位。'
        error=f'本题半个末位是{number(unit/2)}，要比较“余数”和“分母×{number(unit/2)}”，不能把余数直接接到整数部分后面当小数。'
        transfer='先整倍数、再逐位补商、最后只做一次进位判断。余数为0就停，不需要补出一串小数。'
    elif kind == 'calc-base':
        # The original displayed denominator already contains the signed rate.
        tree=ast.parse(v['expression'],mode='eval').body
        x=F(ast.get_source_segment(v['expression'],tree.left)); den=F(x)/exact
        rate=den-1
        recognize=f'先算分母1{("＋" if rate>=0 else "－")}{number(abs(rate)*100)}%＝{number(den)}。这是从现期还原基期；' + ('正增长，结果应小于' if rate>0 else '负增长，结果应大于') + number(x) + '。'
        if unit==100:
            recognize+='本题只取整百，目标是确认落在哪个整百档，不必算长小数。'
            route,check=coarse_base(x,den,evidence)
        else:
            recognize+=f'把{number(den)}写成{den.numerator}/{den.denominator}，除以分数等于乘倒数。'
            route=hint+' '+finite_trace(transformed,evidence)
        error='分母里的1代表原来的一整份，不能漏掉。现期×(1－增长率)一般不是精确基期；用它估算时还要检查误差是否影响本题舍入。'
        transfer='先看增长率正负判断大小，再看精度：整除时转分数；只取整百时用整千试算、整百调整和反乘校验。'
    elif kind == 'calc-growth':
        x, tail=v['displayExpression'].split('×',1); x=F(x); rate=F(tail.split('%',1)[0])/100
        factor=rate/(1+rate)
        recognize=f'不能直接拿现期{number(x)}乘增长率，那会高估增加量。先把增长率写成{rate.numerator}/{rate.denominator}，则 r÷(1＋r)＝{rate.numerator}/({rate.denominator}＋{rate.numerator})＝{factor.numerator}/{factor.denominator}。'
        if v.get('approximationExpression'):
            approx_expr=v['approximationExpression']; approx=evaluate(approx_expr)
            denominator=int(approx_expr.split('/')[1]); r0=F(1,denominator-1)
            direction=1 if rate>r0 else -1
            bound=x*abs(rate-r0); lower=approx if direction>0 else approx-bound; upper=approx+bound if direction>0 else approx
            lo=F(lower*100//1,100); hi=F(-((-upper*100)//1),100)
            target=F(v['roundedValue']); left,right=target-5,target+5
            shortcut=finite_trace(approx_expr,evidence) if '/' not in number(approx) else division_work(x,denominator,1,evidence)
            route=f'口算时把增长率近似看成1/{denominator-1}，那么增长量约等于现期÷{denominator}。'+shortcut
            # The intermediate integer is not the final request (nearest ten).
            route+=f'这一步用于定位；题目要求整十，所以候选结果是{number(target)}。'
            check=f'这里必须查近似误差：r/(1＋r)随r增大而增大，所以这个近似' + ('偏低' if direction>0 else '偏高') + f'。误差小于现期×两种增长率的差，即{number(x)}×|{number(rate)}－1/{denominator-1}|，不到{number(hi-lo)}。据此真值在{number(lo)}到{number(hi)}之间；这个范围完全落在{number(left)}到{number(right)}这一整十档内，所以可取{number(target)}。若改成取个位或小数，就需重新检查。'
            evidence.approximation={'expression':approx_expr,'rate':str(rate),'referenceRate':str(r0),'current':str(x),'bound':str(bound),'lower':str(lo),'upper':str(hi),'roundingLower':str(left),'roundingUpper':str(right)}
        elif unit==10:
            numerator=x*factor.numerator; denominator=factor.denominator
            route=f'约分后是{number(x)}×{factor.numerator}÷{denominator}。'+evidence.equation(f'{number(x)}*{factor.numerator}')+'。'
            route+=division_work(numerator,denominator,0,evidence,rounding_unit=10)
            target=F(v['roundedValue']); difference=abs(numerator-target*denominator)
            check=f'取整十的答案{number(target)}代表真实商在{number(target-5)}到{number(target+5)}之间（左端包含，右端不包含）。上一步直接用原分式的余数判档，避免先取整数再取整十造成二次舍入。'
        else:
            route=hint+' '+finite_trace(transformed,evidence)
        if v.get('approximationExpression'):
            error='把实际增长率替换成接近分数是近似，不是恒等变形；不能省去精度检查，也不能把这里的估算直接用在要求小数位的题里。'
        else:
            error=f'本题增长率是{rate.numerator}/{rate.denominator}，合并后分母是{rate.denominator}＋{rate.numerator}＝{factor.denominator}。直接用现期×增长率会得到{number(x*rate)}，它用了错误的基数，会算大。'
        transfer='看到“现期×r÷(1＋r)”，先把整个r/(1＋r)合并；精确分数直接约，近似分数先检查目标精度。'
    else:
        if n<=168:
            a,b=map(F,v['displayExpression'].split('÷')); percent=a/b*100
            ratio=a/b
            recognize='结果要写成百分数的数值，因此计算的是“部分÷整体×100”，不是把小数原样填入。'
            if ratio.denominator<=100:
                recognize+=f'先约分：{number(a)}/{number(b)}＝{ratio.numerator}/{ratio.denominator}。'
                if ratio.denominator==3:
                    route=division_work(ratio.numerator*100,ratio.denominator,v['precision'],evidence)
                else: route=hint+' '+finite_trace(transformed,evidence)
            else:
                anchor=int(percent); gap=a-b*anchor/100
                route=f'先取{anchor}%作基准：'+evidence.equation(f'{number(b)}*{anchor}/100')+f'，距离部分量{number(a)}还差{number(gap)}。整体的1%是{number(b/100)}，所以差额÷{number(b/100)}就是要补的百分点。'
                route+=division_work(gap,b/100,v['precision'],evidence)
                route+=f'把补出的百分点加回{anchor}，得到{v["roundedValue"]}%。'
            error='例如20%填20或20%，不是0.2；补0.8个百分点是从18%到18.8%，不是把18再乘1.008。'
            transfer='先找接近的整数百分比，再用“差额÷整体的1%”补百分点；转换完单位再做最后舍入。'
        elif n<=174:
            recognize='这是平均数式的直接除法。先约掉容易的因子，或从整百倍定位，再求剩余部分。'
            if n in (171,172):
                a,b=(F(7297),F(21)) if n==171 else map(F,v['expression'].split('/'))
                route=(hint+' ' if n==171 else '')+division_work(a,b,v['precision'],evidence)
            elif n==174:
                route='先把64拆成8×8，第一次除8：'+evidence.equation('14875/8')+'。第二次除8仍按题目精度处理：'+division_work(F(14875,8),8,2,evidence)
            else: route=hint+' '+finite_trace(transformed,evidence)
            error='只给分子约分、分母不变会改变商；若分母拆成两个因子，要把两次除法都做完。'
            transfer='先拆分母：25、32、64、75可分别用乘4除100、连续减半、两次除8、先除3再除25。'
        elif n<=178:
            # The explicit authored transformation is an exact weighted-average identity.
            low,high,wlow,whigh={175:(348,420,24,16),176:(126,154,35,21),177:(F('72.5'),F('81.5'),18,30),178:(286,334,45,27)}[n]
            share=F(whigh,wlow+whigh)
            recognize=f'两组数值都带权重，不能直接求{number(low)}和{number(high)}的简单平均。以较低值{number(low)}为基准，只补高出部分。'
            route=f'高出量：'+evidence.equation(f'{number(high)}-{number(low)}')+f'；高值组的权重为{whigh}/({wlow}＋{whigh})＝{share.numerator}/{share.denominator}。'+finite_trace(transformed,evidence)
            check=f'加权平均数必须位于{number(low)}与{number(high)}之间，并更靠近权重较大的一组。本题精确值为{number(exact)}；'+round_note(q,evidence)
            error='补差要乘“高值那组”的权重，而不是低值组的权重；两组数量不同时不能直接除2。'
            transfer='两组加权平均可写为“低值＋差值×高值组占比”，通常比先乘再加两个大数省事。'
        else:
            rate1,rate2={179:(F(18),F(8)),180:(F('13.6'),F('4.8'))}[n]
            denominator=1+rate2/100; difference=rate1-rate2
            recognize='先把“减1”并进同一个分式：(1＋a)÷(1＋b)－1＝(a－b)÷(1＋b)。这样不用先算一个接近1的长小数再相减。'
            route='分子先作差：'+evidence.equation(f'{number(rate1)}-{number(rate2)}')+f'。注意这是{number(difference)}个百分点；要输出百分数的数值，直接用{number(difference)}÷{number(denominator)}：'+division_work(difference,denominator,2,evidence)
            error=f'分母仍是1＋{number(rate2)}%＝{number(denominator)}，不能直接把{number(difference)}%当作答案，也不能除以{number(rate2)}%。'
            transfer='遇到两个“1＋增长率”的比值再减1，先拆一，再计算差额除以原分母。'
    if check is None: check=round_note(q,evidence)
    blocks=[{'type':'paragraph','text':f'**{title}**　{text}'} for title,text in (
        ('切入点',recognize),('口算步骤',route),('精度检查',check),('易错提醒',error),('下次这样用',transfer))]
    q['explanationBlocks']=blocks
    proof={'version':VERSION,'originalHint':hint,'identities':evidence.identities,'comparisons':evidence.comparisons,'estimates':evidence.estimates}
    if hasattr(evidence,'division'): proof['division']=evidence.division
    if hasattr(evidence,'approximation'): proof['approximation']=evidence.approximation
    proof['explanationSha256']=hashlib.sha256(json.dumps(blocks,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    v['teaching']=proof
    return q


def enrich_questions(questions):
    return [enrich(q) for q in questions]


if __name__=='__main__':
    path=HERE.parent/'calculation.reviewed.json'
    questions=json.loads(path.read_text(encoding='utf8'))
    enrich_questions(questions)
    path.write_text(json.dumps(questions,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
    print('Updated worked explanations:',len(questions))
