// Copyright (c) 2026, TNT Seal Management and contributors
// For license information, please see license.txt

function apply_period(report) {
	const period = report.get_filter_value("period");
	if (!period || period === "Custom") {
		return;
	}

	let from_date;
	const to_date = frappe.datetime.get_today();

	if (period === "Daily") {
		from_date = frappe.datetime.get_today();
	} else if (period === "Weekly") {
		from_date = frappe.datetime.week_start();
	} else if (period === "Monthly") {
		from_date = frappe.datetime.month_start();
	}

	report.set_filter_value("from_date", from_date);
	report.set_filter_value("to_date", to_date);
}

frappe.query_reports["Completed Journeys Report"] = {
	filters: [
		{
			fieldname: "period",
			label: __("Period"),
			fieldtype: "Select",
			options: ["Custom", "Daily", "Weekly", "Monthly"],
			default: "Custom",
			on_change: function (report) {
				apply_period(report);
				report.refresh();
			},
		},
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			default: "2026-01-01",
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
			fieldname: "customer",
			label: __("Customer"),
			fieldtype: "Link",
			options: "Customer",
		},
	],

	formatter: function (value, row, column, data, default_formatter) {
		if (!data || !data.bold) {
			return default_formatter(value, row, column, data);
		}

		// Summary/payable rows carry their entire label + amount inside the
		// "customer" cell (a Link column) — render it as plain bold text
		// instead of the default Link formatter, which would wrap it in a
		// broken link to a non-existent Customer record.
		if ((data.is_summary_row || data.is_payable_row) && column.fieldname === "customer") {
			const style = data.is_payable_row
				? "background-color: var(--gray-900); color: var(--white); padding: 2px 4px; display: inline-block;"
				: "padding: 2px 4px; display: inline-block;";
			return `<div style="${style}"><b>${frappe.utils.escape_html(value)}</b></div>`;
		}
		// Leave the rest of a summary/payable row's cells blank and unstyled
		// (they carry no user-facing content besides the raw total_charge).
		if (data.is_summary_row || data.is_payable_row) {
			return column.fieldname === "total_charge" ? default_formatter(value, row, column, data) : "";
		}

		value = default_formatter(value, row, column, data);
		value = `<b>${value}</b>`;
		if (data.is_total_row) {
			value = `<div style="border-top: 1px solid var(--gray-400); background-color: var(--subtle-fg); padding: 2px 4px;">${value}</div>`;
		}
		return value;
	},
};
