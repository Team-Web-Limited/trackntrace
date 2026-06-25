frappe.pages["control-room"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Control Room"),
		single_column: true,
	});

	page.control_room_state = {
		tab: "approve",
		loading: false,
		requests: [],
		dialog: null,
		dialog_docname: null,
		search: "",
		from_date: "",
		to_date: "",
		alerts: [],
		alertsLoaded: false,
		alertsLoading: false,
		alertSearch: "",
		alertStatus: "open",
		alertLevel: "all",
		alertType: "all",
		alertFilterOptions: { levels: [], types: [] },
		alertSummary: { open: 0, critical_open: 0, unacknowledged_open: 0 },
		alertPollTimer: null,
		arrivals: [],
		arrivalsLoading: false,
		arrivalsLoaded: false,
		untaggingApprovals: [],
		untaggingApprovalsLoading: false,
		untaggingApprovalsLoaded: false,
		sealReturnApprovals: [],
		sealReturnApprovalsLoading: false,
		sealReturnApprovalsLoaded: false,
		dialog_kind: "tagging",
	};

	page.add_inner_button(__("Dashboard"), () => frappe.set_route("tnt-seal-management"));
	page.add_inner_button(__("Refresh"), () => {
		_control_room_load_queue(page);
		_control_room_load_arrivals(page);
		_control_room_load_untagging_approvals(page);
		_control_room_load_seal_return_approvals(page);
	}).addClass("cr-page-refresh-btn");

	_control_room_inject_styles();
	_control_room_render(page);
	_control_room_load_queue(page);
	_control_room_load_alerts(page);
	_control_room_load_arrivals(page);
	_control_room_load_untagging_approvals(page);
	_control_room_load_seal_return_approvals(page);

	// Stop the alert poll if the user navigates away from this page entirely
	// (switching tabs within the page is handled in the .cr-tab click handler).
	$(document).on("page-change", () => _control_room_stop_alert_polling(page));
};

// Polling only runs while the Alert tab is the active tab, and only re-fetches
// — it never auto-acknowledges or mutates anything, so a Control Room user
// idling on the tab just sees the queue refresh in the background.
const CR_ALERT_POLL_INTERVAL_MS = 5 * 60 * 1000;

function _control_room_start_alert_polling(page) {
	_control_room_stop_alert_polling(page);
	page.control_room_state.alertPollTimer = setInterval(() => {
		if (page.control_room_state.tab !== "alert") {
			_control_room_stop_alert_polling(page);
			return;
		}
		_control_room_load_alerts(page);
	}, CR_ALERT_POLL_INTERVAL_MS);
}

function _control_room_stop_alert_polling(page) {
	if (page.control_room_state.alertPollTimer) {
		clearInterval(page.control_room_state.alertPollTimer);
		page.control_room_state.alertPollTimer = null;
	}
}

const CR_METHOD = (name) =>
	`tnt_seal_management.tnt_seal_management.doctype.journey_request.journey_request.${name}`;

