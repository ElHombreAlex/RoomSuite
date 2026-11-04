---
name: roomsuite
description: Use RoomSuite or its rooms for photo editing (PixelRoom), painting (PaintRoom), vector art (VectorRoom), animation (MotionRoom), video (Cliproom), audio (SoundRoom), screen recording (CaptureRoom), shared files and NotesRoom, documents (DocSuite), spreadsheets (GridSuite), presentations (DeckSuite), or calendars (PlanSuite). Use when finding, creating, editing, reviewing, rendering, or exporting RoomSuite work.
---

# RoomSuite

Use the connected RoomSuite MCP server for work in the user's RoomSuite instance. Its tools operate on the configured instance, not on open browser tabs. This skill is guidance, not an inventory of the user's content: when locating existing work, search the relevant live store and inspect the returned item. Keep the requested output, destination, and editability in view, and report the returned project URL or output path when useful.

## Discover and call tools

1. Call a directly advertised RoomSuite tool when available. Otherwise, search for the specific room and action with `roomsuite_find_tools`, inspect the selected tool's current schema and annotations with `roomsuite_tool_schema`, then call `roomsuite_invoke` with `{"name":"tool_name","arguments":{...}}`. For example, after inspecting its schema, read a cell with `{"name":"gridsuite_read_cells","arguments":{"path":"Budget.gridsuite","addresses":["A3"]}}`.
2. The default `standard` mode advertises common tools plus discovery; `compact` exposes discovery and diagnostics only; `full` advertises all enabled tools directly. Search the enabled catalog and handle pagination. `roomsuite_info.rooms` is the enabled catalog, not a list of direct-call names. On newer servers, `direct_tools` and the discovery results' `directly_advertised` flag identify direct calls; otherwise use the host's advertised tool list. Invoke other enabled tools through `roomsuite_invoke`.
3. A configured group filter or older installation can make a named tool unavailable. `ROOMSUITE_MCP_MODE` selects the mode; `ROOMSUITE_MCP_GROUPS` can restrict groups and must include `shared` for shared-file tools. Explain a missing group or needed update rather than assuming a tool exists or changing connection settings without authorization. If the MCP connection is missing, tell the user it must be enabled and the agent restarted.

These guides were checked against RoomSuite 3.2.2 and 3.5.0; those are baselines, not required or maximum versions. The installed skill is a static copy and does not update itself. For any version, use the connected server's current tools and schemas, and check version-matched documentation or safe inspection when a guide and the live server disagree. Before saying a task is unsupported, search for the specific operation: an unadvertised tool may still be invokable, and broad capability summaries can be stale. If the tool is unavailable or needs optional configuration, explain the limit for this connection rather than claiming the whole suite lacks the feature.

## Choose a workflow

| User's intent | Start with | Guide |
| --- | --- | --- |
| Retouch, crop, or remove a photo background | PixelRoom: raster export or edits to an existing `.pixelroom` project | [Visual and motion](references/visual-motion.md) |
| Paint a layered illustration | PaintRoom: saved artwork and editable `.paintroom` export | [Visual and motion](references/visual-motion.md) |
| Make a logo, icon, diagram, or precise shapes | VectorRoom: editable `.vectorroom`, SVG, or PNG | [Visual and motion](references/visual-motion.md) |
| Animate artwork or title cards | MotionRoom: editable composition and silent video or GIF render | [Visual and motion](references/visual-motion.md) |
| Edit or render video, subtitles, or audio | Cliproom and SoundRoom: projects, media, and renders | [Video and audio](references/video-audio-capture.md) |
| Record a prepared scene or ask about live capture | CaptureRoom: static scenes through MCP; live capture in its interactive UI | [Video and audio](references/video-audio-capture.md) |
| Find or organize shared files and notes | Shared files and NotesRoom | [Shared files and notes](references/shared-notes.md) |
| Work on documents, spreadsheets, slides, or calendars | DocSuite, GridSuite, DeckSuite, or PlanSuite | [Productivity](references/productivity.md) |

Read only the references needed for the request. For less common operations, search the live catalog rather than guessing a tool or copying a schema from memory.

## Working rules

- **Keep file spaces straight.** Search the relevant store(s); no single search covers them all. For tool arguments that take local files, **inputs and outputs must be inside the configured MCP workspace**, either as relative paths or absolute paths within it. The agent's current directory or `/tmp` is not automatically that workspace. Use `roomsuite_list_files` or, if needed, `roomsuite_info` to find the root; use allowed filesystem tools or Shared-file download to place inputs there.

  | Space | Paths and tools |
  | --- | --- |
  | MCP workspace | Local to the MCP server's machine; `roomsuite_list_files`, local media inputs and outputs. |
  | Server Shared files | Separate server-relative `/` paths; `roomsuite_shared_*`, productivity files, and upload/download copies. |
  | Cliproom media library | Server asset IDs; imported media persists even without a saved project. |
  | NotesRoom and PaintRoom | Separate server stores, searched with their respective list tools. |
- **Protect concurrent edits without unnecessary rereads.** Before the first edit of existing work, obtain its current state, IDs, and revision. Pass a revision where the selected tool requires one. For consecutive edits, reuse the latest revision returned by the previous successful write; a new read before every edit is not required. If another editor changes the item, a stale write can fail: reread and reconcile the requested change rather than overwriting newer work. Use `dry_run` when supported and helpful. Follow each retryable tool's ID and receipt rules; after a timeout, check for a completed write before repeating it.
- **Cliproom can render audio.** Its renders include available audio by default; MotionRoom's downloaded render is silent. See the room guides for the audio handoff and verification.
- **Inspect results.** Check errors, warnings, partial results, and returned paths or URLs. Outputs are create-only unless a tool explicitly supports revision-checked replacement; output parent directories must exist. Inspect images or video frames when visual quality matters and the host actually delivers image blocks; use a suitable preview tool or be clear when visual inspection is unavailable. A successful write can include a preview error: do not recreate it blindly.
- **Match side effects to the request.** Prefer recoverable trash when removing Shared files; the older `roomsuite_shared_delete` and purge tools are permanent. Searches and dependency audits can be incomplete and do not cover unsaved work or external files. Do not infer permission to download optional models, sync an external calendar, or permanently delete content from a general request to edit or review.

After a RoomSuite code update, restart the backend and reconnect or restart the agent so it can launch the updated MCP process. When components may be out of sync, `roomsuite_check_deployment` checks this connected MCP process against the backend and served frontend. Restart stale components and check again; it does not verify every asset or browser cache.
