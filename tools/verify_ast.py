"""Независимый подсчёт метрик Холстеда по AST Python — те же правила Таблицы 1,
но другой способ: классификация по синтаксическому дереву, а не по потоку токенов."""
import ast
import collections
import io
import json
import sys
import tokenize

NL = '↵ (конец инструкции)'
BIN = {ast.Add: '+', ast.Sub: '-', ast.Mult: '*', ast.Div: '/', ast.FloorDiv: '//',
       ast.Mod: '%', ast.Pow: '**', ast.MatMult: '@', ast.LShift: '<<',
       ast.RShift: '>>', ast.BitAnd: '&', ast.BitOr: '|', ast.BitXor: '^'}
UNARY = {ast.USub: '-', ast.UAdd: '+', ast.Invert: '~', ast.Not: 'not'}
CMP = {ast.Eq: '==', ast.NotEq: '!=', ast.Lt: '<', ast.LtE: '<=', ast.Gt: '>',
       ast.GtE: '>=', ast.In: 'in', ast.NotIn: 'not in', ast.Is: 'is',
       ast.IsNot: 'is not'}
SIMPLE = (ast.Expr, ast.Assign, ast.AugAssign, ast.AnnAssign, ast.Return, ast.Delete,
          ast.Pass, ast.Break, ast.Continue, ast.Raise, ast.Assert, ast.Global,
          ast.Nonlocal, ast.Import, ast.ImportFrom)


