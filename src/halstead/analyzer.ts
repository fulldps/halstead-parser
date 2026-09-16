import { SourceError } from './errors.ts';
import type { Token } from './lexer.ts';

// operator/operand — учитывается в таблице; part — входит в чужой оператор (else в if…else,
// скобки вызова в f( )); ignored — не учитывается вовсе (комментарий, запятая).
export type Role = 'operator' | 'operand' | 'part' | 'ignored';

export interface Classified {
  token: Token;
  role: Role;
  // operator/operand — ключ в таблице частот; part — к какому оператору относится;
  // ignored — почему не учтён.
  key: string;
}

export interface Analysis {
  items: Classified[];
  operators: Map<string, number>;
  operands: Map<string, number>;
}

// Ключи составных операторов. Все служебные слова одной конструкции — один оператор (PDF).
export const KEYS = {
  if: 'if…elif…else',
  ifExpr: 'if…else (условное выражение)',
  ifFilter: 'if (фильтр генератора)',
  for: 'for…in…else',
  forComp: 'for…in (генератор)',
  while: 'while…else',
  try: 'try…except…finally',
  with: 'with…as',
  match: 'match…case',
  import: 'import…as',
  fromImport: 'from…import…as',
  paren: '( )',
  bracket: '[ ]',
  brace: '{ }',
  slice: ': (срез)',
  newline: '↵ (конец инструкции)',
} as const;

type FrameKind = 'call' | 'group' | 'index' | 'brace';

interface Frame {
  kind: FrameKind;
  key: string; // к какому оператору относится закрывающая скобка
  token: Token;
}

interface Header {
  depth: number;
  key: string;
  stmtAfter: boolean; // после «def f():» может идти инструкция, после «lambda x:» — выражение
}

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

const isOp = (t: Token | null | undefined, value: string) => t?.kind === 'op' && t.value === value;
const isKw = (t: Token | null | undefined, value: string) =>
  t?.kind === 'keyword' && t.value === value;

export function analyze(tokens: Token[]): Analysis {
  return new Analyzer(tokens).run();
}

class Analyzer {
  private readonly tokens: Token[];
  private readonly items: (Classified | undefined)[];
  private readonly operators = new Map<string, number>();
  private readonly operands = new Map<string, number>();

