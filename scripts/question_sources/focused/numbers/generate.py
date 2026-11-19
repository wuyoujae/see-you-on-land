"""Original, independently specified arithmetic-pattern practice. No external question data.

All sequence terms below were authored explicitly; verify.py independently derives them.
Run: python -X utf8 scripts/question_sources/focused/numbers/generate.py
"""
from pathlib import Path
from fractions import Fraction as F
import json
import random
import hashlib
from collections import Counter

HERE = Path(__file__).resolve().parent
SPECS = []

def add(skill, title, difficulty, values, rule, explanation, wrong=None):
    SPECS.append(dict(skillId='number-'+skill, skillTitle=title,
        difficulty=difficulty, values=str(values).split(), rule=rule,
        explanation=explanation, wrong=wrong))

def formula(expr): return dict(mode='formula', expression=expr)
def diff(expr): return dict(mode='differences', expression=expr)
def rec(expr, seeds=1): return dict(mode='recurrence', expression=expr, seeds=seeds)
def lanes(*rules): return dict(mode='lanes', lanes=list(rules))
def group(expr): return dict(mode='groups', expression=expr, width=3)
FND, STD, CHL = 'foundation', 'standard', 'challenge'

# 01–12: differences. Different first/second differences and alternating differences.
def D(d,v,r,e): add('differences','差分数列',d,v,r,e)
D(FND,'11 16 24 35 49 66 86',diff('3*n+2'),'相邻两项的差依次为 5、8、11、14、17、20，差数列每次增加 3。末项为 66＋20＝86。')
D(FND,'83 80 73 62 47 28 5',diff('1-4*n'),'相邻两项依次减去 3、7、11、15、19、23，减数每次增加 4。末项为 28－23＝5。')
D(FND,'6 8 12 20 36 68 132',diff('2**n'),'相邻两项的差为 2、4、8、16、32、64，后一差是前一差的 2 倍。末项为 68＋64＝132。')
D(FND,'230 229 225 216 200 175 139',diff('-n**2'),'各项依次减去 1²、2²、3²、4²、5²、6²。末项为 175－36＝139。')
D(STD,'5 6 9 15 25 40 61',diff('F(n*(n+1),2)'),'相邻差为 1、3、6、10、15、21；这些差再相减得到 2、3、4、5、6。下一差为 15＋6＝21，末项为 40＋21＝61。')
D(STD,'4 5 13 40 104 229 445',diff('n**3'),'相邻差为 1、8、27、64、125、216，即 1³ 至 6³。末项为 229＋216＝445。')
D(STD,'9 12 17 24 35 48 65',diff('prime(n+1)'),'相邻差为 3、5、7、11、13、17，是从 3 开始的连续质数。末项为 48＋17＝65。')
D(STD,'10 12 15 20 28 41 62',diff('fib(n+2)'),'相邻差为 2、3、5、8、13、21；从第三个差起，每个差等于前两个差之和。末项为 41＋21＝62。')
D(CHL,'17 20 25 34 51 84 149',diff('2**n+1'),'一次差为 3、5、9、17、33、65；二次差为 2、4、8、16、32。下一次差为 33＋32＝65，末项为 84＋65＝149。')
D(STD,'8 11 18 31 52 83 126',diff('n*n+n+1'),'一次差为 3、7、13、21、31、43；二次差为 4、6、8、10、12。下一次差为 31＋12＝43，末项为 83＋43＝126。')
D(STD,'4 6 2 8 0 10 -2',diff('(-1)**(n+1)*2*n'),'相邻变化依次为 ＋2、－4、＋6、－8、＋10、－12，绝对值是连续偶数，正负交替。末项为 10－12＝－2。')
D(CHL,'7 10 13 19 25 37 49 73',diff('3*2**((n-1)//2)'),'相邻差为 3、3、6、6、12、12、24，每个差重复两次后翻倍。下一差为 24，末项为 49＋24＝73。')

