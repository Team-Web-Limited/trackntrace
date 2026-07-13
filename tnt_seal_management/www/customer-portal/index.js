const CUSTOMER_BOOKING_API =
	"tnt_seal_management.tnt_seal_management.api.customer_tagging_bookings";
const CUSTOMER_JOURNEY_API =
	"tnt_seal_management.tnt_seal_management.api.customer_completed_journeys";
const COMPLETED_JOURNEYS_EXPORT_API =
	"tnt_seal_management.tnt_seal_management.api.completed_journeys";

frappe.ready(() => {
	const root = document.querySelector("[data-customer-portal]");
	if (!root) return;

	bindTabs(root);
	root.querySelector("[data-booking-form]").addEventListener("submit", (event) => {
		event.preventDefault();
		createBooking(root, event.currentTarget);
	});
	root.querySelector("[data-booking-rows]").addEventListener("click", (event) => {
		const button = event.target.closest("[data-cancel-booking]");
		if (button) cancelBooking(root, button.dataset.cancelBooking);
	});

	initJourneys(root);
	loadBookings(root);
});

function bindTabs(root) {
	root.querySelectorAll("[data-tab-trigger]").forEach((button) => {
		button.addEventListener("click", () => {
			setActiveTab(root, button.dataset.tabTrigger);
			if (button.dataset.tabTrigger === "journeys" && !root._journeysLoaded) {
				root._journeysLoaded = true;
				loadJourneys(root);
			}
		});
	});
}

function setActiveTab(root, tabName) {
	root.querySelectorAll("[data-tab-trigger]").forEach((button) => {
		button.classList.toggle("is-active", button.dataset.tabTrigger === tabName);
	});

	root.querySelectorAll("[data-tab-panel]").forEach((panel) => {
		panel.classList.toggle("d-none", panel.dataset.tabPanel !== tabName);
	});
}

async function loadBookings(root) {
	setError(root, "");
	root.querySelector("[data-booking-loading]").classList.remove("d-none");
	root.querySelector("[data-booking-empty]").classList.add("d-none");
	root.querySelector("[data-booking-table-wrap]").classList.add("d-none");

	try {
		const response = await frappe.call({
			method: `${CUSTOMER_BOOKING_API}.get_customer_tagging_bookings`,
		});
		const result = response.message || {};
		renderBookings(root, result.bookings || []);
	} catch (error) {
		setError(root, getErrorMessage(error));
	} finally {
		root.querySelector("[data-booking-loading]").classList.add("d-none");
	}
}

async function createBooking(root, form) {
	const countryCode = form.querySelector("[data-phone-country]")?.value || "";
	const phoneNumber = (form.querySelector("[data-phone-number]")?.value || "").trim();

	if (!phoneNumber) {
		setError(root, __("Phone Number is required."));
		return;
	}

	const button = form.querySelector("[data-submit-booking]");
	button.disabled = true;
	setError(root, "");

	const data = Object.fromEntries(new FormData(form).entries());
	data.contact_person_phone = countryCode + "-" + phoneNumber;

	try {
		await frappe.call({
			method: `${CUSTOMER_BOOKING_API}.create_customer_tagging_booking`,
			args: { data: JSON.stringify(data) },
		});
		form.reset();
		setActiveTab(root, "list");
		frappe.show_alert({ message: __("Tagging booking submitted"), indicator: "green" }, 5);
		await loadBookings(root);
	} catch (error) {
		setError(root, getErrorMessage(error));
	} finally {
		button.disabled = false;
	}
}

async function cancelBooking(root, name) {
	if (!window.confirm(__("Cancel booking {0}?", [name]))) return;
	setError(root, "");
	try {
		await frappe.call({
			method: `${CUSTOMER_BOOKING_API}.cancel_customer_tagging_booking`,
			args: { name },
		});
		frappe.show_alert({ message: __("Booking cancelled"), indicator: "orange" }, 5);
		await loadBookings(root);
	} catch (error) {
		setError(root, getErrorMessage(error));
	}
}

