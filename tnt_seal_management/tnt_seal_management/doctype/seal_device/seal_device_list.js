frappe.listview_settings["Seal Device"] = {
	add_fields: ["imei_number", "current_journey", "current_technician"],
	custom_filter_configs: [
		{
			fieldtype: "Data",
			label: __("IMEI Number"),
			fieldname: "imei_number",
			condition: "like",
		},
		{
			fieldtype: "Link",
			label: __("Current Journey"),
			fieldname: "current_journey",
			options: "Seal Journey",
			condition: "=",
		},
		{
			fieldtype: "Link",
			label: __("Current Technician"),
			fieldname: "current_technician",
			options: "User",
			condition: "=",
		},
	],
};