function _control_room_render(page) {
	const state = page.control_room_state;
	$(page.body).html(`
		<div class="cr-page">
			<section class="cr-panel">
				<div class="cr-tabs">
					<button class="cr-tab ${state.tab === "approve" ? "active" : ""}" data-tab="approve">
						${__("Approve")}
						<span class="cr-tab-count" data-cr-count>${state.requests.length}</span>
					</button>
					<button class="cr-tab ${state.tab === "alert" ? "active" : ""}" data-tab="alert">
						${__("Alert")}
						<span class="cr-tab-count ${state.alertSummary.critical_open ? "cr-tab-count--critical" : ""}" data-cr-alert-count>${state.alertSummary.open || 0}</span>
					</button>
				</div>
				<div class="cr-toolbar" style="display: ${state.tab === "approve" ? "block" : "none"}">
					<div class="cr-toolbar-top">
						<label class="cr-field cr-search-inline">
							<input class="cr-search" type="search" placeholder="${__("Journey request, client, entry, container or vehicle")}" value="${frappe.utils.escape_html(state.search || "")}">
						</label>
						<label class="cr-field">
							<span>${__("From")}</span>
							<input class="cr-from-date" type="date" value="${frappe.utils.escape_html(state.from_date || "")}">
						</label>
						<label class="cr-field">
							<span>${__("To")}</span>
							<input class="cr-to-date" type="date" value="${frappe.utils.escape_html(state.to_date || "")}">
						</label>
						<div class="cr-actions">
							<button class="cr-clear-btn">${__("Clear filters")}</button>
						</div>
					</div>
				</div>
				<div class="cr-toolbar" style="display: ${state.tab === "alert" ? "block" : "none"}">
					<div class="cr-toolbar-top">
						<label class="cr-field cr-search-inline">
							<input class="cr-alert-search" type="search" placeholder="${__("Seal device, journey or message")}" value="${frappe.utils.escape_html(state.alertSearch || "")}">
						</label>
						<label class="cr-field">
							<span>${__("Status")}</span>
							<select class="cr-alert-status">
								<option value="open" ${state.alertStatus === "open" ? "selected" : ""}>${__("Open")}</option>
								<option value="resolved" ${state.alertStatus === "resolved" ? "selected" : ""}>${__("Resolved")}</option>
								<option value="all" ${state.alertStatus === "all" ? "selected" : ""}>${__("All")}</option>
							</select>
						</label>
						<label class="cr-field">
							<span>${__("Level")}</span>
							<select class="cr-alert-level">
								<option value="all" ${state.alertLevel === "all" ? "selected" : ""}>${__("All")}</option>
								${(state.alertFilterOptions.levels || [])
									.map((level) => `<option value="${frappe.utils.escape_html(level)}" ${state.alertLevel === level ? "selected" : ""}>${frappe.utils.escape_html(level)}</option>`)
									.join("")}
							</select>
						</label>
						<label class="cr-field">
							<span>${__("Type")}</span>
							<select class="cr-alert-type">
								<option value="all" ${state.alertType === "all" ? "selected" : ""}>${__("All")}</option>
								${(state.alertFilterOptions.types || [])
									.map((type) => `<option value="${frappe.utils.escape_html(type)}" ${state.alertType === type ? "selected" : ""}>${frappe.utils.escape_html(type)}</option>`)
									.join("")}
							</select>
						</label>
						<div class="cr-actions">
							<button class="cr-alert-clear-btn">${__("Clear filters")}</button>
							<button class="cr-alert-refresh-btn">${__("Refresh")}</button>
						</div>
					</div>
				</div>
				<div class="cr-tab-body" data-cr-body></div>
			</section>
		</div>
	`);

	const delayedSearch = _cr_debounce(() => {
		page.control_room_state.search = ($(page.body).find(".cr-search").val() || "").trim();
		_control_room_render_body(page);
	}, 350);

	$(page.body)
		.off("input", ".cr-search")
		.on("input", ".cr-search", delayedSearch);

	$(page.body)
		.off("change", ".cr-from-date, .cr-to-date")
		.on("change", ".cr-from-date, .cr-to-date", function () {
			page.control_room_state.from_date = $(page.body).find(".cr-from-date").val() || "";
			page.control_room_state.to_date = $(page.body).find(".cr-to-date").val() || "";
			_control_room_render_body(page);
		});

	$(page.body)
		.off("click", ".cr-clear-btn")
		.on("click", ".cr-clear-btn", function () {
			page.control_room_state.search = "";
			page.control_room_state.from_date = "";
			page.control_room_state.to_date = "";
			$(page.body).find(".cr-search, .cr-from-date, .cr-to-date").val("");
			_control_room_render_body(page);
		});

	$(page.body)
		.off("click", ".cr-tab")
		.on("click", ".cr-tab", function () {
			const tab = $(this).data("tab");
			if (!tab || tab === page.control_room_state.tab) return;
			page.control_room_state.tab = tab;
			_control_room_render(page);
			_control_room_render_body(page);
			if (tab === "alert") {
				if (!page.control_room_state.alertsLoaded) _control_room_load_alerts(page);
				_control_room_start_alert_polling(page);
			} else {
				_control_room_stop_alert_polling(page);
			}
		});

	const delayedAlertSearch = _cr_debounce(() => {
		page.control_room_state.alertSearch = ($(page.body).find(".cr-alert-search").val() || "").trim();
		_control_room_load_alerts(page);
	}, 350);

	$(page.body)
		.off("input", ".cr-alert-search")
		.on("input", ".cr-alert-search", delayedAlertSearch);

	$(page.body)
		.off("change", ".cr-alert-status")
		.on("change", ".cr-alert-status", function () {
			page.control_room_state.alertStatus = $(this).val() || "open";
			_control_room_load_alerts(page);
		});

	$(page.body)
		.off("change", ".cr-alert-level")
		.on("change", ".cr-alert-level", function () {
			page.control_room_state.alertLevel = $(this).val() || "all";
			_control_room_load_alerts(page);
		});

	$(page.body)
		.off("change", ".cr-alert-type")
		.on("change", ".cr-alert-type", function () {
			page.control_room_state.alertType = $(this).val() || "all";
			_control_room_load_alerts(page);
		});

	$(page.body)
		.off("click", ".cr-alert-clear-btn")
		.on("click", ".cr-alert-clear-btn", function () {
			page.control_room_state.alertSearch = "";
			page.control_room_state.alertStatus = "open";
			page.control_room_state.alertLevel = "all";
			page.control_room_state.alertType = "all";
			$(page.body).find(".cr-alert-search").val("");
			$(page.body).find(".cr-alert-status").val("open");
			$(page.body).find(".cr-alert-level").val("all");
			$(page.body).find(".cr-alert-type").val("all");
			_control_room_load_alerts(page);
		});

	$(page.body)
		.off("click", ".cr-alert-refresh-btn")
		.on("click", ".cr-alert-refresh-btn", () => _control_room_load_alerts(page));

	$(page.body)
		.off("click", ".cr-alert-ack-btn")
		.on("click", ".cr-alert-ack-btn", function () {
			const docname = $(this).data("name");
			if (!docname) return;
			frappe.call({
				method: "tnt_seal_management.tnt_seal_management.doctype.seal_alert_log.seal_alert_log.acknowledge_alert",
				args: { docname },
				freeze: true,
				callback() {
					frappe.show_alert({ message: __("Alert acknowledged"), indicator: "green" }, 4);
					_control_room_load_alerts(page);
				},
			});
		});

	$(page.body)
		.off("change", ".cr-arrival-unlock-checkbox")
		.on("change", ".cr-arrival-unlock-checkbox", function () {
			const $checkbox = $(this);
			const docname = $checkbox.data("name");
			if (!docname || !$checkbox.is(":checked")) return;

			frappe.confirm(
				__(
					"Confirm the driver has reported arrival and the seal has been unlocked for {0}? This cannot be undone — location will be captured live from the seal's GPS.",
					[docname]
				),
				() => {
					frappe.call({
						method: "tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.confirm_arrival",
						args: { docname },
						freeze: true,
						freeze_message: __("Confirming arrival…"),
						callback() {
							frappe.show_alert(
								{ message: __("{0}: arrival confirmed, seal unlocked", [docname]), indicator: "green" },
								6
							);
							_control_room_load_arrivals(page);
						},
						error() {
							$checkbox.prop("checked", false);
						},
					});
				},
				() => $checkbox.prop("checked", false)
			);
		});

	_control_room_bind_actions(page);
	_control_room_render_body(page);
}

function _control_room_render_body(page) {
	const state = page.control_room_state;
	const $body = $(page.body).find("[data-cr-body]");

	if (state.tab === "alert") {
		if (state.alertsLoading) {
			$body.html(`<div class="cr-loading"><div class="cr-spinner"></div>${__("Loading alerts…")}</div>`);
			return;
		}
		if (!state.alerts.length) {
			$body.html(`
				<div class="cr-empty">
					<div class="cr-empty-icon">🛎️</div>
					<h3>${__("No alerts")}</h3>
					<p>${__("Seal exceptions, journey disruptions and low-battery signals will surface here as they occur.")}</p>
				</div>
			`);
			return;
		}
		$body.html(`<div class="cr-table-wrap">${_control_room_alert_table(state.alerts)}</div>`);
		return;
	}

	const arrivalsHtml = _control_room_arrivals_section_html(state);
	const untaggingHtml = _control_room_untagging_section_html(state);
	const sealReturnHtml = _control_room_seal_return_section_html(state);
	const extraSectionsHtml = `${arrivalsHtml}${untaggingHtml}${sealReturnHtml}`;
	const hasOtherPending =
		state.arrivals.length || state.untaggingApprovals.length || state.sealReturnApprovals.length;

	if (state.loading) {
		$body.html(`${extraSectionsHtml}<div class="cr-loading"><div class="cr-spinner"></div>${__("Loading approval queue…")}</div>`);
		return;
	}

	if (!state.requests.length) {
		// The "nothing to do" placeholder must only show when every approval-type
		// queue (Journey Requests + Arrivals + Untagging Approvals) is empty —
		// not just this one. Otherwise a pending card sits above a contradictory
		// "Nothing awaiting approval" message.
		$body.html(
			hasOtherPending
				? extraSectionsHtml
				: `
			<div class="cr-empty">
				<h3>${__("Nothing awaiting approval")}</h3>
				<p>${__("When a Tag Operator submits a seal journey for checking, it appears here for your review.")}</p>
			</div>
		`
		);
		return;
	}

	const filteredRequests = _control_room_get_filtered_requests(page);

	if (!filteredRequests.length) {
		$body.html(`
			${extraSectionsHtml}
			<div class="cr-empty">
				<div class="cr-empty-icon">🔍</div>
				<h3>${__("No matching requests found")}</h3>
				<p>${__("Try clearing filters or adjusting your search term.")}</p>
			</div>
		`);
		return;
	}

	$body.html(`
		${extraSectionsHtml}
		<div class="cr-table-wrap">${_control_room_request_table(filteredRequests, "tagging")}</div>
	`);
}

function _control_room_untagging_section_html(state) {
	if (state.untaggingApprovalsLoading) {
		return `<div class="cr-loading"><div class="cr-spinner"></div>${__("Loading untagging approvals…")}</div>`;
	}
	if (!state.untaggingApprovals.length) return "";

	return `
		<section class="cr-untagging-approvals">
			<h3 class="cr-section-title">${__("Untagging — Pending Approval")}</h3>
			<div class="cr-table-wrap">${_control_room_request_table(state.untaggingApprovals, "untagging")}</div>
		</section>
	`;
}