function renderBookings(root, bookings) {
	const empty = root.querySelector("[data-booking-empty]");
	const table = root.querySelector("[data-booking-table-wrap]");
	const rows = root.querySelector("[data-booking-rows]");
	rows.innerHTML = "";

	if (!bookings.length) {
		empty.classList.remove("d-none");
		return;
	}

	rows.innerHTML = bookings.map(bookingRow).join("");
	table.classList.remove("d-none");
}

function bookingRow(booking) {
	const statusClass = String(booking.status || "")
		.toLowerCase()
		.replaceAll(" ", "-");
	const requestedDate = booking.booking_date_time
		? frappe.datetime.str_to_user(booking.booking_date_time)
		: "—";
	const action = booking.can_cancel
		? `<button class="btn btn-sm btn-outline-danger" data-cancel-booking="${escapeHtml(
				booking.name
		  )}">${__("Cancel")}</button>`
		: "—";

	return `<tr>
		<td><strong>${escapeHtml(booking.name)}</strong></td>
		<td>${escapeHtml(booking.location || "—")}</td>
		<td>${escapeHtml(requestedDate)}</td>
		<td>${escapeHtml(booking.contact_person_phone || "—")}</td>
		<td><span class="tb-status tb-status--${statusClass}">${escapeHtml(booking.status || "—")}</span></td>
		<td class="text-right">${action}</td>
	</tr>`;
}

function setError(root, message) {
	const box = root.querySelector("[data-portal-error]");
	box.textContent = message || "";
	box.classList.toggle("d-none", !message);
}

function getErrorMessage(error) {
	return error?._server_messages
		? JSON.parse(error._server_messages).map((item) => JSON.parse(item).message).join(" ")
		: error?.message || __("Something went wrong. Please try again.");
}

function escapeHtml(value) {
	return frappe.utils.escape_html(String(value ?? ""));
}

// ---------------------------------------------------------------------------
// Completed Journeys tab
// ---------------------------------------------------------------------------

const CJ_PAGE_LENGTH = 15;

function initJourneys(root) {
	root._journeyState = {
		period: "Monthly",
		from_date: frappe.datetime.month_start(),
		to_date: frappe.datetime.get_today(),
		page: 1,
	};
	root._journeyData = { customers: [] };

	const periodField = root.querySelector("[data-cj-period]");
	const fromField = root.querySelector("[data-cj-from]");
	const toField = root.querySelector("[data-cj-to]");

	fromField.value = root._journeyState.from_date;
	toField.value = root._journeyState.to_date;

	periodField.addEventListener("change", () => {
		root._journeyState.period = periodField.value;
		applyPeriod(root);
		root._journeyState.page = 1;
		loadJourneys(root);
	});

	fromField.addEventListener("change", () => {
		root._journeyState.period = "Custom";
		periodField.value = "Custom";
		root._journeyState.from_date = fromField.value;
		root._journeyState.page = 1;
		loadJourneys(root);
	});

	toField.addEventListener("change", () => {
		root._journeyState.period = "Custom";
		periodField.value = "Custom";
		root._journeyState.to_date = toField.value;
		root._journeyState.page = 1;
		loadJourneys(root);
	});

	root.querySelector("[data-cj-refresh]").addEventListener("click", () => {
		root._journeyState.page = 1;
		loadJourneys(root);
	});

	root.querySelector("[data-cj-content]").addEventListener("click", (event) => {
		const pdfBtn = event.target.closest("[data-cj-export-pdf]");
		if (pdfBtn) {
			event.preventDefault();
			exportJourneyPdf(root, Number(pdfBtn.dataset.cjExportPdf));
			return;
		}
		const excelBtn = event.target.closest("[data-cj-export-excel]");
		if (excelBtn) {
			event.preventDefault();
			exportJourneyExcel(root, Number(excelBtn.dataset.cjExportExcel));
			return;
		}
		const chargesBtn = event.target.closest("[data-cj-charges]");
		if (chargesBtn) {
			showChargesModal(root, Number(chargesBtn.dataset.cjCharges));
			return;
		}
		const pageBtn = event.target.closest("[data-cj-page]");
		if (pageBtn && !pageBtn.disabled) {
			root._journeyState.page = Number(pageBtn.dataset.cjPage);
			loadJourneys(root);
		}
	});
}

