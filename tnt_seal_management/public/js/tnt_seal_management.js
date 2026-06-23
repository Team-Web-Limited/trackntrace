frappe.router.on('change', () => {
	if (frappe.get_route_str() === 'workspace/tnt-operations-hub') {
		frappe.set_route('tnt-seal-management');
	}
});
