// Печатает таблицы частот TS-парсера в JSON — для сверки с tools/verify_ast.py.
import { readFileSync } from 'node:fs';
import { runAnalysis } from '../src/halstead/index.ts';

const { metrics } = runAnalysis(readFileSync(process.argv[2], 'utf8'));
const table = (rows: { name: string; count: number }[]) =>
  Object.fromEntries(rows.map((row) => [row.name, row.count]));
console.log(JSON.stringify({ operators: table(metrics.operators), operands: table(metrics.operands) }));
