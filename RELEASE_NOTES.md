## RoomSuite 3.5.1

- **Refined room icons:** a coordinated set for all creative and productivity rooms, with redesigned PixelRoom, Cliproom and NotesRoom marks and an updated RoomSuite arch. CaptureRoom uses the original viewfinder icon. Icons appear in the launcher, room headers and browser tabs, including standalone Pixelroom and Cliproom.
- **Artwork showcase:** the README features artwork made in RoomSuite for image editing and painting, vector design, and motion, video and sound.
- **Update checks:** the deployment check now includes SVG assets, so changes to room icons are included in frontend verification.

## RoomSuite 3.5.0

- **RoomSuite agent skill:** install the bundled skill for task-based guidance across the creative rooms, productivity suites, shared files and notes. It helps agents discover enabled MCP tools, choose a workflow, manage separate file spaces and revisions, and inspect results. See the [skill installation guide](mcp/README.md#install-the-roomsuite-agent-skill).
- **Clearer MCP discovery:** productivity capability summaries now describe supported all-day and time-zone calendar events, optional CalDAV sync and supported anchored Word comments accurately. Conversion and synchronization limits still apply.
- **Updating:** the skill and MCP connection are separate. Copy the skill into your agent's skills directory and restart the agent; refresh that copy when RoomSuite is updated. Existing RoomSuite projects remain compatible.

## RoomSuite 3.2.2

- **Reusable compositions:** MotionRoom groups, sibling attachments with anchors and orientation, reusable symbols with instance overrides, cross-project copies, and parameterized behaviors separate motion from content.
- **Flexible layout and assets:** text boxes wrap and can shrink to fit; images support fit modes, rounded clipping and layer styles. Replace an embedded image or link/relink a stable asset ID to Shared files. Missing links are visible and block export.
- **Review and audio handoff:** download contact sheets, compare projects and inspect a full-resolution crop; MCP adds difference previews and advisory frame-by-frame motion lint. An optional audio file can accompany a render into Cliproom as a separate track.
- **Compatibility:** 3.2 and 3.2.1 projects open in 3.2.2. Newly saved projects use a newer format and do not open in older MotionRoom versions. Attachments are between siblings, symbols contain native MotionRoom layers, and linked assets require the same Shared files server. Video downloaded directly from MotionRoom remains silent. See the [MotionRoom guide](README.md#motionroom) for limits.

## RoomSuite 3.2.1

- **MotionRoom compositions:** set an independent stage, add text, shapes, images and a live magnifier, reorder layers, and animate text reveal and lens zoom. Bricolage Grotesque and Gelasio are included; other fonts can be embedded.
- **Frame-accurate video:** render WebM or MP4 at 1–60 fps, repeat poses for stop motion, export transparent WebM/VP9, and send video to Cliproom. The optional MCP component and a compatible browser encoder are required.
- **Agent workflows and memory:** create, inspect, batch-edit, preview and render compositions through MotionRoom MCP tools. PaintRoom layers are trimmed to visible bounds before caching, allowing more sparse layers within the retained-pixel limit.
- Existing 3.2 MotionRoom projects open in the new version; newly saved projects use a newer format. See the [MotionRoom guide](README.md#motionroom) for limits.

## RoomSuite 3.2.0

- **MotionRoom:** animate individual PaintRoom layers or VectorRoom objects with keyframed position, scale, rotation and opacity; choose easing, preview on the timeline, save an editable motion project and export WebM or send it to Cliproom.
- PaintRoom, VectorRoom and Shared files can open supported artwork in MotionRoom. The motion project embeds an editable copy of the source; edits made in the original room do not sync automatically.
- MotionRoom renders layers as bitmaps and records video in real time on a solid background, without audio. Duration, project size and rendered-layer memory are bounded; see the [MotionRoom guide](README.md#motionroom).

## RoomSuite 3.1.0

- Fixes a timing bug that could collapse the creative grading section when changing a color wheel, curve or hue range. The panel remains open in both PixelRoom and Cliproom.
- Speeds up the shared CPU color renderer while preserving the v3.0 pixel output in the compatibility fixtures. In one 1080p two-track test, a 105-frame export fell from 36.01 to 23.45 seconds. Results vary by device and project; [performance notes](PERFORMANCE.md) include the full comparison.
- Warns in the editor and MCP results when real-time rendering completes substantially fewer draws than its 30 fps target. This is not a count of encoded frames and cannot detect every dropped frame. Demanding full-resolution grades can still drop frames; use **Every frame** export for supported projects when consistent frames matter.
- Prefers VP8 for real-time WebM when the browser reports support, otherwise trying VP9, and gives recovery guidance if a browser produces an empty recording. This fixes the short 1080p export exercised by the macOS CI check.
- Runs the complete MCP suite in Windows and Linux CI, and adds advanced grading coverage to both Mac jobs. Some tests need optional speech or CalDAV fixtures; [the MCP guide](mcp/README.md#verify) lists them.

Physical mobile and low-end devices were not available for this comparison. Existing v3 limits, including static video masks, the iCalendar subset and the every-frame export requirements, remain as described below.

## RoomSuite 3.0.0

RoomSuite 3 expands the creative and productivity rooms while keeping projects and processing local. Existing 2.5 projects remain usable; back up your RoomSuite data before updating.

### Creative tools

- **PixelRoom and Cliproom:** use shared photo and video grading with exposure, white balance, tonal controls, curves, HSL, color wheels, supported `.cube` LUTs and finishing effects. Save portable `.roomgrade` looks, share them through Shared files, compare before and after, and adjust strength without changing the source. Cliproom can animate supported adjustments.
- **Cliproom:** see audio waveforms, make optional optimized previews, import/export subtitles or generate captions with an optional local speech model, package a project with its media, and review unused media before moving it to recoverable trash. Every-frame WebM export uses the optional server renderer when realtime export drops frames.
- **PixelRoom:** refine non-destructive cutout and color-region masks and use local OCR in English, French, Spanish or Italian. Original lettering can be isolated for editing.
- **SoundRoom:** save editable sessions, apply EQ, compression, a local noise gate and a sample-peak ceiling, inspect loudness, and send processed audio to Cliproom with a reopenable source.
- **CaptureRoom, VectorRoom and PaintRoom:** reuse capture scenes and recover some interrupted recordings; arrange and combine supported vector shapes; and paint with brush presets, pressure, symmetry, selections and editable masks.

### Productivity and shared files

- **FilesRoom and NotesRoom:** recover trashed shared files, keep file versions, search and preview supported content, link notes in both directions, protect note media from moves, and export a note with its supported assets.
- **DocSuite, GridSuite and DeckSuite:** use anchored comments and tracked text edits, cross-sheet formulas and multi-series charts, and independent slide elements with speaker notes and templates.
- **PlanSuite:** import supported iCalendar events and recurring series, create all-day events, and optionally preview and apply a bounded CalDAV sync configured on the local server.
- **MCP:** agents can use the corresponding saved-project, preset, media, creative and productivity workflows with revision checks and structured feedback. See the [MCP guide](mcp/README.md).

### Known limits

- Advanced full-resolution video grading is CPU intensive. Use **Fast color preview** while editing and **Every frame** export for consistent frames; the latter can be slower and needs the optional MCP/server-render component. See [performance notes](PERFORMANCE.md).
- Cliproom color masks are static rather than motion-tracked. Vector shape combinations, PaintRoom masks, Word/PowerPoint interchange and OCR have bounded support and may need review. See the [feature and parity audit](UPGRADE_STATUS.md).
- PlanSuite supports a documented subset of iCalendar recurrence, not every RRULE or floating date-time. CalDAV sync requires explicit server configuration, previews changes, and does not overwrite unsupported remote event fields or remote-origin edits. Back up calendars before enabling synchronization.
- The candidate was tested on Windows, with desktop Chromium and a mobile-sized WebKit emulation. Physical mobile and low-end hardware was not available for testing. Native Linux and macOS checks are run separately by the release workflow.

## Installation

On Windows, download `RoomSuite-Setup.exe`. Choose the MCP option to include agent tools and headless rendering. Close RoomSuite before updating and select the MCP component again if you use it. The Windows installer is unsigned.

On macOS, download `RoomSuite-macOS-arm64.dmg` for Apple silicon or `RoomSuite-macOS-x64.dmg` for Intel, open it and drag RoomSuite into Applications. The Mac app is **unsigned and not notarized**. After attempting to open it, approve it under **System Settings → Privacy & Security**. Camera, microphone and screen capture also need the usual browser and macOS permissions.

The checksums detect download corruption; they are not publisher signatures. See the [README](README.md) and platform guides for setup, data storage and backups.
