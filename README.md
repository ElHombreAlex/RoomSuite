# RoomSuite

RoomSuite is a self-hosted set of creative tools. One launcher opens each editor in its own tab or window, so you can work in several rooms at once:

- **PixelRoom** — photo editing, layers, text and local subject/text isolation.
- **Cliproom** — a multitrack video editor with a server-backed media and project library.
- **SoundRoom** — record or import audio, select, trim, cut, mark splits, adjust volume and fades, and export WAV.
- **CaptureRoom** — arrange screen, camera, microphone, image and text sources into scenes and record them.
- **VectorRoom** — create shapes, text and editable Bézier paths, with solid or gradient fills and SVG/PNG export.

SoundRoom, CaptureRoom and VectorRoom run in the browser. Their sessions are separate for each tab, and there is no application-imposed limit on the number of open rooms. Available memory, camera access, browser behavior and device performance still affect how many can be used at once.

## Start RoomSuite

Install Node.js 18 or later and Git. No npm packages or build step are required:

~~~sh
git clone https://github.com/ElHombreAlex/RoomSuite.git
cd RoomSuite
node server.js
~~~

On the server itself, open **http://127.0.0.1:8090/** and choose a room. The suite runs on Cliproom's existing server; starting the standalone Cliproom server still starts Cliproom on its own as before. Stop the server with Ctrl+C.

The suite uses the existing CLIPROOM_PORT, CLIPROOM_DATA, and CLIPROOM_ALLOWED_HOSTS environment variables. By default, Cliproom projects and uploaded media are stored in the cliproom/data/ directory. Back up that entire directory, including projects/ and assets/, with the service stopped.

## Use it on other devices

The server listens on loopback only and has **no built-in login**. For selected devices, use HTTPS through Tailscale Serve and configure tailnet access rules to allow only those devices. Anyone who can reach the server can access and change all Cliproom projects and uploaded media. Follow the detailed instructions in [Cliproom's guide](cliproom/README.md#share-with-selected-tailscale-devices); start the root server instead of the standalone Cliproom server to serve the whole suite.

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

Each room opens as a separate session. Starting another tab does not replace your current work. PixelRoom and the three new rooms process their media on the device. Cliproom imports media into its server library.

SoundRoom and CaptureRoom have a **Send to Cliproom** button; VectorRoom can send a PNG. Sending is an explicit upload to your Cliproom server. Once the upload completes, select **Open in Cliproom** to add it to a new Cliproom project. Save that project in Cliproom if you want to reopen it later. Media remains on the server after an upload even if it is not added to a saved project; consult the Cliproom guide for storage and backup details.

Choose **Your projects** in the launcher's **Your space** card to open the saved Cliproom projects browser in a separate window. Open a project or delete it after confirmation. Deleting a project removes its saved timeline but keeps uploaded media, which may be shared by other projects. Other rooms' work is stored or exported on the device and is not listed in this server project browser.

## SoundRoom

Choose an audio file or record your microphone. Drag across the waveform or enter start and end times to select a range; trim to it or cut it out. Click to move the playhead, then add a split marker. **Export current part** exports the selection, or the section containing the playhead between split markers. Volume and fades apply to playback and WAV exports; normalize sets volume based on the audio's peak.

Audio and edit history stay in the tab's memory. Export a WAV before closing it; split markers and editable history are not saved in the WAV. Supported imports depend on browser decoders, and large recordings depend on available memory.

## CaptureRoom

Add a scene, then add visual sources and microphones. Drag a visual source in the preview or use its position and size controls. Switch scenes during a recording; only the active scene's visible sources and audible sources appear in the output. Sources in other scenes remain open until removed or the tab closes.

Start and stop recording, then download the selected result or send it to Cliproom. Recordings are kept in the tab's memory, so download anything you want to keep before closing it. The preview is 1280 × 720 and recording targets 30 fps; actual performance and output format depend on the browser and device. CaptureRoom currently records locally and does **not** provide live streaming.

The browser asks for permission for each screen-sharing session. Screen or system audio may not be offered, and mobile screen capture support varies. Camera/microphone availability also depends on permissions and hardware. Keep the tab open and visible during recording; browsers and mobile operating systems may pause or throttle background capture. Recordings can consume substantial memory.

## VectorRoom

Draw rectangles, ellipses, lines and text. With the pen, click to add points and drag to create Bézier handles; finish or close the path, then use **Edit nodes** to adjust points and handles. The inspector controls fills, gradients, outlines and text. Toggle grid snapping when helpful.

**Save project** downloads a .vectorroom file that can be reopened in VectorRoom. Export SVG for scalable artwork, or PNG for a raster image. SVG/PNG exports are not editable VectorRoom project files. Work stays in the tab until you save or export.

## Checks

~~~sh
node --test cliproom/tests/*.test.js tests/*.test.js
~~~

The tests cover the existing timeline and server behavior, suite routes and static asset handling, and upload/metadata handoff.

## Coding agents

The optional [RoomSuite MCP server](mcp/README.md) lets coding agents inspect files and media, manage Cliproom projects, and create images, audio, vector artwork and animated videos through the rooms. It runs separately from the normal application and uses isolated browser sessions. Cliproom also offers a [headless project render endpoint](cliproom/README.md#render-from-a-program).