class Halstead:
    def __init__(self, src):
        self.src = src
        self.lines = src.splitlines(keepends=True)
        self.ops = collections.Counter()
        self.opnds = collections.Counter()
        self.toks = [t for t in tokenize.generate_tokens(io.StringIO(src).readline)
                     if t.type not in (tokenize.COMMENT, tokenize.NL,
                                       tokenize.INDENT, tokenize.DEDENT)]
        self.headers = []          # [(start, end)] — заголовки def/class/lambda
        self.call_parens = set()   # позиции «(» вызовов по имени
        self.header_parens = set() # «(» вокруг заголовка if/while/with/except/match/case и импорта

    def pos(self, line, byte_col):
        raw = self.lines[line - 1].encode('utf-8')
        return (line, len(raw[:byte_col].decode('utf-8')))

    def start(self, n):
        return self.pos(n.lineno, n.col_offset)

    def end(self, n):
        return self.pos(n.end_lineno, n.end_col_offset)

    def tok_after(self, p, string=None):
        for t in self.toks:
            if t.start >= p and (string is None or t.string == string):
                return t
        raise ValueError(p)

    def last_colon_before(self, p):
        return max(t.start for t in self.toks if t.string == ':' and t.start < p)

    def index(self, p):
        return next(k for k, t in enumerate(self.toks) if t.start == p)

    def closing(self, k):
        depth = 0
        for j in range(k, len(self.toks)):
            t = self.toks[j]
            if t.type == tokenize.OP and t.string in ('(', '[', '{'):
                depth += 1
            elif t.type == tokenize.OP and t.string in (')', ']', '}'):
                depth -= 1
                if depth == 0:
                    return j
        raise ValueError(k)

    def wrapped(self, kw, stops=(':',)):
        """kw — индекс служебного слова; скобки сразу после него до «:» — часть оператора."""
        if self.toks[kw].string == 'async':
            kw += 1
        if self.toks[kw + 1].string == '(':
            close = self.closing(kw + 1)
            if self.toks[close + 1].string in stops:
                self.header_parens.add(self.toks[kw + 1].start)

    def in_header(self, p):
        return any(a <= p <= b for a, b in self.headers)

    # --- обход ---
    def run(self, tree):
        self.body(tree.body)
        for t in self.toks:
            if t.type != tokenize.OP or self.in_header(t.start):
                continue
            if t.string == '(' and t.start not in self.call_parens | self.header_parens:
                self.ops['( )'] += 1
            elif t.string == '[':
                self.ops['[ ]'] += 1
            elif t.string == '{':
                self.ops['{ }'] += 1
            elif t.string == ';':
                self.ops[';'] += 1
        return self

    def body(self, stmts):
        for s in stmts:
            self.stmt(s)

    def stmt(self, s):
        if isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant) \
                and isinstance(s.value.value, str):
            return  # docstring
        if isinstance(s, SIMPLE) and self.tok_after(self.end(s)).type == tokenize.NEWLINE:
            self.ops[NL] += 1
        match s:
            case ast.Expr(value=v):
                self.expr(v)
            case ast.Assign(targets=ts, value=v):
                self.ops['='] += len(ts)
                for t in ts:
                    self.expr(t)
                self.expr(v)
            case ast.AugAssign(target=t, op=op, value=v):
                self.ops[BIN[type(op)] + '='] += 1
                self.expr(t)
                self.expr(v)
            case ast.Return(value=v):
                self.ops['return'] += 1
                self.expr(v)
            case ast.Delete(targets=ts):
                self.ops['del'] += 1
                for t in ts:
                    self.expr(t)
            case ast.Pass() | ast.Break() | ast.Continue():
                self.ops[type(s).__name__.lower()] += 1
            case ast.Raise(exc=e, cause=c):
                self.ops['raise'] += 1
                self.expr(e)
                self.expr(c)
            case ast.Assert(test=t, msg=m):
                self.ops['assert'] += 1
                self.expr(t)
                self.expr(m)
            case ast.Global(names=ns) | ast.Nonlocal(names=ns):
                self.ops[type(s).__name__.lower()] += 1
                for n in ns:
                    self.opnds[n] += 1
            case ast.Import(names=names):
                self.ops['import…as'] += 1
                self.aliases(names)
            case ast.ImportFrom(module=mod, names=names, level=0):
                self.ops['from…import…as'] += 1
                self.header_parens |= {t.start for t in self.toks if t.string == '('
                                       and self.start(s) <= t.start < self.end(s)}
                self.dotted(mod)
                self.aliases(names)
            case ast.If(test=t, body=b, orelse=o):
                self.ops['if…elif…else'] += 1
                self.wrapped(self.index(self.start(s)))
                self.expr(t)
                self.body(b)
                self.body(o)
            case ast.For(target=t, iter=it, body=b, orelse=o):
                self.ops['for…in…else'] += 1
                self.expr(t)
                self.expr(it)
                self.body(b)
                self.body(o)
            case ast.While(test=t, body=b, orelse=o):
                self.ops['while…else'] += 1
                self.wrapped(self.index(self.start(s)))
                self.expr(t)
                self.body(b)
                self.body(o)
            case ast.Try(body=b, handlers=hs, orelse=o, finalbody=f):
                self.ops['try…except…finally'] += 1
                self.body(b)
                for h in hs:
                    self.wrapped(self.index(self.start(h)), (':', 'as'))
                    self.expr(h.type)
                    if h.name:
                        self.opnds[h.name] += 1
                    self.body(h.body)
                self.body(o)
                self.body(f)
            case ast.With(items=items, body=b):
                self.ops['with…as'] += 1
                self.wrapped(self.index(self.start(s)))
                for it in items:
                    self.expr(it.context_expr)
                    self.expr(it.optional_vars)
                self.body(b)
            case ast.Match(subject=subj, cases=cases):
                self.ops['match…case'] += 1
                self.wrapped(self.index(self.start(s)))
                self.expr(subj)
                for c in cases:
                    assert c.guard is None, 'guard не поддержан'
                    self.wrapped(max(k for k, t in enumerate(self.toks)
                                     if t.string == 'case' and t.start < self.start(c.pattern)))
                    self.pattern(c.pattern)
                    self.body(c.body)
            case ast.FunctionDef(body=b) | ast.ClassDef(body=b):
                self.decorators(s.decorator_list)
                self.ops['def' if isinstance(s, ast.FunctionDef) else 'class'] += 1
                self.headers.append((self.start(s), self.last_colon_before(self.start(b[0]))))
                self.body(b)
            case _:
                raise NotImplementedError(ast.dump(s))

    def aliases(self, names):
        for a in names:
            if a.name == '*':
                self.ops['*'] += 1
            else:
                self.dotted(a.name)
            if a.asname:
                self.opnds[a.asname] += 1

    def dotted(self, name):
        parts = name.split('.')
        self.opnds[parts[0]] += 1
        for p in parts[1:]:
            self.ops['.'] += 1
            self.opnds['.' + p] += 1

    def decorators(self, decs):
        for d in decs:
            call = isinstance(d, ast.Call)
            target = d.func if call else d
            chain = []
            while isinstance(target, ast.Attribute):
                chain.insert(0, target.attr)
                target = target.value
            assert isinstance(target, ast.Name), 'сложный декоратор не поддержан'
            key = '@' + '.'.join([target.id] + chain)
            if call:
                key += '( )'
                self.call_parens.add(self.tok_after(self.end(d.func), '(').start)
                self.args(d)
            self.ops[key] += 1

    def comprehension(self, gens):
        for g in gens:
            self.ops['for…in (генератор)'] += 1
            self.expr(g.target)
            self.expr(g.iter)
            for cond in g.ifs:
                self.ops['if (фильтр генератора)'] += 1
                self.expr(cond)

    def args(self, call):
        for a in call.args:
            self.expr(a)
        for kw in call.keywords:
            if kw.arg is None:
                self.ops['**'] += 1
            self.expr(kw.value)

    def pattern(self, p):
        match p:
            case ast.MatchValue(value=v):
                self.expr(v)
            case ast.MatchSingleton(value=v):
                self.opnds[repr(v)] += 1
            case ast.MatchSequence(patterns=ps):
                for q in ps:
                    self.pattern(q)
            case ast.MatchAs(pattern=q, name=n):
                if q is not None:
                    self.pattern(q)
                self.opnds[n if n is not None else '_'] += 1
            case ast.MatchOr(patterns=ps):
                self.ops['|'] += len(ps) - 1
                for q in ps:
                    self.pattern(q)
            case _:
                raise NotImplementedError(ast.dump(p))

    def expr(self, e):
        if e is None:
            return
        match e:
            case ast.Name(id=name):
                self.opnds[name] += 1
            case ast.Constant():
                self.opnds[ast.get_source_segment(self.src, e)] += 1
            case ast.Attribute(value=v, attr=a):
                self.ops['.'] += 1
                self.opnds['.' + a] += 1
                self.expr(v)
            case ast.Call(func=f):
                if isinstance(f, ast.Name):
                    self.ops[f.id + '( )'] += 1
                    self.call_parens.add(self.tok_after(self.end(f), '(').start)
                elif isinstance(f, ast.Attribute):
                    self.ops['.'] += 1
                    self.ops['.' + f.attr + '( )'] += 1
                    self.expr(f.value)
                    self.call_parens.add(self.tok_after(self.end(f), '(').start)
                else:
                    self.expr(f)  # скобки такого вызова — обычная пара ( )
                self.args(e)
            case ast.BinOp(left=l, op=op, right=r):
                self.ops[BIN[type(op)]] += 1
                self.expr(l)
                self.expr(r)
            case ast.UnaryOp(op=op, operand=x):
                self.ops[UNARY[type(op)]] += 1
                self.expr(x)
            case ast.BoolOp(op=op, values=vs):
                self.ops['and' if isinstance(op, ast.And) else 'or'] += len(vs) - 1
                for v in vs:
                    self.expr(v)
            case ast.Compare(left=l, ops=cmp, comparators=rs):
                for c in cmp:
                    self.ops[CMP[type(c)]] += 1
                self.expr(l)
                for r in rs:
                    self.expr(r)
            case ast.NamedExpr(target=t, value=v):
                self.ops[':='] += 1
                self.expr(t)
                self.expr(v)
            case ast.IfExp(test=t, body=b, orelse=o):
                self.ops['if…else (условное выражение)'] += 1
                self.expr(t)
                self.expr(b)
                self.expr(o)
            case ast.Lambda(body=b):
                self.ops['lambda'] += 1
                self.headers.append((self.start(e), self.last_colon_before(self.start(b))))
                self.expr(b)
            case ast.Subscript(value=v, slice=sl):
                self.expr(v)
                self.slice(sl)
            case ast.List(elts=xs) | ast.Tuple(elts=xs) | ast.Set(elts=xs):
                for x in xs:
                    self.expr(x)
            case ast.Dict(keys=ks, values=vs):
                for k, v in zip(ks, vs):
                    if k is None:
                        self.ops['**'] += 1
                    self.expr(k)
                    self.expr(v)
            case ast.ListComp(elt=x, generators=g) | ast.SetComp(elt=x, generators=g) \
                    | ast.GeneratorExp(elt=x, generators=g):
                self.expr(x)
                self.comprehension(g)
            case ast.DictComp(key=k, value=v, generators=g):
                self.expr(k)
                self.expr(v)
                self.comprehension(g)
            case ast.Starred(value=v):
                self.ops['*'] += 1
                self.expr(v)
            case ast.Yield(value=v) | ast.Await(value=v):
                self.ops[type(e).__name__.lower()] += 1
                self.expr(v)
            case _:
                raise NotImplementedError(ast.dump(e))

    def slice(self, sl):
        match sl:
            case ast.Slice(lower=lo, upper=up, step=st):
                colons = [t for t in self.toks if t.string == ':'
                          and self.start(sl) <= t.start < self.end(sl)]
                self.ops[': (срез)'] += max(1, len(colons))
                for x in (lo, up, st):
                    self.expr(x)
            case ast.Tuple(elts=xs):
                for x in xs:
                    self.slice(x)
            case _:
                self.expr(sl)


if __name__ == '__main__':
    src = open(sys.argv[1], encoding='utf-8').read()
    h = Halstead(src).run(ast.parse(src))
    json.dump({'operators': dict(h.ops), 'operands': dict(h.opnds)},
              sys.stdout, ensure_ascii=False, indent=1)
