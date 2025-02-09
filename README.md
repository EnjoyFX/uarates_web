# Генератор курсів валют НБУ за період з веб-інтерфейсом

Цей проект є генератором csv-файлів, що використовує відкритий API Національного банку України для отримання актуальних курсів.

## Функціонал

- **Інтерактивна форма:** Обирайте валюти та дату початку/кінця для генерації файлу.
- **Підключення до API:** Використовується відкритий API Національного банку України для отримання валютних даних.
- **Генерація csv для Excel:** Згенерований файл має формат comma-separated values.

## Використання

1. **Збірка докер-образу:**
```bash
docker build -t ua-rates2 .
```
2. **Запуск контейнера:**
```bash
docker run -p 5555:5555 ua-rates2
```
3. **У браузері введіть http://localhost:5555 і заповніть дані у формі.**
