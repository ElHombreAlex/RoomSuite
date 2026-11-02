# RoomSuite

RoomSuite is a self-hosted workspace for creative work, productivity, notes and shared files. Use the launcher switch to choose Creative or Productivity. Each room or suite opens in its own tab or window, so you can work in several at once:

RoomSuite 3 adds shared photo and video grading with portable looks, editable audio sessions, safer shared-file recovery, and improvements across the creative and productivity rooms. Version 3.2 adds MotionRoom for animating artwork. See [what's new and known limits](RELEASE_NOTES.md).

- **PixelRoom** — photo editing, layers, text and local subject/text isolation.
- **Cliproom** — a multitrack video editor with a server-backed media and project library.
- **SoundRoom** — record or import audio, select, trim, cut, mark splits, adjust volume and fades, and export WAV.
- **CaptureRoom** — arrange screen, camera, microphone, image and text sources into scenes and record them.
- **VectorRoom** — create shapes, text and editable Bézier paths, with solid or gradient fills and SVG/PNG export.
- **NotesRoom** — write and organize Markdown notes, add voice clips, images and quick sketches, and use a visual board or browser dictation.
- **PaintRoom** — paint and draw on a layered canvas, import images, transform layers, and save editable artwork.
- **MotionRoom** — animate PaintRoom layers and VectorRoom objects on a keyframe timeline, then export video.
- **DocSuite** — write formatted documents with lists, tables, links and shared images; import/export DOCX and plain text, and print to PDF.
- **GridSuite** — edit workbooks, calculate common formulas, make bar or line charts, and import/export XLSX and CSV.
- **DeckSuite** — create and present slides with text and shared images, import/export PPTX, and print to PDF.
- **PlanSuite** — keep a local calendar of events and optionally send reminders to an ntfy topic.
- **Shared files** — upload, search, organize and transfer files between your devices and rooms.

Sessions are separate for each tab, and there is no application-imposed limit on the number of open rooms. Available memory, camera access, browser behavior and device performance still affect how many can be used at once.

## Windows setup

The Windows installer supports x64-compatible Windows 10 and 11. It installs for the current user without administrator rights and includes its own Node.js runtime. The optional MCP browser follows [Playwright's system requirements](https://playwright.dev/docs/intro#system-requirements), which currently list Windows 11 or newer; it may work on Windows 10 but is not guaranteed there.

1. Download `RoomSuite-Setup.exe` from the [latest GitHub release](https://github.com/ElHombreAlex/RoomSuite/releases/latest) and open it. See [building the installer](windows/README.md) to make it from source. The installer is not code-signed, so Windows may display an unfamiliar-publisher warning.
2. Choose **RoomSuite with MCP and headless rendering** if you want agents to use the rooms. The optional component includes the MCP dependencies and a matching headless browser; it does not download anything during installation. You can rerun the installer to add it later.
3. Open **RoomSuite** from the Start menu. It starts a local server and opens the suite in your browser. Keep the RoomSuite window open while you work; closing it stops the server. You can also opt into a desktop shortcut during setup.
4. To connect an agent, select **MCP setup** in the RoomSuite window, copy the JSON or Codex TOML configuration into the agent's MCP settings, and restart the agent. The installer does not edit agent settings for you. See the [MCP guide](mcp/README.md) for usage and host-specific details.

The app opens at **http://127.0.0.1:8090/**. If another program uses that port, stop it before starting RoomSuite. Saved projects, files, and the agent workspace are kept under `%LOCALAPPDATA%\RoomSuite`, separate from the installed program. Close RoomSuite before backing up that folder. Uninstalling from Windows Apps removes installed program files but leaves this data in place. Updating means downloading and running a newer installer; choose the MCP component again if you use it.

### Run from source on Windows

If you prefer a checkout, install Git and Node.js 20 or later, then run in PowerShell:

~~~powershell
git clone https://github.com/ElHombreAlex/RoomSuite.git
cd RoomSuite
node server.js
~~~

Open **http://127.0.0.1:8090/** in your browser and keep the terminal open. Press Ctrl+C to stop the server. The standard interface requires no npm install. MCP and the server-side render endpoint have [additional setup steps](mcp/README.md#install).

The source checkout and the Windows installer use separate data directories by default. To run this source build with the installer's existing files, close the installed RoomSuite first, then set its data paths in the same PowerShell session before starting the source server:

~~~powershell
$roomSuiteData = if ($env:ROOMSUITE_APP_DATA) { $env:ROOMSUITE_APP_DATA } else { Join-Path $env:LOCALAPPDATA 'RoomSuite' }
$env:CLIPROOM_DATA = Join-Path $roomSuiteData 'data\cliproom'
$env:ROOMSUITE_DATA = Join-Path $roomSuiteData 'data\workspace'
node server.js
~~~

Use only one RoomSuite server with a particular data directory at a time. The source build does not update the installed application; opening the installer again will run its installed version.

## macOS setup

RoomSuite provides separate installers for Apple silicon and Intel Macs running macOS 14 or later. Download the matching `RoomSuite-macOS-arm64.dmg` or `RoomSuite-macOS-x64.dmg` from the [latest GitHub release](https://github.com/ElHombreAlex/RoomSuite/releases/latest). Open the disk image, drag **RoomSuite** to **Applications**, and open it from there. The app includes Node.js, the MCP dependencies and headless Chromium; Git, Node and npm are not needed on the Mac.

The app is not signed or notarized. macOS will warn on first launch; after trying to open it, use **System Settings → Privacy & Security → Open Anyway** to approve it. See [Apple's guidance](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/mac) and the [Mac installer guide](macos/README.md). Do not disable Gatekeeper globally.

RoomSuite opens in your browser at **http://127.0.0.1:8090/**. Keep its launcher window open while working; closing it stops the server. Use **MCP setup** to copy agent configuration. The package does not change your agent settings. Your files and agent workspace are stored in `~/Library/Application Support/RoomSuite`, outside the application; close RoomSuite before updating or backing up. Replacing or removing the app does not remove this folder. Browser codec support and macOS camera, microphone and screen-recording permissions affect the available features.

### Run from source on macOS

Install Git and Node.js 20 or later, then use Terminal:

~~~sh
git clone https://github.com/ElHombreAlex/RoomSuite.git
cd RoomSuite
node server.js
~~~

Open **http://127.0.0.1:8090/** and keep Terminal open. Press Ctrl+C to stop the server. The standard interface requires no npm install; the [MCP guide](mcp/README.md#install) covers optional agent tools and headless rendering. A source checkout uses its own data directory unless configured explicitly.

## Linux setup

Install Git and Node.js 18 or later (use Node.js 20 or later for MCP and server-side rendering):

~~~sh
git clone https://github.com/ElHombreAlex/RoomSuite.git
cd RoomSuite
node server.js
~~~

Open **http://127.0.0.1:8090/** on the server and choose a room. Press Ctrl+C to stop it. No npm install is needed for the standard interface; see the [MCP guide](mcp/README.md#install) for optional agent tools and headless rendering. An adaptable systemd example is in [deploy/roomsuite.service.example](deploy/roomsuite.service.example).

For source-based installs, `CLIPROOM_PORT`, `CLIPROOM_DATA`, `ROOMSUITE_DATA`, and `CLIPROOM_ALLOWED_HOSTS` configure the server. Cliproom projects and media default to `cliproom/data/`; notes, PaintRoom projects and shared files default to `cliproom/data/workspace/`. See [Storage and backups](#storage-and-backups) before deploying. Clones and separate installations have independent data; GitHub stores source code, not your projects.

## Use it on other devices

The server listens on loopback only and has **no built-in login or per-user permissions**. For selected devices, use HTTPS through Tailscale Serve and configure tailnet access rules to allow only trusted devices. Anyone who can reach the server can read, change and delete all shared files, notes, artwork, Cliproom projects and uploaded media. Follow the detailed instructions in [Cliproom's guide](cliproom/README.md#share-with-selected-tailscale-devices); start the root server instead of the standalone Cliproom server to serve the whole suite.

For example, after setting up Tailscale and its access policy, run the suite with the exact Tailscale host and port allowed:

~~~sh
CLIPROOM_ALLOWED_HOSTS=your-server.your-tailnet.ts.net:8443 node server.js
~~~

Then, in a separate terminal:

~~~sh
tailscale serve --bg --https=8443 8090
tailscale serve status
~~~

Open the HTTPS URL reported by Tailscale on an authorized device. Camera, microphone and screen capture require a secure browser context: HTTPS on other devices, or localhost on the server itself. Do not expose the unauthenticated server directly to the public internet.

## Work between rooms

Each room opens as a separate session. Starting another tab does not replace your current work. Notes and saved PaintRoom projects persist on the server. The other browser editors keep their current sessions in memory unless you save or export them; Cliproom also has its own server-backed project and media library.

Open **Shared files** to upload files from any authorized device, make folders, search, download, rename and move. **Move to trash** keeps a recoverable copy; use **Trash & restore** to restore it to an unoccupied path or explicitly delete it forever. Trash counts toward storage and is included in workspace backups. Drag a file or folder onto another folder, or select **Move** and browse to a destination; an existing file is never overwritten. Moving or trashing a file can break links until it is restored. Use **Open in…** on a supported file or each room's shared-file button to bring it into an editor. Shared files and Cliproom's media library are separate, so importing into Cliproom creates a library copy. The existing MCP permanent-delete tool remains permanent; the new trash tools are recoverable.

Use **Check uses** on a file before cleanup to scan saved notes and supported UTF-8 Shared files for the path. Matching text is a possible use, not proof of a dependency; protected note attachments are reported separately after checking their independent copies, up to 64 MiB total. The scan covers up to 10,000 notes and 64 MiB of note data, plus 2,000 files of at most 8 MiB each and 64 MiB total, within 10,000 filesystem entries. Unreadable or oversized supported files make the scan incomplete. Open or unsaved work, external files and unsupported formats are not scanned. When no blocking uses are found and the scan is complete, **Move checked file to trash** rechecks the file and saved references under the server write lock before moving it. Ordinary trash and permanent-delete operations remain available.

Use **Versions** on a file to save a snapshot, or **File history** to browse and filter all snapshots. Before a changed DocSuite, GridSuite, DeckSuite or PlanSuite file is saved, RoomSuite tries to keep its prior version; other files need an explicit snapshot. Each snapshot is limited to 64 MiB, with up to 20 per saved path and 10,000 across the server. Versions count toward storage and remain until explicitly deleted; identical versions are reused. If history is full, storage is insufficient or history is damaged, the productivity save can still succeed with a visible warning that its previous version was not retained. Downloads and restores verify the saved hash, and restores always create a new path. Snapshots keep their original saved path after a move; find them with File history. Back up the workspace history directory with the rest of the workspace.

Choose **Text contents** in Shared files search and press **Search** to find matching text inside supported UTF-8 files. Each file is limited to 1 MiB; a scan reads at most 1,000 files and 32 MiB, returns up to 200 matches, and reports skipped large/binary files or an incomplete scan. Unsupported formats and NotesRoom's separate note store are not searched by this option.

Use **Preview** on supported images, audio, video and plain-text files without opening an editor. Text and HTML source are shown as text; text files must be at most 1 MiB and previews show up to 65,536 characters. Image files are limited to 20 MiB. Audio and video playback depends on browser codecs.

PixelRoom and Cliproom share editable color controls, before/after comparison and portable `.roomgrade` looks. Save a look locally, download it, or exchange it through Shared files. Cliproom also offers static, non-destructive color masks on picture clips and opt-in local waveforms for short audio and video clips. See [Shared color and portable looks](COLOR_GRADING.md) for the workflow, file format and performance/color limits, and [the enhancement audit](UPGRADE_STATUS.md) for remaining work.

Cliproom can import SRT or WebVTT captions as editable title overlays and export them again. It can distribute supplied lines evenly over a time range or, after an explicit optional model download, transcribe a short clip locally. Review speech recognition and timing before using them. Files are limited to 512 KiB and projects to 500 subtitles; positioning and rich caption formatting are simplified with a warning. Subtitle titles are burned into rendered video rather than added as a selectable text track. See the [Cliproom guide](cliproom/README.md) for speech model privacy and limits.

Cliproom can download a saved project with its project media as a portable `.roomclip` package and import it as a new project. Packages are uncompressed and limited to 256 MiB and 250 media files. See [Cliproom project packages](CLIPROOM_PACKAGES.md) for verification, temporary-space needs and the format.

For demanding videos, open **Optimized previews** in Cliproom to create a lower-resolution copy on your device and opt in to using it for preview in the current tab. Copies use VP8/Opus with a longest side of at most 640 pixels and include the primary video and audio tracks. They are compressed and do not preserve video transparency, so check color and transparency on the original. Browser and headless exports always use the original media. Creation needs the optional MCP and headless-rendering components and a browser that can decode and encode the source. Videos are limited to 10 minutes, 256 MiB and 16 megapixels; a copy is limited to 128 MiB. Copies are stored on the server, shared by projects using the same source, omitted from project packages and removable from the dialog. The separate cache holds up to 100 copies or 1 GiB and is not part of the Shared files quota; source-media trash removes its copy when possible.

In Cliproom, **Inspect server media** checks saved-project references and can move eligible files to recoverable media trash. Other open or unsaved projects are not visible to the scan; review those before cleanup. Files must be at least 24 hours old, saved references are checked again at the time of the move, and incomplete scans block cleanup. Restore from the media trash or explicitly delete forever. The separate Cliproom media trash is part of the data directory and uses hard links on the same filesystem.

## Productivity suites

DocSuite, GridSuite, DeckSuite and PlanSuite use editable `.docsuite`, `.gridsuite`, `.decksuite` and `.plansuite` files in **the same Shared files** used by the creative rooms. Use **Save** or Ctrl+S (Command+S on Mac), and choose a location the first time; **Save a copy** creates a separate file. Changes are not automatically saved. If another tab, device or agent updates a file, a revision check prevents a stale save from replacing it. Open the latest version or save your changes as a copy.

DocSuite supports headings, text size and color, bold/italic/underline/strikethrough, lists, alignment, links, simple tables and embedded shared images up to 2 MiB. Add, resolve or delete comments. Select up to 1,000 characters before adding a comment to link it to that text; the anchor follows ordinary edits and can be highlighted or located from the comments panel. If the text is removed or an edit cannot be mapped safely, the comment is kept and can be attached to a new selection. Older comments remain as static context until attached. Import/export DOCX and text or use Print / PDF. Word import retains supported text, underline and font sizes, lists, tables, links, images and simple comments. Non-overlapping comments anchored within a paragraph can be exported as Word comments. General, overlapping or unsupported cross-boundary comments are omitted with a warning; comment threads and resolved status are simplified. Complex layout, colors and other Word features may also be simplified or omitted.

Turn on **Track text edits** to record insertions, deletions and replacements for review in the document. Pending changes are saved in `.docsuite` files; accept keeps the current text and reject reverses a change when its saved context still matches. Later overlapping or ambiguous edits require manual review and cannot be rejected automatically. Rejected deletions restore plain text, and some complex formatted selections may need manual restoration. Formatting and images are not tracked. Tracking stops with a warning after 200 pending changes or an individual edit above 10,000 characters. DOCX export uses the current text and warns that pending review information and deleted text are not included.

GridSuite supports up to 20 sheets, each with up to 500 rows and 52 columns. Formulas support arithmetic, comparisons, concatenation, references, ranges and the functions `SUM`, `SUMIF`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `IF`, `AND`, `OR`, `ROUND` and `ABS`. `SUMIF` supports matching-size ranges, case-insensitive text, basic comparisons and `*`/`?` wildcards (`~` escapes a wildcard); advanced Excel criteria may differ. Circular references and invalid formulas show an error. Sort by the selected column with row 1 kept as a header; sorting is disabled for formulas or imported cell metadata. A case-insensitive contains filter hides nonmatching rows without deleting data; select a cell in the desired column before applying it. Filters are saved in GridSuite files but are not included in XLSX exports. Import/export XLSX and CSV, and create one bar or line chart per sheet from matching single-row or single-column ranges of up to 30 values, with up to six named series. Long or crowded chart labels appear in a numbered key. XLSX preserves values, formulas, dates, number formats and supported bold, italic, underline, color, fill, size and alignment. Supported bar and line charts with up to six series and a shared label range can round-trip; chart styling, extra or incompatible series, unsupported charts, other formatting, pivot tables and external links may be simplified or omitted with import warnings. Unsupported Excel formulas remain available for export but may not calculate locally. CSV contains raw values and formulas from the active sheet.

GridSuite also evaluates absolute and mixed references such as `$A$1`, `$A1` and `A$1`, including references and ranges on other sheets such as `=Sheet2!A1` and `=SUM('Sales 2026'!A1:A5)`. Enclose names containing spaces or punctuation in single quotes; double an apostrophe inside a quoted name. Renaming a sheet updates references throughout the workbook. A missing sheet, an out-of-bounds reference or a circular dependency displays an error. External workbooks and three-dimensional ranges spanning multiple sheets are not calculated locally.

Select a source cell and choose **Fill from selected cell** to copy its value, formula and supported formatting into a rectangular range of up to 1,000 cells. Relative and mixed formula references shift with the destination; absolute references stay fixed. **Fill number series** extends a numeric source by one per row or column. Both actions replace the chosen destination after confirmation.

DeckSuite supports up to 100 slides. Each has a title, body, background, speaker notes, an optional primary image, and up to 30 additional independent text or image elements. Drag an element's handle or enter its position and size; select multiple elements to align or distribute them. Text elements support the same font, size, color, weight, italics, alignment and line-height controls as the title and body. Images are embedded and limited to 2 MiB each; the complete presentation must fit within the 8 MiB save request limit. The editor warns when title or body text may be clipped. Present slides with optional notes visible on the same screen, import/export PPTX, or print to PDF; notes do not appear on the slide or in the PDF.

Use the built-in layouts for the title, body and primary image. To reuse a whole slide, download it as a `.decktemplate` file or save it to Shared files, then insert it into another presentation as a new slide. A template includes its text, images and speaker notes, and is limited to 7 MiB. PowerPoint conversion preserves supported independent text boxes, images, positions and speaker notes on a 16:9 canvas. Inherited layouts, unsupported fonts and formatting, image cropping, animations, charts and other objects may be simplified or omitted; inspect the conversion warnings. Font availability varies by device.

Office conversion runs locally in the browser. Imported files are opened as new RoomSuite work; the original is not changed, and the app shows conversion warnings before import. Export to the device or directly to Shared files. Office archives are limited to 20 MiB compressed and 64 MiB expanded; encrypted and ZIP64 archives are not supported. The bundled conversion libraries and license notices are in `ProductivitySuite/vendor/`.

When PlanSuite opens, it searches Shared files and automatically opens the only saved `.plansuite` calendar. If several are found, choose one or start a new calendar; if the search is incomplete, use Browse shared files to find another. A direct calendar link opens that file. PlanSuite displays events in month, week and day views in the device's local time zone. Save a calendar as a shared file, or import and export `.ics` files. Import merges events and skips UIDs already in the calendar; review any conversion warnings and save the calendar afterward.

New daily, weekly or monthly repetitions and custom rules support up to 52 occurrences. Select **All day** for date-only events; the last day entered in the editor is inclusive. All-day dates stay on the same calendar days across time zones and export with an exclusive iCalendar end date. Enter an IANA time zone such as `Europe/Paris` for a timed recurrence to keep the event's local time through daylight-saving changes; enter its start and end in that zone. Leave the zone blank to enter times in this device's zone and repeat in UTC, so local clock times may shift. The `.ics` importer supports date-only events, UTC date-times and recognized IANA-zone date-times from 1970 through 2100, plus daily/weekly/monthly/yearly rules with COUNT or UNTIL, INTERVAL, BYDAY (including monthly/yearly ordinals), BYMONTHDAY, BYMONTH, BYSETPOS and WKST. All-day rules use a date-only UNTIL such as `20261231`; timed rules use UTC date-time UNTIL. BYMONTHDAY is not valid with WEEKLY; BYSETPOS requires another supported BY rule. Exports retain RRULEs and represent deleted or individually edited occurrences with EXDATE or RECURRENCE-ID; they include finite time-zone definitions for zone-based series. Imported embedded time-zone definitions are not applied: recognized IANA zones use the device's rules. Nonexistent local times are skipped during expansion, and ambiguous times use the first occurrence. Floating date-times, RDATE, unknown zones and unsupported rule options are rejected. Some series time shifts are rejected if they would alter the recurrence pattern; edit individual occurrences instead. Legacy linked repetitions remain individual events in exports. The format follows [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html) within these limits.

PlanSuite can optionally sync a saved calendar with one explicitly configured CalDAV collection. On the RoomSuite server, set `ROOMSUITE_CALDAV_URL` to the exact collection URL ending in `/`, and set either `ROOMSUITE_CALDAV_USERNAME` and `ROOMSUITE_CALDAV_PASSWORD` for Basic authentication or `ROOMSUITE_CALDAV_TOKEN` for a Bearer token. Configure these in the server's environment or service manager and restart RoomSuite. HTTPS is required except for an explicit `127.0.0.1` or `::1` loopback server; redirects and URLs containing credentials, queries or fragments are rejected. The feature uses the optional MCP dependencies and Chromium. RoomSuite reads the credentials from its server environment, does not save them in projects or sync state, and contacts the configured server only when a person or agent requests a preview or sync. The configured server receives the calendar data and authentication headers.

Save the calendar, open **CalDAV sync**, preview the changes, then choose **Sync reviewed changes**. PlanSuite checks the saved file revision, the preview and strong remote ETags; simultaneous changes become conflicts rather than silent overwrites. Local events created by RoomSuite can be sent to the collection and edited on either side when their complete supported structure can be preserved. Existing remote events can be imported and refreshed, but local edits to events that originated elsewhere are reported as conflicts instead of overwriting remote fields such as attendees or locations. Imported unsupported fields are reported; unsupported events are left for review. Deletions are off by default. If explicitly enabled and reviewed, unchanged remote deletions can remove the corresponding local event, and unchanged RoomSuite-created remote events can be deleted after local deletion. A cancelled or partially failed sync should be previewed again. Each side supports up to 500 event UIDs, and at most 50 changes are processed per sync; repeat the preview for further batches. The sync record is tied to the collection URL and saved calendar path, so moving the file starts a fresh comparison. Back up the workspace's `.caldav` directory with the rest of its data. A local Radicale server and a controlled server are covered by the test suite; other providers may have additional behavior to review.

To use optional ntfy reminders, open **ntfy reminders** in PlanSuite and enter your server URL and topic. A bearer access token is optional; it is stored in the RoomSuite data directory, not returned by the settings API, and should be treated like a password. Use HTTPS for remote servers and an unguessable or protected topic: the notification contains the event title and start time. All-day reminders use midnight on the first day in the RoomSuite server's time zone. Subscribe to the same topic in an ntfy client and use **Send test** after saving settings. RoomSuite checks saved calendars roughly every 30 seconds and sends a reminder when due, retrying failed sends while the event is upcoming and for a short grace period after its start. It keeps a local delivery record to reduce duplicates; delivery is best effort, and an interruption during a send can result in a duplicate. The ntfy server receives the notification when it is sent. See [ntfy's publishing documentation](https://docs.ntfy.sh/publish/) for its topic and access-control behavior.

Productivity projects with newer document annotations or tracked changes, slide notes or elements, cross-sheet formulas or multiseries charts, all-day events, and imported calendar or recurrence metadata use version 2. Older editors reject those files; version 1 projects remain readable here. PixelRoom projects with color grading or masks use version 2, and Cliproom projects with advanced grading, subtitles, SoundRoom links or agent edit receipts use version 5. Keep a backup if you need to use an earlier editor. Productivity files are limited to 8 MiB, or a lower configured RoomSuite per-file limit. They use the same storage quota and backup as other shared files. The optional MCP server can create and edit these files using the same revision checks; see the [MCP guide](mcp/README.md#productivity-workflows).

SoundRoom and CaptureRoom have a **Send to Cliproom** button; VectorRoom can send a PNG. Sending is an explicit upload to your Cliproom server. Once the upload completes, select **Open in Cliproom** to add it to a new Cliproom project. Save that project in Cliproom if you want to reopen it later. Media remains on the server after an upload even if it is not added to a saved project; consult the Cliproom guide for storage and backup details.

Choose **Your projects** in the launcher's **Your space** card to open the saved Cliproom projects browser in a separate window. Open a project or delete it after confirmation. Deleting a project removes its saved timeline but keeps uploaded media, which may be shared by other projects. PaintRoom has its own **Open** project browser; NotesRoom lists its notes in its sidebar.

## NotesRoom

Create notes and nested folders, add comma-separated tags, and search by title, body or tag. Changes autosave after a short pause. Write in Markdown, use **Board** to see the text beside a mixed-media preview, or use **Preview** to read it. The preview supports common Markdown headings, lists, emphasis, code blocks, quotes and links; unsupported Markdown remains in the source.

Use **Link note** to insert a Markdown link to another note by its stable ID. **Links & backlinks** lists saved outgoing links and notes that link here; refresh after editing. Renaming a note or changing its folder does not break an ID link, although the text label already inserted in the source note does not change. A link to a deleted note is shown as missing. The bounded scan checks up to 10,000 saved notes and 64 MiB, reports incomplete results, and ignores links in inline code or triple-backtick code blocks. Unsaved edits are not included until saved.

Use **Record voice** and stop to insert a playable clip at the cursor. Recordings are limited to 10 minutes or 20 MiB; if upload fails, retry or download the unsaved recording. Use **Image** to upload a PNG, JPEG, GIF or WebP, or **Shared image** to link one already in Shared files. Images can be up to 20 MiB and uploads up to 16 megapixels. **Draw** opens a quick sketch with a pen, eraser, color, size, undo and clear; it inserts a PNG. In Board or Preview, adjust image width or remove an item from the note. Sketches are flattened images after insertion.

New note images and recordings receive a separate protected copy, so they continue to work if the Shared file is moved, removed or replaced. Copies count toward workspace storage and are included in workspace backups; identical content is reused. For an older note, **Protect existing media** upgrades supported path-only image and voice links while preserving their labels and sizes. The original Shared file must still be available when upgrading. **Manage note media** scans saved notes and can delete an explicitly selected unused copy after at least 24 hours. The scan cannot see other open or unsaved notes, or Markdown files saved outside NotesRoom; review those before deleting a copy. An incomplete scan blocks deletion. Saving a note as Markdown exports links, not embedded media; retain the workspace backup to preserve protected copies.

**Download note bundle** creates a portable `.roomnote` containing the saved note and its supported image and voice attachments. **Import note bundle** verifies the included media and creates a new note with protected copies. Bundles are limited to 50 distinct media references, 24 MiB of media and 36 MiB overall; external or unsupported image links must be removed or converted to NotesRoom attachments before export. Links to other notes remain as IDs, and those other notes are not included. Importing creates protected copies that count toward workspace storage; an interrupted retry of the same selected file reuses the import ID while the tab remains open.

**Dictate** inserts recognized speech at the cursor when the browser supports speech recognition. It uses the selected language and may send audio to the browser's speech service; it may require an internet connection. If unavailable, use the device's voice typing in the text editor. Microphone access requires permission and a secure browser context (localhost or HTTPS).

Recordings, uploaded images and sketches are stored separately in the `NotesRoom media` folder in Shared files and count against its storage quota. The Markdown note contains links to those files; moving or deleting them breaks the note's media, and deleting a note leaves its media files in Shared files. A Markdown export contains links, not the media itself, so keep the files and their paths when backing up or sharing. Notes can be linked from any room. The server rejects an out-of-date save or deletion; use **Save as a copy** to preserve local changes or **Reload latest** to discard them. Folders must be empty before they can be deleted.

## PaintRoom

Draw with a brush or eraser, choose a built-in brush preset, and use vertical or horizontal symmetry. A compatible pen can vary stroke width with pressure; mirrored strokes remain individually editable. Make lines, rectangles, ellipses and Bézier paths, and move, reorder, hide or transform layers. The Bézier path tool adds points on click and shapes their handles on drag; finish it open or closed. **Edit path** lets you drag points and handles on the selected layer; Alt-drag a point to create an outgoing handle. Each layer groups its objects and can rotate or scale around a chosen pivot. The Lasso tool draws a freeform selection; keep or hide that area as a non-destructive layer mask, then drag mask points to reshape it or remove the mask. Each layer supports one polygon mask, without feathering. Import a supported raster image as a layer. **Save** stores an editable project on the server; **Open** reopens or deletes it, and **Save a copy** resolves a concurrent edit. Export PNG or an editable `.paintroom` file to the device or shared files. SVG export is available for vector-only work without embedded images or eraser strokes. Use **Send to Cliproom** or export a PNG through shared files to animate it there. Projects embed imported images, which are limited to 20 MiB each; editable projects are limited to 32 MiB.

**Send to VectorRoom** saves a file through the shared-file picker and provides a link to open it. Unclipped vector artwork with opaque layers is converted into editable VectorRoom paths, scaled to fit its 1000 × 700 artboard. Individual object opacity is preserved where the appearance can be represented faithfully; hidden layers are omitted and layer grouping is flattened. Photos, eraser strokes, partially transparent layers, clipped artwork and certain translucent fill-and-outline combinations cannot be faithfully converted into editable paths. For those projects you can choose to send a flattened PNG instead; the original remains editable in PaintRoom. The shared copy remains on the server until deleted. You can also save a PaintRoom project on the server and use **Fetch from PaintRoom** inside VectorRoom to add its editable objects to the current artwork without replacing it. Unsupported projects show an explanation and are not silently flattened.

## MotionRoom

Import a `.paintroom` or `.vectorroom` project from your device or Shared files, or choose **Send to MotionRoom** in PaintRoom or VectorRoom and save the editable artwork to Shared files. PaintRoom layers and individual VectorRoom objects appear separately. Select one, move the playhead, and add a keyframe or change its position, scale, rotation or opacity. Drag the selected layer on the preview to position it. Add another keyframe at a different time, choose the easing from the earlier keyframe to the next, and press **Play**. Use the diamonds or previous/next buttons to revisit keyframes; undo and redo cover animation edits.

Save a `.motionroom` file locally or to Shared files to reopen the animation with its embedded source artwork. **Open artwork in its room** saves a separate editable copy for PaintRoom or VectorRoom; later changes to that copy are not automatically synced back into the animation. Export WebM or send the rendered video to Cliproom. Video has a solid background, no audio, and records in real time; keep the tab visible. A transparent PaintRoom canvas is rendered on white. Vector objects and PaintRoom layers are rendered to bitmaps for animation, so large scale-ups can soften details. The source paths, images, masks and strokes remain in the motion project.

One artwork is supported per motion project. Projects are limited to 40 MiB, durations to 0.1–60 seconds and 10,000 keyframes. To bound memory, PaintRoom canvas pixels multiplied by the number of layers, or the combined pixel area of the rendered VectorRoom objects, cannot exceed 40 million. Animated SVG, path morphing, frame-by-frame drawing, audio and automatic source synchronization are not included. Real-time recording can drop frames on busy devices.

## PixelRoom

Select an image, text or shape layer and set its angle in the layer properties, or drag the rotation handle above the selection (hold Shift for 15° steps). Rotation is saved in editable projects and does not alter the original image pixels. Rotated content can extend outside the canvas; crop or adjust the canvas composition as needed.

For text in an image, use **Isolate → Find text areas**, choose or draw a selection, and refine the letter mask. **Preview cleanup** uses the local model to rebuild the background, processing long selections in overlapping sections. Adjust the cleanup margin and edge blend in source pixels, compare the preview with the original, and choose **Remove letters** or continue to isolate editable text. Cleanup is approximate, especially on detailed backgrounds; refine and review it before applying. The first use loads the model from the RoomSuite server and needs sufficient device memory.

## Check an update

After replacing source or installed files, restart the RoomSuite backend and restart each agent that uses MCP. With the optional MCP dependencies installed, set `ROOMSUITE_MCP_URL` if the backend is not at its default address and run `node mcp/check-deployment.mjs` from the updated installation. For the Windows installer, use its bundled runtime instead: in PowerShell, run `& "$env:LOCALAPPDATA\Programs\RoomSuite\runtime\node.exe" "$env:LOCALAPPDATA\Programs\RoomSuite\mcp\check-deployment.mjs"`. A successful result has `ok: true`; a mismatch or an older backend returns a nonzero exit status. The check compares process startup fingerprints with current code, then hashes the served HTML, CSS and JavaScript. It checks the newly launched MCP process, not other already-running agent processes. Ask each connected agent to call `roomsuite_check_deployment` to check its own MCP process. It does not verify browser caches, media/model assets or installed dependency contents. The Windows launcher runs this check before showing Ready when MCP is installed, and the installer smoke test checks fresh and upgraded installations.

## Storage and backups

`ROOMSUITE_MAX_FILE_BYTES` defaults to 536870912 (512 MiB per shared upload), and `ROOMSUITE_MAX_STORAGE_BYTES` defaults to 5368709120 (5 GiB total for shared files, notes and PaintRoom projects). Both accept positive integer byte counts. Cliproom's existing media library is separate and is not counted in this quota. File names and paths are validated, uploads cannot overwrite existing files, and downloads are served as attachments. Notes and PaintRoom projects use revision checks to prevent silent overwrites. Limits assume one RoomSuite server process owns the data directory; avoid modifying it directly while the service is running.

For a Linux service, use a dedicated unprivileged account, keep both data directories writable only by that account, and store them outside the Git checkout. The default `cliproom/data/` and `roomsuite-data/` locations are ignored by Git, but a custom `ROOMSUITE_DATA` path inside the checkout is not automatically ignored. Never commit user data or private service settings. Repository backups cover the source and example configuration, not the data or a working restore.

On Windows, close the installed RoomSuite launcher and copy `%LOCALAPPDATA%\RoomSuite` to independent storage. For a source checkout, back up its configured data directories instead. On Linux, back up **both** `CLIPROOM_DATA` and `ROOMSUITE_DATA` independently of GitHub. Stop the service first for a consistent snapshot, then run the included Linux backup script with the same data paths as the service:

~~~sh
mkdir -p /srv/roomsuite-backups
CLIPROOM_DATA=/var/lib/roomsuite/cliproom \
ROOMSUITE_DATA=/var/lib/roomsuite/workspace \
  sh scripts/backup-roomsuite.sh /srv/roomsuite-backups
~~~

The script creates private timestamped tar archives and checks that they can be read. When the workspace is inside Cliproom's data directory, it is already included in that archive. Restart the service afterward. Copy backups to independent storage, schedule regular backups using a maintenance window or filesystem snapshot, and periodically test restoration. To restore, stop the service, extract each archive into its corresponding empty data directory (`tar -xzf archive.tar.gz -C /path/to/data`), set ownership to the service account, then start the service. Backups contain private user data; restrict and protect them accordingly. The example service and script are provided for deployment; they do not configure a running server or scheduled backups automatically.

## SoundRoom

Choose an audio file or record your microphone. Drag across the waveform or enter start and end times to select a range; trim to it or cut it out. Click to move the playhead, then add a split marker. **Export current part** exports the selection, or the section containing the playhead between split markers. Volume and fades apply to playback and WAV exports. Normalize targets a peak of −3 dBFS by default; adjust the target from −24 to 0 dBFS when needed. Gain is limited to 300% and rounded down to the nearest whole percent, so very quiet audio may not reach the target. Normalization measures the unprocessed audio; EQ and compression can change the final peak.

Open **Equalizer & dynamics** for broad low, mid and high bands, optional compression, a local quiet-section noise gate and a sample-peak ceiling. The noise gate reduces quiet sections, not noise underneath louder speech or music; it runs in a local worker, supports mono/stereo and at most six million channel samples, and leaves the source unchanged. The compressor uses a 3 ms attack, 250 ms release and browser-provided makeup gain. The order is gate, EQ, compression, volume and fades, then the peak ceiling. The ceiling hard-clips samples and may distort; it is not a true-peak limiter. Playback and WAV export use the same settings, though browser implementations may differ. Sending to Cliproom uploads the processed WAV plus a separate 32-bit float source and the processing settings. The Cliproom timeline plays the processed copy; select it and open the editable source in SoundRoom to change settings, then send the new result back as another clip. The source already reflects trims and cuts, while selection, split markers and undo history are not transferred. Editable handoff sources are limited to 256 MiB. Both files remain on the server and count toward a portable project package’s 256 MiB limit.

Save a `.soundroom` session locally or to Shared files to reopen the current audio, selection, split markers and processing settings. It embeds the current edited audio as 32-bit float PCM and is limited to 32 MiB; long recordings may need to be shortened or exported as WAV. Trims and cuts are reflected in the embedded audio, and undo history is not saved. The original input file is not changed. WAV exports contain finished 16-bit audio, not editable settings.

**Analyze loudness** measures the processed WAV using 400 ms K-weighted blocks with absolute and relative gates, and reports integrated LUFS plus sample peak. It accepts mono or stereo audio from 0.4 to 60 seconds and resamples to 48 kHz for analysis. This is an estimate, not a certified meter or a true-peak measurement. Supported imports depend on browser decoders; processing large recordings depends on available memory.

## CaptureRoom

Add a scene, then add visual sources and microphones. Images initially fit inside the frame while preserving their aspect ratio. Use **Fit frame** to letterbox or **Fill frame** to crop, or adjust position and size yourself. Text wraps to its source width and is clipped to its height; a contrast backdrop can improve readability. Drag a visual source in the preview or use its position and size controls. Switch scenes during a recording; only the active scene's visible sources and audible sources appear in the output. Sources in other scenes remain open until removed or the tab closes.

Under **Scene templates**, download the current scene as a `.capturescene` file or save it to Shared files, then open it later as a new scene. Text, layout and supported images are embedded; each image is limited to 2 MiB and 16 megapixels, each template to 4 MiB and 32 sources. Screen, camera and microphone sources are saved as placeholders without device identifiers or streams. Choose **Reconnect** and grant permission for each live source after opening a template.

Start and stop recording, then download the selected result or send it to Cliproom. Choose 640 × 360, 1280 × 720 or 1920 × 1080 output, a 0-, 3- or 5-second countdown, and a 15 or 30 fps target. Scene positions use a consistent 1280 × 720 coordinate space at every output size. Where the browser supports it, pause and resume without including the paused time in the recording. Alt+Shift+R starts/stops and Alt+Shift+P pauses/resumes outside input fields. Actual frame rate and output format depend on the browser and device. CaptureRoom records locally and does **not** provide live streaming.

With **Keep a recovery copy in this browser** enabled, CaptureRoom writes recording chunks to local browser storage. After an interruption, open **Recover recordings** in the same browser profile and device, recover a copy, and check it before deleting the stored data. Completed copies are retained there too until explicitly deleted or the browser clears its storage. This is a best-effort recovery path: a crash can lose recent chunks and an incomplete WebM or MP4 may be unplayable. Browser quotas and eviction apply; storage failures leave the ongoing recording in tab memory and display a warning. Recovery is limited to eight copies, 256 MiB per recording and 512 MiB total. Turn the option off to keep recordings only in tab memory until downloaded or sent. Browser recovery data is separate from the server workspace and its backups.

The browser asks for permission for each screen-sharing session. Screen or system audio may not be offered, and mobile screen capture support varies. Camera/microphone availability also depends on permissions and hardware. Keep the tab open and visible during recording; browsers and mobile operating systems may pause or throttle background capture. Recordings can consume substantial memory.

## VectorRoom

Draw rectangles, ellipses, lines and text. With the pen, click to add points and drag to create Bézier handles; finish or close the path, then use **Edit nodes** to adjust points and handles. The inspector controls fills, gradients, outlines, opacity, rotation and text. Drag the selection's handles to resize or rotate (Shift keeps proportions or snaps rotation to 15°), duplicate objects, reorder them, or nudge them with the arrow keys (Shift moves 10 pixels). Undo and redo are available from the toolbar or keyboard. Toggle grid snapping when helpful. Use **Fetch from PaintRoom** to add supported saved artwork as editable paths.

Shift-click objects or use the layer checkboxes to select several. Group or ungroup them, move or duplicate them together, and align or distribute objects and groups. Alignment guides can snap a moving selection to artboard or object edges and centers. Alignment uses browser-measured geometry without stroke widths; rotated shapes use a conservative bounding box. Grouping is retained in `.vectorroom` projects. SVG exports keep the individual shapes and group identifiers, but do not create a nested SVG group.

For non-destructive **Union**, **Intersect**, **Subtract top** or **Exclude overlap**, select two adjacent, ungrouped filled rectangles, ellipses or closed paths without outlines or transparency. The result uses the lower shape's solid color and retains both sources; **Release shapes** restores them, including their original colors. The combination uses SVG masks rather than creating a new editable outline, and its arrangement bounds can include masked-out areas. Source shapes must fit within a 4096 × 4096 area. Resize is unavailable for a combined shape; move or rotate it, or release the shapes to edit their geometry. SVG and PNG preserve the visible result.

**Save project** downloads a .vectorroom file that can be reopened in VectorRoom. Export SVG for scalable artwork, or PNG for a raster image. SVG/PNG exports are not editable VectorRoom project files. VectorRoom can also import a raster image as a movable, resizable layer; imported images remain raster and are embedded in project and SVG files. Images are limited to 20 MiB and project imports to 32 MiB. Work stays in the tab until you save or export.

## Checks

~~~sh
node --test cliproom/tests/*.test.js tests/*.test.js
~~~

The tests cover the existing timeline and server behavior, suite routes, shared storage limits and revision conflicts. Browser and MCP integration checks are documented in the [MCP guide](mcp/README.md#verify).

## Coding agents

The optional [RoomSuite MCP server](mcp/README.md) lets coding agents search and transfer shared files, create and organize notes, edit and export PaintRoom artwork, manage Cliproom projects, and produce images, audio and animated videos through the rooms. Image-capable agents can [compare frames and inspect the rendered video](mcp/README.md#frame-workflow-for-agents), with stable object IDs, file-based inputs and batch exports to make iteration easier. It runs separately from the normal application and uses isolated browser sessions. Cliproom also offers a [headless project render endpoint](cliproom/README.md#render-from-a-program).