function applyPeriod(root) {
	const period = root._journeyState.period;
	if (!period || period === "Custom") return;

	const to_date = frappe.datetime.get_today();
	let from_date = to_date;
	if (period === "Weekly") from_date = frappe.datetime.week_start();
	else if (period === "Monthly") from_date = frappe.datetime.month_start();

	root._journeyState.from_date = from_date;
	root._journeyState.to_date = to_date;
	root.querySelector("[data-cj-from]").value = from_date;
	root.querySelector("[data-cj-to]").value = to_date;
}

async function loadJourneys(root) {
	setError(root, "");
	root.querySelector("[data-cj-loading]").classList.remove("d-none");

	try {
		const response = await frappe.call({
			method: `${CUSTOMER_JOURNEY_API}.get_customer_completed_journeys`,
			args: {
				from_date: root._journeyState.from_date || null,
				to_date: root._journeyState.to_date || null,
				page: root._journeyState.page || 1,
				page_length: CJ_PAGE_LENGTH,
			},
		});
		renderJourneys(root, response.message || { customers: [] });
	} catch (error) {
		setError(root, getErrorMessage(error));
	} finally {
		root.querySelector("[data-cj-loading]").classList.add("d-none");
	}
}

function renderJourneys(root, data) {
	root._journeyData = data;
	const customers = data.customers || [];
	const content = root.querySelector("[data-cj-content]");

	if (!customers.length) {
		content.innerHTML = `<div class="cj-empty">${__(
			"No completed journeys found for the selected filters."
		)}</div>`;
		return;
	}

	const pagination = data.pagination || null;
	content.innerHTML = customers
		.map((c, idx) => journeyCardHtml(c, idx, pagination))
		.join("");
}

function journeyCardHtml(c, idx, pagination) {
	const rows = (c.journeys || []).map(journeyRowHtml).join("");
	return `
		<section class="cj-card" id="cj-card-${idx}">
			<header class="cj-card-header">
				<div class="cj-card-title">
					<span class="cj-card-customer">${escapeHtml(c.customer)}</span>
				</div>
				<div class="cj-card-stats">
					<span class="cj-card-stat cj-stat--teal">
						<span class="cj-stat-label">${__("Completed Journeys")}</span>
						<span class="cj-stat-value">${c.journey_count}</span>
					</span>
					<span class="cj-card-stat cj-stat--green">
						<span class="cj-stat-label">${__("Total Payable")}</span>
						<span class="cj-stat-value">${format_currency(c.summary?.total_payable || 0)}</span>
					</span>
				</div>
				<div class="cj-card-actions">
					<button class="cj-btn" type="button" data-cj-charges="${idx}">${__("Charges")}</button>
					<div class="dropdown cj-export-dropdown">
						<button class="cj-btn dropdown-toggle" type="button" data-toggle="dropdown" aria-expanded="false">${__("Export")}</button>
						<ul class="dropdown-menu dropdown-menu-right">
							<li><a class="dropdown-item" href="#" data-cj-export-pdf="${idx}">${__("PDF")}</a></li>
							<li><a class="dropdown-item" href="#" data-cj-export-excel="${idx}">${__("Excel")}</a></li>
						</ul>
					</div>
				</div>
			</header>

			${
				(c.journeys || []).length
					? `<div class="cj-table-wrap">
				<table class="cj-table">
					<thead>
						<tr>
							<th>${__("Journey")}</th>
							<th>${__("Container/Truck #")}</th>
							<th>${__("Origin")}</th>
							<th>${__("Destination")}</th>
							<th>${__("Tagging Date")}</th>
							<th>${__("Arrival Date")}</th>
							<th>${__("Un-tagging Date")}</th>
							<th>${__("Seal Number")}</th>
							<th>${__("File Number")}</th>
							<th>${__("Hours/Days Taken")}</th>
							<th>${__("Contact Person")}</th>
							<th>${__("Departure Card #")}</th>
							<th>${__("Retrieval Card #")}</th>
							<th class="cj-col-amount">${__("Amount")}</th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
			</div>
			${journeyPaginationHtml(pagination)}`
					: `<div class="cj-no-journeys">${__(
							"No completed journeys in this period — recurring subscription fee only."
					  )}</div>`
			}

			<div class="cj-card-charges-section">
				${recurringHtml(c.recurring_fees)}
				${summaryHtml(c.summary)}
			</div>
		</section>
	`;
}

