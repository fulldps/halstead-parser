// Ошибка во входном Python-коде. Несёт позицию, чтобы UI мог показать, где именно проблема.
export class SourceError extends Error {
  readonly line: number;
  readonly col: number;

  constructor(message: string, line: number, col: number) {
    super(`Строка ${line}, позиция ${col}: ${message}`);
    this.name = 'SourceError';
    this.line = line;
    this.col = col;
  }
}