# 13–24: multiplicative/recursive, including two/three preceding terms.
def R(d,v,r,e): add('recursion','倍数与递推',d,v,r,e)
R(FND,'4 11 25 53 109 221',rec('2*p+3'),'每一项等于前一项乘 2 再加 3：4×2＋3＝11，11×2＋3＝25，依次成立。末项为 109×2＋3＝221。')
R(FND,'5 13 37 109 325 973',rec('3*p-2'),'每一项等于前一项乘 3 再减 2。末项为 325×3－2＝973。')
R(FND,'3 8 11 19 30 49 79',rec('p+q',2),'从第三项起，每项等于前两项之和。末项为 30＋49＝79。')
R(FND,'4 7 12 19 28 39 52',rec('2*p-q+2',2),'从第三项起，每项等于前一项的 2 倍减去再前一项，再加 2。也可看相邻差 3、5、7、9、11、13。末项为 39×2－28＋2＝52。')
R(CHL,'2 5 16 65 326 1957',rec('n*p+1'),'从第二项起，依次将前项乘 2、3、4、5、6，再加 1。末项为 326×6＋1＝1957。')
R(STD,'3 7 16 35 74 153',rec('2*p+n-1'),'从第二项起，将前项乘 2 后依次加 1、2、3、4、5。末项为 74×2＋5＝153。')
R(STD,'2 7 11 25 47 97 191',rec('p+2*q',2),'从第三项起，每项等于前一项加上再前一项的 2 倍。末项为 97＋2×47＝191。')
R(STD,'2 3 5 14 69 965',rec('p*q-1',2),'从第三项起，每项等于前两项的乘积减 1。末项为 14×69－1＝965。')
R(STD,'2 4 7 13 24 44 81 149',rec('p+q+r',3),'从第四项起，每项等于前三项之和。末项为 24＋44＋81＝149。')
R(STD,'3 7 20 41 122 245 734',rec('2*p+1 if n%2==0 else 3*p-1'),'相邻变换交替采用“乘 2 加 1”和“乘 3 减 1”：3→7→20→41→122→245。下一步为 245×3－1＝734。')
R(STD,'1 4 8 16 29 51 87',rec('p+q+n',2),'从第三项起，前两项相加后，再依次加 3、4、5、6、7。末项为 29＋51＋7＝87。')
R(CHL,'2 5 13 35 95 259 707',rec('2*(p+q)-1',2),'从第三项起，每项等于前两项之和的 2 倍减 1。末项为（95＋259）×2－1＝707。')

# 25–36: power structures.
def P(d,v,r,e): add('powers','幂次数列',d,v,r,e)
P(FND,'6 11 18 27 38 51 66',formula('(n+1)**2+2'),'各项依次为 2²＋2、3²＋2、4²＋2、5²＋2、6²＋2、7²＋2、8²＋2。末项为 66。')
P(FND,'5 24 61 122 213 340 509',formula('(n+1)**3-3'),'各项依次为 2³－3、3³－3、4³－3……8³－3。末项为 512－3＝509。')
P(FND,'3 7 15 31 63 127 255',formula('2**(n+1)-1'),'每项加 1 后得到 4、8、16、32、64、128、256，即连续的 2 的幂。末项为 256－1＝255。')
P(FND,'17 25 35 47 61 77 95',formula('(n+2)*(n+3)+5'),'各项依次为 3×4＋5、4×5＋5、5×6＋5……9×10＋5。末项为 95。')
P(STD,'6 7 18 23 38 47 66',formula('(n+1)**2+2*(-1)**(n+1)'),'以 2²、3²、4²……为主体，依次加 2、减 2，交替进行。第七项为 8²＋2＝66。')
P(STD,'2 10 30 68 130 222 350',formula('n**3+n'),'各项依次为 1³＋1、2³＋2、3³＋3……7³＋7。末项为 343＋7＝350。')
P(STD,'9 25 49 121 169 289 361',formula('prime(n+1)**2'),'各项开平方得到 3、5、7、11、13、17、19，是连续质数。末项为 19²＝361。')
P(STD,'13 25 41 61 85 113 145',formula('(n+1)**2+(n+2)**2'),'各项依次为 2²＋3²、3²＋4²、4²＋5²……8²＋9²。末项为 64＋81＝145。')
P(STD,'4 27 16 125 36 343 64',formula('(n+1)**(2 if n%2 else 3)'),'底数为连续整数 2、3、4、5、6、7、8，指数按 2、3 交替。末项为 8²＝64。')
P(CHL,'4 11 31 89 259 761 2251',formula('3**n+2**(n-1)'),'各项依次为 3¹＋2⁰、3²＋2¹、3³＋2²……3⁷＋2⁶。末项为 2187＋64＝2251。')
P(STD,'9 23 53 105 185 299 453',formula('(n+1)**3-(n+1)**2+5'),'各项可写成 m³－m²＋5，其中 m 依次为 2、3、4、5、6、7、8。末项为 512－64＋5＝453。')
P(CHL,'1 9 36 100 225 441 784',formula('(F(n*(n+1),2))**2'),'各项开平方得到 1、3、6、10、15、21、28，后者的相邻差为 2、3、4、5、6、7。末项为 28²＝784。')

