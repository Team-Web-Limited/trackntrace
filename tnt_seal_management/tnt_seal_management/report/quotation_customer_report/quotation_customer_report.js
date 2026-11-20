// Copyright (c) 2026, TNT Seal Management and contributors
// For license information, please see license.txt

frappe.query_reports["Quotation Customer Report"] = {
	filters: [
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			default: frappe.datetime.month_start(),
			reqd: 1,
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
			reqd: 1,
		},
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
		},
		{
			fieldname: "customer",
			label: __("Customer"),
			fieldtype: "Link",
			options: "Customer",
		},
		{
			fieldname: "account_manager",
			label: __("Account Manager"),
			fieldtype: "Link",
			options: "User",
		},
		{
			fieldname: "quotation_to",
			label: __("Quotation To"),
			fieldtype: "Select",
			options: ["", "Customer", "Lead", "Prospect"],
		},
		{
			fieldname: "customer_source",
			label: __("Customer Source"),
			fieldtype: "Select",
			options: ["", "Direct", "Converted Lead", "Not Converted"],
		},
		{
			fieldname: "status",
			label: __("Status"),
			fieldtype: "Select",
			options: ["", "Draft", "Open", "Replied", "Partially Ordered", "Ordered", "Lost", "Expired"],
		},
		{
			fieldname: "owner",
			label: __("Created By"),
			fieldtype: "Link",
			options: "User",
		},
	],

	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldname === "customer_source" && data) {
			const colour = {
				"Direct": "green",
				"Converted Lead": "blue",
				"Not Converted": "orange",
			}[data.customer_source];
			if (colour) {
				value = `<span class="indicator-pill ${colour}">${value}</span>`;
			}
		}
		return value;
	},
};
