import math
from collections import Counter as Tally

TAX = 0.2
LIMIT = 5
operations = 0


class StockError(Exception):
    pass


class Product:
    def __init__(self, sku, title, price, qty):
        self.sku = sku
        self.title = title
        self.price = price
        self.qty = qty

    def cost(self):
        return self.price * self.qty

    def is_low(self):
        return 0 < self.qty <= LIMIT


class Session:
    def __enter__(self):
        self.log = []
        return self

    def __exit__(self, kind, value, trace):
        print("Записей за смену:", len(self.log))
        return False


def logged(func):
    calls = 0

    def wrapper(*args):
        nonlocal calls
        calls += 1
        print("Вызов", func.__name__, calls)
        return func(*args)

    return wrapper


@logged
def add_stock(store, item, amount):
    global operations
    assert amount > 0, "Количество должно быть больше нуля"
    operations += 1
    if item.sku in store:
        store[item.sku].qty += amount
    else:
        store[item.sku] = item


def remove_stock(store, sku, amount):
    global operations
    if sku not in store:
        raise StockError("Нет товара " + sku)
    product = store[sku]
    if product.qty < amount or amount <= 0:
        return False
    product.qty -= amount
    operations += 1
    if product.qty == 0:
        del store[sku]
    return True


def with_tax(price):
    return round(price * (1 + TAX), 2)


def expensive(store, bound):
    for product in store.values():
        if product.price >= bound:
            yield product.title


def checksum(sku):
    value = 0
    for symbol in sku:
        value = (value << 1 ^ ord(symbol)) & 0xFFFF
    return value >> 4 | ~value & 0xF


def parse(command):
    match command.split():
        case ["sell", sku, amount]:
            return "sell", sku, int(amount)
        case ["add", sku, amount]:
            return "add", sku, int(amount)
        case ["stop"]:
            return "stop", None, 0
        case _:
            return "unknown", None, 0


def main():
    store = {}
    for item in [Product("A-1", "Молоко", 2.5, 40),
                 Product("B-7", "Кофе", 15.9, 3),
                 Product("C-3", "Ноутбук", 2300, 2)]:
        add_stock(store, item, item.qty)
    commands = ["sell A-1 15", "sell B-7 3", "add C-3 1",
                "sell X-0 1", "help", "stop"]
    index = 0
    with Session() as shift:
        while index < len(commands):
            action, sku, amount = parse(commands[index])
            index += 1
            shift.log.append(action)
            if action == "stop":
                break
            elif sku is None:
                print("Неизвестная команда")
                continue
            try:
                if action == "sell":
                    done = remove_stock(store, sku, amount)
                    print(sku, "продано" if done else "не хватает")
                else:
                    add_stock(store, store[sku], amount)
            except StockError as error:
                print("Ошибка:", error)
            else:
                print("Готово:", sku)
            finally:
                print("Позиций:", len(store))
    prices = {key: with_tax(product.cost())
              for key, product in store.items() if product.qty != 0}
    ranked = sorted(store.values(), key=lambda product: product.cost())
    if (count := len([p for p in ranked if p.is_low()])) > 0:
        print("Мало на складе:", count, "операций:", operations)
    best = next(iter(ranked), None)
    if best is not None and not best.is_low():
        print("Упаковок:", best.qty // 6, "остаток:", best.qty % 6)
    total = sum(prices.values())
    spread = ranked[-1].price - ranked[0].price
    print("Итого:", total, math.floor(total / len(prices)))
    print("Разброс:", spread, spread ** 0.5)
    print("Дорогие:", list(expensive(store, 10)))
    print("Буквы:", Tally(p.title[0] for p in ranked))
    print("Суммы:", [checksum(key) for key in store][:2])


if __name__ == "__main__":
    main()
