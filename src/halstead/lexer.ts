import { SourceError } from './errors.ts';

export type TokenKind = 'name' | 'keyword' | 'number' | 'string' | 'op' | 'newline' | 'comment';

export interface Token {
  kind: TokenKind;
  value: string;
  line: number; // с 1, как в редакторе
  col: number; // с 1
}

// Все операторы и разделители Python (Language Reference, разделы «Operators» и «Delimiters»).
const OPS = [
  '+',
  '-',
  '*',
  '/',
  '//',
  '%',
  '@',
  '**',
  '<<',
  '>>',
  '&',
  '|',
  '^',
  '~',
  ':=',
  '<',
  '>',
  '<=',
  '>=',
  '==',
  '!=',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  ':',
  '.',
  ';',
  '->',
  '...',
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '//=',
  '%=',
  '@=',
  '&=',
  '|=',
  '^=',
  '>>=',
  '<<=',
  '**=',
];

// Длинные раньше коротких (maximal munch), иначе '**=' разберётся как '*' + '*='.
const OPS_SORTED = [...OPS].sort((a, b) => b.length - a.length);

// Set вместо массива: проверка has() не перебирает список на каждом имени.
const KEY_WORDS = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);

// Флаг y (sticky): регулярка матчится строго с lastIndex, а не ищет совпадение дальше по тексту.
const STRING_PREFIX_RE = /(?:rb|br|fr|rf|tr|rt|[rbuft])(?=['"])/iy;
const NUMBER_RE =
  /0[xX](?:_?[0-9a-fA-F])+|0[oO](?:_?[0-7])+|0[bB](?:_?[01])+|(?:(?:\d(?:_?\d)*)?\.\d(?:_?\d)*|\d(?:_?\d)*\.?)(?:[eE][+-]?\d(?:_?\d)*)?[jJ]?/y;
const NAME_RE = /[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}]*/uy;

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isNameStart = (c: string) => /[\p{L}\p{Nl}_]/u.test(c);
const isNamePart = (c: string | undefined) => c !== undefined && /[\p{L}\p{Nd}_]/u.test(c);

export class Lexer {
  private readonly src: string;
  private pos = 0;
  private line = 1;
  private lineStart = 0; // позиция начала текущей физической строки — из неё считается колонка
  private depth = 0; // вложенность скобок: внутри ( [ { перевод строки не завершает инструкцию
  private lineHasTokens = false; // были ли в текущей логической строке значимые токены
  private tokens: Token[] = [];

  constructor(src: string) {
    // BOM и \r\n убираем заранее, чтобы дальше думать только о '\n'.
    this.src = src.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  }

  tokenize(): Token[] {
    // Сброс состояния: повторный вызов должен давать тот же результат, а не продолжать старый.
    this.pos = 0;
    this.line = 1;
    this.lineStart = 0;
    this.depth = 0;
    this.lineHasTokens = false;
    this.tokens = [];

    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === '\n') {
        this.readNewline();
      } else if (c === ' ' || c === '\t' || c === '\f') {
        this.pos++;
      } else if (c === '#') {
        this.readComment();
      } else if (c === '\\') {
        this.readContinuation();
      } else if (c === '"' || c === "'" || this.match(STRING_PREFIX_RE) !== null) {
        this.readString();
      } else if (isDigit(c) || (c === '.' && isDigit(this.src[this.pos + 1]))) {
        this.readNumber();
      } else if (isNameStart(c)) {
        this.readName();
      } else {
        this.readOp();
      }
    }

    // Файл не обязан кончаться переводом строки, но последнюю инструкцию всё равно надо закрыть.
    if (this.lineHasTokens) this.push('newline', '\n', this.line, this.col());
    return this.tokens;
  }

  private readNewline(): void {
    // Внутри скобок перевод строки — продолжение выражения (неявное соединение строк).
    // Пустая строка или строка из одного комментария инструкцией не является.
    if (this.depth === 0 && this.lineHasTokens) {
      this.push('newline', '\n', this.line, this.col());
      this.lineHasTokens = false;
    }
    this.pos++;
    this.nextLine();
  }

  private readComment(): void {
    const line = this.line;
    const col = this.col();
    const end = this.src.indexOf('\n', this.pos);
    const stop = end === -1 ? this.src.length : end;
    this.push('comment', this.src.slice(this.pos, stop), line, col);
    this.pos = stop; // сам '\n' не съедаем — его разберёт основной цикл
  }

  private readContinuation(): void {
    // '\' в самом конце строки склеивает её со следующей: для парсера перевода строки нет.
    if (this.src[this.pos + 1] !== '\n') this.fail('символ «\\» допустим только в конце строки');
    this.pos += 2;
    this.nextLine();
  }

  private readString(): void {
    const line = this.line;
    const col = this.col();
    const start = this.pos;
    const prefix = (this.match(STRING_PREFIX_RE) ?? '').toLowerCase();
    this.pos += prefix.length;
    // f-строки (и t-строки из Python 3.14) целиком — один операнд, но их {выражения} надо
    // пройти аккуратно: внутри них могут быть кавычки, которые строку НЕ закрывают.
    const isTemplate = prefix.includes('f') || prefix.includes('t');
    this.skipStringBody(isTemplate, line, col);
    this.push('string', this.src.slice(start, this.pos), line, col);
  }

  // На входе pos стоит на открывающей кавычке, на выходе — сразу за закрывающей.
  private skipStringBody(isTemplate: boolean, line: number, col: number): void {
    const quote = this.src[this.pos];
    const closing = this.src.startsWith(quote.repeat(3), this.pos) ? quote.repeat(3) : quote;
    const triple = closing.length === 3;
    this.pos += closing.length;
    let braces = 0; // глубина {выражения} внутри f-строки

    while (true) {
      if (this.pos >= this.src.length) this.fail('строка не закрыта', line, col);
      const c = this.src[this.pos];

      if (c === '\\') {
        // Экранированный символ строку не закрывает — даже в r-строках, как и в самом Python.
        if (this.src[this.pos + 1] === '\n') {
          this.pos += 2;
          this.nextLine();
        } else {
          this.pos += 2;
        }
        continue;
      }
      if (c === '\n') {
        if (!triple && braces === 0) this.fail('строка не закрыта до конца строки', line, col);
        this.pos++;
        this.nextLine();
        continue;
      }
      if (isTemplate) {
        const doubled = this.src[this.pos + 1] === c;
        if (braces === 0 && (c === '{' || c === '}') && doubled) {
          this.pos += 2; // {{ и }} — экранированные фигурные скобки, это просто текст
          continue;
        }
        if (c === '{') {
          braces++;
          this.pos++;
          continue;
        }
        if (c === '}' && braces > 0) {
          braces--;
          this.pos++;
          continue;
        }
        if (braces > 0 && (c === '"' || c === "'")) {
          this.skipStringBody(false, this.line, this.col()); // вложенная строка: f"{d["k"]}"
          continue;
        }
      }
      if (braces === 0 && this.src.startsWith(closing, this.pos)) {
        this.pos += closing.length;
        return;
      }
      this.pos++;
    }
  }

  private readNumber(): void {
    const line = this.line;
    const col = this.col();
    const value = this.match(NUMBER_RE) ?? this.fail('некорректное число');
    this.pos += value.length;
    // «1abc», «0x», «1e» — к числу прилипли буквы. Python такое отвергает, и мы тоже.
    if (isNamePart(this.src[this.pos])) this.fail(`некорректное число «${value}…»`);
    this.push('number', value, line, col);
  }

  private readName(): void {
    const line = this.line;
    const col = this.col();
    const value = this.match(NAME_RE) ?? this.fail('некорректное имя');
    this.pos += value.length;
    this.push(KEY_WORDS.has(value) ? 'keyword' : 'name', value, line, col);
  }

  private readOp(): void {
    const line = this.line;
    const col = this.col();
    const op =
      OPS_SORTED.find((o) => this.src.startsWith(o, this.pos)) ??
      this.fail(`неизвестный символ «${this.src[this.pos]}»`);
    // Парность скобок проверяет анализатор; лексеру глубина нужна только для переводов строк.
    if (op === '(' || op === '[' || op === '{') this.depth++;
    else if ((op === ')' || op === ']' || op === '}') && this.depth > 0) this.depth--;
    this.pos += op.length;
    this.push('op', op, line, col);
  }

  private match(re: RegExp): string | null {
    re.lastIndex = this.pos;
    return re.exec(this.src)?.[0] ?? null;
  }

  private push(kind: TokenKind, value: string, line: number, col: number): void {
    this.tokens.push({ kind, value, line, col });
    if (kind !== 'comment' && kind !== 'newline') this.lineHasTokens = true;
  }

  private nextLine(): void {
    this.line++;
    this.lineStart = this.pos;
  }

  private col(): number {
    return this.pos - this.lineStart + 1;
  }

  // Тип never: TS понимает, что после вызова код не продолжается, поэтому `x ?? this.fail()` — string.
  private fail(message: string, line = this.line, col = this.col()): never {
    throw new SourceError(message, line, col);
  }
}
