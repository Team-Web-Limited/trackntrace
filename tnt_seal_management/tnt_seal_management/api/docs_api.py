import re

import frappe
from frappe.utils import get_url, nowdate, format_date
from frappe.utils.pdf import get_pdf

ACCENT = "#0e7490"

# Unpatched-qt wkhtmltopdf builds (Ubuntu repo) drop internal #anchor links,
# but URI links survive. Anchors are rendered as links to this sentinel host
# and converted back into internal GoTo links by _link_anchors() afterwards.
ANCHOR_SENTINEL = "https://docs-anchor.invalid/#"
ANCHOR_MARKER = "@@a:{}@@"

SOURCE_PAGES = ["/docs/features", "/docs/roles"]


@frappe.whitelist()
def download_pdf():
	html, outline = _build_pdf_html()

	pdf_content = get_pdf(
		html,
		options={
			"margin-top": "18mm",
			"margin-bottom": "20mm",
			"margin-left": "16mm",
			"margin-right": "16mm",
			# footer options only take effect on patched-qt wkhtmltopdf builds
			"footer-left": "TNT Seal Management — User Guide",
			"footer-right": "Page [page] of [topage]",
			"footer-font-size": "8",
			"footer-spacing": "6",
			"load-error-handling": "ignore",
			"load-media-error-handling": "ignore",
		},
	)

	pdf_content = _link_anchors(pdf_content, outline)

	frappe.local.response.filename = "TNT_Seal_Management_Docs.pdf"
	frappe.local.response.filecontent = pdf_content
	frappe.local.response.type = "download"


def _link_anchors(pdf_content, outline):
	"""Convert sentinel URI annotations into internal GoTo links and add
	PDF bookmarks, using the invisible anchor markers to find target pages."""
	import io

	from pypdf import PdfReader, PdfWriter
	from pypdf.generic import ArrayObject, DictionaryObject, NameObject

	reader = PdfReader(io.BytesIO(pdf_content))

	anchor_pages = {}
	for page_no, page in enumerate(reader.pages):
		for match in re.finditer(r"@@a:([\w-]+)@@", page.extract_text() or ""):
			anchor_pages.setdefault(match.group(1), page_no)

	writer = PdfWriter(clone_from=reader)

	for page in writer.pages:
		for annot in page.get("/Annots") or []:
			obj = annot.get_object()
			action = obj.get("/A")
			uri = action.get("/URI") if action else None
			if not uri or not uri.startswith(ANCHOR_SENTINEL):
				continue
			target = anchor_pages.get(uri[len(ANCHOR_SENTINEL):])
			if target is None:
				continue
			dest = ArrayObject(
				[writer.pages[target].indirect_reference, NameObject("/Fit")]
			)
			obj[NameObject("/A")] = DictionaryObject(
				{NameObject("/S"): NameObject("/GoTo"), NameObject("/D"): dest}
			)

	for title, anchor_id in outline:
		if anchor_id in anchor_pages:
			writer.add_outline_item(title, anchor_pages[anchor_id])

	out = io.BytesIO()
	writer.write(out)
	return out.getvalue()


def _build_pdf_html():
	from bs4 import BeautifulSoup
	from frappe.website.serve import get_response_content

	# Rendering /docs/features and /docs/roles as Guest raises a redirect in
	# their get_context(); this flag (checked there) lets the internal
	# server-side render through without affecting the public route.
	frappe.flags.in_pdf_generation = True
	try:
		page_soups = [
			BeautifulSoup(get_response_content(path), "html.parser")
			for path in SOURCE_PAGES
		]
	finally:
		frappe.flags.in_pdf_generation = False

	sections = []
	for soup in page_soups:
		for section in soup.select("main .docs-content > section.docs-section"):
			_clean_section(section)
			sections.append(section)

	toc_rows = []
	body_parts = []
	outline = []
	for idx, section in enumerate(sections, start=1):
		heading = section.find("h2")
		title = heading.get_text(strip=True) if heading else section.get("id", "")
		if heading:
			heading.string = f"{idx}.  {title}"

		section_id = section["id"]
		outline.append((f"{idx}. {title}", section_id))
		toc_rows.append(
			f'<li class="toc-item"><a href="{ANCHOR_SENTINEL}{section_id}">'
			f'<span class="toc-num">{idx}</span>{frappe.utils.escape_html(title)}</a>'
		)

		sub_rows = []
		markers = [_marker(section_id)]
		for h3 in section.find_all("h3"):
			sub_title = h3.get_text(strip=True)
			sub_id = h3.get("id") or (section_id + "-" + _slugify(sub_title))
			h3.insert(0, BeautifulSoup(_marker(sub_id), "html.parser"))
			sub_rows.append(
				f'<li><a href="{ANCHOR_SENTINEL}{sub_id}">'
				f"{frappe.utils.escape_html(sub_title)}</a></li>"
			)
		if sub_rows:
			toc_rows.append('<ul class="toc-sub">' + "".join(sub_rows) + "</ul>")
		toc_rows.append("</li>")

		body_parts.append(
			f'<div class="doc-section">{markers[0]}{section.decode_contents()}</div>'
		)

	generated_on = format_date(nowdate(), "d MMMM yyyy")

	return f"""
	<html>
	<head><meta charset="utf-8"></head>
	<body>
	<style>{_pdf_css()}</style>

	<div class="cover">
		<div class="cover-rule"></div>
		<p class="cover-kicker">User Documentation</p>
		<h1 class="cover-title">TNT Seal<br>Management</h1>
		<p class="cover-sub">
			Cargo security &amp; transit tracking — feature guides and
			role-based manuals for the TNT Seal Management platform.
		</p>
		<p class="cover-meta">
			Generated on {generated_on} &nbsp;·&nbsp;
			Online version: <a href="{get_url('/docs')}">{get_url('/docs')}</a>
		</p>
	</div>

	<div class="toc-page">
		<h2 class="toc-title">Contents</h2>
		<ul class="toc">{''.join(toc_rows)}</ul>
	</div>

	{''.join(body_parts)}
	</body>
	</html>
	""", outline


