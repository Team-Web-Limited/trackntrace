// Colour-codes RECTs orders in the Sales Order list: upfront billing orders blue,
// seal-sale orders amber (the order type is stamped when they are raised).
(function () {
	const settings = (frappe.listview_settings["Sales Order"] = frappe.listview_settings["Sales Order"] || {});
	settings.add_fields = Array.from(new Set([...(settings.add_fields || []), "custom_rects_order_type"]));

	const previous_refresh = settings.refresh;
	settings.refresh = function (listview) {
		if (previous_refresh) previous_refresh.call(this, listview);
		if (!document.getElementById("tnt-so-list-colours")) {
			$("head").append(`<style id="tnt-so-list-colours">
				.list-row-container.tnt-so-billing { background: var(--blue-50, #eff6ff); box-shadow: inset 4px 0 0 var(--blue-500, #3b82f6); }
				.list-row-container.tnt-so-seal-sale { background: var(--yellow-50, #fffbeb); box-shadow: inset 4px 0 0 var(--yellow-500, #eab308); }
			</style>`);
		}
		const type_by_name = {};
		(listview.data || []).forEach((d) => (type_by_name[d.name] = d.custom_rects_order_type));
		listview.$result.find(".list-row-container").each(function () {
			const name = $(this).find(".list-row-checkbox").data("name");
			const type = type_by_name[name];
			$(this)
				.toggleClass("tnt-so-billing", type === "RECTs Billing")
				.toggleClass("tnt-so-seal-sale", type === "RECTs Seal Sale")
				.attr("title", type || null);
		});
	};
})();