# 37–48: exact fractions, no floating-point rounding.
def Q(d,v,r,e): add('fractions','分数数列',d,v,r,e)
Q(FND,'1/2 3/5 2/3 5/7 3/4 7/9',formula('F(n+1,n+3)'),'把各项写成 2/4、3/5、4/6、5/7、6/8、7/9，分子、分母分别加 1。末项为 7/9。')
Q(FND,'1/3 1/5 1/7 1/9 1/11 1/13',formula('F(1,2*n+1)'),'分子恒为 1，分母是从 3 开始的连续奇数。下一分母为 13，末项为 1/13。')
Q(STD,'1/2 2/5 3/10 4/17 5/26 6/37',formula('F(n,n*n+1)'),'分子依次为 1、2、3、4、5、6，分母等于分子的平方加 1。末项为 6/（6²＋1）＝6/37。')
Q(FND,'4/3 9/4 16/5 25/6 36/7 49/8',formula('F((n+1)**2,n+2)'),'分子依次为 2²、3²、4²……7²，分母依次为 3、4、5……8。末项为 49/8。')
Q(STD,'2/5 3/8 5/13 8/21 13/34 21/55 34/89',formula('F(fib(n+2),fib(n+4))'),'分子为 2、3、5、8、13、21、34，分母为 5、8、13、21、34、55、89，两列均满足“后一项等于前两项之和”。末项为 34/89。')
Q(FND,'3/8 1/4 1/6 1/9 2/27 4/81 8/243',rec('p*F(2,3)'),'每项等于前项乘 2/3。末项为（4/81）×（2/3）＝8/243。')
Q(STD,'3/2 5/3 7/4 9/5 11/6 13/7 15/8',formula('2-F(1,n+1)'),'各项与 2 的差依次为 1/2、1/3、1/4、1/5、1/6、1/7、1/8。末项为 2－1/8＝15/8。')
Q(STD,'1/6 1/12 1/20 1/30 1/42 1/56',formula('F(1,(n+1)*(n+2))'),'分母依次为 2×3、3×4、4×5、5×6、6×7、7×8。末项为 1/56。')
Q(CHL,'2/5 3/7 4/11 5/19 6/35 7/67 8/131',formula('F(n+1,2**n+3)'),'分子每次加 1；分母为 5、7、11、19、35、67、131，其相邻差为 2、4、8、16、32、64。末项为 8/131。')
Q(STD,'1/4 1/7 1/12 1/19 1/28 1/39 1/52',formula('F(1,n*n+3)'),'分母为 4、7、12、19、28、39、52，相邻差为 3、5、7、9、11、13。末项为 1/52。')
Q(STD,'1/3 -1/2 3/5 -2/3 5/7 -3/4 7/9',formula('(-1)**(n+1)*F(n,n+2)'),'忽略正负号后，各项写成 1/3、2/4、3/5、4/6、5/7、6/8、7/9；正负号交替，奇数项为正。末项为 7/9。')
Q(CHL,'5/6 7/12 9/20 11/30 13/42 15/56',formula('F(1,n+1)+F(1,n+2)'),'各项依次为 1/2＋1/3、1/3＋1/4、1/4＋1/5……1/7＋1/8。末项为 15/56；也可观察分子 5、7、9、11、13、15，分母为相邻整数的乘积。')