  private stack: Frame[] = []; // открытые скобки
  private prev: Token | null = null; // предыдущий значимый токен логической строки
  private lineStart = true; // текущий токен — первый в логической строке
  private stmtStart = true; // текущий токен — первый в инструкции (после начала строки, «;» или «:»)
  private nextStmtStart = false;
  private isDecoratorLine = false;
  private lineHead: string | null = null; // оператор, которому принадлежит «:» заголовка блока
  private header: Header | null = null; // идём по заголовку def/class/lambda
  private callName: string | null = null; // следующая «(» — скобка вызова этого оператора
  private kwarg = false; // следующий «=» — это name=value в аргументах вызова
  private absorbNext: string | null = null; // «in» после «not», «not» после «is»
  private asyncIndex: number | null = null;
  private pendingIn = new Map<number, string>(); // глубина скобок → for, ждущий своего in
  private comprehension = new Set<number>(); // глубины, где уже был for генератора

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.items = new Array<Classified | undefined>(tokens.length);
  }

  run(): Analysis {
    for (let i = 0; i < this.tokens.length; i++) {
      i = this.visit(i);
    }

    // Инвариант: каждый токен размечен ровно один раз. Дыра = баг анализатора, а не входа.
    const items: Classified[] = [];
    for (let i = 0; i < this.tokens.length; i++) {
      const item = this.items[i];
      if (item === undefined) {
        const t = this.tokens[i];
        throw new Error(`Внутренняя ошибка: токен «${t.value}» (${t.line}:${t.col}) не размечен`);
      }
      items.push(item);
    }
    return { items, operators: this.operators, operands: this.operands };
  }

  // Возвращает индекс последнего обработанного токена: некоторые конструкции съедают несколько.
  private visit(i: number): number {
    const t = this.tokens[i];

    if (t.kind === 'comment') {
      this.set(i, 'ignored', 'комментарий');
      return i;
    }
    if (t.kind === 'newline') {
      this.visitNewline(i);
      return i;
    }
    if (this.lineStart) {
      const end = this.docstringEnd(i);
      if (end !== null) {
        for (let k = i; k <= end; k++) {
          this.set(k, 'ignored', this.tokens[k].kind === 'comment' ? 'комментарий' : 'docstring');
        }
        this.resetLine();
        return end;
      }
    }

    let last = i;
    this.nextStmtStart = false;
    if (this.header !== null) this.visitHeader(i, this.header);
    else if (t.kind === 'op') last = this.visitOp(i);
    else if (t.kind === 'keyword') this.visitKeyword(i);
    else if (t.kind === 'name') this.visitName(i);
    else this.count(i, 'operand', t.value); // number, string

    this.prev = this.tokens[last];
    this.lineStart = false;
    this.stmtStart = this.nextStmtStart;
    return last;
  }

  // Конец логической строки — аналог «;» Паскаля: разделитель инструкций.
  private visitNewline(i: number): void {
    const open = this.stack.at(-1);
    if (open !== undefined) {
      throw new SourceError(`скобка «${open.token.value}» не закрыта`, open.token.line, open.token.col);
    }
    if (this.header !== null) {
      const t = this.tokens[i];
      throw new SourceError(`после заголовка ${this.header.key} ожидалось «:»`, t.line, t.col);
    }
    if (this.isDecoratorLine) this.set(i, 'ignored', 'конец строки декоратора');
    else if (isOp(this.prev, ':')) this.set(i, 'ignored', 'конец заголовка блока');
    else this.count(i, 'operator', KEYS.newline);
    this.resetLine();
  }

  // def/class/lambda: всё до «:» — объявление (имя, параметры, аннотации). Как заголовок
  // процедуры в Паскале, который по методике Холстеда не анализируется.
  private visitHeader(i: number, header: Header): void {
    const t = this.tokens[i];
    if (t.kind === 'op') {
      if (t.value in PAIRS) {
        this.stack.push({ kind: 'group', key: header.key, token: t });
      } else if (t.value === ')' || t.value === ']' || t.value === '}') {
        this.close(i);
      } else if (t.value === ':' && this.stack.length === header.depth) {
        this.header = null;
        this.nextStmtStart = header.stmtAfter;
      }
    }
    this.set(i, 'part', header.key);
  }

  private visitOp(i: number): number {
    const t = this.tokens[i];
    switch (t.value) {
      case '(':
        this.openParen(i);
        return i;
      case '[':
        this.stack.push({ kind: 'index', key: KEYS.bracket, token: t });
        this.count(i, 'operator', KEYS.bracket);
        return i;
      case '{':
        this.stack.push({ kind: 'brace', key: KEYS.brace, token: t });
        this.count(i, 'operator', KEYS.brace);
        return i;
      case ')':
      case ']':
      case '}':
        // Пара скобок — один оператор, он уже учтён на открывающей.
        this.set(i, 'part', this.close(i).key);
        return i;
      case ',':
        // Как в примере PDF: в Writeln (x, y, eps) запятые не считаются.
        this.set(i, 'ignored', 'разделитель');
        return i;
      case ':':
        this.visitColon(i);
        return i;
      case '=':
        if (this.kwarg) {
          this.kwarg = false;
          this.set(i, 'ignored', 'имя=значение в вызове');
        } else {
          this.count(i, 'operator', '=');
        }
        return i;
      case ';':
        this.count(i, 'operator', ';');
        this.nextStmtStart = true;
        return i;
      case '...':
        this.count(i, 'operand', '...'); // Ellipsis — константа
        return i;
      case '@':
        if (this.stmtStart) return this.visitDecorator(i);
        this.count(i, 'operator', '@');
        return i;
      default:
        // Унарный и бинарный минус — один оператор, как «–» в примере PDF. То же для * и **.
        this.count(i, 'operator', t.value);
        return i;
    }
  }

  private openParen(i: number): void {
    const t = this.tokens[i];
    if (this.callName !== null) {
      // Скобки вызова входят в оператор «f( )» (как Readln ( ) в PDF) и отдельно не считаются.
      this.stack.push({ kind: 'call', key: this.callName, token: t });
      this.set(i, 'part', this.callName);
      this.callName = null;
    } else if (isOp(this.prev, ')') || isOp(this.prev, ']')) {
      // handlers[0](x), f(x)(y) — вызов результата выражения: имени нет, это просто пара скобок.
      this.stack.push({ kind: 'call', key: KEYS.paren, token: t });
      this.count(i, 'operator', KEYS.paren);
    } else {
      this.stack.push({ kind: 'group', key: KEYS.paren, token: t });
      this.count(i, 'operator', KEYS.paren);
    }
  }

  private close(i: number): Frame {
    const t = this.tokens[i];
    const frame = this.stack.pop();
    if (frame === undefined) {
      throw new SourceError(`лишняя закрывающая скобка «${t.value}»`, t.line, t.col);
    }
    const open = frame.token;
    if (PAIRS[open.value] !== t.value) {
      throw new SourceError(
        `скобка «${open.value}» из строки ${open.line} закрыта символом «${t.value}»`,
        t.line,
        t.col,
      );
    }
    // Всё, что было открыто внутри этих скобок, закончилось вместе с ними.
    const inner = this.stack.length + 1;
    this.pendingIn.delete(inner);
    this.comprehension.delete(inner);
    return frame;
  }

  private visitColon(i: number): void {
    const top = this.stack.at(-1);
    if (top?.kind === 'index') {
      this.count(i, 'operator', KEYS.slice);
    } else if (top === undefined && this.lineHead !== null) {
      // «:» заголовка блока — часть своего составного оператора; после него может идти инструкция.
      this.set(i, 'part', this.lineHead);
      this.lineHead = null;
      this.nextStmtStart = true;
    } else {
      this.set(i, 'ignored', 'разделитель'); // словарь {k: v}, аннотация x: int
    }
  }

  // @name, @a.b, @name(args): имя декоратора целиком — один оператор, как вызов функции.
  private visitDecorator(i: number): number {
    this.isDecoratorLine = true;
    const parts: number[] = [];
    let key = '@';
    let k = this.nextIndex(i);
    while (k !== -1 && this.tokens[k].kind === 'name') {
      key += this.tokens[k].value;
      parts.push(k);
      const dot = this.nextIndex(k);
      if (dot === -1 || !isOp(this.tokens[dot], '.')) break;
      key += '.';
      parts.push(dot);
      k = this.nextIndex(dot);
    }
    const last = parts.at(-1) ?? i;
    if (isOp(this.peek(last), '(')) {
      key += '( )';
      this.callName = key;
    }
    this.count(i, 'operator', key);
    for (const p of parts) this.set(p, 'part', key);
    return last;
  }

  private visitName(i: number): void {
    const t = this.tokens[i];
    const next = this.peek(i);

    if (this.stmtStart && (t.value === 'match' || t.value === 'case') && this.isSoftKeyword(i)) {
      if (t.value === 'match') this.count(i, 'operator', KEYS.match);
      else this.set(i, 'part', KEYS.match);
      this.lineHead = KEYS.match;
      return;
    }
    if (isOp(next, '(')) {
      // Имя функции — оператор (PDF: «имена процедур и функций»), её скобки войдут в него же.
      this.callName = `${t.value}( )`;
      this.count(i, 'operator', this.callName);
      return;
    }
    if (isOp(next, '=') && this.stack.at(-1)?.kind === 'call') {
      // f(key=1): key — не переменная программы, а имя параметра. Учитывается только значение.
      this.kwarg = true;
      this.set(i, 'ignored', 'имя=значение в вызове');
      return;
    }
    this.count(i, 'operand', t.value);
  }

  private visitKeyword(i: number): void {
    const t = this.tokens[i];
    const next = this.peek(i);
    const depth = this.stack.length;

    switch (t.value) {
      case 'True':
      case 'False':
      case 'None':
        this.count(i, 'operand', t.value);
        return;

      case 'if':
        if (this.stmtStart) {
          this.count(i, 'operator', KEYS.if);
          this.lineHead = KEYS.if;
        } else if (this.comprehension.has(depth)) {
          this.count(i, 'operator', KEYS.ifFilter);
        } else {
          this.count(i, 'operator', KEYS.ifExpr);
        }
        return;
      case 'elif':
        // elif = else + вложенный if: в Паскале это был бы ещё один If…Then…Else.
        this.count(i, 'operator', KEYS.if);
        this.lineHead = KEYS.if;
        return;
      case 'else':
        // else — часть if/for/while/try или тернарника; отдельно не считается ни в одном случае.
        this.set(i, 'part', 'ветка else');
        if (this.stmtStart) this.lineHead = 'ветка else';
        return;

      case 'for': {
        const key = this.operator(i, this.stmtStart ? KEYS.for : KEYS.forComp);
        if (this.stmtStart) this.lineHead = key;
        else this.comprehension.add(depth);
        this.pendingIn.set(depth, key);
        return;
      }
      case 'in': {
        if (this.absorb(i)) return;
        const owner = this.pendingIn.get(depth);
        if (owner !== undefined) {
          this.pendingIn.delete(depth);
          this.set(i, 'part', owner); // in из «for x in xs» — часть for, как To в For…To…Do
        } else {
          this.count(i, 'operator', 'in');
        }
        return;
      }
      case 'not':
        if (this.absorb(i)) return;
        this.twoWord(i, isKw(next, 'in') ? 'not in' : null, 'not');
        return;
      case 'is':
        this.twoWord(i, isKw(next, 'not') ? 'is not' : null, 'is');
        return;

      case 'while':
        this.count(i, 'operator', KEYS.while);
        this.lineHead = KEYS.while;
        return;
      case 'try':
        this.count(i, 'operator', KEYS.try);
        this.lineHead = KEYS.try;
        return;
      case 'except':
      case 'finally':
        this.set(i, 'part', KEYS.try);
        this.lineHead = KEYS.try;
        return;
      case 'with':
        this.lineHead = this.operator(i, KEYS.with);
        return;
      case 'as':
        this.set(i, 'part', this.lineHead ?? 'as');
        return;

      case 'import':
        if (this.stmtStart) {
          this.count(i, 'operator', KEYS.import);
          this.lineHead = KEYS.import;
        } else {
          this.set(i, 'part', KEYS.fromImport);
        }
        return;
      case 'from':
        if (this.stmtStart) {
          this.count(i, 'operator', KEYS.fromImport);
          this.lineHead = KEYS.fromImport;
        } else {
          this.set(i, 'part', 'raise…from / yield from');
        }
        return;

      case 'def':
      case 'class':
        this.header = { depth, key: this.operator(i, t.value), stmtAfter: true };
        return;
      case 'lambda':
        this.count(i, 'operator', 'lambda');
        this.header = { depth, key: 'lambda', stmtAfter: false };
        return;
      case 'async':
        // async def / async for / async with — одна конструкция. Ключ допишем на следующем слове.
        this.set(i, 'part', 'async');
        this.asyncIndex = i;
        return;

      default:
        // return, pass, break, continue, raise, del, assert, global, nonlocal, yield, await,
        // and, or — простые операторы, ключ совпадает со словом.
        this.count(i, 'operator', t.value);
    }
  }

  // Считает оператор с учётом стоящего перед ним async и возвращает итоговый ключ.
  private operator(i: number, key: string): string {
    if (this.asyncIndex !== null) {
      key = `async ${key}`;
      this.set(this.asyncIndex, 'part', key);
      this.asyncIndex = null;
    }
    this.count(i, 'operator', key);
    return key;
  }

  private twoWord(i: number, pair: string | null, single: string): void {
    this.count(i, 'operator', pair ?? single);
    this.absorbNext = pair; // второе слово пары станет частью этого оператора
  }

  private absorb(i: number): boolean {
    if (this.absorbNext === null) return false;
    this.set(i, 'part', this.absorbNext);
    this.absorbNext = null;
    return true;
  }

  // match/case — «мягкие» ключевые слова: могут быть и именами переменных (match = re.match(...)).
  // Ключевое слово — только если дальше в строке есть «:» вне скобок и это не присваивание.
  private isSoftKeyword(i: number): boolean {
    const next = this.peek(i);
    if (next === undefined || next.kind === 'newline') return false;
    if (isOp(next, ':') || isOp(next, '=') || isOp(next, '.')) return false;
    let depth = 0;
    for (let k = i + 1; k < this.tokens.length; k++) {
      const t = this.tokens[k];
      if (t.kind === 'newline') return false;
      if (t.kind !== 'op') continue;
      if (t.value in PAIRS) depth++;
      else if (t.value === ')' || t.value === ']' || t.value === '}') depth--;
      else if (depth === 0 && t.value === ':') return true;
      else if (depth === 0 && t.value === '=') return false;
    }
    return false;
  }

  // Строка только из строковых литералов — docstring или «многострочный комментарий».
  private docstringEnd(i: number): number | null {
    for (let k = i; k < this.tokens.length; k++) {
      const { kind } = this.tokens[k];
      if (kind === 'newline') return k;
      if (kind !== 'string' && kind !== 'comment') return null;
    }
    return null;
  }

  private resetLine(): void {
    this.prev = null;
    this.lineStart = true;
    this.stmtStart = true;
    this.isDecoratorLine = false;
    this.lineHead = null;
    this.header = null;
    this.callName = null;
    this.kwarg = false;
    this.absorbNext = null;
    this.asyncIndex = null;
    this.pendingIn.clear();
    this.comprehension.clear();
  }

  private nextIndex(i: number): number {
    for (let k = i + 1; k < this.tokens.length; k++) {
      if (this.tokens[k].kind !== 'comment') return k;
    }
    return -1;
  }

  private peek(i: number): Token | undefined {
    const k = this.nextIndex(i);
    return k === -1 ? undefined : this.tokens[k];
  }

  private count(i: number, role: 'operator' | 'operand', key: string): void {
    const freq = role === 'operator' ? this.operators : this.operands;
    freq.set(key, (freq.get(key) ?? 0) + 1);
    this.set(i, role, key);
  }

  private set(i: number, role: Role, key: string): void {
    this.items[i] = { token: this.tokens[i], role, key };
  }
}
