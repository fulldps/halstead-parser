import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { KEYS, runAnalysis, SourceError } from '../src/halstead/index.ts';
import { Lexer } from '../src/halstead/lexer.ts';

const NL = KEYS.newline;

// Таблицы частот как обычные объекты — так deepEqual показывает разницу по ключам.
const operators = (src: string) =>
  Object.fromEntries(runAnalysis(src).metrics.operators.map((r) => [r.name, r.count]));
const operands = (src: string) =>
  Object.fromEntries(runAnalysis(src).metrics.operands.map((r) => [r.name, r.count]));

describe('вызовы и скобки', () => {
  it('f( ) — один оператор, его скобки отдельно не считаются', () => {
    assert.deepEqual(operators('print(len(xs))'), { 'print( )': 1, 'len( )': 1, [NL]: 1 });
    assert.deepEqual(operands('print(len(xs))'), { xs: 1 });
  });

  it('пробел перед скобкой не мешает вызову (как Readln (x) в PDF)', () => {
    assert.deepEqual(operators('print (x)'), { 'print( )': 1, [NL]: 1 });
  });

  it('скобки группировки — оператор ( )', () => {
    assert.deepEqual(operators('y = (a + b) * c'), { '=': 1, '( )': 1, '+': 1, '*': 1, [NL]: 1 });
  });

  it('метод: . и имя метода как оператор', () => {
    assert.deepEqual(operators('xs.append(1)'), { '.': 1, '.append( )': 1, [NL]: 1 });
    assert.deepEqual(operands('xs.append(1)'), { xs: 1, '1': 1 });
  });

  it('атрибут и переменная с тем же именем — разные операнды', () => {
    assert.deepEqual(operands('self.qty = qty'), { self: 1, '.qty': 1, qty: 1 });
    assert.deepEqual(operators('math.floor(x)'), { '.': 1, '.floor( )': 1, [NL]: 1 });
  });

  it('запятая не учитывается (Writeln (x, y, eps) в PDF)', () => {
    assert.deepEqual(operators('print(x, y, eps)'), { 'print( )': 1, [NL]: 1 });
    assert.deepEqual(operands('print(x, y, eps)'), { x: 1, y: 1, eps: 1 });
  });

  it('имя именованного аргумента не операнд, его = не присваивание', () => {
    assert.deepEqual(operators('f(x, key=1)'), { 'f( )': 1, [NL]: 1 });
    assert.deepEqual(operands('f(x, key=1)'), { x: 1, '1': 1 });
  });

  it('но == внутри вызова — сравнение', () => {
    assert.deepEqual(operators('f(a == b)'), { 'f( )': 1, '==': 1, [NL]: 1 });
  });

  it('индекс и срез', () => {
    assert.deepEqual(operators('y = xs[1:2]'), { '=': 1, '[ ]': 1, [KEYS.slice]: 1, [NL]: 1 });
  });

  it('словарь: { } — оператор, двоеточие — разделитель', () => {
    assert.deepEqual(operators('d = {a: 1}'), { '=': 1, '{ }': 1, [NL]: 1 });
  });

  it('вызов результата выражения', () => {
    assert.deepEqual(operators('handlers[0](x)'), { '[ ]': 1, '( )': 1, [NL]: 1 });
  });
});

describe('скобки, входящие в другой оператор', () => {
  it('скобки вокруг условия if/while — часть оператора, а не ( )', () => {
    assert.deepEqual(operators('if (a):\n    pass\n'), { [KEYS.if]: 1, pass: 1, [NL]: 1 });
    assert.deepEqual(operators('while (a and b):\n    pass\n'), {
      [KEYS.while]: 1,
      and: 1,
      pass: 1,
      [NL]: 1,
    });
  });

  it('скобки вокруг части условия — приоритетные, считаются', () => {
    assert.equal(operators('if (a) and (b):\n    pass\n')['( )'], 2);
    assert.equal(operators('if (n := f()) > 0:\n    pass\n')['( )'], 1);
    assert.equal(operators('if not (a or b):\n    pass\n')['( )'], 1);
  });

  it('except (…), with (…), список импорта — скобки входят в оператор', () => {
    const src = 'try:\n    pass\nexcept (A, B) as e:\n    pass\n';
    assert.equal(operators(src)['( )'], undefined);
    assert.equal(operators('with (open(p)):\n    pass\n')['( )'], undefined);
    assert.equal(operators('from m import (a, b)')['( )'], undefined);
    assert.equal(operators('match (cmd):\n    case (1):\n        pass\n')['( )'], undefined);
  });

  it('скобки тернарника и кортежа остаются ( )', () => {
    assert.equal(operators('if a if (b) else c:\n    pass\n')['( )'], 1);
    assert.equal(operators('pair = (a, b)')['( )'], 1);
  });
});

describe('операторы-символы', () => {
  it('унарный и бинарный минус — один оператор (как «–» в PDF)', () => {
    assert.deepEqual(operators('y = -a - b'), { '=': 1, '-': 2, [NL]: 1 });
  });

  it('составное присваивание — свой оператор', () => {
    assert.deepEqual(operators('n += 1'), { '+=': 1, [NL]: 1 });
  });

  it('; — разделитель инструкций, как в Паскале', () => {
    assert.deepEqual(operators('a = 1; b = 2'), { '=': 2, ';': 1, [NL]: 1 });
  });
});