function journeyPaginationHtml(pagination) {
	if (!pagination || !pagination.total) return "";

	const { page, page_length, total } = pagination;
	const pages = Math.max(1, Math.ceil(total / page_length));
	const start = total ? (page - 1) * page_length + 1 : 0;
	const end = Math.min(page * page_length, total);

	return `
		<div class="cj-pagination">
			<span>${__("Showing {0}-{1} of {2}", [start, end, total])}</span>
			<div>
				<button class="cj-page-btn" type="button" data-cj-page="${page - 1}" ${
					page <= 1 ? "disabled" : ""
				}>${__("Previous")}</button>
				<b class="mx-2">${__("Page {0} of {1}", [page, pages])}</b>
				<button class="cj-page-btn" type="button" data-cj-page="${page + 1}" ${
					page >= pages ? "disabled" : ""
				}>${__("Next")}</button>
			</div>
		</div>
	`;
}

function journeyRowHtml(j) {
	const dash = `<span class="cj-muted">—</span>`;
	const dt = (v) => (v ? frappe.datetime.str_to_user(v) : dash);
	const cell = (v) => (v ? escapeHtml(v) : dash);

	return `
		<tr>
			<td>${cell(j.name)}</td>
			<td>${cell(j.container_number)}</td>
			<td>${cell(j.origin)}</td>
			<td>${cell(j.destination)}</td>
			<td>${dt(j.tagging_date_time)}</td>
			<td>${dt(j.arrival_date_time)}</td>
			<td>${dt(j.untagging_completed_date_time)}</td>
			<td>${cell(j.seal_number)}</td>
			<td>${cell(j.file_number)}</td>
			<td>${cell(j.days_taken_display)}</td>
			<td>${cell(j.contact_person_name)}</td>
			<td>${cell(j.departure_card_number)}</td>
			<td>${cell(j.retrieval_card_number)}</td>
			<td class="cj-col-amount">${format_currency(j.total_charge || 0)}</td>
		</tr>
	`;
}

function recurringHtml(fees) {
	if (!fees || !fees.length) return "";
	const rows = fees
		.map(
			(f) => `
		<div class="cj-recurring-row">
			<span class="cj-recurring-label">
				${escapeHtml(f.label)}
				<span class="cj-recurring-meta">${f.seal_count} ${
					f.seal_count === 1 ? __("seal") : __("seals")
				} × ${format_currency(f.rate, f.currency)} / ${__(f.billing_interval)}</span>
			</span>
			<span>${format_currency(f.amount, f.currency)}</span>
		</div>
	`
		)
		.join("");
	return `
		<div class="cj-recurring">
			<div class="cj-recurring-title">${__("Recurring Subscription Fees")}</div>
			${rows}
		</div>
	`;
}

