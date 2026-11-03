# Productivity suites

Call `roomsuite_discover_suites` to see enabled suites and inspect the specific live tool schemas for the operation. In RoomSuite 3.2.2 its broad limits contain stale claims: supported simple anchored Word comments can round-trip, and PlanSuite has all-day events, time-zone-aware recurrence, and optional CalDAV tools. The summary is corrected in 3.5.0. Check the specific tools and their requirements; other versions and configurations may differ.

Editable `.docsuite`, `.gridsuite`, `.decksuite`, and `.plansuite` files live in the server's Shared files. Create at a new path with the correct extension and an existing parent folder. Read an existing file before the first edit; pass its current `base_revision`, reuse the latest returned revision for the next edit, and reread/reconcile after a conflict. `roomsuite_productivity_get` and `roomsuite_productivity_save` provide complete-state access; `base_revision: null` creates a file. Inspect conversion and history warnings.

## DocSuite

- `docsuite_create`, `docsuite_get`, `docsuite_append_text`, `docsuite_replace_text`, and `docsuite_insert_image` create or edit a document. Inserted images come from Shared files. Replacing all content has broader effects on comments and tracked changes than appending or targeted edits.
- Use `docsuite_add_comment`, `docsuite_attach_comment`, `docsuite_update_comment`, and `docsuite_delete_comment` for comments. `docsuite_track_replace` records an exact text replacement; `docsuite_review_change` accepts or rejects it when safe. Review unresolved anchors or conflicts.
- `docsuite_import_docx` reads an agent-workspace Word file into a new shared document; `docsuite_export_docx` and `docsuite_export_pdf` write new agent-workspace files. Supported simple anchored comments can round-trip, while general, overlapping, or unsupported comments can be omitted or simplified with warnings. Word export does not include tracked-review metadata, and complex formatting can change. When that fidelity matters, keep the native shared document and tell the user what the export omitted.

## GridSuite

- `gridsuite_create` and `gridsuite_get` create/read workbooks. Use `gridsuite_set_cells` and `gridsuite_fill_cells` for values/formulas; `gridsuite_read_cells` returns raw and calculated values. Use `gridsuite_add_sheet`, `gridsuite_select_sheet`, and `gridsuite_rename_sheet` for sheets, and `gridsuite_set_chart`, `gridsuite_set_filter`, `gridsuite_resize`, or `gridsuite_sort_rows` as needed. Formula-bearing sheets cannot be sorted by the sort tool.
- `gridsuite_import_csv` / `gridsuite_import_xlsx` create shared workbooks from local workspace files; `gridsuite_export_csv` / `gridsuite_export_xlsx` write local outputs. CSV export can request calculated values. GridSuite calculates a bounded formula subset; external workbooks, 3D ranges, some Excel features, and complex formatting are not fully supported. Check the relevant function and conversion warnings, and verify important calculated results rather than assuming Excel parity.

## DeckSuite

- `decksuite_create` and `decksuite_get` return a shared presentation and stable slide IDs. Use `decksuite_add_slide`, `decksuite_update_slide`, or `decksuite_delete_slide` for slides; `decksuite_add_element`, `decksuite_update_element`, `decksuite_delete_element`, and `decksuite_arrange_elements` manage independent elements. `decksuite_apply_template` applies a built-in layout.
- `decksuite_export_template`, `decksuite_inspect_template`, and `decksuite_insert_template` exchange reusable slide templates through the agent workspace. PPTX import/export and PDF export use the corresponding `decksuite_import_pptx`, `decksuite_export_pptx`, and `decksuite_export_pdf` tools.
- Default results replace embedded images with revision-bound handles. Use `decksuite_export_image` with the handle to copy an image locally, or request `response_mode: "full"` when full embedded state is needed. Compact state is not valid input to a full-state save.

## PlanSuite

- Use `plansuite_create`, `plansuite_get`, and `plansuite_list_events` to create/read a shared calendar. `plansuite_add_event`, `plansuite_add_all_day`, `plansuite_add_recurring`, and `plansuite_add_events` add events; `plansuite_update_event`, `plansuite_update_all_day`, and `plansuite_delete_event` change them. Timed events need explicit offsets; an IANA `time_zone` on supported recurrence preserves local clock time across daylight-saving changes. All-day `end_date` is inclusive. Series edits/deletions can affect multiple occurrences.
- `plansuite_import_ics` merges supported events into an existing revision-checked calendar; `plansuite_export_ics` writes a new workspace file. Review unsupported recurrence or time-zone warnings.
- CalDAV is an optional external sync. When explicitly requested and configured, call `plansuite_caldav_preview`, review proposed changes and conflicts, then call `plansuite_caldav_sync` with the returned plan token and matching deletion setting. Deletions require explicit enabling on both calls. Preview again after a conflict or partial sync.