# 49–60: interlaced, paired and three-lane structures.
def L(d,v,r,e): add('alternating','交错数列',d,v,r,e)
L(FND,'4 30 9 27 14 24 19 21',lanes(formula('5*n-1'),formula('33-3*n')),'奇数位置为 4、9、14、19，每次加 5；偶数位置为 30、27、24、21，每次减 3。末项为 21。')
L(FND,'3 81 6 27 12 9 24 3',lanes(formula('3*2**(n-1)'),formula('F(81,3**(n-1))')),'奇数位置为 3、6、12、24，每次乘 2；偶数位置为 81、27、9、3，每次除以 3。末项为 3。')
L(FND,'9 2 16 5 25 8 36 11',lanes(formula('(n+2)**2'),formula('3*n-1')),'奇数位置为 3²、4²、5²、6²；偶数位置为 2、5、8、11，每次加 3。末项为 11。')
L(FND,'8 4 27 9 64 16 125 25',lanes(formula('(n+1)**3'),formula('(n+1)**2')),'每两个数一组，依次为同一底数的立方、平方，底数为 2、3、4、5。末项为 5²＝25。')
L(CHL,'5 100 2 9 90 6 13 80 18 17 70 54',lanes(formula('4*n+1'),formula('110-10*n'),formula('2*3**(n-1)')),'按位置分成三列：第 1、4、7、10 项每次加 4；第 2、5、8、11 项每次减 10；第 3、6、9、12 项为 2、6、18、54，每次乘 3。末项为 54。')
L(STD,'4 20 7 18 13 16 25 14 49',lanes(rec('2*p-1'),formula('22-2*n')),'奇数位置为 4、7、13、25、49，后一项等于前一项乘 2 减 1；偶数位置为 20、18、16、14，每次减 2。末项为 25×2－1＝49。')
L(STD,'2 3 4 15 6 35 8 63 10 99',lanes(formula('2*n'),formula('(2*n)**2-1')),'每两个数一组，前数依次为 2、4、6、8、10，后数等于前数的平方减 1。末项为 10²－1＝99。')
L(STD,'5 8 6 10 9 14 14 20',lanes(formula('(n-1)**2+5'),formula('n*(n-1)+8')),'奇数位置为 5、6、9、14，相邻差为 1、3、5；偶数位置为 8、10、14、20，相邻差为 2、4、6。末项为 14＋6＝20。')
L(STD,'2 4 3 7 5 11 7 18 11 29',lanes(formula('prime(n)'),rec('p+q',2)),'奇数位置为 2、3、5、7、11，是连续质数；偶数位置为 4、7、11、18、29，从第三个偶数位置起等于前两个偶数位置之和。末项为 11＋18＝29。')
L(STD,'2 1/2 3 1/3 4 1/4 5 1/5 6 1/6',lanes(formula('n+1'),formula('F(1,n+1)')),'每两个数一组，后一数是前一数的倒数，前一数依次为 2、3、4、5、6。末项为 1/6。')
L(STD,'6 5 12 9 20 17 30 33',lanes(formula('(n+1)*(n+2)'),formula('2**(n+1)+1')),'奇数位置依次为 2×3、3×4、4×5、5×6；偶数位置依次为 2²＋1、2³＋1、2⁴＋1、2⁵＋1。末项为 33。')
L(CHL,'1 3 4 4 6 9 9 12 16 16 24 25',lanes(formula('n*n'),formula('3*2**(n-1)'),formula('(n+1)**2')),'每三个数一组：第一列为 1²、2²、3²、4²；第二列为 3、6、12、24；第三列为 2²、3²、4²、5²。末项为 25。')

