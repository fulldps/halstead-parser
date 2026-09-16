import type { HalsteadMetrics } from '../halstead/index.ts';

interface Props {
  metrics: HalsteadMetrics;
}

// Округляем только при выводе: в модели V хранится точным, иначе потеряется точность сверки.
const decimal = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function DerivedMetrics({ metrics: m }: Props) {
  return (
    <dl className="derived">
      <div>
        <dt>Словарь программы</dt>
        <dd>
          η = η<sub>1</sub> + η<sub>2</sub> = {m.eta1} + {m.eta2} = <strong>{m.eta}</strong>
        </dd>
      </div>
      <div>
        <dt>Длина программы</dt>
        <dd>
          N = N<sub>1</sub> + N<sub>2</sub> = {m.N1} + {m.N2} = <strong>{m.N}</strong>
        </dd>
      </div>
      <div>
        <dt>Объём программы, бит</dt>
        <dd>
          V = N·log<sub>2</sub>η = {m.N}·log<sub>2</sub>
          {m.eta} = <strong>{decimal.format(m.V)}</strong> ≈ {Math.round(m.V)}
        </dd>
      </div>
    </dl>
  );
}
