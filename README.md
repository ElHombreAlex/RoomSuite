# RoomSuite

RoomSuite is a self-hosted workspace for creative work, productivity, notes and shared files. Use the launcher switch to choose Creative or Productivity. Each room or suite opens in its own tab or window, so you can work in several at once:

- **PixelRoom** — photo editing, layers, text and local subject/text isolation.
- **Cliproom** — a multitrack video editor with a server-backed media and project library.
- **SoundRoom** — record or import audio, select, trim, cut, mark splits, adjust volume and fades, and export WAV.
- **CaptureRoom** — arrange screen, camera, microphone, image and text sources into scenes and record them.
- **VectorRoom** — create shapes, text and editable Bézier paths, with solid or gradient fills and SVG/PNG export.
- **NotesRoom** — write and organize Markdown notes, add voice clips, images and quick sketches, and use a visual board or browser dictation.
- **PaintRoom** — paint and draw on a layered canvas, import images, transform layers, and save editable artwork.
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

## Linux setup

Install Git and Node.js 18 or later (use Node.js 20 or later for MCP and server-side rendering):

~~~sh
git clone https://github.com/ElHombreAlex/RoomSuite.git
cd RoomSuite
node server.js
~~~

Open **http://127.0.0.1:8090/** on the server and choose a room. Press Ctrl+C to stop it. No npm install is needed for the standard interface; see the [MCP guide](mcp/README.md#install) for optional agent tools and headless rendering. An adaptable systemd example is in [deploy/roomsuite.service.example](deploy/roomsuite.service.example).