# 61–72: four triples, target in fourth triple.
def G(d,v,r,e): add('groups','分组数列',d,v,r,e)
G(FND,'7 4 11 9 6 15 5 8 13 12 7 19',group('a+b'),'每三个数一组，第三数等于前两数之和：7＋4＝11，9＋6＝15，5＋8＝13。末项为 12＋7＝19。')
G(FND,'18 5 13 27 9 18 35 12 23 42 16 26',group('a-b'),'每三个数一组，第三数等于第一数减去第二数。末项为 42－16＝26。')
G(FND,'3 5 16 4 7 29 6 2 13 8 4 33',group('a*b+1'),'每三个数一组，第三数等于前两数相乘再加 1。末项为 8×4＋1＝33。')
G(FND,'36 4 9 56 7 8 30 5 6 63 9 7',group('a/b'),'每三个数一组，第三数等于第一数除以第二数。末项为 63÷9＝7。')
G(STD,'4 7 21 8 5 25 3 6 17 9 4 25',group('2*(a+b)-1'),'每三个数一组，第三数等于前两数之和的 2 倍减 1。末项为（9＋4）×2－1＝25。')
G(STD,'6 7 29 8 9 55 5 3 22 9 11 70',group('a*a-b'),'每三个数一组，第三数等于第一数的平方减去第二数。末项为 9²－11＝70。')
G(STD,'3 4 19 5 2 17 6 7 55 8 3 35',group('a*b+a+b'),'每三个数一组，第三数等于前两数的乘积加前两数之和。末项为 8×3＋8＋3＝35。')
G(STD,'3 4 25 5 2 29 6 7 85 8 3 73',group('a*a+b*b'),'每三个数一组，第三数等于前两数的平方和。末项为 8²＋3²＝73。')
G(STD,'2 5 49 3 8 121 6 4 100 9 3 144',group('(a+b)**2'),'每三个数一组，第三数等于前两数之和的平方。末项为（9＋3）²＝144。')
G(STD,'4 3 13 7 2 19 5 6 29 8 4 36',group('a*(b+1)-b'),'每三个数一组，第三数等于前两数的乘积，再加第一数、减第二数。末项为 8×4＋8－4＝36。')
G(CHL,'7 3 40 9 5 56 6 2 32 10 4 84',group('a*a-b*b'),'每三个数一组，第三数等于第一数的平方减去第二数的平方。末项为 10²－4²＝84。')
G(CHL,'4 6 11 7 3 14 5 8 22 9 4 29',group('a+b+g*g'),'每三个数一组，第三数减去前两数之和，依次得到 1、4、9、16，即 1²、2²、3²、4²。末项为 9＋4＋16＝29。')

# 73–84: digits and their numerical transforms.
def Z(d,v,r,e): add('digits','数位规律',d,v,r,e)
Z(STD,'13 35 57 79 911 1113',formula('concat(2*n-1,2*n+1)'),'把连续奇数两两衔接：1 与 3 拼成 13，3 与 5 拼成 35，5 与 7 拼成 57，依次类推。末项由 11 与 13 拼成 1113。')
Z(FND,'242 353 464 575 686 797',formula('concat(n+1,n+3,n+1)'),'百位和个位相同，依次为 2、3、4、5、6、7；十位始终比百位大 2。末项为 797。')
Z(FND,'3 34 345 3456 34567 345678',formula('int("".join(str(k) for k in range(3,n+3)))'),'每次在右侧添上下一个连续数字：3→34→345→3456→34567。接着添 8，得到 345678。')
Z(FND,'42 53 64 75 86 97',formula('concat(n+3,n+1)'),'十位、个位分别每次加 1，十位始终比个位大 2。末项为 97；等价地，每项加 11。')
Z(FND,'13 31 24 42 35 53 46 64',lanes(formula('11*n+2'),formula('11*n+20')),'每两个数一组，第二数把第一数的十位与个位交换。各组第一数为 13、24、35、46，因此末项为 64。')
Z(STD,'24 39 416 525 636 749',formula('concat(n+1,(n+1)**2)'),'各项由整数与它的平方依次拼接：2 与 4、3 与 9、4 与 16、5 与 25、6 与 36、7 与 49。末项为 749。')
Z(STD,'26 34 41 46 56 67 80',rec('p+dsum(p)'),'下一项等于本项加上本项各位数字之和：26＋2＋6＝34，34＋3＋4＝41，后续同理。末项为 67＋6＋7＝80。')
Z(STD,'12 14 18 26 38 62 74',rec('p+dprod(p)'),'下一项等于本项加上本项各位数字的乘积：12＋1×2＝14，14＋1×4＝18，后续同理。末项为 62＋6×2＝74。')
Z(CHL,'16 37 58 89 145 42 20',rec('dsquares(p)'),'下一项等于本项各位数字的平方和：1²＋6²＝37，3²＋7²＝58，5²＋8²＝89，8²＋9²＝145，1²＋4²＋5²＝42。末项为 4²＋2²＝20。')
Z(CHL,'27 99 198 1089 10890 20691',rec('p+reverse(p)'),'下一项等于本项加上它的倒序数：27＋72＝99，99＋99＝198，198＋891＝1089，1089＋9801＝10890。10890 的倒序数为 9801，故末项为 10890＋9801＝20691。')
Z(STD,'23 35 58 813 1321 2134',formula('concat(fib(n+2),fib(n+3))'),'各项依次拼接相邻的两个数：2 与 3、3 与 5、5 与 8、8 与 13、13 与 21、21 与 34；其中 2、3、5、8、13、21、34 满足前两项相加得后一项。末项为 2134。')
Z(STD,'2 33 444 5555 66666 777777',formula('int(str(n+1)*n)'),'第 1 项有 1 个 2，第 2 项有 2 个 3，第 3 项有 3 个 4，依次类推。第 6 项有 6 个 7，即 777777。')