function summaryHtml(s) {
	if (!s) return "";
	const pct = Math.round((s.vat_rate || 0) * 100);
	const vatLabel = s.mixed_vat_rates ? __("VAT") : __("VAT @{0}%", [pct]);
	const taxLabel =
		s.tax_category && s.tax_category !== "Normal Tax (16% VAT)" ? ` (${__(s.tax_category)})` : "";
	const hasJourneyCharges =
		(s.normal_charges || 0) !== 0 || (s.extra_charges || 0) !== 0 || (s.journey_total || 0) !== 0;
	const hasExtraBilling = (s.extra_billing_total || 0) !== 0;
	const hasRecurring = (s.recurring_total || 0) !== 0;

	const journeyRows = hasJourneyCharges
		? `
		<div class="cj-summary-row">
			<span>${__("Normal Charges")}</span>
			<span>${format_currency(s.normal_charges)}</span>
		</div>
		<div class="cj-summary-row">
			<span>${__("Extra Charges for Extra Days")}</span>
			<span>${format_currency(s.extra_charges)}</span>
		</div>
	`
		: "";

	const extraBillingRow = hasExtraBilling
		? `
		<div class="cj-summary-row">
			<span>${__("Extra Billing (leased seals)")}</span>
			<span>${format_currency(s.extra_billing_total)}</span>
		</div>
	`
		: "";

	const recurringRow = hasRecurring
		? `
		<div class="cj-summary-row">
			<span>${__("Recurring Subscription Fees")}</span>
			<span>${format_currency(s.recurring_total)}</span>
		</div>
	`
		: "";

	return `
		<div class="cj-summary">
			${journeyRows}
			${extraBillingRow}
			${recurringRow}
			<div class="cj-summary-row cj-summary-row--total">
				<span>${__("Total Cost")}</span>
				<span>${format_currency(s.total_cost)}</span>
			</div>
			<div class="cj-summary-row">
				<span>${vatLabel}${taxLabel}</span>
				<span>${format_currency(s.vat)}</span>
			</div>
			<div class="cj-summary-row cj-summary-row--payable">
				<span>${__("Total Payable")}</span>
				<span>${format_currency(s.total_payable)}</span>
			</div>
		</div>
	`;
}

function showChargesModal(root, idx) {
	const c = (root._journeyData.customers || [])[idx];
	if (!c) return;

	// frappe.ui.Dialog's `fields` pipeline needs frappe.ui.form.make_control,
	// which isn't bundled on website pages — build a raw bootstrap modal via
	// frappe.get_modal instead (that helper is bundled for web, see
	// bootstrap-4-web.bundle.js) and drop it once closed.
	const html = `
		<div class="cj-modal-charges">
			${recurringHtml(c.recurring_fees)}
			${summaryHtml(c.summary)}
		</div>
	`;

	const $modal = frappe.get_modal(
		__("Charges Summary — {0}", [escapeHtml(c.customer)]),
		html
	);
	$modal.find(".modal-dialog").addClass("modal-lg");
	$modal.appendTo(document.body);
	$modal.on("hidden.bs.modal", () => $modal.remove());
	$modal.modal("show");
}

// The visible table only ever holds one CJ_PAGE_LENGTH-sized page — exports
// must cover every matching journey, so fetch the full unpaginated dataset
// first rather than reading off the (partial) rendered DOM / root._journeyData.
async function fetchAllJourneysForExport(root) {
	const response = await frappe.call({
		method: `${CUSTOMER_JOURNEY_API}.get_customer_completed_journeys`,
		args: {
			from_date: root._journeyState.from_date || null,
			to_date: root._journeyState.to_date || null,
			page: 1,
			page_length: 100000,
		},
	});
	return (response.message || { customers: [] }).customers || [];
}

async function exportJourneyPdf(root, idx) {
	const customers = await fetchAllJourneysForExport(root);
	const c = customers[idx];
	if (!c) return;

	const cardHtml = journeyCardHtml(c, idx, null);
	const fromStr = root._journeyState.from_date
		? frappe.datetime.str_to_user(root._journeyState.from_date)
		: "";
	const toStr = root._journeyState.to_date
		? frappe.datetime.str_to_user(root._journeyState.to_date)
		: "";
	let dateRange = fromStr && toStr ? `${fromStr} to ${toStr}` : fromStr || toStr;
	if (!dateRange) dateRange = frappe.datetime.str_to_user(frappe.datetime.get_today());

	const html = `
		<html>
			<head>
				<title>${escapeHtml(c.customer)} — ${__("Completed Journeys")}</title>
				<style>${journeyPrintStyles()}</style>
			</head>
			<body>
				<h2>${escapeHtml(c.customer)}</h2>
				<p class="cj-print-meta">${__("Completed Journeys Statement")} — ${escapeHtml(dateRange)}</p>
				${cardHtml}
			</body>
		</html>
	`;

	postDownload(`${COMPLETED_JOURNEYS_EXPORT_API}.export_pdf`, {
		html,
		filename: `${c.customer} - Completed Journeys`,
	});
}