For source-based installs on either platform, `CLIPROOM_PORT`, `CLIPROOM_DATA`, `ROOMSUITE_DATA`, and `CLIPROOM_ALLOWED_HOSTS` configure the server. Cliproom projects and media default to `cliproom/data/`; notes, PaintRoom projects and shared files default to `cliproom/data/workspace/`. See [Storage and backups](#storage-and-backups) before deploying. Clones and separate installations have independent data; GitHub stores source code, not your projects.

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

Open **Shared files** to upload files from any authorized device, make folders, search, download, rename, move and delete. Drag a file or folder onto another folder, or select **Move** and browse to a destination; the item keeps its name and an existing file is never overwritten. You can also drop an item onto **Parent folder**. Moving a file can break links to it in notes or documents. Use **Open in…** on a supported file or each room's shared-file button to bring it into an editor. Save exports back through the shared-file picker. The file type must be supported by the receiving room; shared files and Cliproom's media library are separate, so importing into Cliproom creates a library copy.

## Productivity suites

DocSuite, GridSuite, DeckSuite and PlanSuite use editable `.docsuite`, `.gridsuite`, `.decksuite` and `.plansuite` files in **the same Shared files** used by the creative rooms. Use **Save** or Ctrl+S, and choose a location the first time; **Save a copy** creates a separate file. Changes are not automatically saved. If another tab, device or agent updates a file, a revision check prevents a stale save from replacing it. Open the latest version or save your changes as a copy.

DocSuite supports headings, text size and color, bold/italic/underline/strikethrough, lists, alignment, links, simple tables and embedded shared images up to 2 MiB. Add, resolve or delete comments; a comment can keep a snapshot of selected text as context, but it does not move with subsequent edits. Import/export DOCX and text or use Print / PDF. Word import retains supported text, underline and font sizes, lists, tables, links and images. Complex layout, colors, comments and other Word features may be simplified or omitted. DocSuite comments are not exported to Word; the export warns when they are present.

GridSuite supports up to 20 sheets, each with up to 500 rows and 52 columns. Formulas support arithmetic, comparisons, concatenation, references, ranges and the functions `SUM`, `SUMIF`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `IF`, `AND`, `OR`, `ROUND` and `ABS`. `SUMIF` supports matching-size ranges, case-insensitive text, basic comparisons and `*`/`?` wildcards (`~` escapes a wildcard); advanced Excel criteria may differ. Circular references and invalid formulas show an error. Sort by the selected column with row 1 kept as a header; sorting is disabled for formulas or imported cell metadata. A case-insensitive contains filter hides nonmatching rows without deleting data; select a cell in the desired column before applying it. Filters are saved in GridSuite files but are not included in XLSX exports. Import/export XLSX and CSV, and create one bar or line chart per sheet from matching single-row or single-column ranges of up to 30 values. Long or crowded chart labels appear in a numbered key. XLSX preserves values, formulas, dates, number formats and supported bold, italic, underline, color, fill, size and alignment. Simple single-series bar and line charts can round-trip; chart styling, extra series, unsupported charts, other formatting, pivot tables and external links may be simplified or omitted. Unsupported Excel formulas remain available for export but may not calculate locally. CSV contains raw values and formulas from the active sheet.

DeckSuite supports up to 100 slides, each with a title, text, background and an optional embedded shared image up to 2 MiB. Add, duplicate, reorder or delete slides, apply standard, title, split-image or statement templates, present, import/export PPTX, or print to PDF. PowerPoint conversion retains slide order and supported positions for the title, body and one image on a 16:9 canvas. Multiple text boxes may be combined; inherited layouts, fonts, formatting, image cropping, animations, charts and other objects may be simplified or omitted.

Office conversion runs locally in the browser. Imported files are opened as new RoomSuite work; the original is not changed, and the app shows conversion warnings before import. Export to the device or directly to Shared files. Office archives are limited to 20 MiB compressed and 64 MiB expanded; encrypted and ZIP64 archives are not supported. The bundled conversion libraries and license notices are in `ProductivitySuite/vendor/`.

When PlanSuite opens, it searches Shared files and automatically opens the only saved `.plansuite` calendar. If several are found, choose one or start a new calendar; if the search is incomplete, use Browse shared files to find another. A direct calendar link opens that file. PlanSuite displays events in month, week and day views in the device's local time zone. A calendar is saved as a shared file and can be exported as an `.ics` calendar. Daily, weekly or monthly repetition creates up to 52 linked individual events. On edit or delete, choose the selected occurrence or the entire series; time changes across a series shift each occurrence by the same elapsed amount. Earlier files with unrelated repeated events remain unrelated. ICS exports individual events, not an RRULE. There is no calendar synchronization, and reminders require the server to be running.

To use optional ntfy reminders, open **ntfy reminders** in PlanSuite and enter your server URL and topic. A bearer access token is optional; it is stored in the RoomSuite data directory, not returned by the settings API, and should be treated like a password. Use HTTPS for remote servers and an unguessable or protected topic: the notification contains the event title and start time. Subscribe to the same topic in an ntfy client and use **Send test** after saving settings. RoomSuite checks saved calendars roughly every 30 seconds and sends a reminder when due, retrying failed sends while the event is upcoming and for a short grace period after its start. It keeps a local delivery record to reduce duplicates; delivery is best effort, and an interruption during a send can result in a duplicate. The ntfy server receives the notification when it is sent. See [ntfy's publishing documentation](https://docs.ntfy.sh/publish/) for its topic and access-control behavior.

Productivity files are limited to 8 MiB, or a lower configured RoomSuite per-file limit. They use the same storage quota and backup as other shared files. The optional MCP server can create and edit these files using the same revision checks; see the [MCP guide](mcp/README.md#productivity-workflows).

SoundRoom and CaptureRoom have a **Send to Cliproom** button; VectorRoom can send a PNG. Sending is an explicit upload to your Cliproom server. Once the upload completes, select **Open in Cliproom** to add it to a new Cliproom project. Save that project in Cliproom if you want to reopen it later. Media remains on the server after an upload even if it is not added to a saved project; consult the Cliproom guide for storage and backup details.

Choose **Your projects** in the launcher's **Your space** card to open the saved Cliproom projects browser in a separate window. Open a project or delete it after confirmation. Deleting a project removes its saved timeline but keeps uploaded media, which may be shared by other projects. PaintRoom has its own **Open** project browser; NotesRoom lists its notes in its sidebar.

## NotesRoom

Create notes and nested folders, add comma-separated tags, and search by title, body or tag. Changes autosave after a short pause. Write in Markdown, use **Board** to see the text beside a mixed-media preview, or use **Preview** to read it. The preview supports common Markdown headings, lists, emphasis, code blocks, quotes and links; unsupported Markdown remains in the source.

Use **Record voice** and stop to insert a playable clip at the cursor. Recordings are limited to 10 minutes or 20 MiB; if upload fails, retry or download the unsaved recording. Use **Image** to upload a PNG, JPEG, GIF or WebP, or **Shared image** to link one already in Shared files. Images can be up to 20 MiB and uploads up to 16 megapixels. **Draw** opens a quick sketch with a pen, eraser, color, size, undo and clear; it inserts a PNG. In Board or Preview, adjust image width or remove an item from the note. Sketches are flattened images after insertion.

**Dictate** inserts recognized speech at the cursor when the browser supports speech recognition. It uses the selected language and may send audio to the browser's speech service; it may require an internet connection. If unavailable, use the device's voice typing in the text editor. Microphone access requires permission and a secure browser context (localhost or HTTPS).

Recordings, uploaded images and sketches are stored separately in the `NotesRoom media` folder in Shared files and count against its storage quota. The Markdown note contains links to those files; moving or deleting them breaks the note's media, and deleting a note leaves its media files in Shared files. A Markdown export contains links, not the media itself, so keep the files and their paths when backing up or sharing. Notes can be linked from any room. The server rejects an out-of-date save or deletion; use **Save as a copy** to preserve local changes or **Reload latest** to discard them. Folders must be empty before they can be deleted.

## PaintRoom

Draw with a brush or eraser, make lines, rectangles, ellipses and Bézier paths, and move, reorder, hide or transform layers. The Bézier path tool adds points on click and shapes their handles on drag; finish it open or closed. **Edit path** lets you drag points and handles on the selected layer; Alt-drag a point to create an outgoing handle. Each layer groups its objects and can rotate or scale around a chosen pivot. Import a supported raster image as a layer. **Save** stores an editable project on the server; **Open** reopens or deletes it, and **Save a copy** resolves a concurrent edit. Export PNG or an editable `.paintroom` file to the device or shared files. SVG export is available for vector-only work without embedded images or eraser strokes. Use **Send to Cliproom** or export a PNG through shared files to animate it there. Projects embed imported images, which are limited to 20 MiB each; editable projects are limited to 32 MiB.

**Send to VectorRoom** saves a file through the shared-file picker and provides a link to open it. Unclipped vector artwork with opaque layers is converted into editable VectorRoom paths, scaled to fit its 1000 × 700 artboard. Individual object opacity is preserved where the appearance can be represented faithfully; hidden layers are omitted and layer grouping is flattened. Photos, eraser strokes, partially transparent layers, clipped artwork and certain translucent fill-and-outline combinations cannot be faithfully converted into editable paths. For those projects you can choose to send a flattened PNG instead; the original remains editable in PaintRoom. The shared copy remains on the server until deleted. You can also save a PaintRoom project on the server and use **Fetch from PaintRoom** inside VectorRoom to add its editable objects to the current artwork without replacing it. Unsupported projects show an explanation and are not silently flattened.

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

Choose an audio file or record your microphone. Drag across the waveform or enter start and end times to select a range; trim to it or cut it out. Click to move the playhead, then add a split marker. **Export current part** exports the selection, or the section containing the playhead between split markers. Volume and fades apply to playback and WAV exports. Normalize targets a peak of −3 dBFS by default; adjust the target from −24 to 0 dBFS when needed. Gain is limited to 300% and rounded down to the nearest whole percent, so very quiet audio may not reach the target.

Audio and edit history stay in the tab's memory. Export a WAV before closing it; split markers and editable history are not saved in the WAV. Supported imports depend on browser decoders, and large recordings depend on available memory.

## CaptureRoom

Add a scene, then add visual sources and microphones. Images initially fit inside the frame while preserving their aspect ratio. Use **Fit frame** to letterbox or **Fill frame** to crop, or adjust position and size yourself. Text wraps to its source width and is clipped to its height; a contrast backdrop can improve readability. Drag a visual source in the preview or use its position and size controls. Switch scenes during a recording; only the active scene's visible sources and audible sources appear in the output. Sources in other scenes remain open until removed or the tab closes.

Start and stop recording, then download the selected result or send it to Cliproom. Recordings are kept in the tab's memory, so download anything you want to keep before closing it. The preview is 1280 × 720 and recording targets 30 fps; actual performance and output format depend on the browser and device. CaptureRoom currently records locally and does **not** provide live streaming.

The browser asks for permission for each screen-sharing session. Screen or system audio may not be offered, and mobile screen capture support varies. Camera/microphone availability also depends on permissions and hardware. Keep the tab open and visible during recording; browsers and mobile operating systems may pause or throttle background capture. Recordings can consume substantial memory.

## VectorRoom

Draw rectangles, ellipses, lines and text. With the pen, click to add points and drag to create Bézier handles; finish or close the path, then use **Edit nodes** to adjust points and handles. The inspector controls fills, gradients, outlines, opacity, rotation and text. Drag the selection's handles to resize or rotate (Shift keeps proportions or snaps rotation to 15°), duplicate objects, reorder them, or nudge them with the arrow keys (Shift moves 10 pixels). Undo and redo are available from the toolbar or keyboard. Toggle grid snapping when helpful. Use **Fetch from PaintRoom** to add supported saved artwork as editable paths.

**Save project** downloads a .vectorroom file that can be reopened in VectorRoom. Export SVG for scalable artwork, or PNG for a raster image. SVG/PNG exports are not editable VectorRoom project files. VectorRoom can also import a raster image as a movable, resizable layer; imported images remain raster and are embedded in project and SVG files. Images are limited to 20 MiB and project imports to 32 MiB. Work stays in the tab until you save or export.

## Checks

~~~sh
node --test cliproom/tests/*.test.js tests/*.test.js
~~~

The tests cover the existing timeline and server behavior, suite routes, shared storage limits and revision conflicts. Browser and MCP integration checks are documented in the [MCP guide](mcp/README.md#verify).

## Coding agents

The optional [RoomSuite MCP server](mcp/README.md) lets coding agents search and transfer shared files, create and organize notes, edit and export PaintRoom artwork, manage Cliproom projects, and produce images, audio and animated videos through the rooms. Image-capable agents can [compare frames and inspect the rendered video](mcp/README.md#frame-workflow-for-agents), with stable object IDs, file-based inputs and batch exports to make iteration easier. It runs separately from the normal application and uses isolated browser sessions. Cliproom also offers a [headless project render endpoint](cliproom/README.md#render-from-a-program).
