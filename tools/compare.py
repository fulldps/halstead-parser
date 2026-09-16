"""Сверка двух независимых подсчётов: TS-парсер (поток токенов) и verify_ast.py (дерево AST).

Запуск из корня проекта: python3 tools/compare.py examples/warehouse.py
"""
import json
import math
import pathlib
import subprocess
import sys

TOOLS = pathlib.Path(__file__).parent


def metrics(freq):
    e1, e2 = len(freq['operators']), len(freq['operands'])
    n1, n2 = sum(freq['operators'].values()), sum(freq['operands'].values())
    return f'η1={e1} η2={e2} N1={n1} N2={n2} η={e1 + e2} N={n1 + n2} ' \
           f'V={(n1 + n2) * math.log2(e1 + e2):.2f}'


path = sys.argv[1]
ts = json.loads(subprocess.check_output(['node', TOOLS / 'ts-dump.ts', path]))
py = json.loads(subprocess.check_output([sys.executable, TOOLS / 'verify_ast.py', path]))

same = True
for part in ('operators', 'operands'):
    for key in sorted(set(ts[part]) | set(py[part])):
        if ts[part].get(key) != py[part].get(key):
            same = False
            print(f'{part}: {key!r}: TS={ts[part].get(key)} AST={py[part].get(key)}')

print('TS :', metrics(ts))
print('AST:', metrics(py))
print('Совпадает' if same else 'Есть расхождения')
sys.exit(0 if same else 1)
