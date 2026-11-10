"""Signatures for print formats (exposed to Jinja via hooks.jinja)."""

import base64
import os

import frappe
from frappe.utils import cint

_RECTS_QUOTATION_SIGNATURE = "rects_quotation_signature.png"
# The signature is Rachael Njoroge's, so it goes only on quotations she created.
_RECTS_QUOTATION_SIGNER = "rnjoroge@trackntrace.co.ke"


def rects_quotation_signature(doc):
	"""Data URI of the Finance signature for a RECTs quotation created by the
	signer (Rachael), else "".

	A RECTs quotation is one whose customer has the RECTS branch ticked (on its
	own or with other branches; billing's stricter "RECTs only" rule is
	rects_billing.is_rects_customer). Embedded as data so it renders the same in
	the print view and in wkhtmltopdf PDFs."""
	if (doc.get("owner") or "").lower() != _RECTS_QUOTATION_SIGNER:
		return ""
	customer = doc.get("custom_customer") or (doc.get("party_name") if doc.get("quotation_to") == "Customer" else None)
	if not customer or not cint(frappe.db.get_value("Customer", customer, "custom_division_rects")):
		return ""
	return _image_data_uri(_RECTS_QUOTATION_SIGNATURE)


def _image_data_uri(filename):
	path = frappe.get_app_path("tnt_seal_management", "public", "images", filename)
	if not os.path.exists(path):
		return ""
	with open(path, "rb") as f:
		return "data:image/png;base64," + base64.b64encode(f.read()).decode()