def _marker(anchor_id):
	"""Invisible text marker used to locate an anchor's page after rendering."""
	return f'<span class="anchor-marker">{ANCHOR_MARKER.format(anchor_id)}</span>'


def _clean_section(section):
	"""Strip web-page styling from a docs section, keeping semantic structure,
	ids and links so the PDF template can restyle it."""
	for icon in section.find_all("i"):
		icon.decompose()

	for tag in section.find_all(True):
		classes = tag.get("class") or []

		if "alert-warning" in classes:
			new_classes = ["callout", "warn"]
		elif "alert" in classes:
			new_classes = ["callout"]
		elif "card" in classes:
			new_classes = ["box"]
		elif "placeholder-content" in classes:
			new_classes = ["placeholder"]
		else:
			new_classes = []

		attrs = {}
		if new_classes:
			attrs["class"] = new_classes
		if tag.get("id"):
			attrs["id"] = tag["id"]
		if tag.name == "a" and tag.get("href"):
			href = tag["href"]
			if href.startswith("#"):
				# rewritten back to an internal PDF link in _link_anchors()
				href = ANCHOR_SENTINEL + href[1:]
			elif href.startswith("/"):
				# site-relative links become real hyperlinks from the PDF
				href = get_url(href)
			attrs["href"] = href
		tag.attrs = attrs


def _slugify(text):
	return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _pdf_css():
	return f"""
	body {{
		font-family: "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
		font-size: 10pt;
		color: #1e293b;
		line-height: 1.65;
	}}
	a {{ color: {ACCENT}; text-decoration: none; }}
	.anchor-marker {{ position: absolute; color: #ffffff; font-size: 1px; line-height: 0; }}

	/* ---- Cover ---- */
	.cover {{ page-break-after: always; padding-top: 130px; }}
	.cover-rule {{ width: 70px; height: 6px; background: {ACCENT}; margin-bottom: 28px; }}
	.cover-kicker {{
		text-transform: uppercase; letter-spacing: 3px;
		font-size: 10pt; color: {ACCENT}; margin: 0 0 10px;
	}}
	.cover-title {{ font-size: 40pt; font-weight: 700; line-height: 1.1; margin: 0 0 24px; color: #0f172a; }}
	.cover-sub {{ font-size: 13pt; color: #475569; max-width: 420px; margin: 0 0 60px; }}
	.cover-meta {{ font-size: 9pt; color: #94a3b8; }}

	/* ---- Table of contents ---- */
	.toc-page {{ page-break-after: always; }}
	.toc-title {{
		font-size: 22pt; color: #0f172a; margin: 0 0 24px;
		padding-bottom: 10px; border-bottom: 3px solid {ACCENT};
	}}
	ul.toc {{ list-style: none; padding: 0; margin: 0; }}
	.toc-item {{ margin: 0; }}
	.toc-item > a {{
		display: block; font-size: 12pt; font-weight: 600; color: #0f172a;
		padding: 9px 2px; border-bottom: 1px solid #e2e8f0;
	}}
	.toc-num {{
		display: inline-block; width: 34px; color: {ACCENT}; font-weight: 700;
	}}
	ul.toc-sub {{ list-style: none; padding: 4px 0 10px 36px; margin: 0; }}
	ul.toc-sub li a {{ font-size: 10pt; color: #475569; line-height: 2; }}

	/* ---- Sections ---- */
	.doc-section {{ page-break-before: always; }}
	.doc-section h2 {{
		font-size: 20pt; font-weight: 700; color: #0f172a;
		margin: 0 0 18px; padding-bottom: 10px; border-bottom: 3px solid {ACCENT};
	}}
	.doc-section h3 {{
		font-size: 13pt; font-weight: 600; color: {ACCENT};
		margin: 26px 0 8px;
	}}
	.doc-section h5 {{
		font-size: 10.5pt; font-weight: 700; color: #0f172a; margin: 0 0 6px;
	}}
	.doc-section p {{ margin: 0 0 10px; color: #334155; }}
	.doc-section ul {{ margin: 0 0 12px; padding-left: 20px; color: #334155; }}
	.doc-section li {{ margin-bottom: 5px; }}
	code {{
		font-family: "Courier New", monospace; font-size: 9pt;
		background: #f1f5f9; color: {ACCENT};
		padding: 1px 4px; border: 1px solid #e2e8f0; border-radius: 3px;
	}}
	strong {{ color: #0f172a; }}

	.box {{
		border: 1px solid #e2e8f0; border-left: 4px solid {ACCENT};
		background: #f8fafc; border-radius: 4px;
		padding: 14px 16px; margin: 10px 0 14px;
		page-break-inside: avoid;
	}}
	.callout {{
		border: 1px solid #bae6fd; border-left: 4px solid {ACCENT};
		background: #f0f9ff; border-radius: 4px;
		padding: 14px 16px; margin: 14px 0;
		page-break-inside: avoid;
	}}
	.callout.warn {{
		border-color: #fde68a; border-left-color: #d97706; background: #fffbeb;
	}}
	.callout.warn h5 {{ color: #b45309; }}
	.placeholder {{
		border: 1px dashed #cbd5e1; border-radius: 4px; background: #f8fafc;
		color: #94a3b8; text-align: center; padding: 18px; margin: 14px 0;
	}}
	"""
