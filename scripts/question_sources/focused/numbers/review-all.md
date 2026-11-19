# 原创数字规律候选题逐题审阅表

全部为原创专项练习，非真题。序号 1–84 为数列，85–120 为图阵。
本表展示全部完整值；正式题干只隐藏一个值，不展示规则。

| ID | 难度 | 模块 | 完整数列 / 图阵末行 | 答案 | 规则 |
|---|---|---|---|---|---|
| focus-number-001 | foundation | 差分数列 | 11, 16, 24, 35, 49, 66, 86 | A=86 | `{"mode": "differences", "expression": "3*n+2"}` |
| focus-number-002 | foundation | 差分数列 | 83, 80, 73, 62, 47, 28, 5 | B=5 | `{"mode": "differences", "expression": "1-4*n"}` |
| focus-number-003 | foundation | 差分数列 | 6, 8, 12, 20, 36, 68, 132 | C=132 | `{"mode": "differences", "expression": "2**n"}` |
| focus-number-004 | foundation | 差分数列 | 230, 229, 225, 216, 200, 175, 139 | D=139 | `{"mode": "differences", "expression": "-n**2"}` |
| focus-number-005 | standard | 差分数列 | 5, 6, 9, 15, 25, 40, 61 | A=61 | `{"mode": "differences", "expression": "F(n*(n+1),2)"}` |
| focus-number-006 | standard | 差分数列 | 4, 5, 13, 40, 104, 229, 445 | B=445 | `{"mode": "differences", "expression": "n**3"}` |
| focus-number-007 | standard | 差分数列 | 9, 12, 17, 24, 35, 48, 65 | C=65 | `{"mode": "differences", "expression": "prime(n+1)"}` |
| focus-number-008 | standard | 差分数列 | 10, 12, 15, 20, 28, 41, 62 | D=62 | `{"mode": "differences", "expression": "fib(n+2)"}` |
| focus-number-009 | challenge | 差分数列 | 17, 20, 25, 34, 51, 84, 149 | A=149 | `{"mode": "differences", "expression": "2**n+1"}` |
| focus-number-010 | standard | 差分数列 | 8, 11, 18, 31, 52, 83, 126 | B=126 | `{"mode": "differences", "expression": "n*n+n+1"}` |
| focus-number-011 | standard | 差分数列 | 4, 6, 2, 8, 0, 10, -2 | C=-2 | `{"mode": "differences", "expression": "(-1)**(n+1)*2*n"}` |
| focus-number-012 | challenge | 差分数列 | 7, 10, 13, 19, 25, 37, 49, 73 | D=73 | `{"mode": "differences", "expression": "3*2**((n-1)//2)"}` |
| focus-number-013 | foundation | 倍数与递推 | 4, 11, 25, 53, 109, 221 | A=221 | `{"mode": "recurrence", "expression": "2*p+3", "seeds": 1}` |
| focus-number-014 | foundation | 倍数与递推 | 5, 13, 37, 109, 325, 973 | B=973 | `{"mode": "recurrence", "expression": "3*p-2", "seeds": 1}` |
| focus-number-015 | foundation | 倍数与递推 | 3, 8, 11, 19, 30, 49, 79 | C=79 | `{"mode": "recurrence", "expression": "p+q", "seeds": 2}` |
| focus-number-016 | foundation | 倍数与递推 | 4, 7, 12, 19, 28, 39, 52 | D=52 | `{"mode": "recurrence", "expression": "2*p-q+2", "seeds": 2}` |
| focus-number-017 | challenge | 倍数与递推 | 2, 5, 16, 65, 326, 1957 | A=1957 | `{"mode": "recurrence", "expression": "n*p+1", "seeds": 1}` |
| focus-number-018 | standard | 倍数与递推 | 3, 7, 16, 35, 74, 153 | B=153 | `{"mode": "recurrence", "expression": "2*p+n-1", "seeds": 1}` |
| focus-number-019 | standard | 倍数与递推 | 2, 7, 11, 25, 47, 97, 191 | C=191 | `{"mode": "recurrence", "expression": "p+2*q", "seeds": 2}` |
| focus-number-020 | standard | 倍数与递推 | 2, 3, 5, 14, 69, 965 | D=965 | `{"mode": "recurrence", "expression": "p*q-1", "seeds": 2}` |
| focus-number-021 | standard | 倍数与递推 | 2, 4, 7, 13, 24, 44, 81, 149 | A=149 | `{"mode": "recurrence", "expression": "p+q+r", "seeds": 3}` |
| focus-number-022 | standard | 倍数与递推 | 3, 7, 20, 41, 122, 245, 734 | B=734 | `{"mode": "recurrence", "expression": "2*p+1 if n%2==0 else 3*p-1", "seeds": 1}` |
| focus-number-023 | standard | 倍数与递推 | 1, 4, 8, 16, 29, 51, 87 | C=87 | `{"mode": "recurrence", "expression": "p+q+n", "seeds": 2}` |
| focus-number-024 | challenge | 倍数与递推 | 2, 5, 13, 35, 95, 259, 707 | D=707 | `{"mode": "recurrence", "expression": "2*(p+q)-1", "seeds": 2}` |
| focus-number-025 | foundation | 幂次数列 | 6, 11, 18, 27, 38, 51, 66 | A=66 | `{"mode": "formula", "expression": "(n+1)**2+2"}` |
| focus-number-026 | foundation | 幂次数列 | 5, 24, 61, 122, 213, 340, 509 | B=509 | `{"mode": "formula", "expression": "(n+1)**3-3"}` |
| focus-number-027 | foundation | 幂次数列 | 3, 7, 15, 31, 63, 127, 255 | C=255 | `{"mode": "formula", "expression": "2**(n+1)-1"}` |
| focus-number-028 | foundation | 幂次数列 | 17, 25, 35, 47, 61, 77, 95 | D=95 | `{"mode": "formula", "expression": "(n+2)*(n+3)+5"}` |
| focus-number-029 | standard | 幂次数列 | 6, 7, 18, 23, 38, 47, 66 | A=66 | `{"mode": "formula", "expression": "(n+1)**2+2*(-1)**(n+1)"}` |
| focus-number-030 | standard | 幂次数列 | 2, 10, 30, 68, 130, 222, 350 | B=350 | `{"mode": "formula", "expression": "n**3+n"}` |
| focus-number-031 | standard | 幂次数列 | 9, 25, 49, 121, 169, 289, 361 | C=361 | `{"mode": "formula", "expression": "prime(n+1)**2"}` |
| focus-number-032 | standard | 幂次数列 | 13, 25, 41, 61, 85, 113, 145 | D=145 | `{"mode": "formula", "expression": "(n+1)**2+(n+2)**2"}` |
| focus-number-033 | standard | 幂次数列 | 4, 27, 16, 125, 36, 343, 64 | A=64 | `{"mode": "formula", "expression": "(n+1)**(2 if n%2 else 3)"}` |
| focus-number-034 | challenge | 幂次数列 | 4, 11, 31, 89, 259, 761, 2251 | B=2251 | `{"mode": "formula", "expression": "3**n+2**(n-1)"}` |
| focus-number-035 | standard | 幂次数列 | 9, 23, 53, 105, 185, 299, 453 | C=453 | `{"mode": "formula", "expression": "(n+1)**3-(n+1)**2+5"}` |
| focus-number-036 | challenge | 幂次数列 | 1, 9, 36, 100, 225, 441, 784 | D=784 | `{"mode": "formula", "expression": "(F(n*(n+1),2))**2"}` |
| focus-number-037 | foundation | 分数数列 | 1/2, 3/5, 2/3, 5/7, 3/4, 7/9 | A=7/9 | `{"mode": "formula", "expression": "F(n+1,n+3)"}` |
| focus-number-038 | foundation | 分数数列 | 1/3, 1/5, 1/7, 1/9, 1/11, 1/13 | B=1/13 | `{"mode": "formula", "expression": "F(1,2*n+1)"}` |
| focus-number-039 | standard | 分数数列 | 1/2, 2/5, 3/10, 4/17, 5/26, 6/37 | C=6/37 | `{"mode": "formula", "expression": "F(n,n*n+1)"}` |
| focus-number-040 | foundation | 分数数列 | 4/3, 9/4, 16/5, 25/6, 36/7, 49/8 | D=49/8 | `{"mode": "formula", "expression": "F((n+1)**2,n+2)"}` |
| focus-number-041 | standard | 分数数列 | 2/5, 3/8, 5/13, 8/21, 13/34, 21/55, 34/89 | A=34/89 | `{"mode": "formula", "expression": "F(fib(n+2),fib(n+4))"}` |
| focus-number-042 | foundation | 分数数列 | 3/8, 1/4, 1/6, 1/9, 2/27, 4/81, 8/243 | B=8/243 | `{"mode": "recurrence", "expression": "p*F(2,3)", "seeds": 1}` |
| focus-number-043 | standard | 分数数列 | 3/2, 5/3, 7/4, 9/5, 11/6, 13/7, 15/8 | C=15/8 | `{"mode": "formula", "expression": "2-F(1,n+1)"}` |
| focus-number-044 | standard | 分数数列 | 1/6, 1/12, 1/20, 1/30, 1/42, 1/56 | D=1/56 | `{"mode": "formula", "expression": "F(1,(n+1)*(n+2))"}` |
| focus-number-045 | challenge | 分数数列 | 2/5, 3/7, 4/11, 5/19, 6/35, 7/67, 8/131 | A=8/131 | `{"mode": "formula", "expression": "F(n+1,2**n+3)"}` |
| focus-number-046 | standard | 分数数列 | 1/4, 1/7, 1/12, 1/19, 1/28, 1/39, 1/52 | B=1/52 | `{"mode": "formula", "expression": "F(1,n*n+3)"}` |
| focus-number-047 | standard | 分数数列 | 1/3, -1/2, 3/5, -2/3, 5/7, -3/4, 7/9 | C=7/9 | `{"mode": "formula", "expression": "(-1)**(n+1)*F(n,n+2)"}` |
| focus-number-048 | challenge | 分数数列 | 5/6, 7/12, 9/20, 11/30, 13/42, 15/56 | D=15/56 | `{"mode": "formula", "expression": "F(1,n+1)+F(1,n+2)"}` |
| focus-number-049 | foundation | 交错数列 | 4, 30, 9, 27, 14, 24, 19, 21 | A=21 | `{"mode": "lanes", "lanes": [{"mode": "formula", "expression": "5*n-1"}, {"mode": "formula", "expression": "33-3*n"}]}` |
| focus-number-050 | foundation | 交错数列 | 3, 81, 6, 27, 12, 9, 24, 3 | B=3 | `{"mode": "lanes", "lanes": [{"mode": "formula", "expression": "3*2**(n-1)"}, {"mode": "formula", "expression": "F(81,3**(n-1))"}]}` |
| focus-number-051 | foundation | 交错数列 | 9, 2, 16, 5, 25, 8, 36, 11 | C=11 | `{"mode": "lanes", "lanes": [{"mode": "formula", "expression": "(n+2)**2"}, {"mode": "formula", "expression": "3*n-1"}]}` |
| focus-number-052 | foundation | 交错数列 | 8, 4, 27, 9, 64, 16, 125, 25 | D=25 | `{"mode": "lanes", "lanes": [{"mode": "formula", "expression": "(n+1)**3"}, {"mode": "formula", "expression": "(n+1)**2"}]}` |
| focus-number-053 | challenge | 交错数列 | 5, 100, 2, 9, 90, 6, 13, 80, 18, 17, 70, 54 | A=54 | `{"mode": "lanes", "lanes": [{"mode": "formula", "expression": "4*n+1"}, {"mode": "formula", "expression": "110-10*n"}, {"mode": "formula", "expression": "2*3**(n-1)"}]}` |
| focus-number-054 | standard | 交错数列 | 4, 20, 7, 18, 13, 16, 25, 14, 49 | B=49 | `{"mode": "lanes", "lanes": [{"mode": "recurrence", "expression": "2*p-1", "seeds": 1}, {"mode": "formula", "expression": "22-2*n"}]}` |
| focus-number-055 | standard | 交错数列 | 2, 3, 4, 15, 6, 35, 8, 63, 10, 99 | C=99 | `{"mode": "lanes", "lanes": [{"mode": "formula", "expression": "2*n"}, {"mode": "formula", "expression": "(2*n)**2-1"}]}` |
| focus-number-056 | standard | 交错数列 | 5, 8, 6, 10, 9, 14, 14, 20 | D=20 | `{"mode": "lanes", "lanes": [{"mode": "formula", "expression": "(n-1)**2+5"}, {"mode": "formula", "expression": "n*(n-1)+8"}]}` |
| focus-number-057 | standard | 交错数列 | 2, 4, 3, 7, 5, 11, 7, 18, 11, 29 | A=29 | `{"mode": "lanes", "lanes": [{"mode": "formula", "expression": "prime(n)"}, {"mode": "recurrence", "expression": "p+q", "seeds": 2}]}` |
| focus-number-058 | standard | 交错数列 | 2, 1/2, 3, 1/3, 4, 1/4, 5, 1/5, 6, 1/6 | B=1/6 | `{"mode": "lanes", "lanes": [{"mode": "formula", "expression": "n+1"}, {"mode": "formula", "expression": "F(1,n+1)"}]}` |
| focus-number-059 | standard | 交错数列 | 6, 5, 12, 9, 20, 17, 30, 33 | C=33 | `{"mode": "lanes", "lanes": [{"mode": "formula", "expression": "(n+1)*(n+2)"}, {"mode": "formula", "expression": "2**(n+1)+1"}]}` |
| focus-number-060 | challenge | 交错数列 | 1, 3, 4, 4, 6, 9, 9, 12, 16, 16, 24, 25 | D=25 | `{"mode": "lanes", "lanes": [{"mode": "formula", "expression": "n*n"}, {"mode": "formula", "expression": "3*2**(n-1)"}, {"mode": "formula", "expression": "(n+1)**2"}]}` |
| focus-number-061 | foundation | 分组数列 | 7, 4, 11, 9, 6, 15, 5, 8, 13, 12, 7, 19 | A=19 | `{"mode": "groups", "expression": "a+b", "width": 3}` |
| focus-number-062 | foundation | 分组数列 | 18, 5, 13, 27, 9, 18, 35, 12, 23, 42, 16, 26 | B=26 | `{"mode": "groups", "expression": "a-b", "width": 3}` |
| focus-number-063 | foundation | 分组数列 | 3, 5, 16, 4, 7, 29, 6, 2, 13, 8, 4, 33 | C=33 | `{"mode": "groups", "expression": "a*b+1", "width": 3}` |
| focus-number-064 | foundation | 分组数列 | 36, 4, 9, 56, 7, 8, 30, 5, 6, 63, 9, 7 | D=7 | `{"mode": "groups", "expression": "a/b", "width": 3}` |
| focus-number-065 | standard | 分组数列 | 4, 7, 21, 8, 5, 25, 3, 6, 17, 9, 4, 25 | A=25 | `{"mode": "groups", "expression": "2*(a+b)-1", "width": 3}` |
| focus-number-066 | standard | 分组数列 | 6, 7, 29, 8, 9, 55, 5, 3, 22, 9, 11, 70 | B=70 | `{"mode": "groups", "expression": "a*a-b", "width": 3}` |
| focus-number-067 | standard | 分组数列 | 3, 4, 19, 5, 2, 17, 6, 7, 55, 8, 3, 35 | C=35 | `{"mode": "groups", "expression": "a*b+a+b", "width": 3}` |
| focus-number-068 | standard | 分组数列 | 3, 4, 25, 5, 2, 29, 6, 7, 85, 8, 3, 73 | D=73 | `{"mode": "groups", "expression": "a*a+b*b", "width": 3}` |
| focus-number-069 | standard | 分组数列 | 2, 5, 49, 3, 8, 121, 6, 4, 100, 9, 3, 144 | A=144 | `{"mode": "groups", "expression": "(a+b)**2", "width": 3}` |
| focus-number-070 | standard | 分组数列 | 4, 3, 13, 7, 2, 19, 5, 6, 29, 8, 4, 36 | B=36 | `{"mode": "groups", "expression": "a*(b+1)-b", "width": 3}` |
| focus-number-071 | challenge | 分组数列 | 7, 3, 40, 9, 5, 56, 6, 2, 32, 10, 4, 84 | C=84 | `{"mode": "groups", "expression": "a*a-b*b", "width": 3}` |
| focus-number-072 | challenge | 分组数列 | 4, 6, 11, 7, 3, 14, 5, 8, 22, 9, 4, 29 | D=29 | `{"mode": "groups", "expression": "a+b+g*g", "width": 3}` |
| focus-number-073 | standard | 数位规律 | 13, 35, 57, 79, 911, 1113 | A=1113 | `{"mode": "formula", "expression": "concat(2*n-1,2*n+1)"}` |
| focus-number-074 | foundation | 数位规律 | 242, 353, 464, 575, 686, 797 | B=797 | `{"mode": "formula", "expression": "concat(n+1,n+3,n+1)"}` |
| focus-number-075 | foundation | 数位规律 | 3, 34, 345, 3456, 34567, 345678 | C=345678 | `{"mode": "formula", "expression": "int(\"\".join(str(k) for k in range(3,n+3)))"}` |
| focus-number-076 | foundation | 数位规律 | 42, 53, 64, 75, 86, 97 | D=97 | `{"mode": "formula", "expression": "concat(n+3,n+1)"}` |
| focus-number-077 | foundation | 数位规律 | 13, 31, 24, 42, 35, 53, 46, 64 | A=64 | `{"mode": "lanes", "lanes": [{"mode": "formula", "expression": "11*n+2"}, {"mode": "formula", "expression": "11*n+20"}]}` |
| focus-number-078 | standard | 数位规律 | 24, 39, 416, 525, 636, 749 | B=749 | `{"mode": "formula", "expression": "concat(n+1,(n+1)**2)"}` |
| focus-number-079 | standard | 数位规律 | 26, 34, 41, 46, 56, 67, 80 | C=80 | `{"mode": "recurrence", "expression": "p+dsum(p)", "seeds": 1}` |
| focus-number-080 | standard | 数位规律 | 12, 14, 18, 26, 38, 62, 74 | D=74 | `{"mode": "recurrence", "expression": "p+dprod(p)", "seeds": 1}` |
| focus-number-081 | challenge | 数位规律 | 16, 37, 58, 89, 145, 42, 20 | A=20 | `{"mode": "recurrence", "expression": "dsquares(p)", "seeds": 1}` |
| focus-number-082 | challenge | 数位规律 | 27, 99, 198, 1089, 10890, 20691 | B=20691 | `{"mode": "recurrence", "expression": "p+reverse(p)", "seeds": 1}` |
| focus-number-083 | standard | 数位规律 | 23, 35, 58, 813, 1321, 2134 | C=2134 | `{"mode": "formula", "expression": "concat(fib(n+2),fib(n+3))"}` |
| focus-number-084 | standard | 数位规律 | 2, 33, 444, 5555, 66666, 777777 | D=777777 | `{"mode": "formula", "expression": "int(str(n+1)*n)"}` |
| focus-number-085 | foundation | 图阵加减 | 10, 9, 4, 23 | A=23 | `{"mode": "matrix", "expression": "a+b+c", "equation": "z-a-b==c", "arity": 3}` |
| focus-number-086 | foundation | 图阵加减 | 21, 3, 5, 19 | B=3 | `{"mode": "matrix", "expression": "a+b-c", "equation": "z+c==a+b", "arity": 3}` |
| focus-number-087 | foundation | 图阵加减 | 18, 12, 11, 17 | C=17 | `{"mode": "matrix", "expression": "a-b+c", "equation": "z+b==a+c", "arity": 3}` |
| focus-number-088 | foundation | 图阵加减 | 20, 2, 5, 13 | D=13 | `{"mode": "matrix", "expression": "a-b-c", "equation": "z+b+c==a", "arity": 3}` |
| focus-number-089 | standard | 图阵加减 | 9, 10, 7, 35 | A=9 | `{"mode": "matrix", "expression": "2*a+b+c", "equation": "z-b-c==2*a", "arity": 3}` |
| focus-number-090 | standard | 图阵加减 | 22, 7, 4, 32 | B=32 | `{"mode": "matrix", "expression": "a+2*b-c", "equation": "z+c-a==2*b", "arity": 3}` |
| focus-number-091 | standard | 图阵加减 | 16, 8, 10, 4 | C=4 | `{"mode": "matrix", "expression": "a+b-2*c", "equation": "a+b-z==2*c", "arity": 3}` |
| focus-number-092 | standard | 图阵加减 | 31, 9, 12, 26 | D=26 | `{"mode": "matrix", "expression": "(a+b+c)/2", "equation": "2*z==a+b+c", "arity": 3}` |
| focus-number-093 | standard | 图阵加减 | 12, 3, 11, 19 | A=19 | `{"mode": "matrix", "expression": "a+(b+c)/2", "equation": "2*(z-a)==b+c", "arity": 3}` |
| focus-number-094 | standard | 图阵加减 | 19, 5, 2, 30 | B=30 | `{"mode": "matrix", "expression": "2*(a-b)+c", "equation": "z-c==2*a-2*b", "arity": 3}` |
| focus-number-095 | challenge | 图阵加减 | 4, 6, 2, 12 | C=2 | `{"mode": "matrix", "expression": "a+2*(b-c)", "equation": "z-a==2*b-2*c", "arity": 3}` |
| focus-number-096 | challenge | 图阵加减 | 8, 11, 12, 25 | D=25 | `{"mode": "matrix", "expression": "3*a-b+c", "equation": "z+b-c==3*a", "arity": 3}` |
| focus-number-097 | foundation | 图阵乘除 | 15, 7, 105 | A=105 | `{"mode": "matrix", "expression": "a*b", "equation": "z/a==b", "arity": 2}` |
| focus-number-098 | foundation | 图阵乘除 | 7, 13, 5, 96 | B=13 | `{"mode": "matrix", "expression": "a*b+c", "equation": "z-c==a*b", "arity": 3}` |
| focus-number-099 | foundation | 图阵乘除 | 20, 10, 7, 193 | C=193 | `{"mode": "matrix", "expression": "a*b-c", "equation": "z+c==a*b", "arity": 3}` |
| focus-number-100 | foundation | 图阵乘除 | 4, 2, 12, 56 | D=56 | `{"mode": "matrix", "expression": "a*(b+c)", "equation": "z/a==b+c", "arity": 3}` |
| focus-number-101 | standard | 图阵乘除 | 13, 12, 10, 26 | A=13 | `{"mode": "matrix", "expression": "a*(b-c)", "equation": "z/a==b-c", "arity": 3}` |
| focus-number-102 | standard | 图阵乘除 | 30, 7, 10, 370 | B=370 | `{"mode": "matrix", "expression": "(a+b)*c", "equation": "z/c==a+b", "arity": 3}` |
| focus-number-103 | standard | 图阵乘除 | 17, 3, 4, 56 | C=56 | `{"mode": "matrix", "expression": "(a-b)*c", "equation": "z/c==a-b", "arity": 3}` |
| focus-number-104 | standard | 图阵乘除 | 14, 3, 6, 7 | D=7 | `{"mode": "matrix", "expression": "a*b/c", "equation": "z*c==a*b", "arity": 3}` |
| focus-number-105 | standard | 图阵乘除 | 12, 2, 11, 17 | A=17 | `{"mode": "matrix", "expression": "a/b+c", "equation": "(z-c)*b==a", "arity": 3}` |
| focus-number-106 | standard | 图阵乘除 | 32, 6, 3, 34 | B=34 | `{"mode": "matrix", "expression": "a+b/c", "equation": "(z-a)*c==b", "arity": 3}` |
| focus-number-107 | challenge | 图阵乘除 | 30, 6, 3, 12 | C=3 | `{"mode": "matrix", "expression": "(a+b)/c", "equation": "z*c==a+b", "arity": 3}` |
| focus-number-108 | challenge | 图阵乘除 | 30, 2, 3, 6 | D=6 | `{"mode": "matrix", "expression": "a/(b+c)", "equation": "z*(b+c)==a", "arity": 3}` |
| focus-number-109 | foundation | 图阵复合运算 | 29, 10, 6, 857 | A=857 | `{"mode": "matrix", "expression": "a*a+b+c", "equation": "z-b-c==a*a", "arity": 3}` |
| focus-number-110 | foundation | 图阵复合运算 | 22, 11, 6, 467 | B=11 | `{"mode": "matrix", "expression": "a*a-b-c", "equation": "z+b+c==a*a", "arity": 3}` |
| focus-number-111 | foundation | 图阵复合运算 | 5, 7, 3, 141 | C=141 | `{"mode": "matrix", "expression": "(a+b)**2-c", "equation": "z+c==(a+b)**2", "arity": 3}` |
| focus-number-112 | foundation | 图阵复合运算 | 20, 4, 6, 262 | D=262 | `{"mode": "matrix", "expression": "(a-b)**2+c", "equation": "z-c==(a-b)**2", "arity": 3}` |
| focus-number-113 | standard | 图阵复合运算 | 24, 3, 11, 574 | A=24 | `{"mode": "matrix", "expression": "a*a+b*b-c", "equation": "z+c==a*a+b*b", "arity": 3}` |
| focus-number-114 | standard | 图阵复合运算 | 19, 7, 10, 322 | B=322 | `{"mode": "matrix", "expression": "a*a-b*b+c", "equation": "z-c==(a-b)*(a+b)", "arity": 3}` |
| focus-number-115 | standard | 图阵复合运算 | 29, 8, 7, 222 | C=222 | `{"mode": "matrix", "expression": "(a+b)*(c-1)", "equation": "z/(a+b)+1==c", "arity": 3}` |
| focus-number-116 | standard | 图阵复合运算 | 3, 13, 6, 117 | D=117 | `{"mode": "matrix", "expression": "a*b+b*c", "equation": "z/b==a+c", "arity": 3}` |
| focus-number-117 | standard | 图阵复合运算 | 10, 7, 13, 2, 116 | A=116 | `{"mode": "matrix", "expression": "a*c-b*d", "equation": "z+b*d==a*c", "arity": 4}` |
| focus-number-118 | standard | 图阵复合运算 | 30, 5, 3, 2, 7 | B=7 | `{"mode": "matrix", "expression": "(a+b)/(c+d)", "equation": "z*(c+d)==a+b", "arity": 4}` |
| focus-number-119 | challenge | 图阵复合运算 | 22, 4, 6, 3, 106 | C=106 | `{"mode": "matrix", "expression": "a*b+c*d", "equation": "z-a*b==c*d", "arity": 4}` |
| focus-number-120 | challenge | 图阵复合运算 | 29, 5, 6, 10, 544 | D=544 | `{"mode": "matrix", "expression": "(a+b)*(c+d)", "equation": "z/(a+b)==c+d", "arity": 4}` |
