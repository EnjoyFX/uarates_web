from flask import Flask, request, render_template_string, Response, url_for
import requests
import csv
import io
import datetime

app = Flask(__name__)

# Шаблон головної сторінки з формою
INDEX_HTML = """
<!doctype html>
<html lang="uk">
<head>
    <meta charset="utf-8">
    <title>Генератор CSV файлів з валютними курсами НБУ</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body>
<div class="container mt-5">
    <h1>Курси НБУ за період</h1>
    <form action="/generate" method="post">
        <div class="mb-3">
            <label for="start_date" class="form-label">Дата початку періоду</label>
            <input type="date" id="start_date" name="start_date" class="form-control" required>
        </div>
        <div class="mb-3">
            <label for="end_date" class="form-label">Дата кінця періоду</label>
            <input type="date" id="end_date" name="end_date" class="form-control" required>
        </div>
        <div class="mb-3">
                <label for="currencies" class="form-label">Валюти (через кому, напр. EUR, USD)</label>
            <input type="text" id="currencies" name="currencies" class="form-control" required>
        </div>
        <button type="submit" class="btn btn-primary">Згенерувати таблицю</button>
    </form>
</div>
</body>
</html>
"""

# Шаблон сторінки з результатами (таблиця та посилання для завантаження CSV)
RESULTS_HTML = """
<!doctype html>
<html lang="uk">
<head>
    <meta charset="utf-8">
    <title>Результати генерації</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body>
<div class="container mt-5">
    <h1>Таблиця валютних курсів</h1>
    <table class="table table-bordered">
        <thead>
            <tr>
                {% for col in header %}
                <th>{{ col }}</th>
                {% endfor %}
            </tr>
        </thead>
        <tbody>
            {% for row in rows %}
            <tr>
                {% for cell in row %}
                <td>{{ cell }}</td>
                {% endfor %}
            </tr>
            {% endfor %}
        </tbody>
    </table>
    <a href="{{ download_url }}" class="btn btn-success">Завантажити CSV</a>
    <a href="/" class="btn btn-secondary">Нова генерація</a>
</div>
</body>
</html>
"""


def fetch_currency_data(currency, start, end):
    """
    Отримуємо дані з API НБУ для вказаної валюти та періоду.
    Формуємо URL з параметрами: start, end, valcode, sort, order та json.
    """
    url = f"https://bank.gov.ua/NBU_Exchange/exchange_site?start={start}&end={end}&valcode={currency}&sort=exchangedate&order=desc&json"
    response = requests.get(url)
    if response.status_code == 200:
        return response.json()
    else:
        return []


@app.route("/", methods=["GET"])
def index():
    return render_template_string(INDEX_HTML)


@app.route("/generate", methods=["POST"])
def generate():
    # Отримуємо параметри з форми
    start_date = request.form.get("start_date")  # формат: YYYY-MM-DD
    end_date = request.form.get("end_date")
    currencies_input = request.form.get("currencies")  # наприклад: "eur, usd"

    if not (start_date and end_date and currencies_input):
        return "Відсутні параметри", 400

    # Конвертуємо дати у формат, потрібний для API: YYYYMMDD
    start = start_date.replace("-", "")
    end = end_date.replace("-", "")

    # Отримуємо список валют (перетворюємо на нижній регістр)
    currency_list = [c.strip().lower() for c in currencies_input.split(",") if c.strip()]

    combined_data = {}  # ключ: exchangedate (формат "DD.MM.YYYY"), значення: словник {валюта: rate}

    # Для кожної валюти отримуємо дані та об'єднуємо їх
    for cur in currency_list:
        data = fetch_currency_data(cur, start, end)
        for entry in data:
            date = entry.get("exchangedate")  # наприклад: "31.01.2025"
            rate = entry.get("rate")
            if date not in combined_data:
                combined_data[date] = {}
            combined_data[date][cur.upper()] = rate  # зберігаємо код валюти у верхньому регістрі

    # Сортуємо дати за зростанням (конвертуємо рядок у datetime)
    sorted_dates = sorted(combined_data.keys(), key=lambda d: datetime.datetime.strptime(d, "%d.%m.%Y"))

    # Формуємо заголовок таблиці
    header = ["Date"] + [cur.upper() for cur in currency_list]

    # Формуємо рядки таблиці
    rows = []
    for date in sorted_dates:
        row = [date]
        for cur in currency_list:
            cur_code = cur.upper()
            row.append(combined_data[date].get(cur_code, ""))
        rows.append(row)

    # Формуємо URL для завантаження CSV, передаючи параметри через query string
    download_url = url_for("download", start_date=start_date, end_date=end_date, currencies=currencies_input)

    return render_template_string(RESULTS_HTML, header=header, rows=rows, download_url=download_url)


@app.route("/download", methods=["GET"])
def download():
    # Отримуємо параметри з query string
    start_date = request.args.get("start_date")
    end_date = request.args.get("end_date")
    currencies_input = request.args.get("currencies")

    if not (start_date and end_date and currencies_input):
        return "Відсутні параметри", 400

    start = start_date.replace("-", "")
    end = end_date.replace("-", "")
    currency_list = [c.strip().lower() for c in currencies_input.split(",") if c.strip()]

    combined_data = {}
    for cur in currency_list:
        data = fetch_currency_data(cur, start, end)
        for entry in data:
            date = entry.get("exchangedate")
            rate = entry.get("rate")
            if date not in combined_data:
                combined_data[date] = {}
            combined_data[date][cur.upper()] = rate

    sorted_dates = sorted(combined_data.keys(), key=lambda d: datetime.datetime.strptime(d, "%d.%m.%Y"))
    header = ["Date"] + [cur.upper() for cur in currency_list]

    # Створюємо CSV у пам'яті
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(header)
    for date in sorted_dates:
        row = [date]
        for cur in currency_list:
            cur_code = cur.upper()
            row.append(combined_data[date].get(cur_code, ""))
        writer.writerow(row)

    csv_content = output.getvalue()
    output.close()

    return Response(csv_content,
                    mimetype="text/csv",
                    headers={"Content-disposition": "attachment; filename=exchange_rates.csv"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5555, debug=True)
