frappe.listview_settings["Seal Device"] = {
	add_fields: ["imei_number", "current_journey", "current_technician"],
	onload(listview) {
		listview.page.add_actions_menu_item(__("Transfer Custody"), () => {
			const seals = listview.get_checked_items(true);
			window.tnt_transfer_seals(seals, () => listview.refresh());
		});
	},
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
