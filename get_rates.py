import argparse
import json
import logging
from datetime import datetime, timedelta
from string import ascii_uppercase
from os.path import basename

import openpyxl
from openpyxl.styles import Font

import requests

__version__ = '1.1.0'
LOG_NAME = basename(__file__).split('.')[0]
logging.basicConfig(
    filename=f'{LOG_NAME}.log',
    level=logging.INFO,
    format='%(asctime)s %(filename)s %(funcName)s %(message)s'
)
logger = logging.getLogger(LOG_NAME)

SITE = 'https://bank.gov.ua/'
CMD = 'NBUStatService/v1/statdirectory/exchange?valcode={0}&date={1}&json'
API_URL = f'{SITE}{CMD}'
DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
DATE_FORMAT = '%Y-%m-%d'
API_DATE_FORMAT = '%Y%m%d'


class RateForPeriod:
    def __init__(self, currencies, start_date: str, end_date: str) -> None:
        """
        :param currencies: Currency codes as a comma separated string or list/tuple of strings.
        :param start_date: Start date in format YYYY-MM-DD.
        :param end_date: End date in format YYYY-MM-DD.
        """
        if not currencies:
            msg = '[currencies parameter] value is not allowed'
            logger.warning(msg)
            raise ValueError(msg)

        # Normalize currencies to list of uppercase strings
        if isinstance(currencies, str):
            currencies = [cur.strip().upper() for cur in currencies.split(',') if cur.strip()]
        elif isinstance(currencies, (list, tuple)):
            currencies = [str(cur).strip().upper() for cur in currencies if str(cur).strip()]
        else:
            msg = '[currencies parameter]: allowed only str, list or tuple'
            logger.warning(msg)
            raise ValueError(msg)

        if not currencies:
            msg = '[currencies parameter] after processing is empty'
            logger.warning(msg)
            raise ValueError(msg)

        self.currencies = currencies
        try:
            self.start_date = datetime.strptime(start_date, DATE_FORMAT)
            self.end_date = datetime.strptime(end_date, DATE_FORMAT)
        except ValueError as e:
            logger.warning(f'[Date parsing error] {e}')
            raise

        if self.start_date > self.end_date:
            self.start_date, self.end_date = self.end_date, self.start_date
            logger.info('[Dates swapped] start_date was greater than end_date')

        currency_str = '_'.join(self.currencies)
        self.filename = f'rates_{currency_str}_{self.start_date.strftime(DATE_FORMAT)}_{self.end_date.strftime(DATE_FORMAT)}'
        self.headers = ['Date'] + self.currencies
        self.rates_data = []  # will hold the rates data as list of lists

    def get_rates(self) -> 'RateForPeriod':
        logger.info(
            f"Fetching rates for currencies: {', '.join(self.currencies)} from {self.start_date.strftime(DATE_FORMAT)} to {self.end_date.strftime(DATE_FORMAT)}"
        )
        print(f"{self.filename} will be created...")
        current_date = self.start_date
        while current_date <= self.end_date:
            formatted_date = current_date.strftime(API_DATE_FORMAT)
            row = [current_date.strftime(DATE_FORMAT)]
            for currency in self.currencies:
                rate = self._get_rate_for_date(currency, formatted_date)
                row.append(rate)
            self.rates_data.append(row)
            current_date += timedelta(days=1)
        return self  # allow method chaining

    def save_xlsx(self, filename: str) -> str:
        if not self.rates_data:
            msg = '[Save error] No data available to save'
            logger.warning(msg)
            raise Exception(msg)

        workbook = openpyxl.Workbook()
        worksheet = workbook.active
        worksheet.title = 'Bank rates'

        # Append header row
        worksheet.append(self.headers)
        # Append data rows
        for row in self.rates_data:
            worksheet.append(row)

        # Set header style (bold)
        for col_idx, _ in enumerate(self.headers, start=1):
            cell = worksheet.cell(row=1, column=col_idx)
            cell.font = Font(bold=True)

        # Set width for first column
        worksheet.column_dimensions[ascii_uppercase[0]].width = 11

        try:
            workbook.save(filename)
            logger.info(f'File {filename} saved successfully.')
            return filename
        except Exception as e:
            logger.warning(f'Error saving file {filename}: {e}')
            raise e

    def _get_rate_for_date(self, currency: str, formatted_date: str) -> str:
        url = API_URL.format(currency.lower(), formatted_date)
        try:
            response = requests.get(url, headers=self._get_headers())
        except requests.RequestException as e:
            logger.warning(f'Network error for {currency} on {formatted_date}: {e}')
            return ''
        if response.status_code == 200:
            try:
                data = response.json()
            except json.JSONDecodeError as e:
                logger.warning(f'JSON decode error for {currency} on {formatted_date}: {e}')
                return ''
            if data and isinstance(data, list) and len(data) > 0:
                rate = data[0].get('rate')
                if rate is not None:
                    return str(rate)
                else:
                    logger.debug(f'No rate found in response: {data[0]}')
            else:
                logger.debug(f'Empty response for {currency} on {formatted_date}')
        else:
            logger.warning(f'{response.status_code}: {response.text}')
        return ''

    @staticmethod
    def _get_headers(user_agent: str = DEFAULT_USER_AGENT) -> dict:
        # Returns HTTP headers for API request
        return {'User-Agent': user_agent}


def main():
    description = f'CLI-extractor for Official FX rates of National Bank of Ukraine'\
                  f'(c) 2022-2025 Andy Reo, version {__version__}'
    today_str = datetime.now().strftime(DATE_FORMAT)
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("currencies", type=str, help="Code(s) of currency - USD, EUR, ... (comma separated)")
    parser.add_argument("start_date", type=str, nargs='?', default=today_str, help="Start date in format YYYY-MM-DD")
    parser.add_argument("end_date", type=str, nargs='?', default=today_str, help="End date in format YYYY-MM-DD")
    args = parser.parse_args()

    try:
        rate_period = RateForPeriod(args.currencies, start_date=args.start_date, end_date=args.end_date)
        saved_filename = rate_period.get_rates().save_xlsx(f'{rate_period.filename}.xlsx')
        # Print the filename to stdout so that it can be captured by the caller (e.g., web interface)
        print(f"{saved_filename} saved OK!")
    except Exception as e:
        logger.error(f"An error occurred: {e}")
        print(f"Error: {e}")


if __name__ == '__main__':
    main()
