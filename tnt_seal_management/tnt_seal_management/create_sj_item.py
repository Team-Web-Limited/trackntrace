import frappe

def execute():
	item_code = "SJ-Subscription"
	if not frappe.db.exists("Item", item_code):
		item_group = frappe.db.get_value("Item Group", {"is_group": 0}, "name")
		
		item = frappe.new_doc("Item")
		item.item_code = item_code
		item.item_name = "SJ-Subscription"
		item.item_group = item_group
		item.is_stock_item = 0
		item.include_item_in_manufacturing = 0
		item.insert(ignore_permissions=True)
		print(f"Created Item: {item_code} under group {item_group}")
	else:
		print(f"Item already exists: {item_code}")
	
	frappe.db.commit()
	print("RESULT_END")