function _control_room_seal_return_section_html(state) {
	if (state.sealReturnApprovalsLoading) {
		return `<div class="cr-loading"><div class="cr-spinner"></div>${__("Loading seal return approvals…")}</div>`;
	}
	if (!state.sealReturnApprovals.length) return "";

	return `
		<section class="cr-seal-return-approvals">
			<h3 class="cr-section-title">${__("Seal Return — Pending Approval")}</h3>
			<div class="cr-table-wrap">${_control_room_request_table(state.sealReturnApprovals, "seal_return")}</div>
		</section>
	`;
}

function _control_room_arrivals_section_html(state) {
	if (state.arrivalsLoading) {
		return `<div class="cr-loading"><div class="cr-spinner"></div>${__("Loading arrivals…")}</div>`;
	}
	if (!state.arrivals.length) return "";

	return `
		<section class="cr-arrivals">
			<h3 class="cr-section-title">${__("Arrivals — Confirm Seal Unlocked")}</h3>
			<div class="cr-arrival-list">${state.arrivals.map(_control_room_arrival_card).join("")}</div>
		</section>
	`;
}

function _control_room_arrival_card(journey) {
	const route = `${frappe.utils.escape_html(journey.origin || "—")} → ${frappe.utils.escape_html(journey.destination || "—")}`;
	const started = journey.journey_start_date_time
		? frappe.datetime.str_to_user(journey.journey_start_date_time)
		: "—";
	const lastSeen = journey.api_last_update_time
		? frappe.datetime.str_to_user(journey.api_last_update_time)
		: "—";

	return `
		<article class="cr-arrival" data-name="${frappe.utils.escape_html(journey.name)}">
			<header class="cr-arrival-head">
				<span class="cr-req-id">${frappe.utils.escape_html(journey.name)}</span>
				<span class="cr-arrival-status">${__("In Transit")}</span>
			</header>
			<div class="cr-meta">
				${_cr_meta(__("Customer"), frappe.utils.escape_html(journey.customer || "—"))}
				${_cr_meta(__("Vehicle"), frappe.utils.escape_html(journey.vehicle_plate_number || "—"))}
				${_cr_meta(__("Container"), frappe.utils.escape_html(journey.container_number || "—"))}
				${_cr_meta(__("Seal Device"), frappe.utils.escape_html(journey.assigned_seal || "—"))}
				${_cr_meta(__("Route"), route, true)}
				${_cr_meta(__("Last Known Location"), frappe.utils.escape_html(journey.api_device_location || "—"), true)}
				${_cr_meta(__("Journey Started"), started)}
				${_cr_meta(__("Last API Update"), lastSeen)}
			</div>
			<footer class="cr-arrival-actions">
				<label class="cr-arrival-checkbox">
					<input type="checkbox" class="cr-arrival-unlock-checkbox" data-name="${frappe.utils.escape_html(journey.name)}">
					<span>${__("Seal Unlocked Confirmation")}</span>
				</label>
			</footer>
		</article>
	`;
}

function _control_room_get_filtered_requests(page) {
	const state = page.control_room_state;
	let list = state.requests || [];

	if (state.search) {
		const q = state.search.toLowerCase();
		list = list.filter((r) => {
			const name = (r.name || "").toLowerCase();
			const client = (r.client_name || "").toLowerCase();
			const entry = (r.entry_number || "").toLowerCase();
			const container = (r.container_number || "").toLowerCase();
			const vehicle = (r.vehicle || "").toLowerCase();
			return name.includes(q) || client.includes(q) || entry.includes(q) || container.includes(q) || vehicle.includes(q);
		});
	}

	if (state.from_date) {
		const fromTime = new Date(state.from_date + "T00:00:00").getTime();
		list = list.filter((r) => {
			if (!r.creation) return false;
			const creationTime = new Date(r.creation).getTime();
			return creationTime >= fromTime;
		});
	}

	if (state.to_date) {
		const toTime = new Date(state.to_date + "T23:59:59").getTime();
		list = list.filter((r) => {
			if (!r.creation) return false;
			const creationTime = new Date(r.creation).getTime();
			return creationTime <= toTime;
		});
	}

	return list;
}

function _cr_debounce(callback, wait) {
	let timeout;
	return function (...args) {
		window.clearTimeout(timeout);
		timeout = window.setTimeout(() => callback.apply(this, args), wait);
	};
}

function _control_room_request_table(requests, kind = "tagging") {
	const rows = requests
		.map((req) => {
			let clientHtml = frappe.utils.escape_html(req.client_name || "—");
			if (req.client_name) {
				const words = req.client_name.split(" ");
				if (words.length > 3) {
					const truncated = words.slice(0, 3).join(" ") + "...";
					clientHtml = `<span title="${frappe.utils.escape_html(req.client_name)}">${frappe.utils.escape_html(truncated)}</span>`;
				}
			}

			const sealSerialNumbers = (req.seals || [])
				.map((s) => s.seal_number)
				.filter(Boolean)
				.join(", ") || "—";

			return `
				<tr class="cr-row" data-name="${frappe.utils.escape_html(req.name)}" data-kind="${kind}">
					<td>${clientHtml}</td>
					<td>${frappe.utils.escape_html(req.vehicle || "—")}</td>
					<td>${frappe.utils.escape_html(sealSerialNumbers)}</td>
					<td>${frappe.utils.escape_html(req.origin || "—")}</td>
					<td>${frappe.utils.escape_html(req.destination || "—")}</td>
					<td class="text-right">
						<button class="cr-open" data-docname="${frappe.utils.escape_html(req.name)}" data-kind="${kind}">
							${__("Open")}
						</button>
					</td>
				</tr>
			`;
		})
		.join("");

	return `
		<table class="cr-queue-table">
			<thead>
				<tr>
					<th>${__("Client Name")}</th>
					<th>${__("Vehicle")}</th>
					<th>${__("Seal Serial Number(s)")}</th>
					<th>${__("Origin")}</th>
					<th>${__("Destination")}</th>
					<th class="text-right">${__("Action")}</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>
	`;
}

const CR_REQUEST_STATUS_LABEL = {
	tagging: () => __("Pending Control Room Approval"),
	untagging: () => __("Pending Untagging Approval"),
	seal_return: () => __("Pending Seal Return Approval"),
};

