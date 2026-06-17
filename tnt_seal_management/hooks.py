app_name = "tnt_seal_management"
app_title = "Tnt Seal Management"
app_publisher = "teamweb"
app_description = "tnt-seal"
app_email = "teamweb@gmail.com"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
add_to_apps_screen = [
	{
		"name": "tnt_seal_management",
		"logo": "/assets/tnt_seal_management/images/tnt-seal-management-logo.svg",
		"title": "TNT Seal Management",
		"route": "/app/tnt-seal-management",
	}
]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/tnt_seal_management/css/tnt_seal_management.css"
# app_include_js = "/assets/tnt_seal_management/js/tnt_seal_management.js"

# include js, css files in header of web template
# web_include_css = "/assets/tnt_seal_management/css/tnt_seal_management.css"
# web_include_js = "/assets/tnt_seal_management/js/tnt_seal_management.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "tnt_seal_management/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "tnt_seal_management/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "tnt_seal_management.utils.jinja_methods",
# 	"filters": "tnt_seal_management.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "tnt_seal_management.install.before_install"
# after_install = "tnt_seal_management.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "tnt_seal_management.uninstall.before_uninstall"
# after_uninstall = "tnt_seal_management.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "tnt_seal_management.utils.before_app_install"
# after_app_install = "tnt_seal_management.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "tnt_seal_management.utils.before_app_uninstall"
# after_app_uninstall = "tnt_seal_management.utils.after_app_uninstall"

# Build
# ------------------
# To hook into the build process

# after_build = "tnt_seal_management.build.after_build"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "tnt_seal_management.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

permission_query_conditions = {
	"PCB Assignment": "tnt_seal_management.tnt_seal_management.doctype.pcb_assignment.pcb_assignment.get_permission_query_conditions",
	"Journey Request": "tnt_seal_management.tnt_seal_management.doctype.journey_request.journey_request.get_permission_query_conditions",
}

has_permission = {
	"PCB Assignment": "tnt_seal_management.tnt_seal_management.doctype.pcb_assignment.pcb_assignment.has_permission",
	"Journey Request": "tnt_seal_management.tnt_seal_management.doctype.journey_request.journey_request.has_permission",
}

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# The scheduler fires every minute; actual sync frequency is controlled by
# "Sync Frequency Minutes" in Seal API Settings (default 15). The function
# checks elapsed time since the last successful sync and exits early if the
# configured interval has not yet passed.
#
# scheduled_sync_all_devices follows the same pattern: it only runs a
# full-fleet sync (all devices with an IMEI) when "Full Fleet Sync Enabled"
# is checked in Seal API Settings, gated by its own
# "Full Fleet Sync Frequency Minutes" interval (default 10).
scheduler_events = {
	"cron": {
		"* * * * *": [
			"tnt_seal_management.tnt_seal_management.api.seal_sync.scheduled_sync_active_journeys",
			"tnt_seal_management.tnt_seal_management.api.seal_sync.scheduled_sync_all_devices",
		]
	}
}

# Testing
# -------

# before_tests = "tnt_seal_management.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "tnt_seal_management.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "tnt_seal_management.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "tnt_seal_management.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["tnt_seal_management.utils.before_request"]
# after_request = ["tnt_seal_management.utils.after_request"]

# Job Events
# ----------
# before_job = ["tnt_seal_management.utils.before_job"]
# after_job = ["tnt_seal_management.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"tnt_seal_management.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []
