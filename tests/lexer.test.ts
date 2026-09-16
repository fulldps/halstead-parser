import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SourceError } from '../src/halstead/errors.ts';
import { Lexer, type Token } from '../src/halstead/lexer.ts';

const lex = (src: string) => new Lexer(src).tokenize();
const values = (src: string, kind: Token['kind']) =>
  lex(src)
    .filter((t) => t.kind === kind)
    .map((t) => t.value);

describe('лексер: операторы', () => {
  it('берёт самый длинный оператор (maximal munch)', () => {
    assert.deepEqual(values('a **= b // c == d <= e := f -> ...', 'op'), [
      '**=',
      '//',
      '==',
      '<=',
      ':=',
      '->',
      '...',
    ]);
  });

  it('падает на неизвестном символе, а не пропускает его молча', () => {
    assert.throws(() => lex('x = $'), SourceError);
    assert.throws(() => lex('x = a ! b'), SourceError);
  });
});

describe('лексер: числа', () => {
  it('каждое число — один токен', () => {
    assert.deepEqual(values('0xAB 0o17 0b1010 1e-5 .5 3j 1_000 10. 3.14', 'number'), [
      '0xAB',
      '0o17',
      '0b1010',
      '1e-5',
      '.5',
      '3j',
      '1_000',
      '10.',
      '3.14',
    ]);
  });

  it('точка перед именем — оператор, а не число', () => {
    assert.deepEqual(values('obj.attr', 'op'), ['.']);
  });

  it('отвергает число с прилипшими буквами', () => {
    assert.throws(() => lex('x = 1abc'), SourceError);
    assert.throws(() => lex('x = 0x'), SourceError);
  });
});

describe('лексер: строки и комментарии', () => {
  it('# внутри строки — не комментарий', () => {
    assert.deepEqual(values('s = "цена # за штуку"', 'string'), ['"цена # за штуку"']);
    assert.deepEqual(values('s = "цена # за штуку"', 'comment'), []);
  });

  it('экранированная кавычка не закрывает строку', () => {
    assert.deepEqual(values(String.raw`t = 'don\'t'`, 'string'), [String.raw`'don\'t'`]);
  });

  it('тройные кавычки: переводы строк внутри, номера строк после — верные', () => {
    const tokens = lex('d = """a\nb"""\ny = 1');
    assert.equal(tokens.filter((t) => t.kind === 'string').length, 1);
    assert.equal(tokens.find((t) => t.value === 'y')?.line, 3);
  });

  it('префиксы строк и f-строка с вложенными кавычками', () => {
    assert.deepEqual(values(`r'\\d' b"x" rb'y' f"{d["k"]:>{w}} {{x}}"`, 'string'), [
      `r'\\d'`,
      'b"x"',
      "rb'y'",
      'f"{d["k"]:>{w}} {{x}}"',
    ]);
  });

  it('незакрытая строка — ошибка с позицией начала строки', () => {
    assert.throws(
      () => lex('x = 1\ns = "open'),
      (e: unknown) => e instanceof SourceError && e.line === 2 && e.col === 5,
    );
  });

  it('комментарий идёт до конца строки', () => {
    assert.deepEqual(values('x = 1  # a = b + c', 'comment'), ['# a = b + c']);
    assert.deepEqual(values('x = 1  # a = b + c', 'name'), ['x']);
  });
});

describe('лексер: строки программы', () => {
  const newlines = (src: string) => lex(src).filter((t) => t.kind === 'newline').length;

  it('внутри скобок перевод строки не завершает инструкцию', () => {
    assert.equal(newlines('f(1,\n  2)\n'), 1);
  });

  it('обратный слэш склеивает строки', () => {
    assert.equal(newlines('a = 1 + \\\n    2\n'), 1);
  });

  it('пустые строки и строки-комментарии — не инструкции', () => {
    assert.equal(newlines('\n\n# comment\nx = 1\n\n'), 1);
  });

  it('последняя инструкция без \\n в конце файла всё равно закрывается', () => {
    assert.equal(newlines('x = 1'), 1);
  });

  it('CRLF и BOM не ломают разбор', () => {
    assert.deepEqual(values('\uFEFFx = 1\r\ny = 2\r\n', 'name'), ['x', 'y']);
    assert.equal(newlines('x = 1\r\ny = 2\r\n'), 2);
  });

  it('считает строку и колонку с 1', () => {
    const y = lex('x = 1\n  y = 2').find((t) => t.value === 'y');
    assert.equal(y?.line, 2);
    assert.equal(y?.col, 3);
  });
});

describe('лексер: имена', () => {
  it('отличает ключевые слова от имён, понимает кириллицу', () => {
    const tokens = lex('счётчик = None if ok else 0');
    assert.deepEqual(
      tokens.filter((t) => t.kind === 'keyword').map((t) => t.value),
      ['None', 'if', 'else'],
    );
    assert.deepEqual(
      tokens.filter((t) => t.kind === 'name').map((t) => t.value),
      ['счётчик', 'ok'],
    );
  });

  it('повторный tokenize() даёт тот же результат', () => {
    const lexer = new Lexer('x = 1\n');
    assert.deepEqual(lexer.tokenize(), lexer.tokenize());
  });
});
