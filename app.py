from flask import Flask, render_template, request, jsonify, send_file
import subprocess
import os
import time

app = Flask(__name__)


def run_generate_file_script(currency, start_date, end_date, timeout=30):
    start_time = time.time()
    process = subprocess.Popen(
        ["python", "get_rates.py", currency, start_date, end_date],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        universal_newlines=True
    )
    # Читаємо перший рядок з виводу, наприклад:
    # "rates_USD_EUR_2025-01-01_2025-01-31 will be created..."
    raw_output = process.stdout.readline().strip()
    # Отримуємо базову назву файлу
    base_name = raw_output.split(" will be created")[0]
    # Додаємо потрібне розширення
    correct_file_name = base_name + ".xlsx"

    # Очікуємо, поки файл з'явиться в каталозі
    start_wait = time.time()
    while not os.path.exists(correct_file_name):
        if time.time() - start_wait > timeout:
            raise TimeoutError(f"Файл '{correct_file_name}' не з'явився протягом {timeout} секунд.")
        time.sleep(1)

    process.wait()
    end_time = time.time()
    time_taken = end_time - start_time
    return correct_file_name, time_taken


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/generate', methods=['POST'])
def generate():
    currency = request.form.get('currency')
    start_date = request.form.get('start_date')
    end_date = request.form.get('end_date')
    try:
        generated_file, time_taken = run_generate_file_script(currency, start_date, end_date)
        # Повертаємо JSON з результатами
        return jsonify({
            "status": "success",
            "file_name": generated_file,
            "time_taken": round(time_taken, 2)
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/download')
def download():
    file_name = request.args.get('file_name', 'output.xlsx')
    if os.path.exists(file_name):
        return send_file(file_name, as_attachment=True)
    else:
        return "Файл не знайдено", 404


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5555)
