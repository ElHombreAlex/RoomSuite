# RoomSuite MCP server

The optional MCP server gives a coding agent local, structured tools for producing RoomSuite output. It uses the official MCP SDK over **stdio**. Editor-based jobs open their own headless browser sessions; project and file utilities use the server or local filesystem directly. It does not control or close your open RoomSuite tabs.

## Install

The MCP integration requires **Node.js 20 or later**, npm, and a Chromium browser. The ordinary RoomSuite server can still run on Node.js 18 or later without these optional dependencies.

On Windows, the [RoomSuite installer](../windows/README.md) can install the MCP dependencies and matching headless Chromium as an optional component. Start RoomSuite and select **MCP setup** in its launcher to copy a configuration containing the correct bundled executable, workspace and browser paths. Add it to your agent's MCP settings and restart the agent. This route needs no separate Node, npm or browser installation.

On macOS, the [RoomSuite app](../macos/README.md) includes the MCP dependencies and matching headless Chromium. Open **MCP setup** in its launcher to copy the configuration; add it to the agent's settings and restart the agent.

For a source checkout on Windows, macOS or Linux, run from the repository root:

~~~sh
npm ci --prefix mcp
cd mcp
npx playwright install chromium
cd ..
~~~

On Linux, Chromium may require additional system libraries. See [Playwright's browser installation guide](https://playwright.dev/docs/browsers). If you already have a compatible browser, set ROOMSUITE_BROWSER_PATH to its absolute executable path instead of installing Playwright's Chromium. Playwright's bundled version is the recommended choice.

Start RoomSuite separately and leave it running:

~~~sh
node server.js
~~~

The MCP host starts the MCP process itself when needed; do not manually start it as a normal terminal service. The default RoomSuite URL is http://127.0.0.1:8090. If your service listens on another port, set `ROOMSUITE_MCP_URL` to its actual origin, for example `http://127.0.0.1:8093`.

## Connect a coding agent

For Codex, add the following to its configuration, replacing both absolute paths with paths on **the machine running the agent**:

~~~toml
[mcp_servers.roomsuite]
command = "node"
args = ["/absolute/path/to/RoomSuite/mcp/server.mjs"]
tool_timeout_sec = 600

[mcp_servers.roomsuite.env]
ROOMSUITE_MCP_WORKSPACE = "/absolute/path/to/agent-media"
ROOMSUITE_MCP_URL = "http://127.0.0.1:8090"
~~~

The longer tool timeout matters because Cliproom's default export runs in real time. An optional offline mode is available for supported projects, but its speed depends on the device. Increase the timeout for longer jobs and set ROOMSUITE_MCP_TIMEOUT_MS if the server render timeout also needs to be longer. See [OpenAI's MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Other MCP hosts commonly accept a stdio server entry like this; use the format required by your host:

~~~json
{
  "mcpServers": {
    "roomsuite": {
      "command": "node",
      "args": ["/absolute/path/to/RoomSuite/mcp/server.mjs"],
      "env": {
        "ROOMSUITE_MCP_WORKSPACE": "/absolute/path/to/agent-media",
        "ROOMSUITE_MCP_URL": "http://127.0.0.1:8090"
      }
    }
  }
}
~~~

The MCP process, its workspace, and the browser run on the agent's machine. If the agent is on a different machine from RoomSuite, localhost refers to the agent's machine; configure the suite URL and access accordingly. The existing RoomSuite server has no built-in login, so follow the access guidance in the [main README](../README.md#use-it-on-other-devices).

The agent host's sandbox must allow the MCP process to launch Chromium, access its configured workspace, and connect to the RoomSuite URL. If any of those are blocked, the corresponding tool call returns an error.

### Limit tool schemas for a focused workflow

By default, RoomSuite advertises a small set of common tools together with discovery and invocation tools. Use `roomsuite_find_tools` to search the complete enabled catalog, `roomsuite_tool_schema` to retrieve a selected input schema, and `roomsuite_invoke` to call it with `{"name":"decksuite_get","arguments":{"path":"Pitch.decksuite"}}`. Directly advertised tools can still be called normally. Set `ROOMSUITE_MCP_MODE=full` and reconnect to expose every enabled tool directly, as in earlier releases. Set `ROOMSUITE_MCP_MODE=compact` for only the six discovery, invocation and diagnostic tools.

To further limit available tools, set `ROOMSUITE_MCP_GROUPS` in the MCP environment to a comma-separated list such as `shared,decksuite,gridsuite`, then restart the connection. Available groups are `shared`, `notesroom`, `paintroom`, `pixelroom`, `soundroom`, `vectorroom`, `captureroom`, `cliproom`, `docsuite`, `gridsuite`, `decksuite` and `plansuite`. Discovery and deployment checks remain available. Include `shared` when you need file transfer or media-preview tools; add all groups needed by a multi-room workflow. `roomsuite_info` reports the available catalog, and `roomsuite_discover_suites` lists enabled productivity suites. An unknown group prevents initialization and is reported on MCP stderr. Groups reduce exposed schemas and are not an access-control boundary.

Discovery calls retain the original validations, progress, image previews, revision checks and error results. Malformed arguments fail as `INVALID_ARGUMENT`; later calls can continue. Standard and compact modes require an agent capable of the discovery-and-invoke workflow for tools that are not directly advertised; existing direct-tool integrations can select full mode.

## Productivity workflows

The productivity tools operate on editable files in the RoomSuite server's **Shared files**, not on paths in the agent's separate MCP workspace. A create action requires a new path with the appropriate extension; parent folders must already exist. Reads return the file's current `revision`, its state and a browser `url`. Pass that revision as `base_revision` to each edit. A stale revision fails without overwriting newer work. `roomsuite_productivity_get` and `roomsuite_productivity_save` offer full-state access for all four formats.

- **DocSuite:** Create, read, append, replace and insert images with the `docsuite_*` tools. `docsuite_add_comment` can attach to an exact `anchor_quote`; `anchor_occurrence` disambiguates repeated text. `docsuite_attach_comment` reattaches an existing comment, and update/delete manage it. Anchors follow ordinary editor text changes and are marked for reattachment when their text is removed. `docsuite_track_replace` records a text replacement and `docsuite_review_change` accepts or safely rejects it; conflicting changes require manual review. Tracked deletions are restored as plain text, and formatting/images are not tracked. Replacing the full document detaches anchors and marks pending changes for review with warnings. DOCX import and export preserve supported simple anchored comments; general, overlapping and unsupported cross-boundary comments are reported, and thread/resolved status can be simplified. Tracked-review metadata is not included in Word exports.
- **GridSuite:** Use the `gridsuite_*` tools for sheets, cells, formulas, charts, filters, CSV and XLSX. Same-workbook cross-sheet references calculate locally; `gridsuite_rename_sheet` updates them and `gridsuite_fill_cells` copies a formula with relative references or extends a numeric series over up to 1,000 cells. `gridsuite_set_chart` accepts legacy `values` or up to six named `series` entries such as `[{"name":"Sales","values":"B2:B5"},{"name":"Costs","values":"C2:C5"}]`, all matching the same `labels` range. `gridsuite_set_filter` applies a saved, non-destructive contains filter or clears it with null. Set `sheet_name` to target a sheet; omit it for the active sheet. Excel charts and supported cell styles round-trip within the limits in the main guide.
- **DeckSuite:** The `decksuite_*` tools manage slides, speaker notes, independent text/image elements and PowerPoint/PDF files. Use `decksuite_add_element`, `decksuite_update_element`, `decksuite_delete_element` and `decksuite_arrange_elements` with the current revision. `decksuite_apply_template` applies the built-in `standard`, `title`, `split` or `statement` layout without replacing slide text or images. `decksuite_export_template`, `decksuite_inspect_template` and `decksuite_insert_template` exchange complete reusable `.decktemplate` slides through the agent workspace; use Shared upload/download to exchange them with the editor. Templates contain text, embedded images and speaker notes and are limited to 7 MiB. A complete presentation must fit within the 8 MiB save request limit.

  By default, reads and edits return slide text and layout with each embedded image replaced by a revision-bound handle containing `path`, `slide_id`, `revision` and `mime_type`; an additional image element handle also contains `element_id`. Use the handle with `decksuite_export_image` to copy the image to the agent workspace; a stale revision is rejected. Set `response_mode: "full"` to retrieve embedded bytes, or `"summary"` for slide IDs, titles and image-presence flags. Compact state cannot be submitted to `roomsuite_productivity_save`; retrieve the complete state first. Ordinary edits preserve existing images without a full read.
- **PlanSuite:** The `plansuite_*` tools manage, import and export events. `plansuite_import_ics` merges supported date-only, UTC or IANA-zone events with a revision check and optional dry run; repeated UIDs are skipped. `plansuite_add_all_day` and `plansuite_update_all_day` use `YYYY-MM-DD` values with an inclusive `end_date`; the underlying file and `.ics` use an exclusive end date. An optional finite `rrule` creates an all-day series, whose UNTIL must be a date. All-day reminders use midnight in the server time zone. `plansuite_add_recurring` stores a finite timed RRULE with up to 52 occurrences. Pass `time_zone`, such as `Europe/Paris`, to keep the local event time across daylight-saving changes; `start` and `end` still require explicit offsets. Without a zone, recurrence is in UTC. Daily, weekly, monthly and yearly rules support `BYDAY` (including monthly/yearly ordinals), `BYMONTHDAY`, `BYMONTH`, `BYSETPOS` and `WKST` within the documented restrictions; EXDATE and recurrence overrides survive `.ics` export. Floating date-times, unknown zones and unsupported rule options are rejected. IANA time zones use device rules, not imported VTIMEZONE definitions; local times may shift for UTC recurrences. `plansuite_add_events` still accepts up to 52 individually supplied events; set `series: true` only for related occurrences. On update or delete, `scope: "series"` affects all linked events; the default is one occurrence. Some rule-preserving series time shifts are rejected when they would change the recurrence pattern. Reminders require ntfy and a running server.
- **Optional CalDAV:** Configure the collection and credentials in the RoomSuite server environment as described in the [PlanSuite guide](../README.md#productivity-suites). `plansuite_caldav_preview` takes the saved file revision and returns proposed actions, conflicts and a short-lived-in-practice plan token tied to the current local and remote state. `plansuite_caldav_sync` requires that token and the same deletion setting; it reports each outcome, warnings and `partial`. The server never returns credentials. Deletions require `allow_deletions: true` on both calls. Changes to remote-origin events that RoomSuite cannot safely preserve are not overwritten. A sync processes at most 50 changes, deferring the rest to another preview. Preview again after any partial result or conflict.

Use `roomsuite_shared_references` to check one server Shared file for possible references in saved notes and supported UTF-8 Shared files. Protected note copies are reported separately. If the bounded scan is complete and has no blocking matches, `roomsuite_shared_trash_unreferenced` takes its `revision` as `base_revision`, confirms awareness of unscanned work, and repeats the check under the server write lock before moving the file to recoverable trash. External files, unsupported formats and open or unsaved work are not scanned; text matches can be false positives. The existing ordinary trash and permanent-delete tools keep their original behavior.

Call `roomsuite_discover_suites` for capabilities and limits. Productivity edits require the current `base_revision`; after a conflict, read again before retrying. Tool failures retain a readable message and return `structuredContent.error.code` where available, including `REVISION_CONFLICT`, `NOT_FOUND`, `INVALID_ARGUMENT`, `FORBIDDEN`, `UNAVAILABLE` and `OPERATION_FAILED`. Schema validation errors are reported by the MCP protocol.

Deck slide creation and updates accept `text_style` with separate `title` and `body` objects. Each can set `font`, `size` in points, `bold`, `italic`, `align`, `line_height` and hex `color`. For example: `{"title":{"font":"Georgia","size":40,"bold":true,"align":"center"}}`. Omitted fields are preserved on updates. Font availability can differ between devices and Office applications.

After an update, call `roomsuite_check_deployment` from each connected agent to compare that MCP process with the running backend and served frontend. From a source checkout, `node mcp/check-deployment.mjs` checks a newly launched process. Restart stale processes and retry. See [Check an update](../README.md#check-an-update) for scope and limits.

Office imports read from the agent workspace and create new editable files in shared storage; Office exports write new files to the agent workspace and never replace an existing output. Review `warnings` returned by conversion: complex formatting and unsupported Office objects may not be preserved. Office conversion and PDF export use the bundled or configured headless browser.

For example, an agent can create `Budget.gridsuite` with cells `A1: "12"`, `A2: "8"` and `A3: "=SUM(A1:A2)"`, then call `gridsuite_read_cells` for `A3` to receive its raw formula and calculated value. The same file can be opened and edited by a person in GridSuite. See the [main guide](../README.md#productivity-suites) for file formats, limits and reminder behavior.

## Files and sessions

- ROOMSUITE_MCP_WORKSPACE is the directory the agent can use for inputs and outputs. If omitted, it defaults to the ignored mcp/workspace/ directory. The directory is created if necessary.
- The **server shared files** are a separate persistent workspace, accessed through `roomsuite_shared_*` tools. Shared paths use `/` and are relative to the server's shared-files root; MCP workspace paths refer to the machine running the agent. Upload and download tools copy between these two locations.
- Paths in tool arguments may be relative to that directory or absolute paths inside it. Output parent directories must already exist. Existing output files are never overwritten.
- Editor-based calls use separate browser sessions. Independent calls may run concurrently, subject to available CPU, memory, and browser resources.
- File-producing tools return JSON containing the output path, MIME type and size. For video output, supply a filename without an extension to let the browser choose .mp4 or .webm.
- For `cliproom_render`, `duration` applies to still images as a source end time. For audio or video clips use `source_in` and `source_out` instead; incompatible timing fields are rejected rather than ignored.
- PixelRoom, SoundRoom, VectorRoom and static CaptureRoom jobs process data in the local browser session. Cliproom imports each supplied media file into its server library, where it remains even when the generated project is not saved. Set save_project to true to also create an editable Cliproom project.
- Cancelling a call stops its browser job. An upload already completed by Cliproom remains in the server library.

The MCP workspace restriction is separate from your agent host's own filesystem permissions. Choose a workspace whose files the agent is allowed to access.

For complex artwork, prefer smaller `paintroom_create`/`paintroom_edit` calls or file-based element inputs assembled with the bounded workspace-write tools. Large parallel tool-call arguments can exceed a model or host's practical streaming limits. A malformed model response occurs before RoomSuite receives that call; the agent host should report it and retry generation without blindly repeating writes that already completed.

NotesRoom stores its mixed-media sequence in the Markdown `body`; media files are separate Shared files. An agent can upload a supported file with `roomsuite_shared_upload`, then use `notesroom_update` with the current revision to insert a line such as `![Sketch](/api/workspace/file?path=NotesRoom+media%2Fsketch.png){width=420}` or `[Voice note](/api/workspace/file?path=NotesRoom+media%2Fvoice.webm)`. Encode the shared path as a URL query parameter. Removing or moving a shared file can break the note; deleting the note does not delete its media.

## Tools

| Tool | What it does |
| --- | --- |
| roomsuite_info | Lists capabilities, the resolved workspace and the configured server URL. |
| roomsuite_list_files | List a workspace directory with file sizes and modification times, using offset/limit pagination. |
| roomsuite_media_info | Inspect a local image, audio or video file's type, dimensions and duration without uploading it. |
| roomsuite_preview_image | Return an existing raster image from the MCP workspace as an inline preview for a compatible vision-capable agent. |
| roomsuite_preview_video | Decode frames from a local video with WebCodecs or a browser-media fallback. The fallback returns null frame timestamps and durations when exact presentation timing is unavailable. |
| roomsuite_write_begin, roomsuite_write_append, roomsuite_write_finish, roomsuite_write_abort | Safely build a JSON or `.paintroom` file in bounded chunks in the agent workspace, with retry and optional checksum verification. |
| roomsuite_shared_list, roomsuite_shared_search | Browse a shared folder or search filenames and paths across the server workspace. Search returns at most 200 matches and reports `truncated` if the scan was limited. |
| roomsuite_shared_search_content | Search supported UTF-8 Shared files, optionally within a folder, and return bounded text snippets and scan/skip counts. Files above 1 MiB, unsupported formats and NotesRoom's separate store are excluded. |
| roomsuite_shared_preview | Read bounded plain text, inspect audio duration, or return an image/video frame as inline PNG from Shared files. Browser codec support still applies. |
| roomsuite_shared_upload, roomsuite_shared_download | Transfer a file between the agent's MCP workspace and the server shared workspace; existing destination files are never overwritten. |
| roomsuite_shared_mkdir, roomsuite_shared_move, roomsuite_shared_delete | Create a folder, move or rename a file/folder, or delete it; folder deletion requires `recursive: true`. |
| roomsuite_shared_trash, roomsuite_trash_list, roomsuite_trash_restore, roomsuite_trash_purge | Recoverable Shared files deletion, listing, conflict-safe restore and explicit permanent purge. Trash counts toward storage; the older `roomsuite_shared_delete` remains permanent. |
| roomsuite_shared_history_list, roomsuite_shared_snapshot, roomsuite_shared_history_download, roomsuite_shared_history_restore, roomsuite_shared_history_delete | List, create, verify, download, restore as a new file, or explicitly delete version snapshots. Up to 20 per saved path, 64 MiB each; versions count toward storage. Productivity saves try to snapshot their previous version and return `history_warning` if this was not possible. |
| pixelroom_recognize_text | Recognize text locally with the same English, French, Spanish or Italian OCR engine used by the editor. Returns approximate confidence and source-image line boxes for review. |
| pixelroom_add_layer, pixelroom_update_layer | Add image, text or shape layers, or update, duplicate, reorder and remove them in a new revision-checked project copy. `pixelroom_project_inspect` with `include_all` lists layer IDs and properties without returning embedded pixels. Image resizing preserves the layer's aspect ratio. |
| pixelroom_convert_isolated_text | Convert a transparent, already-isolated image layer into editable original lettering using local OCR. Supply corrected text when needed, use `dry_run` and an optional image preview, and review the result. Editable image masks must be applied or removed first; image color adjustments do not transfer to the text layer. |
| pixelroom_isolate_text_region | Select a rectangle in an unrotated image layer using normalized `region: {x, y, width, height}` coordinates from 0 to 1, then create a new editable original-lettering layer in a revision-checked project copy. Optionally provide a normalized `color_sample`, mask `tolerance` (5–130), corrected `text`, `new_layer_id`, or `rebuild_background: true`. Without rebuilding, the original letters remain in the image; rebuilding uses the local model and changes the image only in the output copy. `dry_run` and `include_preview` support review. The automatic mask is approximate and does not expose manual brush refinement; existing editable masks must first be applied or removed. |
| pixelroom_project_inspect, pixelroom_set_layer_mask | Inspect image-layer IDs and the file revision, then set or remove an editable cutout or local-color region in a new `.pixelroom` project (`target: "cutout"` or `"grade"`). PNG alpha or brightness selects the affected area; masks must match the source aspect ratio and fit within 2,048 pixels per side / 4 megapixels / 16 MiB. Version 2 projects containing masks require the updated PixelRoom. |
| cliproom_edit_structure | Add, update or remove tracks and titles using revision checks, dry runs and retry-safe operation IDs. Removing a nonempty track requires explicit clip removal; source media stays in the library. |
| cliproom_set_color_mask | Set or remove a static clip color-region mask from a workspace image with a checked project revision and optional dry run. The mask follows the picture, not moving objects. |
| cliproom_proxy_status, cliproom_create_proxy, cliproom_delete_proxy | Check, create or remove a derived optimized preview of a Cliproom video. Generation uses an isolated local browser and is limited to 256 MiB / 10 minutes / 16 megapixels; the server cache holds at most 100 copies or 1 GiB. The source and project remain unchanged and exports always use the original. |
| roomsuite_preset_list, roomsuite_preset_get, roomsuite_preset_create | List built-in looks or validate/create portable `.roomgrade` files in the MCP workspace. Transfer them with the shared upload/download tools. |
| roomsuite_lut_inspect, roomsuite_preset_preview | Validate a supported 3D `.cube` LUT; preview an image or up to six video-frame pairs before and after a look, with mean RGB statistics. |
| roomsuite_color_analyze, cliproom_analyze_waveform | Bounded RGB histogram/clipping statistics or local audio peak envelopes; neither gives an aesthetic or loudness judgment. |
| pixelroom_project_inspect, pixelroom_apply_preset | Inspect image layer IDs and a SHA-256 file revision, then write a new editable project with a look or use `dry_run`. |
| cliproom_apply_preset | Apply a look or adjustments to explicit clip IDs with the current project revision, optional strength, enable state and `dry_run`; color keyframes are preserved and reported. |
| notesroom_list, notesroom_get | Search notes by text, folder or tag; read Markdown, metadata, revision and a RoomSuite URL. |
| notesroom_create, notesroom_update, notesroom_delete | Create, edit or delete notes. Updates and deletions require the current `base_revision`. |
| notesroom_folders, notesroom_delete_folder | List or create nested folders, or delete an empty folder. |
| notesroom_link, notesroom_links | Add a stable note-ID link with a source revision, or inspect bounded outgoing links and backlinks from saved notes. Missing targets and incomplete scans are reported. |
| notesroom_attachment_create, notesroom_attach_media, notesroom_protect_media | Create a protected image/audio copy, attach one to a revision-checked note, or upgrade older supported path-only media links. Identical copies are reused; prepared copies remain if saving fails. |
| notesroom_attachment_audit, notesroom_attachment_delete | Scan saved-note references and explicitly delete an unused protected copy after a 24-hour grace period. Open or unsaved notes and exported Markdown are not inspected; incomplete scans block deletion. Copies count toward workspace storage. |
| notesroom_export_bundle, notesroom_import_bundle | Export a saved note revision and its supported image/audio media to `.roomnote`, or verify and import it as a new note with protected copies. Reuse `import_id` after a timeout; links to other notes do not include those notes. |
| paintroom_list, paintroom_get, paintroom_brush_presets | List or read saved PaintRoom projects and their editable layers, or discover built-in brush sizes and opacities. |
| paintroom_create, paintroom_edit, paintroom_clone, paintroom_import_project | Create, import, clone or edit artwork, with IDs, file-based elements, Bézier paths and revision checks. Set `include_preview` for an inline image in the same response. |
| paintroom_preview, paintroom_preview_sheet | Preview one saved project, or compare 2–12 projects in a labeled contact sheet. |
| paintroom_export | Export a saved project to the MCP workspace as PNG, `.paintroom`, SVG, or editable `.vectorroom`. VectorRoom export rejects unsupported compositing instead of silently flattening. PNG uses a local browser. |
| paintroom_export_batch | Export a sequence of saved projects as PNGs and a revision-and-hash manifest; byte-identical PNGs reuse a path. |
| pixelroom_edit | Apply primary color adjustments or a `.roomgrade` look, optionally run local subject removal, crop and rotate, and export PNG, JPEG or WebP. Rotation happens after cropping and may extend beyond the existing canvas. |
| pixelroom_inpaint | Rebuild a selected region with the bundled local model. Supply matching image and mask files (white selects; black or transparent preserves); export a PNG and inspect the result. `padding` and `feather` are source-pixel values. |
| soundroom_edit | Trim, normalize, set gain/fades, three-band EQ, compression, a local quiet-section noise gate and sample-peak ceiling, then write a WAV or a new editable `.soundroom` session. Session input requires the inspected revision. |
| soundroom_handoff_cliproom | Upload a processed WAV and a separate editable float source with SoundRoom settings, optionally creating a Cliproom project. Supply a fresh `handoff_id`; retries with identical input/settings reuse media and the project. Cliproom plays the processed copy; reopen the linked source in SoundRoom to make changes and send a new clip. |
| soundroom_session_inspect, soundroom_analyze_loudness | Validate a session and return its revision/settings, or analyze the processed result as bounded integrated LUFS and sample peak; this is not a certified true-peak meter. |
| vectorroom_create, vectorroom_preview | Create shapes, text and Bézier paths with optional object opacity; export SVG, PNG or an editable .vectorroom project, or preview a composition without writing a file. Text supports multiline strings, fonts, `font_weight`, `font_style`, `text_align`, `line_height` and `letter_spacing`. `vectorroom_create` also accepts `include_preview`. |
| vectorroom_inspect_project, vectorroom_arrange_project, vectorroom_update_project | Inspect IDs, properties, groups and browser-measured bounds; use the SHA-256 revision to group, align, distribute, move, combine or edit one object's properties in a new `.vectorroom` file. Select one path and use `include_path_nodes` to read its nodes. Edits support `dry_run`; incompatible properties are rejected and grouped objects must first be ungrouped. Legacy files with missing IDs can be targeted by index and saved as a normalized copy. |
| captureroom_record_scene | Record a prepared image/text scene at 360p, 720p or 1080p, with optional countdown, 15/30 fps target and scheduled pause/resume intervals. Scene coordinates remain in a 1280 × 720 space. |
| captureroom_template_create, captureroom_template_inspect | Create or inspect a portable `.capturescene` scene. Images are embedded; screen, camera and microphone sources are placeholders without device identifiers or streams. |
| cliproom_import_media | Upload media to the Cliproom library and return the asset metadata needed in a project. |
| cliproom_audit_media, cliproom_media_trash_list | Inspect saved-project references and list recoverable Cliproom media trash. Unreferenced does not mean unused by open or unsaved projects. |
| cliproom_media_trash, cliproom_media_restore, cliproom_media_purge | Recheck and trash media at least 24 hours old, restore without overwrite, or explicitly confirm permanent deletion. Cleanup is blocked by incomplete audits, saved references and active server renders. |
| cliproom_import_subtitles, cliproom_generate_subtitles, cliproom_export_subtitles | Import SRT/WebVTT or evenly time supplied text as editable title overlays, then export marked titles as SRT/WebVTT. Generation is not speech recognition. Writes require the current project revision; use `dry_run` to inspect changes. |
| cliproom_export_package, cliproom_import_package | Export a saved revision and its media to a bounded `.roomclip` file, or verify and import it as a new project with new media IDs. |
| cliproom_list_projects | List saved projects with IDs and revisions. |
| cliproom_get_project | Return a saved project, or write its JSON to a new workspace file. |
| cliproom_save_project | Create a project from workspace JSON, or update one using its current revision. |
| cliproom_edit_timeline | Revision-checked update, split, duplicate, remove or dissolve a picture/audio clip, and set or remove keyframes. Preview with `dry_run`. Supply a fresh UUIDv4 `operation_id` for a write; a repeat with the same ID and arguments returns the prior result instead of repeating the edit. The project retains the most recent 64 operation receipts. A stale revision still protects older retries, and source files stay in the media library. |
| cliproom_speech_model_status, cliproom_install_speech_model, cliproom_transcribe_clip | Check or explicitly install the optional local model, then transcribe one saved clip into reviewable timed cues and optionally a new workspace SRT/VTT. Import reviewed cues using `cliproom_import_subtitles`. A server-wide slot limits MCP transcription to one at a time. The selected source, not a mixed timeline, is transcribed; accuracy, browser decoding, source-size and memory limits apply. |
| cliproom_render | Assemble media and titles on tracks, apply transforms, color looks and source-time or timeline-time keyframes, optionally save the project, and render a video. |
| cliproom_render_project | Render a saved project ID or workspace project JSON through the server endpoint. |

Color operations accept a `preset_path` or inline `color_adjustments` and `color_look`; `lut_path` embeds a workspace `.cube` and `remove_lut` removes an existing LUT. A preset cannot be combined with inline adjustments or a creative look. Look strength and enable state remain separate. See [the shared color contract](../COLOR_GRADING.md) for formats, bounds, processing order, keyframes and preview/export limitations.

For `cliproom_render`, each picture keyframe may also provide `creative_look` with `curves`, `hsl`, and `wheels`. It is a complete snapshot: omitted values are neutral, while the clip's LUT remains fixed. Snapshots interpolate over source time, including after trims or speed changes, and create a version 5 project when saved. Existing keyframes are retained and reported when a look is applied to a saved clip.

CaptureRoom's MCP tool does **not** capture a live screen, camera or microphone. Those require a person to grant permission in a browser on the device being captured. The MCP integration does not provide live streaming. Browser codecs, model availability, and device performance still limit exports. Subject removal is approximate and the resulting image should be reviewed.

For `captureroom_record_scene`, provide either `template_path` or direct image/text options. A template with a visible live-source placeholder is rejected until a person reconnects it in CaptureRoom; hidden placeholders are left disconnected and reported in `warnings`. Transfer `.capturescene` files through the existing Shared files tools.

CaptureRoom's optional interruption recovery is local to a person's browser profile and device. The MCP recorder uses an isolated browser session and writes its finished artifact directly to the agent workspace; it does not inspect or manage another browser's recovery copies.

## Visual feedback for agents

RoomSuite can return a PNG **image content block** alongside the usual text and structured project metadata. The MCP host must pass image blocks through to a vision-capable model; a text-only host or model cannot judge the picture merely because the server returns it. Confirm this with your harness: call `paintroom_preview` or `vectorroom_preview` and check whether the agent actually receives the image, not just JSON or a file path.

For example, create an editable shape and ask for a preview in the same tool call:

~~~json
{
  "name": "Horse frame 1",
  "width": 600,
  "height": 400,
  "elements": [{"type":"ellipse","x":120,"y":100,"x2":410,"y2":280,"fill":"#a89472"}],
  "include_preview": true
}
~~~

Inspect the returned image, then call `paintroom_edit` with the returned `project_id`, `base_revision: 1`, `updates: [{"index":0,"x2":440}]`, and `include_preview: true` to adjust that ellipse and see the new result immediately. Indices are zero-based within the chosen layer at the supplied revision. Objects can also have stable IDs: set `id` when creating an element or read its generated ID with `paintroom_get`, then address it with `object_id` in an update or `remove_ids` when removing it. IDs are unique within a project and preserved by `paintroom_clone`. Use `paintroom_get` to inspect layers and their object order, and pass `layer_id` to edit a particular layer; the last layer is used by default. `updates` changes supported fields on existing objects, `remove_indices`/`remove_ids` removes objects, and `elements` appends new ones. Each update specifies exactly one `index` or `object_id`. Updates and removals refer to the original object order before removals; conflicting, invalid or stale targets are rejected. The saved project's new revision and the preview are returned together.

Strokes in `paintroom_create` and `paintroom_edit` may specify `brush_preset` (`round`, `fine`, `marker`, or `broad`), `symmetry` (`none`, `vertical`, `horizontal`, or `both`), and normalized `pressure` on every point. Explicit width or opacity overrides the preset. Mirrors are separate saved objects reflected about the canvas axes, including on transformed layers; overlapping translucent strokes blend independently. Pressure changes width from 5% to 100% of the configured width. PNG and SVG preserve that outline. VectorRoom currently requires a flattened PNG for pressure strokes and reports this instead of silently dropping pressure. Pen sampling is an interactive-device capability; agents supply the pressure samples directly.

A lasso selection is an editor-only temporary gesture; its resulting mask is stored on the selected layer. `paintroom_create` accepts `mask: {"mode":"show"|"hide","points":[{"x":20,"y":20},{"x":100,"y":20},{"x":100,"y":100}]}`. `paintroom_edit` and `paintroom_clone` can replace that mask or remove it with `mask: null`, using the current revision. Points use layer-local coordinates, including on transformed layers. One polygon per layer uses the even-odd rule; there is no feathering or multiple mask stack. Masks apply after the layer objects are composited, and are preserved in editable projects, PNG and SVG. VectorRoom requires a flattened image for masked layers.

Use `paintroom_preview` for a saved project or `paintroom_preview_sheet` with `project_ids` to compare up to 12 frames side by side. The sheet labels the frames and uses white behind transparent areas; individual previews preserve transparency. `vectorroom_preview` previews VectorRoom elements without saving an output file. `roomsuite_preview_image` previews an existing PNG, JPEG, WebP, GIF or AVIF inside the MCP workspace, with a 20 MiB source limit.

`paintroom_preview` also accepts `crop: {"x":0,"y":0,"width":200,"height":150}` in original canvas pixels. A contact sheet can request `similarity: true` for a matrix of pixel similarities: it compares 64 × 64 thumbnails composited over white, where 1 means equal sampled pixels. It is an advisory cue for finding repeated or very similar pictures, not a judgment of animation or artistic quality; intentional holds and loops are valid.

Previews are opt-in on create/edit operations to avoid unnecessary browser startup and image payloads. They are rendered locally through the room, bounded in size and returned in memory without creating a preview file. `max_dimension` (or `preview_max_dimension` on create/edit) accepts 256–1536 pixels; default is 1024, or 1536 for contact sheets. This is still a snapshot per call, not a live stream. If a preview fails **after** a create or edit succeeded, the response keeps the saved project ID and revision and reports `preview_error`; retry `paintroom_preview` rather than creating the project again. The same rule applies to a saved VectorRoom output with a failed preview.

For PaintRoom `rect` and `ellipse` elements, a filled shape has no outline unless `color` or `width` is supplied, or `stroke: true` is requested. Use `stroke: false` to suppress an outline explicitly. Unfilled shapes and lines retain their default outlines. VectorRoom's filled rectangles and ellipses also default to no outline; specify `stroke` or `stroke_width` when one is wanted. Existing saved projects keep their stored outlines.

`soundroom_edit` and `soundroom_analyze_loudness` accept `noise_gate: {"enabled":true,"threshold_dbfs":-45,"reduction_db":24}` and `limiter: {"enabled":true,"ceiling_dbfs":-1}`. The gate reduces quiet sections, is limited to mono/stereo with six million channel samples, and does not remove noise under loud material. The hard sample-peak ceiling can distort and is not a true-peak limiter. These settings persist in `.soundroom` sessions.

`soundroom_edit` normalizes to −3 dBFS by default. Supply `normalize_peak_dbfs` between −24 and 0 to choose a target and enable normalization. The 300% gain ceiling and whole-percent gain steps can leave the measured peak below the requested target; `gain_percent`, if supplied, overrides normalization.

`captureroom_record_scene` fits an image to the 1280 × 720 frame by default. Set `image_fit` to `contain` or `cover`, or specify `image_box` with `x`, `y`, `width`, and `height`. Text wraps inside `text_box`; absent an explicit box, it uses the visible image area or a safe frame margin. The default contrast backdrop can be disabled with `text_backdrop: false`, and `text_fit: false` preserves the supplied font size even if text is clipped. CaptureRoom writes duration metadata to supported streaming WebM recordings. Cliproom also attempts to read older recordings that lack that metadata.

For example, an agent can call vectorroom_create with:

~~~json
{
  "output": "cover.png",
  "elements": [
    { "type": "rect", "x": 60, "y": 60, "width": 880, "height": 580,
      "fill_mode": "gradient", "fill": "#6955cf", "fill2": "#f2b6a5" },
    { "type": "text", "x": 120, "y": 320, "text": "Hello, RoomSuite",
      "font_size": 72, "fill": "#ffffff" }
  ]
}
~~~

It can then use cover.png as an input to pixelroom_edit or cliproom_render. Run roomsuite_info first if the agent needs to discover the configured workspace.

## Frame workflow for agents

For larger drawings, put the array of PaintRoom elements in a JSON file inside the MCP workspace, then call `paintroom_create` with `elements_path` in place of `elements`. `paintroom_edit` and `paintroom_clone` also accept `elements_path` for appended objects and `updates_path` for updates. The file is subject to the same element/update validation as inline arguments and has a 16 MiB limit. Supply either the inline argument or its path, not both. `paintroom_import_project` accepts a `.paintroom` or JSON file containing a complete PaintRoom state, or a saved-project wrapper with a `state` field, up to 32 MiB. Imported projects are saved as new projects.

When the agent cannot write files itself, call `roomsuite_write_begin` with a new `.json` or `.paintroom` `output` path; append ordered `text` chunks with `roomsuite_write_append` using the returned `session_id` and zero-based `index`; then call `roomsuite_write_finish`. Each chunk must contain complete Unicode characters and at most 8,192 UTF-8 bytes, and the whole file is limited to 16 MiB. A retry of the same index and contents is safe; changing an already accepted chunk is rejected. Finish checks valid JSON, optionally verifies a supplied SHA-256, and publishes the file without replacing an existing file. `roomsuite_write_abort` discards a session. Sessions expire after 30 minutes of inactivity and do not survive an MCP process restart; abandoned temporary files are cleaned up. This helper writes to the **agent MCP workspace**, not the server shared-files area.

Create one frame and call `paintroom_get` to learn the object IDs and layer IDs. Then call `paintroom_clone` with `source_project_id`, its current `source_revision`, a new `name`, and targeted `updates` such as `[{"object_id":"near-leg","points":[{"x":20,"y":40},{"x":35,"y":65}]}]`. The source stays unchanged and IDs are retained in the new project, allowing the same IDs to refer to corresponding limbs across frames. An old project without IDs receives deterministic IDs when read; they are saved when the project is edited or cloned. A stale source or edit revision is rejected. Indices remain available for existing clients. Optional caller-supplied UUIDv4 `project_id` on create/import/clone makes recovery easier if a response is lost: check that ID before retrying. Preview failures after saving return the project ID and a `preview_error` rather than hiding the successful save.

The `path` element has two or more points, with absolute `x`, `y`, `in_x`, `in_y`, `out_x`, and `out_y` coordinates. Omitted handles default to the anchor, so straight and curved segments can be mixed. Set `closed`, `fill`, `stroke`, `color`, `width`, and `opacity` as needed. Paths remain editable in PaintRoom, SVG and supported VectorRoom transfers. For coordinated transforms, put related objects on one layer and set `transform.pivot_x`/`pivot_y`, `rotation`, `scale`, `x` and `y`. Layers are groups; nested groups and animated pivots are not currently available.

Call `paintroom_export_batch` with ordered `project_ids`, a new `prefix`, optional `directory` and `fps`. It creates PNGs and a `<prefix>-manifest.json` containing each project's ID, revision, dimensions, path and SHA-256. Identical PNG bytes share one output path while each entry retains its own provenance. The returned `complete` flag and optional `error` describe partial export; inspect the returned frames before retrying with a new prefix. A `manifest_error` reports if frame files were written but the manifest could not be saved. Outputs are never overwritten or silently deleted.

Use the ordered manifest paths with `cliproom_render.frame_sequence`, or import a frame once with `cliproom_import_media` and use its returned ID in `frame_sequence.frame_asset_ids`. `cliproom_render` returns its input-to-asset mapping in `assets`; later variations can pass those IDs, or use `media` entries with `asset_id`, to reuse the existing Cliproom library files. Supply exactly one of `input` or `asset_id` per media entry, and exactly one of `frames` or `frame_asset_ids` for a sequence. Asset IDs belong to the same RoomSuite server and are checked when reused. Previously imported assets remain in the library; no shared asset is removed automatically.

After rendering, call `roomsuite_preview_video` with `input` and up to 12 encoded-file `times`, or set `preview_times` on either render tool. The returned image shows the decoded frame for each requested timestamp, and `frames` reports each requested time, actual presentation time and frame duration. The video track's start/end, total end timestamp, optional metadata duration, dimensions, codecs and audio-track list are returned too. Times are encoded-media timestamps, not Cliproom timeline or source-clip keyframe times; requests must fall within the video track. The last frame starting at or before the requested time is shown, including for variable-frame-rate files. A successful render is retained if inspection fails, with a `preview_error` so it can be inspected again. Browser codec support still applies, and the MCP browser requires the installed Mediabunny dependency. Audio-track presence does not establish that the audio is audible.

## Shared-file workflow

For an image uploaded from a phone, an agent can use these calls in order (replace names and IDs with the returned values):

1. `roomsuite_shared_search` with `{"query":"photo"}` finds its server path, such as `Phone/photo.jpg`.
2. `paintroom_create` with `{"name":"Launch artwork","shared_image":"Phone/photo.jpg","elements":[{"type":"rect","x":20,"y":20,"x2":180,"y2":100,"color":"#ff0000"}]}` creates an editable project. `paintroom_edit` can add strokes or change a layer, using its returned `project_id` and latest `revision` as `base_revision`.
3. `paintroom_export` with `{"project_id":"<id>","format":"png","output":"launch.png"}` writes a local agent-workspace file. Optionally use `roomsuite_shared_upload` with `{"input":"launch.png","path":"Launch/launch.png"}` to make it available to other devices (create `Launch` first).
4. Call `cliproom_render` twice with different output names and keyframes, using `launch.png` as the input. It imports its own server-library copy; see [Animate a video](#animate-a-video).
5. `notesroom_create` can save Markdown documenting the artwork's returned URL, video outputs and project decisions. Its returned URL can be opened by other authorized devices.

Saved notes and PaintRoom projects use server revisions to reject conflicting writes. These tools inherit the suite's trusted-device access model; they do not add individual user accounts. See the main README for storage limits and independent backups.

## Animate a video

For example, call `cliproom_render` with the following arguments after creating `cover.png`:

~~~json
{
  "output": "moving-cover",
  "name": "Moving cover",
  "save_project": true,
  "render_mode": "offline",
  "media": [{
    "input": "cover.png", "duration": 5, "scale": 0.6, "x": 25, "y": 50,
    "keyframes": [
      { "timeline_time": 0, "x": 25, "scale": 0.6, "opacity": 0.4 },
      { "timeline_time": 5, "x": 75, "scale": 1, "opacity": 1 }
    ]
  }]
}
~~~

`x` and `y` are the center position as percentages of canvas width and height; `scale` is a multiplier, and opacity and volume range from 0 to 1. Other animatable properties are `rotation` in degrees and `brightness`, `contrast`, and `saturation` in percent. `fit`, fades, source ranges, speed, tracks and titles remain available.

Use **`timeline_time`** for an absolute time on the project timeline; it must fall within the clip. Alternatively use **`source_time`** for a time in the original media. Specify exactly one per keyframe. The older `time` field remains supported as a legacy alias for `source_time`, so existing agents keep their original behavior; the result includes a warning when it is used. For example, a clip starting at timeline 2 seconds with `source_in: 5` at normal speed can use `timeline_time: 2.5`; it will be stored as source time 5.5. At 2× speed, the same timeline point maps to source time 6. Project JSON and the Cliproom inspector continue to store and display **source seconds**. For a still image, the existing `duration` argument sets its source end time; with a nonzero `source_in`, the timeline length is `(duration - source_in) / speed`.

Each property interpolates linearly between frames that set it. If its first frame is after source time zero, the clip's base value acts as an implicit point at zero; after its last frame the value stays constant. This keeps the animation attached to the source through moves, trims, splits and speed changes. Fades multiply animated opacity and volume.

The saved project returned by `save_project` can be opened and edited in Cliproom. The inspector shows keyframe controls and timeline markers; older projects load normally. Version 5 is used for advanced grading, subtitles, SoundRoom links and agent edit receipts; earlier Cliproom releases cannot reopen those projects, so retain a backup if needed.

## Loop still frames

`cliproom_render` can assemble a repeating frame sequence without duplicating uploads. For example:

~~~json
{
  "output": "horse-loop",
  "name": "Horse cycle",
  "save_project": true,
  "render_mode": "offline",
  "background": "#000000",
  "frame_sequence": {
    "frames": ["horse-1.png", "horse-2.png", "horse-3.png", "horse-4.png", "horse-5.png", "horse-6.png"],
    "fps": 12,
    "duration": 10
  }
}
~~~

The sequence cycles through the images, creates 120 editable clips for 10 seconds, and imports each distinct input file once. Adjacent clips do not need artificial overlaps. `frame_sequence` also accepts `start`, `track`, `fit`, `scale`, `x` and `y`; add a `media` array for other tracks, such as sound. Repeated paths in `media` also reuse one import within the same call. Imports remain in Cliproom's server library after rendering. The 10,000-clip project limit applies to the combined timeline. Old projects retain Cliproom's original `#26252e` background; choose `background` or use the project inspector to control the color revealed by fades.

## Work with existing projects

1. Call `cliproom_list_projects` to find a project ID and revision. Use `cliproom_get_project` with `project_id` to read it, or add `output: "project.json"` to write the saved-project wrapper into the MCP workspace.
2. Edit that JSON file as needed. Use `cliproom_import_media` to upload another local file and get the asset metadata; reference it from the project state. All project assets must exist on the same RoomSuite server.
3. Call `cliproom_save_project` with `project_path: "project.json"` to save a new copy. To update the original, also supply `project_id` and its current `base_revision`. The server rejects stale revisions instead of overwriting a newer edit. Output files are never overwritten.
4. Call `cliproom_render_project` with `project_id` or `project_path`, plus an output filename stem. It returns the saved video path, size and MIME type. The HTTP endpoint can also be called directly; see [Render from a program](../cliproom/README.md#render-from-a-program).

Both Cliproom render tools send the assembled or saved project to the render endpoint; `cliproom_render` only saves a project when `save_project` is true. The endpoint needs the optional MCP dependencies and Chromium on the **RoomSuite server**, available to the server process's user, even if the MCP client runs on another machine. Set `CLIPROOM_RENDER_TIMEOUT_MS` on the server and the MCP/host timeouts high enough for longer projects.

`render_mode` defaults to `realtime`, which uses the existing browser exporter. Set `render_mode: "offline"` on either render tool to encode timeline frames and mix audio without waiting for playback. Offline mode returns **WebM**; omit the output extension or use `.webm`. It supports normal-speed video and audio, still JPEG/PNG/WebP images, titles, tracks, fades and keyframes, for projects up to 10 minutes. Retimed video or audio, animated images and AVIF require realtime mode. Unsupported codecs also return an error suggesting realtime mode. Offline rendering requires compatible Chromium WebCodecs, keeps decoded audio and the output in memory, and may be faster or slower depending on the project and hardware. It uses [Mediabunny](https://github.com/Vanilagy/mediabunny) (MPL-2.0), installed with the MCP dependencies. Imported assets remain on the server in either mode.

In realtime mode, choose an output ending in `.mp4` or pass `output_format: "mp4"` to request H.264 video with AAC audio; choose `.webm` or `output_format: "webm"` for WebM. An explicit filename extension and format must agree. Silent image-only projects need H.264 support but no audio encoder. Set `include_audio: false` only when a deliberately silent export is wanted, including for source videos that contain sound. For audible projects, when the browser supports H.264/Opus but not native AAC, RoomSuite converts the recorded audio to AAC locally using the optional `@mediabunny/aac-encoder` dependency. Conversion needs additional time and memory; it fails rather than omitting audio if the fallback cannot run. `ROOMSUITE_BROWSER_PATH` can select a compatible browser. Offline mode remains WebM-only.

## Verify

After installing the MCP dependencies and browser:

~~~sh
npm test --prefix mcp
~~~

The integration tests start temporary local RoomSuite servers, use a real MCP client over stdio, inspect and produce media, check timeline/source keyframe mapping, rendered motion and audio in both modes, and exercise project management, the render endpoint, parallel jobs, cancellation and file boundaries. Browser-heavy test files run sequentially to avoid starving realtime recording; individual tests still check concurrent jobs. Set ROOMSUITE_BROWSER_PATH if using a system browser. To include the slower local PixelRoom subject-model check:

~~~sh
ROOMSUITE_MCP_TEST_MODELS=1 npm test --prefix mcp
~~~

To also exercise the bundled cleanup model through `pixelroom_inpaint`, set `ROOMSUITE_TEST_CLEANUP_MODEL=1`. That test takes longer because it loads and runs the model locally.
