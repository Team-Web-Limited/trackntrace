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

// Vehicle and Entry Number hold several values as free text ("KCG 325F, KDE 100B").
function _jr_list_values(value) {
	return cstr(value)
		.split(/[,;\n]+/)
		.map((v) => v.trim())
		.filter(Boolean);
}

// One value shows as-is; several collapse to a count and a View button.
function _jr_list_multi_formatter(field) {
	return (value, df, doc) => {
		const values = _jr_list_values(value);
		if (values.length < 2) return frappe.utils.escape_html(cstr(value));
		return `<span class="text-muted">${__("{0} {1}", [values.length, field.plural])}</span>
			<button class="btn btn-xs btn-default jr-list-view-btn ml-2"
				data-name="${encodeURIComponent(doc.name)}" data-field="${df.fieldname}">${__("View")}</button>`;
	};
}

const JR_LIST_MULTI_FIELDS = {
	vehicle: { label: __("Vehicles"), plural: __("vehicles") },
	entry_number: { label: __("Entry Numbers"), plural: __("entries") },
};

function _jr_list_show_details(name, fieldname) {
	frappe.db.get_doc("Journey Request", name).then((doc) => {
		const esc = frappe.utils.escape_html;
		const field = JR_LIST_MULTI_FIELDS[fieldname];
		const rows = (doc.vehicles || []).filter((r) => r.status !== "Cancelled");
		let html;

		if (fieldname === "vehicle" && rows.length) {
			// Per-vehicle rows carry the stage, Seal Journey and fitted seals.
			const seals_for = (row) => {
				const labels = [row.name, row.vehicle, row.registration_number].filter(Boolean);
				const seals = rows.length > 1 ? (doc.seals || []).filter((s) => labels.includes(s.vehicle)) : doc.seals || [];
				return seals.map((s) => s.seal_number || s.seal_device).filter(Boolean);
			};
			html = `<table class="table table-bordered table-sm">
				<thead><tr>
					<th>#</th><th>${__("Vehicle")}</th><th>${__("Status")}</th>
					<th>${__("Seal Journey")}</th><th>${__("Seals")}</th>
				</tr></thead>
				<tbody>${rows
					.map(
						(r, i) => `<tr>
							<td>${i + 1}</td>
							<td>${esc(r.registration_number || r.vehicle || "")}</td>
							<td>${esc(__(r.status || ""))}</td>
							<td>${r.seal_journey ? `<a href="/app/seal-journey/${encodeURIComponent(r.seal_journey)}">${esc(r.seal_journey)}</a>` : ""}</td>
							<td>${esc(seals_for(r).join(", "))}</td>
						</tr>`
					)
					.join("")}</tbody>
			</table>`;
		} else {
			html = `<table class="table table-bordered table-sm">
				<thead><tr><th>#</th><th>${field.label}</th></tr></thead>
				<tbody>${_jr_list_values(doc[fieldname])
					.map((v, i) => `<tr><td>${i + 1}</td><td>${esc(v)}</td></tr>`)
					.join("")}</tbody>
			</table>`;
		}

		const dialog = new frappe.ui.Dialog({
			title: __("{0} — {1}", [field.label, name]),
			size: fieldname === "vehicle" && rows.length ? "large" : "small",
			fields: [{ fieldtype: "HTML", fieldname: "details" }],
			primary_action_label: __("Open Request"),
			primary_action() {
				dialog.hide();
				frappe.set_route("Form", "Journey Request", name);
			},
		});
		dialog.fields_dict.details.$wrapper.html(html);
		dialog.show();
	});
}

frappe.listview_settings["Journey Request"] = {
	hide_name_filter: true,

	formatters: {
		vehicle: _jr_list_multi_formatter(JR_LIST_MULTI_FIELDS.vehicle),
		entry_number: _jr_list_multi_formatter(JR_LIST_MULTI_FIELDS.entry_number),
	},

	onload(listview) {
		// Handled before the row's own click, so View doesn't open the form.
		listview.$result.on("click", ".jr-list-view-btn", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const $btn = $(e.currentTarget);
			_jr_list_show_details(decodeURIComponent($btn.attr("data-name")), $btn.attr("data-field"));
		});

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