# Each matrix has four complete rows, avoiding weak one-example rules.
# The expression and inverse equation are intentionally distinct implementations.
MATRIX = [
 ('addition','图阵加减','a+b+c','z-a-b==c','左一＋左二＋左三＝最右数',3),
 ('addition','图阵加减','a+b-c','z+c==a+b','左一＋左二－左三＝最右数',3),
 ('addition','图阵加减','a-b+c','z+b==a+c','左一－左二＋左三＝最右数',3),
 ('addition','图阵加减','a-b-c','z+b+c==a','左一－左二－左三＝最右数',3),
 ('addition','图阵加减','2*a+b+c','z-b-c==2*a','左一×2＋左二＋左三＝最右数',3),
 ('addition','图阵加减','a+2*b-c','z+c-a==2*b','左一＋左二×2－左三＝最右数',3),
 ('addition','图阵加减','a+b-2*c','a+b-z==2*c','左一＋左二－左三×2＝最右数',3),
 ('addition','图阵加减','(a+b+c)/2','2*z==a+b+c','（左一＋左二＋左三）÷2＝最右数',3),
 ('addition','图阵加减','a+(b+c)/2','2*(z-a)==b+c','左一＋（左二＋左三）÷2＝最右数',3),
 ('addition','图阵加减','2*(a-b)+c','z-c==2*a-2*b','（左一－左二）×2＋左三＝最右数',3),
 ('addition','图阵加减','a+2*(b-c)','z-a==2*b-2*c','左一＋（左二－左三）×2＝最右数',3),
 ('addition','图阵加减','3*a-b+c','z+b-c==3*a','左一×3－左二＋左三＝最右数',3),
 ('product','图阵乘除','a*b','z/a==b','左一×左二＝最右数',2),
 ('product','图阵乘除','a*b+c','z-c==a*b','左一×左二＋左三＝最右数',3),
 ('product','图阵乘除','a*b-c','z+c==a*b','左一×左二－左三＝最右数',3),
 ('product','图阵乘除','a*(b+c)','z/a==b+c','左一×（左二＋左三）＝最右数',3),
 ('product','图阵乘除','a*(b-c)','z/a==b-c','左一×（左二－左三）＝最右数',3),
 ('product','图阵乘除','(a+b)*c','z/c==a+b','（左一＋左二）×左三＝最右数',3),
 ('product','图阵乘除','(a-b)*c','z/c==a-b','（左一－左二）×左三＝最右数',3),
 ('product','图阵乘除','a*b/c','z*c==a*b','左一×左二÷左三＝最右数',3),
 ('product','图阵乘除','a/b+c','(z-c)*b==a','左一÷左二＋左三＝最右数',3),
 ('product','图阵乘除','a+b/c','(z-a)*c==b','左一＋左二÷左三＝最右数',3),
 ('product','图阵乘除','(a+b)/c','z*c==a+b','（左一＋左二）÷左三＝最右数',3),
 ('product','图阵乘除','a/(b+c)','z*(b+c)==a','左一÷（左二＋左三）＝最右数',3),
 ('composite','图阵复合运算','a*a+b+c','z-b-c==a*a','左一²＋左二＋左三＝最右数',3),
 ('composite','图阵复合运算','a*a-b-c','z+b+c==a*a','左一²－左二－左三＝最右数',3),
 ('composite','图阵复合运算','(a+b)**2-c','z+c==(a+b)**2','（左一＋左二）²－左三＝最右数',3),
 ('composite','图阵复合运算','(a-b)**2+c','z-c==(a-b)**2','（左一－左二）²＋左三＝最右数',3),
 ('composite','图阵复合运算','a*a+b*b-c','z+c==a*a+b*b','左一²＋左二²－左三＝最右数',3),
 ('composite','图阵复合运算','a*a-b*b+c','z-c==(a-b)*(a+b)','左一²－左二²＋左三＝最右数',3),
 ('composite','图阵复合运算','(a+b)*(c-1)','z/(a+b)+1==c','（左一＋左二）×（左三－1）＝最右数',3),
 ('composite','图阵复合运算','a*b+b*c','z/b==a+c','左一×左二＋左二×左三＝最右数',3),
 ('composite','图阵复合运算','a*c-b*d','z+b*d==a*c','左一×左三－左二×左四＝最右数',4),
 ('composite','图阵复合运算','(a+b)/(c+d)','z*(c+d)==a+b','（左一＋左二）÷（左三＋左四）＝最右数',4),
 ('composite','图阵复合运算','a*b+c*d','z-a*b==c*d','左一×左二＋左三×左四＝最右数',4),
 ('composite','图阵复合运算','(a+b)*(c+d)','z/(a+b)==c+d','（左一＋左二）×（左三＋左四）＝最右数',4),
]

