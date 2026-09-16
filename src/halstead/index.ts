import { analyze, type Classified, type Role } from './analyzer.ts';
import { Lexer } from './lexer.ts';
import { computeMetrics, type HalsteadMetrics } from './metrics.ts';

export { KEYS, type Classified, type Role } from './analyzer.ts';
export { SourceError } from './errors.ts';
export type { FrequencyRow, HalsteadMetrics } from './metrics.ts';

export interface AnalysisResult {
  metrics: HalsteadMetrics;
  items: Classified[];
}

// Весь конвейер: текст → токены → разметка → метрики. Никакого React — чистая функция.
export function runAnalysis(source: string): AnalysisResult {
  const tokens = new Lexer(source).tokenize();
  const { items, operators, operands } = analyze(tokens);
  const metrics = computeMetrics(operators, operands);

  // Сверка двумя независимыми путями: по таблицам частот и по разметке токенов.
  const byRole = (role: Role) => items.filter((item) => item.role === role).length;
  if (metrics.N1 !== byRole('operator') || metrics.N2 !== byRole('operand')) {
    throw new Error('Внутренняя ошибка: N1/N2 не сходятся с разметкой токенов');
  }
  return { metrics, items };
}
