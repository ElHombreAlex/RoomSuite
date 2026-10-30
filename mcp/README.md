# RoomSuite MCP server

The optional MCP server gives a coding agent local, structured tools for producing RoomSuite output. It uses the official MCP SDK over **stdio**. Editor-based jobs open their own headless browser sessions; project and file utilities use the server or local filesystem directly. It does not control or close your open RoomSuite tabs.

## Install

The MCP integration requires **Node.js 20 or later**, npm, and a Chromium browser. The ordinary RoomSuite server can still run on Node.js 18 or later without these optional dependencies.

On Windows, the [RoomSuite installer](../windows/README.md) can install the MCP dependencies and matching headless Chromium as an optional component. Start RoomSuite and select **MCP setup** in its launcher to copy a configuration containing the correct bundled executable, workspace and browser paths. Add it to your agent's MCP settings and restart the agent. This route needs no separate Node, npm or browser installation.

For a source checkout on Windows or Linux, run from the repository root:

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

## Files and sessions

- ROOMSUITE_MCP_WORKSPACE is the directory the agent can use for inputs and outputs. If omitted, it defaults to the ignored mcp/workspace/ directory. The directory is created if necessary.
- The **server shared files** are a separate persistent workspace, accessed through `roomsuite_shared_*` tools. Shared paths use `/` and are relative to the server's shared-files root; MCP workspace paths refer to the machine running the agent. Upload and download tools copy between these two locations.
- Paths in tool arguments may be relative to that directory or absolute paths inside it. Output parent directories must already exist. Existing output files are never overwritten.
- Editor-based calls use separate browser sessions. Independent calls may run concurrently, subject to available CPU, memory, and browser resources.
- File-producing tools return JSON containing the output path, MIME type and size. For video output, supply a filename without an extension to let the browser choose .mp4 or .webm.
- PixelRoom, SoundRoom, VectorRoom and static CaptureRoom jobs process data in the local browser session. Cliproom imports each supplied media file into its server library, where it remains even when the generated project is not saved. Set save_project to true to also create an editable Cliproom project.
- Cancelling a call stops its browser job. An upload already completed by Cliproom remains in the server library.

The MCP workspace restriction is separate from your agent host's own filesystem permissions. Choose a workspace whose files the agent is allowed to access.

## Tools

| Tool | What it does |
| --- | --- |
| roomsuite_info | Lists capabilities, the resolved workspace and the configured server URL. |
| roomsuite_list_files | List a workspace directory with file sizes and modification times, using offset/limit pagination. |
| roomsuite_media_info | Inspect a local image, audio or video file's type, dimensions and duration without uploading it. |
| roomsuite_preview_image | Return an existing raster image from the MCP workspace as an inline preview for a compatible vision-capable agent. |
| roomsuite_preview_video | Decode frames at specified times from a local video and return an image, actual frame timestamps, dimensions, codecs and audio-track metadata. |
| roomsuite_write_begin, roomsuite_write_append, roomsuite_write_finish, roomsuite_write_abort | Safely build a JSON or `.paintroom` file in bounded chunks in the agent workspace, with retry and optional checksum verification. |
| roomsuite_shared_list, roomsuite_shared_search | Browse a shared folder or search filenames and paths across the server workspace. Search returns at most 200 matches and reports `truncated` if the scan was limited. |
| roomsuite_shared_upload, roomsuite_shared_download | Transfer a file between the agent's MCP workspace and the server shared workspace; existing destination files are never overwritten. |
| roomsuite_shared_mkdir, roomsuite_shared_move, roomsuite_shared_delete | Create a folder, move or rename a file/folder, or delete it; folder deletion requires `recursive: true`. |
| notesroom_list, notesroom_get | Search notes by text, folder or tag; read Markdown, metadata, revision and a RoomSuite URL. |
| notesroom_create, notesroom_update, notesroom_delete | Create, edit or delete notes. Updates and deletions require the current `base_revision`. |
| notesroom_folders, notesroom_delete_folder | List or create nested folders, or delete an empty folder. |
| paintroom_list, paintroom_get | List or read saved PaintRoom projects and their editable layers. |
| paintroom_create, paintroom_edit, paintroom_clone, paintroom_import_project | Create, import, clone or edit artwork, with IDs, file-based elements, Bézier paths and revision checks. Set `include_preview` for an inline image in the same response. |
| paintroom_preview, paintroom_preview_sheet | Preview one saved project, or compare 2–12 projects in a labeled contact sheet. |
| paintroom_export | Export a saved project to the MCP workspace as PNG, `.paintroom`, or SVG for artwork without images or eraser strokes. PNG uses a local browser. |
| paintroom_export_batch | Export a sequence of saved projects as PNGs and a revision-and-hash manifest; byte-identical PNGs reuse a path. |
| pixelroom_edit | Adjust brightness, contrast or saturation; optionally run local subject removal and crop; export PNG, JPEG or WebP. |
| soundroom_edit | Trim, normalize, change gain, apply fades and export WAV. |
| vectorroom_create, vectorroom_preview | Create shapes, text and Bézier paths; export SVG, PNG or an editable .vectorroom project, or preview a composition without writing a file. `vectorroom_create` also accepts `include_preview`. |
| captureroom_record_scene | Record a prepared image/text scene as a video. |
| cliproom_import_media | Upload media to the Cliproom library and return the asset metadata needed in a project. |
| cliproom_list_projects | List saved projects with IDs and revisions. |
| cliproom_get_project | Return a saved project, or write its JSON to a new workspace file. |
| cliproom_save_project | Create a project from workspace JSON, or update one using its current revision. |
| cliproom_render | Assemble media and titles on tracks, apply transforms and keyframes, optionally save the project, and render a video. |
| cliproom_render_project | Render a saved project ID or workspace project JSON through the server endpoint. |