function _control_room_request_card(req, kind = "tagging") {
	const seals = req.seals || [];
	const sealRows = seals.length
		? seals.map(_control_room_seal_row).join("")
		: `<tr><td colspan="6" class="cr-seal-empty">${__("No seals on this request")}</td></tr>`;
	const statusLabel = (CR_REQUEST_STATUS_LABEL[kind] || CR_REQUEST_STATUS_LABEL.tagging)();

	return `
		<article class="cr-req" data-req="${frappe.utils.escape_html(req.name)}" data-kind="${kind}">
			<header class="cr-req-head">
				<div>
					<span class="cr-req-id">${frappe.utils.escape_html(req.name)}</span>
					<span class="cr-req-status">${statusLabel}</span>
				</div>
				<div class="cr-req-client">${frappe.utils.escape_html(req.client_name || "—")}</div>
			</header>

			<div class="cr-meta">
				${_cr_meta(__("Tag Operator"), req.assigned_technician_name || "—")}
				${_cr_meta(__("Job Order"), req.job_order || "—")}
				${_cr_meta(__("Vehicle"), req.vehicle || "—")}
				${_cr_meta(__("Driver"), req.driver_contact || "—")}
				${_cr_meta(__("Route"), `${frappe.utils.escape_html(req.origin || "—")} → ${frappe.utils.escape_html(req.destination || "—")}`, true)}
				${_cr_meta(__("Entry / Container"), `${frappe.utils.escape_html(req.entry_number || "—")} / ${frappe.utils.escape_html(req.container_number || "—")}`, true)}
			</div>

			<div class="cr-seal-wrap">
				<table class="cr-seal-table">
					<thead>
						<tr>
							<th>${__("Seal")}</th>
							<th>${__("Lock")}</th>
							<th>${__("Device Status")}</th>
							<th>${__("Battery")}</th>
							<th>${__("Location")}</th>
							<th>${__("Last Update")}</th>
						</tr>
					</thead>
					<tbody>${sealRows}</tbody>
				</table>
			</div>

			<footer class="cr-req-actions">
				<button class="cr-act cr-act--refresh" data-act="refresh">${__("Refresh Seal Status")}</button>
				<div class="cr-req-actions-right">
					<button class="cr-act cr-act--reject" data-act="reject">${__("Reject")}</button>
					<button class="cr-act cr-act--approve" data-act="approve">${__("Approve")}</button>
				</div>
			</footer>
		</article>
	`;
}

function _cr_meta(label, value, wide) {
	return `
		<div class="cr-meta-item ${wide ? "cr-meta-item--wide" : ""}">
			<span class="cr-meta-label">${label}</span>
			<span class="cr-meta-value">${value}</span>
		</div>
	`;
}

function _control_room_seal_row(seal) {
	const lock = seal.lock_status || "—";
	const lockClass =
		lock === "Locked" ? "cr-pill--ok" : lock === "Unlocked" ? "cr-pill--warn" : "cr-pill--muted";

	const battery = _cr_battery(seal.battery_level);
	const lastUpdate = seal.api_last_update_time
		? frappe.datetime.str_to_user(seal.api_last_update_time)
		: "—";

	return `
		<tr>
			<td>
				<div class="cr-seal-no">${frappe.utils.escape_html(seal.seal_number || seal.seal_device || "—")}</div>
				<div class="cr-seal-dev">${frappe.utils.escape_html(seal.seal_device || "")}</div>
			</td>
			<td><span class="cr-pill ${lockClass}">${frappe.utils.escape_html(lock)}</span></td>
			<td>${frappe.utils.escape_html(seal.api_device_status || "—")}</td>
			<td><span class="cr-batt ${battery.cls}">${battery.label}</span></td>
			<td class="cr-seal-loc">${frappe.utils.escape_html(seal.api_location || "—")}</td>
			<td>${frappe.utils.escape_html(lastUpdate)}</td>
		</tr>
	`;
}

function _cr_battery(raw) {
	const value = parseInt(raw, 10);
	if (Number.isNaN(value) || value < 0 || value > 100) {
		// Sensors sometimes report sentinel values like 255 — treat as unknown.
		return { label: "—", cls: "cr-batt--muted" };
	}
	let cls = "cr-batt--ok";
	if (value <= 20) cls = "cr-batt--low";
	else if (value <= 50) cls = "cr-batt--mid";
	return { label: `${value}%`, cls };
}

function _control_room_bind_actions(page) {
	// Approve/Reject/Refresh buttons only render inside a frappe.ui.Dialog,
	// which Frappe mounts under document.body rather than page.body — so the
	// click delegation for them must live on document, not page.body.
	$(document)
		.off("click", ".cr-act")
		.on("click", ".cr-act", function () {
			const $card = $(this).closest(".cr-req, .cr-modal-card");
			const docname = $card.data("req");
			const kind = $card.data("kind") || "tagging";
			const act = $(this).data("act");
			if (!docname || !act) return;

			if (act === "refresh") _control_room_refresh_seals(page, docname);
			else if (act === "approve") _control_room_approve(page, docname, kind);
			else if (act === "reject") _control_room_reject(page, docname, kind);
		});

	$(page.body)
		.off("click", ".cr-open")
		.on("click", ".cr-open", function () {
			const docname = $(this).data("docname");
			const kind = $(this).data("kind") || "tagging";
			if (!docname) return;
			_control_room_open_dialog(page, docname, kind);
		})
		.off("click", ".cr-row")
		.on("click", ".cr-row", function (event) {
			if ($(event.target).closest(".cr-open").length) return;
			const docname = $(this).data("name");
			const kind = $(this).data("kind") || "tagging";
			if (docname) _control_room_open_dialog(page, docname, kind);
		});
}

function _control_room_load_queue(page) {
	page.control_room_state.loading = true;
	_control_room_render_body(page);

	frappe.call({
		method: CR_METHOD("get_control_room_queue"),
		callback(r) {
			const state = page.control_room_state;
			state.loading = false;
			state.requests = (r.message && r.message.requests) || [];
			$(page.body).find("[data-cr-count]").text(state.requests.length);
			_control_room_render_body(page);
			_control_room_refresh_dialog(page);
		},
		error() {
			page.control_room_state.loading = false;
			_control_room_render_body(page);
			frappe.show_alert({ message: __("Could not load approval queue"), indicator: "red" }, 5);
		},
	});
}

function _control_room_load_arrivals(page) {
	const state = page.control_room_state;
	state.arrivalsLoading = true;
	if (state.tab === "approve") _control_room_render_body(page);

	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.doctype.seal_journey.seal_journey.get_arrival_queue",
		callback(r) {
			state.arrivalsLoading = false;
			state.arrivalsLoaded = true;
			state.arrivals = (r.message && r.message.journeys) || [];
			if (state.tab === "approve") _control_room_render_body(page);
		},
		error() {
			state.arrivalsLoading = false;
			if (state.tab === "approve") _control_room_render_body(page);
			frappe.show_alert({ message: __("Could not load arrivals queue"), indicator: "red" }, 5);
		},
	});
}

function _control_room_load_untagging_approvals(page) {
	const state = page.control_room_state;
	state.untaggingApprovalsLoading = true;
	if (state.tab === "approve") _control_room_render_body(page);

	frappe.call({
		method: CR_METHOD("get_untagging_approval_queue"),
		callback(r) {
			state.untaggingApprovalsLoading = false;
			state.untaggingApprovalsLoaded = true;
			state.untaggingApprovals = (r.message && r.message.requests) || [];
			if (state.tab === "approve") _control_room_render_body(page);
			_control_room_refresh_dialog(page);
		},
		error() {
			state.untaggingApprovalsLoading = false;
			if (state.tab === "approve") _control_room_render_body(page);
			frappe.show_alert({ message: __("Could not load untagging approvals"), indicator: "red" }, 5);
		},
	});
}

