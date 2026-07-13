import frappe
import json

def execute():
	prices = frappe.get_all('Item Price', filters={'item_code': 'Subscription '}, fields=['price_list', 'price_list_rate', 'currency'])
	print('RESULT_START')
	print(json.dumps(prices, default=str))
	print('RESULT_END')