CaptureRoom's MCP tool does **not** capture a live screen, camera or microphone. Those require a person to grant permission in a browser on the device being captured. The MCP integration does not provide live streaming. Browser codecs, model availability, and device performance still limit exports. Subject removal is approximate and the resulting image should be reviewed.

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

Use `paintroom_preview` for a saved project or `paintroom_preview_sheet` with `project_ids` to compare up to 12 frames side by side. The sheet labels the frames and uses white behind transparent areas; individual previews preserve transparency. `vectorroom_preview` previews VectorRoom elements without saving an output file. `roomsuite_preview_image` previews an existing PNG, JPEG, WebP, GIF or AVIF inside the MCP workspace, with a 20 MiB source limit.

`paintroom_preview` also accepts `crop: {"x":0,"y":0,"width":200,"height":150}` in original canvas pixels. A contact sheet can request `similarity: true` for a matrix of pixel similarities: it compares 64 × 64 thumbnails composited over white, where 1 means equal sampled pixels. It is an advisory cue for finding repeated or very similar pictures, not a judgment of animation or artistic quality; intentional holds and loops are valid.

Previews are opt-in on create/edit operations to avoid unnecessary browser startup and image payloads. They are rendered locally through the room, bounded in size and returned in memory without creating a preview file. `max_dimension` (or `preview_max_dimension` on create/edit) accepts 256–1536 pixels; default is 1024, or 1536 for contact sheets. This is still a snapshot per call, not a live stream. If a preview fails **after** a create or edit succeeded, the response keeps the saved project ID and revision and reports `preview_error`; retry `paintroom_preview` rather than creating the project again. The same rule applies to a saved VectorRoom output with a failed preview.

For PaintRoom `rect` and `ellipse` elements, a filled shape has no outline unless `color` or `width` is supplied, or `stroke: true` is requested. Use `stroke: false` to suppress an outline explicitly. Unfilled shapes and lines retain their default outlines. VectorRoom's filled rectangles and ellipses also default to no outline; specify `stroke` or `stroke_width` when one is wanted. Existing saved projects keep their stored outlines.

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

The saved project returned by `save_project` can be opened and edited in Cliproom. The inspector shows keyframe controls and timeline markers; existing projects load normally and are upgraded to version 4 when saved. An older Cliproom version cannot reopen the upgraded file, so retain a backup if needed.

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

## Verify

After installing the MCP dependencies and browser:

~~~sh
npm test --prefix mcp
~~~

The integration tests start temporary local RoomSuite servers, use a real MCP client over stdio, inspect and produce media, check timeline/source keyframe mapping, rendered motion and audio in both modes, and exercise project management, the render endpoint, parallel jobs, cancellation and file boundaries. Browser-heavy test files run sequentially to avoid starving realtime recording; individual tests still check concurrent jobs. Set ROOMSUITE_BROWSER_PATH if using a system browser. To include the slower local PixelRoom subject-model check:

~~~sh
ROOMSUITE_MCP_TEST_MODELS=1 npm test --prefix mcp
~~~
