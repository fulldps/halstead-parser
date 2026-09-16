// Пример 1 из «Метрик размера программ», переведённый с Паскаля на Python построчно.
// Repeat…Until в Python нет — ближайший аналог: while True + if … break.
export const SAMPLE = `eps = 0.0001
x = float(input())
y = x  # начальные установки
n = 2
vs = x
while True:
    vs = -vs * x * x / (2 * n - 1) / (2 * n - 2)  # формирование слагаемого
    n = n + 1
    y = y + vs
    if abs(vs) < eps:  # выход из цикла по выполнению условия
        break
print(x, y, eps)
`;
