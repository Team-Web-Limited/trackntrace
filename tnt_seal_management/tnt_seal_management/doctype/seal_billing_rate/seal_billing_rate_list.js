frappe.listview_settings["Seal Billing Rate"] = {
	onload(listview) {
		listview.page.add_inner_button(__("Back"), () => {
			frappe.set_route("tnt-seal-management");
		});
	},
};
