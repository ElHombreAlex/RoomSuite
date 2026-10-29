# RoomSuite MCP server

The optional MCP server gives a coding agent local, structured tools for producing RoomSuite output. It uses the official MCP SDK over **stdio**, and opens each job in its own headless browser session. It does not control or close your open RoomSuite tabs.

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

The MCP host starts the MCP process itself when needed; do not manually start it as a normal terminal service. The default RoomSuite URL is http://127.0.0.1:8090.

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

The longer tool timeout matters because Cliproom renders video in real time. Increase it for longer jobs and set ROOMSUITE_MCP_TIMEOUT_MS if the browser's export timeout also needs to be longer. See [OpenAI's MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

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
- Paths in tool arguments may be relative to that directory or absolute paths inside it. Output parent directories must already exist. Existing output files are never overwritten.
- Each tool call uses a separate browser session. Independent calls may run concurrently, subject to available CPU, memory, and browser resources.
- Tools return JSON containing the output path, MIME type and size. For video output, supply a filename without an extension to let the browser choose .mp4 or .webm.
- PixelRoom, SoundRoom, VectorRoom and static CaptureRoom jobs process data in the local browser session. Cliproom imports each supplied media file into its server library, where it remains even when the generated project is not saved. Set save_project to true to also create an editable Cliproom project.
- Cancelling a call stops its browser job. An upload already completed by Cliproom remains in the server library.

The MCP workspace restriction is separate from your agent host's own filesystem permissions. Choose a workspace whose files the agent is allowed to access.

## Tools

| Tool | What it does |
| --- | --- |
| roomsuite_info | Lists capabilities, the resolved workspace and the configured server URL. |
| pixelroom_edit | Adjust brightness, contrast or saturation; optionally run local subject removal and crop; export PNG, JPEG or WebP. |
| soundroom_edit | Trim, normalize, change gain, apply fades and export WAV. |
| vectorroom_create | Create shapes, text and Bézier paths; export SVG, PNG or an editable .vectorroom project. |
| captureroom_record_scene | Record a prepared image/text scene as a video. |
| cliproom_render | Assemble media and titles on tracks, optionally save the project, and render a video. |

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

## Verify

After installing the MCP dependencies and browser:

~~~sh
npm test --prefix mcp
~~~

The integration tests start a temporary local RoomSuite server, use a real MCP client over stdio, produce media through the actual editors, verify a saved Cliproom project, and check parallel jobs, cancellation and file boundaries. Set ROOMSUITE_BROWSER_PATH if using a system browser. To include the slower local PixelRoom subject-model check:

~~~sh
ROOMSUITE_MCP_TEST_MODELS=1 npm test --prefix mcp
~~~