function _control_room_load_seal_return_approvals(page) {
	const state = page.control_room_state;
	state.sealReturnApprovalsLoading = true;
	if (state.tab === "approve") _control_room_render_body(page);

	frappe.call({
		method: CR_METHOD("get_seal_return_approval_queue"),
		callback(r) {
			state.sealReturnApprovalsLoading = false;
			state.sealReturnApprovalsLoaded = true;
			state.sealReturnApprovals = (r.message && r.message.requests) || [];
			if (state.tab === "approve") _control_room_render_body(page);
			_control_room_refresh_dialog(page);
		},
		error() {
			state.sealReturnApprovalsLoading = false;
			if (state.tab === "approve") _control_room_render_body(page);
			frappe.show_alert({ message: __("Could not load seal return approvals"), indicator: "red" }, 5);
		},
	});
}

function _control_room_load_alerts(page) {
	const state = page.control_room_state;
	state.alertsLoading = true;
	if (state.tab === "alert") _control_room_render_body(page);

	frappe.call({
		method: "tnt_seal_management.tnt_seal_management.doctype.seal_alert_log.seal_alert_log.get_alert_queue",
		args: {
			search: state.alertSearch || "",
			status: state.alertStatus || "open",
			level: state.alertLevel || "all",
			alert_type: state.alertType || "all",
			page_length: 100,
		},
		callback(r) {
			const res = r.message || {};
			state.alertsLoading = false;
			state.alertsLoaded = true;
			state.alerts = res.rows || [];
			state.alertFilterOptions = res.filter_options || { levels: [], types: [] };
			state.alertSummary = res.summary || { open: 0, critical_open: 0, unacknowledged_open: 0 };
			$(page.body).find("[data-cr-alert-count]")
				.text(state.alertSummary.open || 0)
				.toggleClass("cr-tab-count--critical", !!state.alertSummary.critical_open);
			if (state.tab === "alert") _control_room_render_body(page);
		},
		error() {
			state.alertsLoading = false;
			if (state.tab === "alert") _control_room_render_body(page);
			frappe.show_alert({ message: __("Could not load alert queue"), indicator: "red" }, 5);
		},
	});
}

function _control_room_alert_table(alerts) {
	const rows = alerts
		.map((a) => {
			const occurred = a.occurred_at ? frappe.datetime.str_to_user(a.occurred_at) : "—";
			const target = a.seal_journey || a.journey_request || a.seal_device || "—";
			const levelClass = (a.level || "info").toLowerCase();
			const statusBadge = a.is_resolved
				? `<span class="cr-alert-badge cr-alert-badge--resolved">${__("Resolved")}</span>`
				: `<span class="cr-alert-badge cr-alert-badge--${levelClass}">${frappe.utils.escape_html(a.level || "")}</span>`;
			const ackCell = a.acknowledged
				? `<span class="cr-alert-ack-done">${__("Acked by {0}", [frappe.utils.escape_html(a.acknowledged_by || "")])}</span>`
				: `<button class="cr-alert-ack-btn" data-name="${frappe.utils.escape_html(a.name)}">${__("Acknowledge")}</button>`;

			return `
				<tr>
					<td>${statusBadge}</td>
					<td>${frappe.utils.escape_html(a.alert_type || "—")}</td>
					<td>${frappe.utils.escape_html(a.message || "")}</td>
					<td>${frappe.utils.escape_html(target)}</td>
					<td>${frappe.utils.escape_html(a.alert_source || "")}</td>
					<td>${occurred}</td>
					<td>${ackCell}</td>
				</tr>
			`;
		})
		.join("");

	return `
		<table class="cr-queue-table">
			<thead>
				<tr>
					<th>${__("Level")}</th>
					<th>${__("Type")}</th>
					<th>${__("Message")}</th>
					<th>${__("Target")}</th>
					<th>${__("Source")}</th>
					<th>${__("Occurred At")}</th>
					<th>${__("Acknowledgement")}</th>
				</tr>
			</thead>
			<tbody>${rows}</tbody>
		</table>
	`;
}

function _control_room_request_list_for_kind(state, kind) {
	if (kind === "untagging") return state.untaggingApprovals;
	if (kind === "seal_return") return state.sealReturnApprovals;
	return state.requests;
}

const CR_DIALOG_TITLE = {
	untagging: () => __("Untagging Approval Review"),
	seal_return: () => __("Seal Return Approval Review"),
	tagging: () => __("Control Room Review"),
};

function _control_room_open_dialog(page, docname, kind = "tagging") {
	const request = _control_room_request_list_for_kind(page.control_room_state, kind).find(
		(row) => row.name === docname
	);
	if (!request) {
		frappe.show_alert({ message: __("Could not find {0}", [docname]), indicator: "orange" }, 5);
		return;
	}

	if (page.control_room_state.dialog) {
		page.control_room_state.dialog.hide();
		page.control_room_state.dialog.$wrapper.remove();
		page.control_room_state.dialog = null;
	}

	const dialog = new frappe.ui.Dialog({
		title: (CR_DIALOG_TITLE[kind] || CR_DIALOG_TITLE.tagging)(),
		size: "extra-large",
		fields: [{ fieldname: "details_html", fieldtype: "HTML" }],
	});

	dialog.$wrapper.addClass("cr-dialog");
	dialog.fields_dict.details_html.$wrapper.html(
		`<div class="cr-modal-card" data-req="${frappe.utils.escape_html(request.name)}" data-kind="${kind}">${_control_room_request_card(
			request,
			kind
		)}</div>`
	);
	dialog.set_secondary_action_label(__("Close"));
	dialog.set_secondary_action(() => dialog.hide());
	dialog.onhide = () => {
		if (page.control_room_state.dialog === dialog) {
			page.control_room_state.dialog = null;
			page.control_room_state.dialog_docname = null;
		}
	};

	page.control_room_state.dialog = dialog;
	page.control_room_state.dialog_docname = docname;
	page.control_room_state.dialog_kind = kind;
	dialog.show();
}

function _control_room_refresh_dialog(page) {
	const state = page.control_room_state;
	const { dialog, dialog_docname, dialog_kind } = state;
	if (!dialog || !dialog_docname) return;

	const kind = dialog_kind || "tagging";
	const request = _control_room_request_list_for_kind(state, kind).find(
		(row) => row.name === dialog_docname
	);
	if (!request) {
		dialog.hide();
		return;
	}

	dialog.fields_dict.details_html.$wrapper.html(
		`<div class="cr-modal-card" data-kind="${kind}">${_control_room_request_card(request, kind)}</div>`
	);
}

function _control_room_reload_queue_for_kind(page, kind) {
	if (kind === "untagging") _control_room_load_untagging_approvals(page);
	else if (kind === "seal_return") _control_room_load_seal_return_approvals(page);
	else _control_room_load_queue(page);
}

const CR_APPROVE_METHOD = {
	untagging: "approve_untagging",
	seal_return: "approve_seal_return",
	tagging: "approve_by_control_room",
};
const CR_REJECT_METHOD = {
	untagging: "reject_untagging",
	seal_return: "reject_seal_return",
	tagging: "reject_by_control_room",
};
const CR_APPROVE_MESSAGE = {
	untagging: (docname) => __("{0} approved — untagging complete", [docname]),
	seal_return: (docname) => __("{0} approved — seal returned, journey complete", [docname]),
	tagging: (docname) => __("{0} approved — tagging can begin", [docname]),
};

