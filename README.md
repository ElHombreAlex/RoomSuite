# RoomSuite

RoomSuite is a self-hosted workspace for creative work, notes and shared files. One launcher opens each room in its own tab or window, so you can work in several rooms at once:

- **PixelRoom** — photo editing, layers, text and local subject/text isolation.
- **Cliproom** — a multitrack video editor with a server-backed media and project library.
- **SoundRoom** — record or import audio, select, trim, cut, mark splits, adjust volume and fades, and export WAV.
- **CaptureRoom** — arrange screen, camera, microphone, image and text sources into scenes and record them.
- **VectorRoom** — create shapes, text and editable Bézier paths, with solid or gradient fills and SVG/PNG export.
- **NotesRoom** — write Markdown notes, organize them into folders with tags, and search and autosave them on the server.
- **PaintRoom** — paint and draw on a layered canvas, import images, transform layers, and save editable artwork.
- **Shared files** — upload, search, organize and transfer files between your devices and rooms.

Sessions are separate for each tab, and there is no application-imposed limit on the number of open rooms. Available memory, camera access, browser behavior and device performance still affect how many can be used at once.

## Start RoomSuite

Install Node.js 18 or later and Git. No npm packages or build step are required:

~~~sh
git clone https://github.com/ElHombreAlex/RoomSuite.git
cd RoomSuite
node server.js
~~~

On the server itself, open **http://127.0.0.1:8090/** and choose a room. The suite runs on Cliproom's existing server; starting the standalone Cliproom server still starts Cliproom on its own as before. Stop the server with Ctrl+C.

The suite uses the existing `CLIPROOM_PORT`, `CLIPROOM_DATA`, and `CLIPROOM_ALLOWED_HOSTS` environment variables. Cliproom projects and media default to `cliproom/data/`; notes, PaintRoom projects and shared files default to `cliproom/data/workspace/`. Set `ROOMSUITE_DATA` to put the latter in a separate persistent directory. See [Storage and backups](#storage-and-backups) before deploying. An adaptable systemd example is in [deploy/roomsuite.service.example](deploy/roomsuite.service.example).

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

Open **Shared files** to upload files from any authorized device, make folders, search, download, rename, move and delete. Use **Open in…** on a supported file or each room's shared-file button to bring it into an editor. Save exports back through the shared-file picker. The file type must be supported by the receiving room; shared files and Cliproom's media library are separate, so importing into Cliproom creates a library copy.

SoundRoom and CaptureRoom have a **Send to Cliproom** button; VectorRoom can send a PNG. Sending is an explicit upload to your Cliproom server. Once the upload completes, select **Open in Cliproom** to add it to a new Cliproom project. Save that project in Cliproom if you want to reopen it later. Media remains on the server after an upload even if it is not added to a saved project; consult the Cliproom guide for storage and backup details.

Choose **Your projects** in the launcher's **Your space** card to open the saved Cliproom projects browser in a separate window. Open a project or delete it after confirmation. Deleting a project removes its saved timeline but keeps uploaded media, which may be shared by other projects. PaintRoom has its own **Open** project browser; NotesRoom lists its notes in its sidebar.

## NotesRoom

Create notes and nested folders, add comma-separated tags, and search by title, body or tag. Changes autosave after a short pause. The preview supports common Markdown headings, lists, emphasis, code blocks, quotes and links; the source remains plain Markdown and unsupported syntax is preserved. Notes can be linked from any room or exported as `.md` to shared files. The server rejects an out-of-date save or deletion; use **Save as a copy** to preserve local changes or **Reload latest** to discard them. Folders must be empty before they can be deleted.

## PaintRoom

Draw with a brush or eraser, make lines, rectangles and ellipses, and move, reorder, hide or transform layers. Import a supported raster image as a layer. **Save** stores an editable project on the server; **Open** reopens or deletes it, and **Save a copy** resolves a concurrent edit. Export PNG or an editable `.paintroom` file to the device or shared files. SVG export is available for vector-only work without embedded images or eraser strokes. Use **Send to Cliproom** or export a PNG through shared files to animate it there. Projects embed imported images, which are limited to 20 MiB each; editable projects are limited to 32 MiB.

**Send to VectorRoom** saves a file through the shared-file picker and provides a link to open it. Fully opaque, unclipped vector artwork is converted into editable VectorRoom paths, scaled to fit its 1000 × 700 artboard. Hidden layers are omitted and layer grouping is flattened. Artwork containing photos, eraser strokes, transparency, clipping or other unsupported vector features is sent as a flattened PNG layer instead; the original remains editable in PaintRoom. VectorRoom can move and resize that image and add vector objects above it, but cannot recover the original PaintRoom layers from the PNG. The shared copy remains on the server until deleted.

## Storage and backups

`ROOMSUITE_MAX_FILE_BYTES` defaults to 536870912 (512 MiB per shared upload), and `ROOMSUITE_MAX_STORAGE_BYTES` defaults to 5368709120 (5 GiB total for shared files, notes and PaintRoom projects). Both accept positive integer byte counts. Cliproom's existing media library is separate and is not counted in this quota. File names and paths are validated, uploads cannot overwrite existing files, and downloads are served as attachments. Notes and PaintRoom projects use revision checks to prevent silent overwrites. Limits assume one RoomSuite server process owns the data directory; avoid modifying it directly while the service is running.

Use a dedicated unprivileged service account, keep both data directories writable only by that account, and store them outside the Git checkout. The default `cliproom/data/` and `roomsuite-data/` locations are ignored by Git, but a custom `ROOMSUITE_DATA` path inside the checkout is not automatically ignored. Never commit user data or private service settings. Repository backups cover the source and example configuration, not the data or a working restore.

Back up **both** `CLIPROOM_DATA` and `ROOMSUITE_DATA` independently of GitHub. Stop the service first for a consistent snapshot, then run the included Linux backup script with the same data paths as the service:

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

Draw rectangles, ellipses, lines and text. With the pen, click to add points and drag to create Bézier handles; finish or close the path, then use **Edit nodes** to adjust points and handles. The inspector controls fills, gradients, outlines and text. Toggle grid snapping when helpful.

**Save project** downloads a .vectorroom file that can be reopened in VectorRoom. Export SVG for scalable artwork, or PNG for a raster image. SVG/PNG exports are not editable VectorRoom project files. VectorRoom can also import a raster image as a movable, resizable layer; imported images remain raster and are embedded in project and SVG files. Images are limited to 20 MiB and project imports to 32 MiB. Work stays in the tab until you save or export.

## Checks

~~~sh
node --test cliproom/tests/*.test.js tests/*.test.js
~~~

The tests cover the existing timeline and server behavior, suite routes, shared storage limits and revision conflicts. Browser and MCP integration checks are documented in the [MCP guide](mcp/README.md#verify).

## Coding agents

The optional [RoomSuite MCP server](mcp/README.md) lets coding agents search and transfer shared files, create and organize notes, edit and export PaintRoom artwork, manage Cliproom projects, and produce images, audio and animated videos through the rooms. Image-capable agents can [request inline previews and compare frames](mcp/README.md#visual-feedback-for-agents). It runs separately from the normal application and uses isolated browser sessions. Cliproom also offers a [headless project render endpoint](cliproom/README.md#render-from-a-program).
