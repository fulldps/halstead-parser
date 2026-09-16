import type { Classified, Role } from '../halstead/index.ts';

interface Props {
  items: Classified[];
}

const ROLE_LABEL: Record<Role, string> = {
  operator: 'оператор',
  operand: 'операнд',
  part: 'часть оператора',
  ignored: 'не учитывается',
};

// Режим для защиты: по каждой лексеме видно, куда и почему она ушла.
export function TokenTable({ items }: Props) {
  return (
    <div className="table-wrap tokens-wrap">
      <table className="tokens">
        <thead>
          <tr>
            <th scope="col" className="num">
              Стр.
            </th>
            <th scope="col" className="num">
              Поз.
            </th>
            <th scope="col">Лексема</th>
            <th scope="col">Тип</th>
            <th scope="col">Роль</th>
            <th scope="col">Учтено как</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ token, role, key }) => (
            // Позиция уникальна для каждой лексемы — стабильный key.
            <tr key={`${token.line}:${token.col}`} className={`role-${role}`}>
              <td className="num">{token.line}</td>
              <td className="num">{token.col}</td>
              <td>
                <code>{token.kind === 'newline' ? '↵' : token.value}</code>
              </td>
              <td>{token.kind}</td>
              <td>{ROLE_LABEL[role]}</td>
              <td>{key}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
