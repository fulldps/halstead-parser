export interface FrequencyRow {
  name: string;
  count: number;
}

export interface HalsteadMetrics {
  operators: FrequencyRow[]; // f1j — по убыванию частоты
  operands: FrequencyRow[]; // f2i — по убыванию частоты
  eta1: number; // словарь операторов
  eta2: number; // словарь операндов
  N1: number; // всего операторов
  N2: number; // всего операндов
  eta: number; // словарь программы η = η1 + η2
  N: number; // длина программы N = N1 + N2
  V: number; // объём программы V = N·log2(η)
}

const sum = (rows: FrequencyRow[]) => rows.reduce((acc, row) => acc + row.count, 0);

function toRows(freq: Map<string, number>): FrequencyRow[] {
  // sort стабильна (ES2019): при равной частоте сохраняется порядок первого появления в коде.
  return [...freq].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export function computeMetrics(
  operators: Map<string, number>,
  operands: Map<string, number>,
): HalsteadMetrics {
  const f1 = toRows(operators);
  const f2 = toRows(operands);
  const eta1 = f1.length;
  const eta2 = f2.length;
  const N1 = sum(f1);
  const N2 = sum(f2);
  const eta = eta1 + eta2;
  const N = N1 + N2;
  // Пустая программа: log2(0) = -Infinity, а 0 * -Infinity = NaN. Объём пустоты — ноль.
  const V = eta > 0 ? N * Math.log2(eta) : 0;
  return { operators: f1, operands: f2, eta1, eta2, N1, N2, eta, N, V };
}
