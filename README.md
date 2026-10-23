# Генератор курсів валют НБУ за період з веб-інтерфейсом

[![tests](https://github.com/EnjoyFX/uarates_web/actions/workflows/tests.yml/badge.svg)](https://github.com/EnjoyFX/uarates_web/actions/workflows/tests.yml)
[![coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/EnjoyFX/uarates_web/badges/coverage.json)](https://github.com/EnjoyFX/uarates_web/actions/workflows/tests.yml)

Офіційні курси гривні НБУ за будь-який період: динаміка, мінімум, максимум і експорт у CSV.

**Відкрити онлайн: https://enjoyfx.github.io/uarates_web/** — статична версія, нічого встановлювати не потрібно.

![Інтерфейс: звіт за III квартал 2026 по USD, EUR і PLN](docs/screenshot.png)

## Функціонал

- **Вибір періоду:** місяць, квартал, рік або довільні дати; швидкі кнопки «Минулий місяць», «Цей квартал» тощо.
- **Вибір валют:** пошук за кодом або назвою з довідника НБУ, популярні валюти в один клік.
- **Аналітика:** для кожної валюти — курс на кінець періоду, зміна, мінімум, максимум, середній і графік динаміки.
- **Підключення до API:** Використовується відкритий API Національного банку України для отримання валютних даних.
- **Експорт:** звичайний CSV (кома) та «CSV для Excel» (`;`, десяткова кома, UTF-8 BOM).
- Результати мають постійне посилання — його можна зберегти або надіслати колезі.

## Дві версії

- **Статична** (`site/`) — HTML, CSS і JavaScript без сервера. Курси бере з відкритих даних
  [uarates_data](https://github.com/EnjoyFX/uarates_data), які оновлюються щодня. Публікується на GitHub Pages
  автоматично при зміні `site/`.
- **Flask-сервер** (`app.py`) — та сама функціональність, але курси запитує в API НБУ напряму. Запускається в Docker.

## Статична версія локально

```bash
mkdir -p _site && cp site/* static/app.css _site/ && python3 -m http.server -d _site 8000
```
Відкрийте http://localhost:8000.

## Flask-версія в Docker

1. **Збірка докер-образу:**
```bash
docker build -t ua-rates2 .
```
2. **Запуск контейнера:**
```bash
docker run -p 5555:5555 ua-rates2
```
3. **У браузері введіть http://localhost:5555 і заповніть дані у формі.**

## Тести

Тести не звертаються до мережі: відповіді НБУ й файли даних підміняються фейковими.

```bash
uv run pytest   # Flask-версія
npm test        # логіка статичної версії (site/lib.js), потрібен Node 22+
```

Покриття рахується автоматично; якщо воно опуститься нижче 80%, тести не пройдуть. Бейдж показує гірше з двох покриттів.
