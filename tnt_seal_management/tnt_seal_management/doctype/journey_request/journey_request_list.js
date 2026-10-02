// Search and Status replace the plain ID filter. Search matches the request ID,
// its seals or its Seal Journeys; Status matches the request's own status or
// any vehicle's, so a multi-vehicle request appears under every stage it spans.
// Neither is a real column, so both are resolved server-side to a name list.
const JR_LIST_STATUSES = [
	"Draft",
	"Pending Control Room Approval",
	"Tagging",
	"Journey Ready",
	"Untagging",
	"Awaiting Seal Return",
	"Pending Seal Return Approval",
	"Seal Returned",
	"Closed - Seal Retained",
	"Cancelled",
];
const JR_LIST_FILTERS = ["jr_search", "jr_status"];

frappe.listview_settings["Journey Request"] = {
	hide_name_filter: true,

	onload(listview) {
		const filter_area = listview.filter_area;
		if (!filter_area) return;

		// Keep the pseudo fields out of the filters the list saves and sends...
		const get_standard_filters = filter_area.get_standard_filters.bind(filter_area);
		filter_area.get_standard_filters = () =>
			get_standard_filters().filter((f) => !JR_LIST_FILTERS.includes(f[1]));

		// ...and send their resolved name list instead (rows and count alike).
		const get_filters_for_args = listview.get_filters_for_args.bind(listview);
		listview.get_filters_for_args = () => {
			const filters = get_filters_for_args();
			if (listview.jr_matches) {
				filters.push(["Journey Request", "name", "in", listview.jr_matches.length ? listview.jr_matches : [""]]);
			}
			return filters;
		};

		const apply = frappe.utils.debounce(() => {
			const search = listview.page.fields_dict.jr_search.get_value();
			const status = listview.page.fields_dict.jr_status.get_value();
			if (!search && !status) {
				listview.jr_matches = null;
				listview.refresh();
				return;
			}
			frappe
				.xcall("tnt_seal_management.tnt_seal_management.doctype.journey_request.journey_request.list_view_matches", {
					search,
					status,
				})
				.then((names) => {
					listview.jr_matches = names || [];
					listview.refresh();
				});
		}, 300);

		const wrapper = filter_area.standard_filters_wrapper;
		const search = listview.page.add_field(
			{
				fieldtype: "Data",
				fieldname: "jr_search",
				label: __("Search Request, Seal or Seal Journey"),
				onchange: apply,
			},
			wrapper
		);
		const status = listview.page.add_field(
			{
				fieldtype: "Select",
				fieldname: "jr_status",
				label: __("Status"),
				options: [""].concat(JR_LIST_STATUSES).join("\n"),
				onchange: apply,
			},
			wrapper
		);
		// Search first, where the ID box used to be.
		wrapper.prepend(status.$wrapper).prepend(search.$wrapper);
	},
};
