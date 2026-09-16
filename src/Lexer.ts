export type TokenKind = 'name' | 'number' | 'string' | 'op' | 'keyword' | 'newline' | 'comment';

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
}

const OPS = [
  '+',
  '-',
  '*',
  '/',
  '%',
  '.',
  ',',
  ':',
  ';',
  '&',
  '~',
  '|',
  '^',
  '=',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '<',
  '>',
  '//',
  '**',
  '!=',
  '*=',
  '%=',
  '/=',
  '@=',
  '^=',
  '|=',
  '&=',
  '-=',
  '+=',
  '->',
  '>>',
  '<<',
  '//=',
  '>>=',
  '<<=',
  '**=',
  '...',
];

const KEY_WORDS = [
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
];

const OPS_SORTED = [...OPS].sort((a, b) => b.length - a.length);

export class Lexer {
  private pos = 0;
  private line = 0;
  private src: string;
  private tokens: Token[] = [];

  constructor(src: string) {
    this.src = src;
  }

  tokenize(): Token[] {
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === '\n') {
        this.tokens.push({ kind: 'newline', value: ' ', line: this.line });
        this.pos++;
      } else if (c === ' ' || c === '\t') {
        this.pos++;
        continue;
      } else if (c === '#') {
        this.tokens.push({ kind: 'comment', value: c, line: this.line });
        this.pos++;
      } else if (c === '"' || c === "'") {
        this.readString();
      } else if (/[0-9]/.test(c)) {
        this.tokens.push(this.readNumber());
      } else if (/[a-zA-Z_]/.test(c)) {
        this.tokens.push(this.readName());
      } else {
        this.readOp();
      }
    }

    return this.tokens;
  }

  private peek(): string {
    return this.src[this.pos];
    this.pos++;
  }

  // TODO:
  private readString(): void {
    this.pos++;
  }

  private readNumber(): Token {
    let c = this.src[this.pos];
    const start = this.pos;
    while (
      /[0-9]/.test(c) ||
      c === '_' ||
      c === '.' ||
      c === 'x' ||
      c === 'f' ||
      c === 'e' ||
      c === 'E' ||
      c === 'b' ||
      c === 'o'
    ) {
      this.pos++;
      c = this.src[this.pos];
    }

    return { kind: 'number', value: this.src.slice(start, this.pos), line: this.line };
  }

  private readName(): Token {
    let c = this.src[this.pos];
    const start = this.pos;
    while (/[a-zA-Z0-9_]/.test(c)) {
      this.pos++;
      c = this.src[this.pos];
    }

    return { kind: 'name', value: this.src.slice(start, this.pos), line: this.line };
  }

  private readOp(): void {
    this.pos++;
  }
}
