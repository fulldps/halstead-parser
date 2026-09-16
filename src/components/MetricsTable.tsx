import type { FrequencyRow, HalsteadMetrics } from '../halstead/index.ts';

interface Props {
  metrics: HalsteadMetrics;
}

// Повторяет таблицу 2 из методички: операторы и операнды — в соседних колонках одной таблицы.
// Нумерация j и i у каждого списка своя, поэтому разная длина списков её не сбивает.
export function MetricsTable({ metrics: m }: Props) {
  const rows = Math.max(m.operators.length, m.operands.length);
  return (
    <div className="table-wrap">
      <table className="freq">
        <thead>
          <tr>
            <th scope="col" className="num">
              j
            </th>
            <th scope="col">Оператор</th>
            <th scope="col" className="num">
              f<sub>1j</sub>
            </th>
            <th scope="col" className="num split">
              i
            </th>
            <th scope="col">Операнд</th>
            <th scope="col" className="num">
              f<sub>2i</sub>
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            // Строки позиционные и не переставляются — индекс как key здесь корректен.
            <tr key={r}>
              <Cells row={m.operators[r]} index={r} />
              <Cells row={m.operands[r]} index={r} split />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>
              η<sub>1</sub> = {m.eta1}
            </td>
            <td className="num">
              N<sub>1</sub> = {m.N1}
            </td>
            <td colSpan={2} className="split">
              η<sub>2</sub> = {m.eta2}
            </td>
            <td className="num">
              N<sub>2</sub> = {m.N2}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

interface CellsProps {
  // За концом более короткого списка индекс даёт undefined — тип говорит об этом явно.
  row: FrequencyRow | undefined;
  index: number;
  split?: boolean;
}

function Cells({ row, index, split = false }: CellsProps) {
  const first = split ? 'num split' : 'num';
  if (row === undefined) {
    return (
      <>
        <td className={first} />
        <td />
        <td />
      </>
    );
  }
  return (
    <>
      <td className={first}>{index + 1}.</td>
      <td>
        <code>{row.name}</code>
      </td>
      <td className="num">{row.count}</td>
    </>
  );
}