describe('составные операторы', () => {
  it('if…elif…else: if и каждый elif — по разу, else входит в конструкцию', () => {
    const src = 'if a:\n    x = 1\nelif b:\n    x = 2\nelse:\n    x = 3\n';
    assert.deepEqual(operators(src), { [KEYS.if]: 2, '=': 3, [NL]: 3 });
  });

  it('однострочный if: инструкция после двоеточия считается', () => {
    assert.deepEqual(operators('if a: return b'), { [KEYS.if]: 1, return: 1, [NL]: 1 });
  });

  it('тернарный оператор отличается от if-инструкции', () => {
    assert.deepEqual(operators('x = a if c else b'), { '=': 1, [KEYS.ifExpr]: 1, [NL]: 1 });
  });

  it('for…in: in входит в for, отдельный in — проверка вхождения', () => {
    const src = 'for x in xs:\n    if x in ys:\n        pass\n';
    assert.deepEqual(operators(src), { [KEYS.for]: 1, [KEYS.if]: 1, in: 1, pass: 1, [NL]: 1 });
  });

  it('генератор с фильтром', () => {
    assert.deepEqual(operators('ys = [x for x in xs if x > 0]'), {
      '=': 1,
      '[ ]': 1,
      [KEYS.forComp]: 1,
      [KEYS.ifFilter]: 1,
      '>': 1,
      [NL]: 1,
    });
  });

  it('тернарник внутри генератора — не фильтр', () => {
    const ops = operators('ys = [a if c else b for x in xs]');
    assert.equal(ops[KEYS.ifExpr], 1);
    assert.equal(ops[KEYS.ifFilter], undefined);
  });

  it('not in и is not — по одному оператору', () => {
    assert.deepEqual(operators('ok = a not in b or c is not None'), {
      '=': 1,
      'not in': 1,
      or: 1,
      'is not': 1,
      [NL]: 1,
    });
  });

  it('try…except…finally и with…as — одна конструкция', () => {
    const src =
      'try:\n    with open(p) as f:\n        pass\nexcept OSError as e:\n    pass\nfinally:\n    pass\n';
    assert.deepEqual(operators(src), {
      [KEYS.try]: 1,
      [KEYS.with]: 1,
      'open( )': 1,
      pass: 3,
      [NL]: 3,
    });
    assert.deepEqual(operands(src), { p: 1, f: 1, OSError: 1, e: 1 });
  });

  it('match/case как ключевые слова и match как переменная', () => {
    const src = 'match cmd:\n    case "go":\n        run()\nmatch = 1\n';
    const ops = operators(src);
    assert.equal(ops[KEYS.match], 1);
    assert.equal(ops['run( )'], 1);
    assert.equal(operands(src).match, 1);
  });
});

describe('объявления', () => {
  it('заголовок def не анализируется, тело — да', () => {
    const src = 'def area(w: float, h: float = 1.0) -> float:\n    return w * h\n';
    assert.deepEqual(operators(src), { def: 1, return: 1, '*': 1, [NL]: 1 });
    assert.deepEqual(operands(src), { w: 1, h: 1 });
  });

  it('class и однострочное тело', () => {
    assert.deepEqual(operators('class A(Base): pass'), { class: 1, pass: 1, [NL]: 1 });
  });

  it('lambda: параметры — объявление, тело — выражение', () => {
    assert.deepEqual(operators('f = lambda x, y=2: x + y'), {
      '=': 1,
      lambda: 1,
      '+': 1,
      [NL]: 1,
    });
    assert.deepEqual(operands('f = lambda x, y=2: x + y'), { f: 1, x: 1, y: 1 });
  });

  it('тернарник в теле lambda не считается if-инструкцией', () => {
    assert.equal(operators('f = lambda x: 1 if x else 2')[KEYS.ifExpr], 1);
  });

  it('async def — один оператор', () => {
    assert.deepEqual(operators('async def main():\n    await go()\n'), {
      'async def': 1,
      await: 1,
      'go( )': 1,
      [NL]: 1,
    });
  });

  it('декоратор — один оператор, строка декоратора не инструкция', () => {
    const src = '@app.route("/")\ndef index():\n    return 1\n';
    assert.deepEqual(operators(src), { '@app.route( )': 1, def: 1, return: 1, [NL]: 1 });
    assert.deepEqual(operands(src), { '"/"': 1, '1': 1 });
  });

  it('import', () => {
    assert.deepEqual(operators('from math import sqrt as root'), { [KEYS.fromImport]: 1, [NL]: 1 });
    assert.deepEqual(operands('from math import sqrt as root'), { math: 1, sqrt: 1, root: 1 });
  });
});

describe('что не учитывается', () => {
  it('комментарии и docstring', () => {
    const src = '"""Модуль."""\n# комментарий\ndef f():\n    """Док."""\n    return 1  # ещё\n';
    assert.deepEqual(operators(src), { def: 1, return: 1, [NL]: 1 });
    assert.deepEqual(operands(src), { '1': 1 });
  });

  it('пустая программа', () => {
    const { metrics } = runAnalysis('\n# только комментарий\n');
    assert.equal(metrics.N1 + metrics.N2, 0);
    assert.equal(metrics.V, 0);
  });

  it('каждый токен размечен ровно один раз', () => {
    const src = 'for i in range(3):\n    print(i, end="")  # x\n';
    const { items } = runAnalysis(src);
    assert.equal(items.length, new Lexer(src).tokenize().length);
    assert.ok(items.every((it) => it.key.length > 0));
  });
});

describe('ошибки во входном коде', () => {
  it('незакрытая скобка — с позицией открывающей', () => {
    assert.throws(
      () => runAnalysis('x = 1\ny = f(a,\n'),
      (e: unknown) => e instanceof SourceError && e.line === 2 && e.col === 6,
    );
  });

  it('лишняя и несовпавшая скобка', () => {
    assert.throws(() => runAnalysis('x = a)'), SourceError);
    assert.throws(() => runAnalysis('x = f(a]'), SourceError);
  });

  it('def без двоеточия', () => {
    assert.throws(() => runAnalysis('def f()\n'), SourceError);
  });
});
