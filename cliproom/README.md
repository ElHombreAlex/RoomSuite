# Cliproom

Cliproom is a small, self-hosted browser video editor, designed as a companion to Pixelroom. It uses no external APIs, CDN, accounts, build step, or npm packages. The browser previews and renders the video; the included Node.js server stores your project and original media for use from other devices.

## Run it

You need Git, Node.js 18 or later, and a current browser. On Debian or Ubuntu you can install Git and Node.js with `sudo apt update && sudo apt install git nodejs`. Check `node --version`: if your distribution provides a version older than 18, install a supported version from [Node.js](https://nodejs.org/en/download) first.

Clone the private RoomSuite repository using a GitHub account authorized to access it, then start Cliproom:

```sh
git clone https://github.com/ElHombreAlex/RoomSuite.git
cd RoomSuite/cliproom
node --version
node server.js
```

On the server itself, open **http://127.0.0.1:8090/**. The server listens only on loopback. Stop it with Ctrl+C. There is no dependency installation.

By default, projects and uploaded media are stored in the `data/` directory beside `server.js`. Set `CLIPROOM_DATA` to an absolute directory to store them elsewhere, and `CLIPROOM_PORT` to use a different loopback port. The server process needs read/write access to its data directory. Keep a backup of the entire data directory, including both `projects/` and `assets/`; stop the service before taking a simple file copy.

The repository contains the app, not your personal media or projects. To move projects created in the local review preview to Linux, stop the preview and copy its complete `data/` directory to `RoomSuite/cliproom/data/` (or to the directory specified by `CLIPROOM_DATA`). Preserve both subdirectories together. After taking a backup, update a clean checkout with `git pull --ff-only` from `RoomSuite/`, then restart Cliproom.

## Share with selected Tailscale devices

The server itself has **no login or device whitelist**. It depends on Tailscale Serve and your tailnet's access policy. Before using it for personal media:

1. Make sure Tailscale is running on the server and each device, and HTTPS certificates are enabled for the tailnet.
2. Configure the tailnet's grants or ACLs so that **only the devices you choose** can reach the server on the HTTPS port you use. Check existing broad rules as they can grant access too. Anyone who can reach Cliproom can see all saved projects and their media and can make changes. The server machine's local users can also reach the loopback service.
3. Choose an unused Serve HTTPS port and the server's full Tailscale DNS name. Start Cliproom with that exact host and port allowed, for example:

   ```sh
   CLIPROOM_ALLOWED_HOSTS=your-server.your-tailnet.ts.net:8443 node server.js
   ```

4. In another terminal, configure Serve on that port:

   ```sh
   tailscale serve --bg --https=8443 8090
   tailscale serve status
   ```

   Open the HTTPS URL shown by Tailscale on each approved device. A dedicated port helps avoid replacing an existing service at the root HTTPS port. Choose another unused port if 8443 is already in use, and use the same port in the allowed host and tailnet policy. For normal HTTPS port 443, omit `:443` from `CLIPROOM_ALLOWED_HOSTS`. Multiple allowed hosts can be comma-separated.
5. Test both an allowed device and a device that should be denied. Tailscale policy controls access to the port; Cliproom's host check and same-origin checks are additional safeguards, not authentication.

See [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) and [Tailscale grants](https://tailscale.com/docs/features/access-control/grants). Do not use Tailscale Funnel or expose this service to the public internet. If you change an existing Serve configuration, check it first with `tailscale serve status`.

For an always-on installation, run `node server.js` as a dedicated, unprivileged service user with your chosen environment variables, a private data directory, and a service manager such as systemd. Serve's `--bg` mode keeps its proxy configured; Cliproom's Node process must also stay running.

## Edit and hand off a project

- **Bring in your media** imports video, photos, or audio. Each file is uploaded to your Cliproom server immediately and appears in your library. It is also added to the end of the chosen video or audio track. Use the two track selectors above the library to choose where new items go; the **+** beside a library item adds another instance.
- Use **Video track** and **Audio track** above the timeline to add tracks. Video 1 is the bottom picture layer; Video 2 and later layers appear above it. Multiple audio clips and the original sound in video clips play together. Each video instance has its own decoder, so even the same source can appear on different tracks at once.
- Drag a clip horizontally to move it in time, or drag its left edge to trim its start. Drag the right edge of a video or image to trim its end. Select a clip to change its track, adjust its source in/out points, timeline start, speed and volume, or place it at the playhead. Select a visible video or photo directly on the preview or on the timeline, then drag it on the preview to position it; drag its corner to resize it or its round handle to rotate it freely. The inspector also provides exact position and rotation fields, fit/fill, opacity, horizontal flip and color controls. Photos can be given a duration. Scroll inside the timeline to see additional tracks, use the zoom controls for finer adjustments, and mute audio or hide picture tracks when needed. The × beside a track removes it and its clips; undo can restore them.
- Click or tap an audio clip at the point where you want to cut it. A short delay distinguishes a single click from a double-click: double-click or double-tap an audio clip to open and focus its speed control without cutting it. All audio controls remain in the details panel, where **Audio clip options** also lets you select any audio clip without cutting it. Drag the body to move it, its left edge to trim, or its right edge to stretch or shorten it without trimming its source; stretching changes its playback speed. Keyboard users can select a clip, move the playhead and use **Split**, or adjust speed in the inspector. **Fit audio to entire video** moves the selected audio to the start and adjusts its tempo to the length of the picture. This changes the tempo uniformly; it does not detect beats or synchronize them to cuts. Speeds from 0.5× to 4× are supported, so trim the source if the requested fit falls outside that range. Cliproom asks the browser to preserve pitch where supported.
- Select a clip to set fade-in and fade-out durations. **Dissolve from previous** overlaps it with the preceding video clip on the same track; the fade-in duration sets the overlap (one second if the field is zero). **Crossfade from previous** does the equivalent for audio clips. Video fades affect their original sound too. Clip placement and transitions can be adjusted or undone.
- Click the ruler to move the playhead, then **Split** the selected video or audio clip. Duplicate, remove, undo and redo are available. The previous/next frame buttons move the playhead in 1/30-second steps. Add a text title and select it on the preview or timeline; drag it on the preview to move it, its corner to resize it, or its round handle to rotate it freely. You can also drag the title or its edges along the timeline to change its timing. The inspector provides exact position and rotation, size, text width, font, bold, italic and color controls. Named fonts use fonts available on the device and may look different on another device; Cliproom uses a fallback if a font is missing. Arrow keys nudge a selected picture or title; hold Shift for a larger step. Hold Shift while rotating to snap to 15-degree steps.
- Choose a landscape, portrait, or square canvas, and a 720p or 1080p export size. **Export** renders the current timeline with its titles and audio and downloads a video to the device. The browser chooses MP4 or WebM according to its supported codecs.
- Name the project and press **Save**. On another device, open the same Cliproom URL and choose **Open**. The project references the source files already stored on the shared server; those files do not need to be uploaded again.
- Saving is manual, not live collaboration or automatic syncing. If another device saved the same project since you opened it, Cliproom offers to save your version as a copy instead of overwriting the newer one. Make sure a save completes before switching devices.
- Projects from the first and second Cliproom versions open in the new timeline; projects from the first version retain their picture order and audible soundtrack range. Saving an older project upgrades its format; an older Cliproom version cannot reopen the upgraded project. Back up the data directory before upgrading if you want to keep a version usable by the old app.

## Practical limits

Import and playback depend on the browser's own decoders, so not every codec in an MP4, MOV, or other container will work. Files are limited to 2 GB each, subject to available server storage, browser memory, and network reliability. Uploading and rendering large files can take time.

Export happens in real time and keeps encoded chunks in browser memory. Keep the tab visible until it finishes; export stops if the tab is hidden. Try 720p for older devices. Playback and export can stutter or drift if the device or network cannot decode media quickly enough, and they are not intended as frame-accurate professional editing. The frame buttons use 1/30-second steps rather than the source file's exact frame rate. Pitch preservation and color adjustments depend on browser support. Some mobile browsers do not support the required recording or audio APIs; the export dialog reports the available format.

This version supports multiple picture and audio tracks, fades, cross-dissolves and text overlays. It does not yet provide keyframes, automatic beat matching, advanced effects, a project archive, or an in-app storage cleanup tool. Several simultaneous videos can place significant load on a device; the actual number of usable tracks depends on its hardware, browser, media and network. Imported media stays on the server even if removed from the timeline; manage storage and backups on the server. Project media is stored on that server without application-level encryption.

## Check the service

```sh
node --test tests/*.test.js
```

The tests check timeline migration, composition and transition timing. The server test starts a separate loopback server and temporary data directory to check media uploads and byte ranges, project saves and concurrent-save protection, and same-origin/host restrictions.
