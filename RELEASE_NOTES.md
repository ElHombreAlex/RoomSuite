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