def fmt(value):
    f=F(value)
    return str(f.numerator) if f.denominator==1 else str(f)

def ev(expr, values):
    return F(eval(expr, {'__builtins__':{}},dict(zip('abcd',map(F,values)))))

def paragraph(text): return dict(type='paragraph',text=text)

def options(answer, ordinal, wrong=None):
    target=F(answer)
    if wrong is None:
        if target.denominator==1:
            n=target.numerator
            offsets=([1,-2,3,-1,2,-3,5,-5,10,-10] if abs(n)<100 else [1,-10,10,-1,11,-11,100,-100,2,-2])
            wrong=[F(n+x) for x in offsets]
        else:
            n,d=target.numerator,target.denominator
            wrong=[F(n,d+1), F(n+1,d), F(n-1,d), F(n,d-1),target*2, target/2]
    dedup=[]
    for item in wrong:
        item=F(item)
        if item!=target and item not in dedup: dedup.append(item)
    rng=random.Random(20261118+ordinal)
    picks=dedup[:3]
    rng.shuffle(picks)
    correct=(ordinal-1)%4
    picks.insert(correct,target)
    return [dict(value='ABCD'[i],label=fmt(x)) for i,x in enumerate(picks)],'ABCD'[correct]

def base(ordinal,skill,title,difficulty,form):
    return dict(id=f'focus-number-{ordinal:03d}',kind='numbers',skillId=skill,skillTitle=title,
      difficulty=difficulty,form=form,sourceLabel='原创专项练习，非真题',
      origin=dict(type='original',isPastExam=False,authoredAt='2026-11-18',
        note='独立设计题目与解析；公开教学页仅用于核对考点范围。'))

def make_sequences():
    out=[]
    for i,s in enumerate(SPECS,1):
        values=[fmt(x) for x in s['values']]
        shown=values[:-1]+['（？）']
        q=base(i,s['skillId'],s['skillTitle'],s['difficulty'],'sequence')
        lead='请选择最合适的一项填入括号，使数列呈现一致的规律。'
        series='，'.join(shown)
        q.update(stem=lead+'\n'+series,stemBlocks=[paragraph(lead),paragraph(series)])
        q['options'],q['answer']=options(values[-1],i,s['wrong'])
        q['explanationBlocks']=[paragraph(s['explanation']),paragraph('因此选择 '+q['answer']+'。')]
        q['verification']=dict(rule=s['rule'],values=values,missingIndex=len(values)-1,
          correctValue=values[-1],authorship='explicitly-authored-values',
          check='逐项独立代入规则，精确分数运算；四个选项分别代入。')
        out.append(q)
    return out

