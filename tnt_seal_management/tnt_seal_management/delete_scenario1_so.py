import frappe

def execute():
	print("RESULT_START")
	
	# Scenario Customer 1 is Coastal Bridge Carriers Ltd
	customer_name = "Coastal Bridge Carriers Ltd"
	
	journeys = frappe.get_all('Seal Journey', 
		filters={
			'customer': customer_name,
			'sales_order_reference': ('is', 'set')
		}, 
		fields=['name', 'sales_order_reference']
	)
	
	deleted_sos = set()
	updated_journeys = 0
	
	for j in journeys:
		so_name = j.sales_order_reference
		if so_name:
			if frappe.db.exists('Sales Order', so_name) and so_name not in deleted_sos:
				try:
					frappe.delete_doc('Sales Order', so_name, force=True)
					deleted_sos.add(so_name)
					print(f"Deleted Sales Order: {so_name}")
				except Exception as e:
					print(f"Failed to delete Sales Order {so_name}: {e}")
			
			# Reset the journey
			frappe.db.set_value('Seal Journey', j.name, {
				'sales_order_reference': None,
				'billing_status': 'Pending Billing'
			})
			updated_journeys += 1
			print(f"Reset Seal Journey {j.name}")
			
	frappe.db.commit()
	print(f"\nSuccessfully deleted {len(deleted_sos)} Sales Orders and reset {updated_journeys} Seal Journeys for {customer_name}.")
	print("RESULT_END")
