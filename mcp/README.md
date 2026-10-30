# RoomSuite MCP server

The optional MCP server gives a coding agent local, structured tools for producing RoomSuite output. It uses the official MCP SDK over **stdio**. Editor-based jobs open their own headless browser sessions; project and file utilities use the server or local filesystem directly. It does not control or close your open RoomSuite tabs.

## Install

The MCP integration requires **Node.js 20 or later**, npm, and a Chromium browser. The ordinary RoomSuite server can still run on Node.js 18 or later without these optional dependencies.

From the repository root:

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
| roomsuite_shared_list, roomsuite_shared_search | Browse a shared folder or search filenames and paths across the server workspace. Search returns at most 200 matches and reports `truncated` if the scan was limited. |
| roomsuite_shared_upload, roomsuite_shared_download | Transfer a file between the agent's MCP workspace and the server shared workspace; existing destination files are never overwritten. |
| roomsuite_shared_mkdir, roomsuite_shared_move, roomsuite_shared_delete | Create a folder, move or rename a file/folder, or delete it; folder deletion requires `recursive: true`. |
| notesroom_list, notesroom_get | Search notes by text, folder or tag; read Markdown, metadata, revision and a RoomSuite URL. |
| notesroom_create, notesroom_update, notesroom_delete | Create, edit or delete notes. Updates and deletions require the current `base_revision`. |
| notesroom_folders, notesroom_delete_folder | List or create nested folders, or delete an empty folder. |
| paintroom_list, paintroom_get | List or read saved PaintRoom projects and their editable layers. |
| paintroom_create, paintroom_edit | Create artwork with an optional shared image, add shapes or strokes, and change layer transforms using the current revision. |
| paintroom_export | Export a saved project to the MCP workspace as PNG, `.paintroom`, or SVG for artwork without images or eraser strokes. PNG uses a local browser. |
| pixelroom_edit | Adjust brightness, contrast or saturation; optionally run local subject removal and crop; export PNG, JPEG or WebP. |
| soundroom_edit | Trim, normalize, change gain, apply fades and export WAV. |
| vectorroom_create | Create shapes, text and Bézier paths; export SVG, PNG or an editable .vectorroom project. |
| captureroom_record_scene | Record a prepared image/text scene as a video. |
| cliproom_import_media | Upload media to the Cliproom library and return the asset metadata needed in a project. |
| cliproom_list_projects | List saved projects with IDs and revisions. |
| cliproom_get_project | Return a saved project, or write its JSON to a new workspace file. |
| cliproom_save_project | Create a project from workspace JSON, or update one using its current revision. |
| cliproom_render | Assemble media and titles on tracks, apply transforms and keyframes, optionally save the project, and render a video. |
| cliproom_render_project | Render a saved project ID or workspace project JSON through the server endpoint. |

CaptureRoom's MCP tool does **not** capture a live screen, camera or microphone. Those require a person to grant permission in a browser on the device being captured. The MCP integration does not provide live streaming. Browser codecs, model availability, and device performance still limit exports. Subject removal is approximate and the resulting image should be reviewed.

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

The integration tests start a temporary local RoomSuite server, use a real MCP client over stdio, inspect and produce media, check timeline/source keyframe mapping, rendered motion and audio in both modes, and exercise project management, the render endpoint, parallel jobs, cancellation and file boundaries. Set ROOMSUITE_BROWSER_PATH if using a system browser. To include the slower local PixelRoom subject-model check:

~~~sh
ROOMSUITE_MCP_TEST_MODELS=1 npm test --prefix mcp
~~~