function _control_room_approve(page, docname, kind = "tagging") {
	const method = CR_APPROVE_METHOD[kind] || CR_APPROVE_METHOD.tagging;
	const successMessage = (CR_APPROVE_MESSAGE[kind] || CR_APPROVE_MESSAGE.tagging)(docname);

	frappe.prompt(
		[
			{
				fieldname: "remarks",
				fieldtype: "Small Text",
				label: __("Remarks (optional)"),
			},
		],
		(values) => {
			frappe.call({
				method: CR_METHOD(method),
				args: { docname, remarks: values.remarks || null },
				freeze: true,
				freeze_message: __("Approving…"),
				callback() {
					frappe.show_alert({ message: successMessage, indicator: "green" }, 6);
					page.control_room_state.dialog?.hide();
					_control_room_reload_queue_for_kind(page, kind);
				},
			});
		},
		__("Approve {0}", [docname]),
		__("Approve")
	);
}

function _control_room_reject(page, docname, kind = "tagging") {
	const method = CR_REJECT_METHOD[kind] || CR_REJECT_METHOD.tagging;

	frappe.prompt(
		[
			{
				fieldname: "remarks",
				fieldtype: "Small Text",
				label: __("Reason for rejection"),
				reqd: 1,
			},
		],
		(values) => {
			frappe.call({
				method: CR_METHOD(method),
				args: { docname, remarks: values.remarks },
				freeze: true,
				freeze_message: __("Rejecting…"),
				callback() {
					frappe.show_alert({ message: __("{0} rejected", [docname]), indicator: "orange" }, 6);
					page.control_room_state.dialog?.hide();
					_control_room_reload_queue_for_kind(page, kind);
				},
			});
		},
		__("Reject {0}", [docname]),
		__("Reject")
	);
}

function _control_room_refresh_seals(page, docname) {
	frappe.call({
		method: CR_METHOD("refresh_proposed_seal_status"),
		args: { docname },
		freeze: true,
		freeze_message: __("Fetching live seal data…"),
		callback(r) {
			const res = r.message || {};
			frappe.show_alert(
				{
					message: __("Refreshed {0} seal(s)", [res.refreshed || 0]),
					indicator: (res.errors || []).length ? "orange" : "green",
				},
				6
			);
			if ((res.errors || []).length) {
				frappe.msgprint({
					title: __("Some seals could not be refreshed"),
					message: res.errors.join("<br>"),
					indicator: "orange",
				});
			}
			_control_room_load_queue(page);
		},
	});
}