async function exportJourneyExcel(root, idx) {
	const customers = await fetchAllJourneysForExport(root);
	const c = customers[idx];
	if (!c) return;

	const dt = (v) => (v ? frappe.datetime.str_to_user(v) : "");
	const num = (v) => (v ? Math.round(v * 100) / 100 : 0);

	const data = [
		["Customer", c.customer],
		["Total Journeys", c.journey_count],
		["Total Days Taken", num(c.total_days_taken)],
		[],
		[
			"Journey", "Container/Truck #", "Origin", "Destination", "Tagging Date",
			"Arrival Date", "Un-tagging Date", "Seal Number", "File Number",
			"Hours/Days Taken", "Contact Person", "Departure Card #", "Retrieval Card #", "Amount",
		],
	];

	(c.journeys || []).forEach((j) => {
		data.push([
			j.name, j.container_number, j.origin, j.destination,
			dt(j.tagging_date_time), dt(j.arrival_date_time), dt(j.untagging_completed_date_time),
			j.seal_number, j.file_number, j.days_taken_display,
			j.contact_person_name, j.departure_card_number, j.retrieval_card_number,
			num(j.total_charge),
		]);
	});

	data.push([]);
	data.push(["Summary"]);
	if (c.recurring_fees && c.recurring_fees.length) {
		data.push(["Recurring Subscription Fees"]);
		c.recurring_fees.forEach((f) => data.push([f.label, num(f.amount)]));
	}

	const s = c.summary || {};
	data.push(["Normal Charges", num(s.normal_charges)]);
	data.push(["Extra Charges for Extra Days", num(s.extra_charges)]);
	if (num(s.extra_billing_total)) data.push(["Extra Billing (leased seals)", num(s.extra_billing_total)]);
	if (num(s.recurring_total)) data.push(["Recurring Subscription Fees", num(s.recurring_total)]);
	data.push(["Total Cost", num(s.total_cost)]);

	const pct = Math.round((s.vat_rate || 0) * 100);
	let vatLabel = s.mixed_vat_rates ? "VAT" : `VAT @${pct}%`;
	if (s.tax_category && s.tax_category !== "Normal Tax (16% VAT)") vatLabel += ` (${__(s.tax_category)})`;
	data.push([vatLabel, num(s.vat)]);
	data.push(["Total Payable", num(s.total_payable)]);

	postDownload(`${COMPLETED_JOURNEYS_EXPORT_API}.export_xlsx`, {
		data: JSON.stringify(data),
		filename: `${c.customer} - Completed Journeys`,
	});
}

function postDownload(method, params) {
	const form = document.createElement("form");
	form.method = "POST";
	form.action = `/api/method/${method}`;
	form.style.display = "none";

	const addField = (name, value) => {
		const input = document.createElement("input");
		input.type = "hidden";
		input.name = name;
		input.value = value;
		form.appendChild(input);
	};

	Object.entries(params).forEach(([key, value]) => addField(key, value));
	if (frappe.csrf_token) addField("csrf_token", frappe.csrf_token);

	document.body.appendChild(form);
	form.submit();
	document.body.removeChild(form);
}

function journeyPrintStyles() {
	return `
		body { font-family: sans-serif; padding: 24px; color: #1e293b; }
		h2 { margin-bottom: 2px; }
		.cj-print-meta { color: #64748b; margin-top: 0; margin-bottom: 20px; }
		.cj-card { border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; }
		.cj-card-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #f1f5f9; }
		.cj-card-actions { display: none; }
		.cj-card-charges-section { display: block !important; }
		.cj-table { width: 100%; border-collapse: collapse; font-size: 11px; }
		.cj-table th, .cj-table td { border-bottom: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
		.cj-table th { background: #f8fafc; }
		.cj-col-amount { text-align: right; }
		.cj-summary { padding: 12px 16px; max-width: 320px; margin-left: auto; }
		.cj-summary-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
		.cj-summary-row--total { border-top: 1px solid #cbd5e1; font-weight: 700; }
		.cj-summary-row--payable { background: #0f172a; color: #fff; font-weight: 800; padding: 8px 10px; margin-top: 4px; border-radius: 4px; }
	`;
}