def make_matrices():
    out=[]
    for offset,(skill,title,expr,equation,human,arity) in enumerate(MATRIX):
        ordinal=85+offset
        rng=random.Random(5000+ordinal)
        rows=[]
        while len(rows)<5:
            vals=[rng.randint(3,32)]+[rng.randint(2,13) for _ in range(arity-1)]
            if len(set(vals))!=len(vals): continue
            result=ev(expr, vals)
            if result.denominator!=1 or not 2<=result<=900: continue
            row=vals+[int(result)]
            if row in rows or result in [r[-1] for r in rows]: continue
            rows.append(row)
        # Non-monotonic square-difference input roots are deliberately never hidden.
        hidden=(offset% (arity+1)) if offset%3==1 else arity
        if expr=='(a-b)**2+c': hidden=arity
        target=rows[-1][hidden]
        opts,answer=options(target,ordinal)
        q=base(ordinal,'number-matrix-'+skill,title,
               FND if offset%12<4 else STD if offset%12<10 else CHL,'matrix')
        visible=[[str(x) for x in row] for row in rows]
        visible[-1][hidden]='？'
        lead='下表各行数字遵循同一种规律。问号处应填入哪一项？'
        q.update(stem=lead+'\n'+'\n'.join('  |  '.join(row) for row in visible),
          stemBlocks=[paragraph(lead),dict(type='table',rows=visible)],options=opts,answer=answer)
        examples=[]
        for row in rows:
            concrete=expr
            for symbol,value in zip('abcd',row[:-1]): concrete=concrete.replace(symbol,str(value))
            concrete=concrete.replace('**2','²').replace('*','×').replace('/','÷').replace('+','＋').replace('-','－')
            examples.append(concrete+'＝'+str(row[-1]))
        q['explanationBlocks']=[paragraph('按每行从左到右的位置，有：'+human+'。'),
          paragraph('前四行依次验证：'+'；'.join(examples[:4])+'。'),
          paragraph('最后一行应满足 '+examples[-1]+'，故问号为 '+str(target)+'，选择 '+answer+'。')]
        q['verification']=dict(rule=dict(mode='matrix',expression=expr,equation=equation,arity=arity),
          values=[[str(x) for x in row] for row in rows],missingCell=[4,hidden],correctValue=str(target),
          authorship='independently-designed-formula-and-seeded-inputs',
          check='所有完整行和目标行均由独立的等价方程验算；四选项逐个代入。')
        out.append(q)
    return out

def main():
    questions=make_sequences()+make_matrices()
    assert len(questions)==120
    # Candidate-choice screening uses an independent module; unsuitable distractors
    # are replaced, never the correct answer or authored given terms.
    from verify import verify_all, alternative_hits
    replacement_log=[]
    for q in questions:
        attempts=0
        while True:
            hits=alternative_hits(q)
            bad={hit['option'] for hit in hits if hit['option']!=q['answer']}
            if not bad: break
            attempts+=1
            if attempts>30: raise AssertionError(('alternative ambiguity',q['id'],hits))
            correct=F(q['verification']['correctValue'])
            for option in q['options']:
                if option['value'] in bad:
                    previous=option['label']
                    candidate=correct + F(17*attempts+ord(option['value'])-64,correct.denominator)
                    existing={F(x['label']) for x in q['options']}
                    while candidate in existing: candidate+=1
                    option['label']=fmt(candidate)
                    replacement_log.append(dict(id=q['id'],option=option['value'],old=previous,new=option['label'],reason=hits))
    result=verify_all(questions)
    result['alternativeDistractorsReplaced']=replacement_log
    for q in questions:
        q['verification']['status']='passed'
    content=json.dumps(questions,ensure_ascii=False,indent=2)+'\n'
    (HERE/'candidates.json').write_text(content,encoding='utf-8',newline='\n')
    result['sha256']=hashlib.sha256(content.encode('utf-8')).hexdigest()
    (HERE/'verification-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    lines=['# 原创数字规律候选题逐题审阅表','',
      '全部为原创专项练习，非真题。序号 1–84 为数列，85–120 为图阵。',
      '本表展示全部完整值；正式题干只隐藏一个值，不展示规则。','',
      '| ID | 难度 | 模块 | 完整数列 / 图阵末行 | 答案 | 规则 |','|---|---|---|---|---|---|']
    for q in questions:
        v=q['verification']; values=v['values'] if q['form']=='sequence' else v['values'][-1]
        rule=json.dumps(v['rule'],ensure_ascii=False)
        lines.append('| '+q['id']+' | '+q['difficulty']+' | '+q['skillTitle']+' | '+', '.join(values)+' | '+q['answer']+'='+v['correctValue']+' | `'+rule+'` |')
    (HERE/'review-all.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__': main()