function _control_room_inject_styles() {
	if (document.getElementById("control-room-page-styles")) return;

	const style = document.createElement("style");
	style.id = "control-room-page-styles";
	style.textContent = `
		.cr-page {
			max-width: calc(1100px + 0.5rem);
			margin: 0 auto;
			padding: 24px 20px 48px;
			font-family: var(--font-stack);
		}
		.cr-panel {
			border: 1px solid rgba(14, 165, 233, .18);
			border-radius: 20px;
			background: var(--card-bg, #fff);
			box-shadow: 0 8px 24px rgba(14, 165, 233, .06);
			overflow: hidden;
		}
		.cr-tabs {
			display: flex;
			gap: 10px;
			padding: 16px 18px;
			border-bottom: 1px solid #dbeafe;
			background: #f8fbff;
		}
		.cr-tab {
			display: inline-flex;
			align-items: center;
			gap: 8px;
			border: 1px solid #bfdbfe;
			border-radius: 999px;
			background: #fff;
			color: #075985;
			padding: 9px 18px;
			font-size: 13px;
			font-weight: 800;
			cursor: pointer;
		}
		.cr-tab.active { border-color: #0284c7; background: #0284c7; color: #fff; }
		.cr-tab-count {
			min-width: 20px;
			padding: 1px 7px;
			border-radius: 999px;
			background: #e0f2fe;
			color: #0369a1;
			font-size: 11px;
			font-weight: 800;
		}
		.cr-tab.active .cr-tab-count { background: rgba(255,255,255,.25); color: #fff; }
		.cr-tab-count--critical { background: #fee2e2; color: #b91c1c; }
		.cr-tab.active .cr-tab-count--critical { background: #fff; color: #b91c1c; }
		.cr-tab-body { padding: 22px; }
		.cr-alert-badge {
			display: inline-block;
			padding: 2px 9px;
			border-radius: 999px;
			font-size: 11px;
			font-weight: 700;
			text-transform: capitalize;
			white-space: nowrap;
		}
		.cr-alert-badge--critical { background: #fee2e2; color: #b91c1c; }
		.cr-alert-badge--warning { background: #fef3c7; color: #92400e; }
		.cr-alert-badge--info { background: #e0f2fe; color: #0369a1; }
		.cr-alert-badge--resolved { background: #dcfce7; color: #15803d; }
		.cr-alert-ack-btn {
			border: 1px solid #cbd5e1;
			background: #fff;
			color: #0f172a;
			border-radius: 6px;
			padding: 4px 10px;
			font-size: 12px;
			font-weight: 600;
			cursor: pointer;
		}
		.cr-alert-ack-btn:hover { background: #f1f5f9; }
		.cr-alert-ack-done { color: #64748b; font-size: 12px; }

		/* ---- toolbar ---- */
		.cr-toolbar { padding: 18px; border-bottom: 1px solid #e0f2fe; background: #f0f9ff; }
		.cr-toolbar-top {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: 12px;
		}
		.cr-search-inline {
			flex: 1;
			min-width: 280px;
			display: flex;
			align-items: center;
		}
		.cr-search-inline input {
			width: 100%;
			height: 38px;
			padding: 8px 12px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			font-size: 14px;
		}
		.cr-search-inline input:focus {
			outline: none;
			border-color: #0284c7;
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}
		/* ---- regular fields ---- */
		.cr-field { display: flex; flex-direction: column; gap: 5px; margin: 0; }
		.cr-field > span {
			color: #0369a1;
			font-size: 11px;
			font-weight: 700;
			letter-spacing: .05em;
			text-transform: uppercase;
		}
		.cr-field input[type="date"],
		.cr-field select {
			width: 160px;
			height: 38px;
			border: 1px solid #bae6fd;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: var(--text-color, #0c4a6e);
			padding: 0 36px 0 10px;
			font-size: 13px;
			font-weight: 650;
			box-shadow: 0 1px 2px rgba(14, 165, 233, .04);
		}
		.cr-field select {
			appearance: none;
			background-image: linear-gradient(45deg, transparent 50%, #0284c7 50%), linear-gradient(135deg, #0284c7 50%, transparent 50%);
			background-position: calc(100% - 16px) 16px, calc(100% - 11px) 16px;
			background-size: 5px 5px, 5px 5px;
			background-repeat: no-repeat;
		}
		.cr-field input[type="date"]:focus,
		.cr-field select:focus {
			outline: none;
			border-color: #0284c7;
			box-shadow: 0 0 0 3px rgba(14, 165, 233, .12);
		}

		/* ---- actions ---- */
		.cr-actions { display: flex; gap: 8px; padding-top: 20px; align-items: flex-end; }
		.cr-clear-btn,
		.cr-alert-clear-btn,
		.cr-alert-refresh-btn {
			padding: 9px 16px;
			border: 1px solid #cbd5e1;
			border-radius: 10px;
			background: var(--card-bg, #fff);
			color: #475569;
			font-size: 13px;
			font-weight: 700;
			cursor: pointer;
			height: 38px;
			transition: background .12s, border-color .12s;
		}
		.cr-clear-btn:hover { background: #f8fafc; border-color: #94a3b8; }
		.cr-alert-clear-btn {
			border-color: #cbd5e1;
			background: #fff;
			color: #475569;
		}
		.cr-alert-clear-btn:hover { background: #f8fafc; border-color: #94a3b8; }
		.cr-alert-refresh-btn {
			border-color: #7dd3fc;
			background: #e0f2fe;
			color: #075985;
			box-shadow: 0 2px 6px rgba(14, 165, 233, .08);
		}
		.cr-alert-refresh-btn:hover { background: #bae6fd; border-color: #38bdf8; color: #0c4a6e; }
		.cr-page-refresh-btn {
			border-radius: 999px !important;
			border-color: #bae6fd !important;
			background: #e0f2fe !important;
			color: #075985 !important;
			font-weight: 800 !important;
			box-shadow: 0 2px 8px rgba(14, 165, 233, .12) !important;
		}
		.cr-page-refresh-btn:hover { background: #bae6fd !important; border-color: #38bdf8 !important; }

		.cr-queue-head { margin-bottom: 16px; }
		.cr-queue-head h3 { margin: 0 0 4px; font-size: 18px; font-weight: 800; color: #0f172a; }
		.cr-queue-sub { color: #64748b; font-size: 13px; }

		.cr-arrivals { margin-bottom: 22px; }
		.cr-untagging-approvals { margin-bottom: 22px; }
		.cr-section-title {
			margin: 0 0 12px;
			font-size: 15px;
			font-weight: 800;
			color: #0f172a;
		}
		.cr-arrival-list { display: grid; gap: 14px; }
		.cr-arrival {
			border: 1px solid #fdba74;
			border-radius: 16px;
			background: #fffbeb;
			overflow: hidden;
			box-shadow: 0 2px 10px rgba(15,23,42,.04);
		}
		.cr-arrival-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 14px 18px;
			background: linear-gradient(135deg, #fff7ed 0%, #fffbeb 100%);
			border-bottom: 1px solid #fed7aa;
		}
		.cr-arrival-status {
			display: inline-block;
			padding: 3px 10px;
			border-radius: 999px;
			background: #1e293b;
			color: #fff;
			font-size: 11px;
			font-weight: 800;
		}
		.cr-arrival-actions {
			display: flex;
			align-items: center;
			justify-content: flex-end;
			padding: 14px 18px;
			border-top: 1px solid #fed7aa;
			background: #fffaf0;
		}
		.cr-arrival-checkbox {
			display: inline-flex;
			align-items: center;
			gap: 8px;
			font-size: 13px;
			font-weight: 800;
			color: #92400e;
			cursor: pointer;
		}
		.cr-arrival-checkbox input {
			width: 18px;
			height: 18px;
			cursor: pointer;
		}

		.cr-queue { display: grid; gap: 18px; }
		.cr-table-wrap {
			border: 1px solid #e2e8f0;
			border-radius: 18px;
			background: #fff;
			overflow-x: auto;
			box-shadow: 0 2px 10px rgba(15,23,42,.04);
		}
		.cr-queue-table {
			width: 100%;
			border-collapse: collapse;
			font-size: 13px;
		}
		.cr-queue-table th {
			padding: 12px 7px;
			background: #f8fafc;
			border-bottom: 1px solid #e2e8f0;
			font-size: 11px;
			font-weight: 800;
			text-transform: uppercase;
			letter-spacing: .04em;
			color: #64748b;
			text-align: left;
			white-space: nowrap;
		}
		.cr-queue-table td {
			padding: 14px 7px;
			border-bottom: 1px solid #f1f5f9;
			color: #1e293b;
			vertical-align: middle;
		}
		.cr-queue-table th:first-child,
		.cr-queue-table td:first-child {
			padding-left: 14px;
		}
		.cr-queue-table th:last-child,
		.cr-queue-table td:last-child {
			padding-right: 14px;
		}
		.cr-queue-table tbody tr:last-child td { border-bottom: none; }
		.cr-row { cursor: pointer; }
		.cr-row:hover { background: rgba(224, 242, 254, .7); }
		.cr-row-main { font-size: 14px; font-weight: 800; color: #0f172a; }
		.cr-row-sub { font-size: 11px; color: #b45309; margin-top: 3px; }
		.cr-open,
		.cr-act,
		.cr-alert-ack-btn {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			min-height: 34px;
			border: 1px solid transparent;
			border-radius: 999px;
			padding: 8px 14px;
			font-size: 12px;
			font-weight: 850;
			line-height: 1;
			white-space: nowrap;
			cursor: pointer;
			transition: background .15s, border-color .15s, box-shadow .15s, transform .15s;
		}
		.cr-open {
			min-width: 84px;
			background: #0284c7;
			border-color: #0284c7;
			color: #fff;
			box-shadow: 0 6px 14px rgba(2, 132, 199, .18);
		}
		.cr-open:hover { background: #0369a1; border-color: #0369a1; transform: translateY(-1px); }

		.cr-req {
			border: 1px solid #e2e8f0;
			border-radius: 18px;
			background: #fff;
			overflow: hidden;
			box-shadow: 0 2px 10px rgba(15,23,42,.04);
		}
		.cr-req-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 16px 20px;
			background: linear-gradient(135deg, #eff6ff 0%, #ecfeff 100%);
			border-bottom: 1px solid #e2e8f0;
		}
		.cr-req-id { font-size: 15px; font-weight: 800; color: #0f172a; margin-right: 10px; }
		.cr-req-status {
			display: inline-block;
			padding: 3px 10px;
			border-radius: 999px;
			background: #fef9c3;
			color: #854d0e;
			font-size: 11px;
			font-weight: 800;
		}
		.cr-req-client { font-size: 14px; font-weight: 700; color: #334155; text-align: right; }

		.cr-meta {
			display: grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 14px 20px;
			padding: 18px 20px;
		}
		.cr-meta-item { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
		.cr-meta-item--wide { grid-column: span 2; }
		.cr-meta-label {
			font-size: 11px;
			font-weight: 800;
			letter-spacing: .04em;
			text-transform: uppercase;
			color: #94a3b8;
		}
		.cr-meta-value { font-size: 14px; font-weight: 600; color: #1e293b; overflow-wrap: anywhere; }

		.cr-seal-wrap { padding: 0 20px 6px; overflow-x: auto; }
		.cr-seal-table { width: 100%; border-collapse: collapse; font-size: 13px; }
		.cr-seal-table th {
			text-align: left;
			padding: 8px 10px;
			font-size: 11px;
			font-weight: 800;
			text-transform: uppercase;
			letter-spacing: .04em;
			color: #64748b;
			background: #f8fafc;
			border-bottom: 1px solid #e2e8f0;
		}
		.cr-seal-table td { padding: 10px; border-bottom: 1px solid #f1f5f9; vertical-align: top; color: #1e293b; }
		.cr-seal-no { font-weight: 700; }
		.cr-seal-dev { font-size: 11px; color: #94a3b8; }
		.cr-seal-loc { max-width: 260px; }
		.cr-seal-empty { text-align: center; color: #94a3b8; padding: 16px; }

		.cr-pill {
			display: inline-block;
			padding: 2px 9px;
			border-radius: 999px;
			font-size: 11px;
			font-weight: 800;
		}
		.cr-pill--ok { background: #dcfce7; color: #166534; }
		.cr-pill--warn { background: #ffedd5; color: #9a3412; }
		.cr-pill--muted { background: #f1f5f9; color: #64748b; }

		.cr-batt { font-weight: 800; font-size: 13px; }
		.cr-batt--ok { color: #16a34a; }
		.cr-batt--mid { color: #ca8a04; }
		.cr-batt--low { color: #dc2626; }
		.cr-batt--muted { color: #94a3b8; }

		.cr-req-actions {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 14px 20px;
			border-top: 1px solid #f1f5f9;
			background: #fcfdff;
		}
		.cr-req-actions-right { display: flex; gap: 8px; }
		.cr-act--refresh { background: #e0f2fe; border-color: #bae6fd; color: #075985; }
		.cr-act--refresh:hover { background: #bae6fd; border-color: #38bdf8; }
		.cr-act--reject { background: #fff1f2; color: #b91c1c; border-color: #fecaca; }
		.cr-act--reject:hover { background: #fee2e2; border-color: #fca5a5; }
		.cr-act--approve { background: #16a34a; border-color: #16a34a; color: #fff; box-shadow: 0 6px 14px rgba(22, 163, 74, .16); }
		.cr-act--approve:hover { background: #15803d; border-color: #15803d; transform: translateY(-1px); }
		.cr-dialog .modal-dialog { max-width: 1180px; }
		.cr-dialog .modal-body { padding: 18px; background: #f8fbff; }
		.cr-dialog .form-layout { margin: 0; }
		.cr-modal-card .cr-req { box-shadow: none; }
		.cr-modal-card .cr-req-actions { position: sticky; bottom: 0; }

		.cr-empty { text-align: center; padding: 56px 24px; color: #64748b; }
		.cr-empty-icon { font-size: 40px; margin-bottom: 12px; }
		.cr-empty h3 { margin: 0 0 6px; font-size: 18px; font-weight: 800; color: #0f172a; }
		.cr-empty p { margin: 0 auto; max-width: 460px; font-size: 14px; }

		.cr-loading { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 56px; color: #64748b; font-weight: 600; }
		.cr-spinner {
			width: 22px; height: 22px;
			border: 3px solid #e2e8f0; border-top-color: #0284c7;
			border-radius: 50%;
			animation: cr-spin .7s linear infinite;
		}
		@keyframes cr-spin { to { transform: rotate(360deg); } }

		[data-theme="dark"] .cr-panel,
		[data-theme="dark"] .cr-req,
		[data-theme="dark"] .cr-table-wrap { background: #1e293b; border-color: #334155; }
		[data-theme="dark"] .cr-search-inline input,
		[data-theme="dark"] .cr-field input[type="date"],
		[data-theme="dark"] .cr-field select,
		[data-theme="dark"] .cr-clear-btn,
		[data-theme="dark"] .cr-alert-clear-btn,
		[data-theme="dark"] .cr-alert-refresh-btn {
			background: #1e293b;
			border-color: #334155;
			color: #cbd5e1;
		}
		[data-theme="dark"] .cr-field > span { color: #7dd3fc; }
		[data-theme="dark"] .cr-toolbar { background: #0f172a; border-color: #334155; color: #7dd3fc; }
		[data-theme="dark"] .cr-tabs { background: #0f172a; border-color: #334155; }
		[data-theme="dark"] .cr-tab { background: #1e293b; border-color: #334155; color: #cbd5e1; }
		[data-theme="dark"] .cr-tab.active { background: #0284c7; color: #fff; border-color: #0284c7; }
		[data-theme="dark"] .cr-req-head { background: #0b3a52; border-color: #334155; }
		[data-theme="dark"] .cr-arrival { background: #1e293b; border-color: #92400e; }
		[data-theme="dark"] .cr-arrival-head { background: #2c1a08; border-color: #92400e; }
		[data-theme="dark"] .cr-arrival-actions { background: #1e293b; border-color: #92400e; }
		[data-theme="dark"] .cr-arrival-checkbox { color: #fdba74; }
		[data-theme="dark"] .cr-section-title { color: #f8fafc; }
		[data-theme="dark"] .cr-req-id, [data-theme="dark"] .cr-queue-head h3,
		[data-theme="dark"] .cr-empty h3 { color: #f8fafc; }
		[data-theme="dark"] .cr-req-client, [data-theme="dark"] .cr-meta-value,
		[data-theme="dark"] .cr-seal-table td, [data-theme="dark"] .cr-queue-table td { color: #e2e8f0; }
		[data-theme="dark"] .cr-seal-table th, [data-theme="dark"] .cr-queue-table th { background: #0f172a; color: #94a3b8; border-color: #334155; }
		[data-theme="dark"] .cr-seal-table td, [data-theme="dark"] .cr-queue-table td { border-color: #334155; }
		[data-theme="dark"] .cr-row-main { color: #f8fafc; }
		[data-theme="dark"] .cr-row:hover { background: rgba(14, 165, 233, .08); }
		[data-theme="dark"] .cr-open { background: #0284c7; border-color: #0284c7; color: #fff; }
		[data-theme="dark"] .cr-act--refresh { background: #082f49; border-color: #075985; color: #bae6fd; }
		[data-theme="dark"] .cr-act--reject { background: #450a0a; border-color: #7f1d1d; color: #fecaca; }
		[data-theme="dark"] .cr-act--approve { background: #166534; border-color: #166534; color: #dcfce7; }
		[data-theme="dark"] .cr-alert-ack-btn { background: #1e293b; border-color: #475569; color: #e2e8f0; }
		[data-theme="dark"] .cr-req-actions { background: #172033; border-color: #334155; }
		[data-theme="dark"] .cr-dialog .modal-body { background: #0f172a; }

		@media (max-width: 900px) { .cr-meta { grid-template-columns: repeat(2, minmax(0,1fr)); } }
		@media (max-width: 640px) {
			.cr-page { padding: 14px 8px 32px; }
			.cr-tab-body { padding: 14px; }
			.cr-table-wrap { overflow-x: auto; }
			.cr-queue-table { min-width: 820px; }
			.cr-search-inline,
			.cr-field,
			.cr-field input[type="date"],
			.cr-field select,
			.cr-clear-btn,
			.cr-alert-clear-btn,
			.cr-alert-refresh-btn { width: 100%; }
			.cr-meta { grid-template-columns: 1fr; }
			.cr-meta-item--wide { grid-column: span 1; }
			.cr-req-head { flex-direction: column; align-items: flex-start; }
			.cr-req-client { text-align: left; }
		}
	`;
	document.head.appendChild(style);
}
