import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { KEYS, runAnalysis } from '../src/halstead/index.ts';
import { computeMetrics } from '../src/halstead/metrics.ts';
import { SAMPLE } from '../src/sample.ts';

describe('формулы на таблице 2 из PDF (Паскаль)', () => {
  // Частоты взяты из PDF как есть — проверяем формулы отдельно от разбора Python.
  const f1 = new Map([
    [';', 7],
    [':=', 6],
    ['*', 4],
    ['–', 3],
    ['/', 2],
    ['( )', 2],
    ['+', 2],
    ['Begin…End', 1],
    ['Readln ( )', 1],
    ['Repeat…Until', 1],
    ['abs( )', 1],
    ['<', 1],
    ['Writeln ( )', 1],
    ['.', 1],
  ]);
  const f2 = new Map([
    ['x', 6],
    ['n', 5],
    ['vs', 5],
    ['y', 4],
    ['2', 4],
    ['1', 2],
    ['eps', 2],
  ]);
  const m = computeMetrics(f1, f2);

  it('6 базовых: η1 = 14, η2 = 7, N1 = 33, N2 = 28', () => {
    assert.deepEqual([m.eta1, m.eta2, m.N1, m.N2], [14, 7, 33, 28]);
  });

  it('3 расширенных: η = 21, N = 61, V = 268', () => {
    assert.equal(m.eta, 21);
    assert.equal(m.N, 61);
    assert.equal(Math.round(m.V), 268); // с Math.log вместо Math.log2 вышло бы 186
  });

  it('таблица отсортирована по убыванию, равные — в порядке появления', () => {
    assert.deepEqual(
      m.operators.slice(0, 3).map((r) => r.name),
      [';', ':=', '*'],
    );
    assert.deepEqual(
      m.operators.slice(-3).map((r) => r.name),
      ['<', 'Writeln ( )', '.'],
    );
  });
});

describe('пример 1, переведённый на Python', () => {
  const { metrics: m } = runAnalysis(SAMPLE);
  const table = (rows: { name: string; count: number }[]) =>
    Object.fromEntries(rows.map((r) => [r.name, r.count]));

  it('операторы (сосчитано вручную до запуска)', () => {
    assert.deepEqual(table(m.operators), {
      [KEYS.newline]: 10,
      '=': 8,
      '*': 4,
      '-': 3,
      '/': 2,
      '( )': 2,
      '+': 2,
      'float( )': 1,
      'input( )': 1,
      [KEYS.while]: 1,
      [KEYS.if]: 1,
      'abs( )': 1,
      '<': 1,
      break: 1,
      'print( )': 1,
    });
  });

  it('операнды: x, n, vs, y, 2, 1 совпадают с PDF', () => {
    assert.deepEqual(table(m.operands), {
      x: 6,
      n: 5,
      vs: 5,
      y: 4,
      '2': 4,
      eps: 3, // в PDF 2: там eps объявлена в разделе Const, который не анализируется
      '1': 2,
      '0.0001': 1,
      True: 1,
    });
  });

  it('метрики', () => {
    assert.deepEqual([m.eta1, m.eta2, m.N1, m.N2, m.eta, m.N], [15, 9, 39, 31, 24, 70]);
    assert.equal(m.V.toFixed(2), '320.95');
  });
});

describe('свойства', () => {
  it('программа, повторённая дважды: N удваивается, словари не меняются', () => {
    const one = runAnalysis(SAMPLE).metrics;
    const two = runAnalysis(SAMPLE + SAMPLE).metrics;
    assert.deepEqual([two.eta1, two.eta2], [one.eta1, one.eta2]);
    assert.deepEqual([two.N1, two.N2], [one.N1 * 2, one.N2 * 2]);
    assert.ok(Math.abs(two.V - one.V * 2) < 1e-9);
  });

  it('повторный расчёт даёт те же числа (счётчики не живут между запусками)', () => {
    assert.deepEqual(runAnalysis(SAMPLE).metrics, runAnalysis(SAMPLE).metrics);
  });
});
