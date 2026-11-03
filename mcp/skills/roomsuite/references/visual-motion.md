# Visual work and motion

Discover and inspect the current schema for each tool before invoking it when it is not directly advertised. Preserve an editable project when the user asks to keep working on the result.

## PaintRoom

- `paintroom_list` and `paintroom_get` find saved artwork, layers, object IDs, and revisions. `paintroom_create` makes a saved layered project from elements or an `elements_path` JSON file; `paintroom_import_project` imports an editable project. `shared_image` refers to Shared files, while `elements_path` refers to the MCP workspace.
- `paintroom_edit` applies targeted changes with the current project revision. Prefer stable object IDs; indices are zero-based and refer to the original order for that edit. `paintroom_clone` creates a new project from a checked source revision while preserving IDs, useful for variations or frame sequences. `paintroom_brush_presets` lists available brushes.
- Use `include_preview` on supported create/edit calls, `paintroom_preview` for one project, or `paintroom_preview_sheet` for comparisons. `paintroom_export` writes PNG, SVG, `.paintroom`, or supported editable `.vectorroom` output to the MCP workspace. `paintroom_export_batch` creates frame PNGs and a manifest; inspect `complete`, any errors, and returned files before retrying.

## PixelRoom

- `pixelroom_edit` processes a workspace image and exports a new raster image; `pixelroom_inpaint` rebuilds areas selected by a matching mask. Subject selection, inpainting, and OCR are approximate, so inspect the output.
- For editable `.pixelroom` projects, `pixelroom_project_inspect` supplies the file revision and layer IDs. `pixelroom_add_layer`, `pixelroom_update_layer`, `pixelroom_set_layer_mask`, and `pixelroom_apply_preset` write new project copies. `pixelroom_recognize_text`, `pixelroom_convert_isolated_text`, and `pixelroom_isolate_text_region` support OCR and original-lettering workflows; review recognized text and masks.

## VectorRoom

- `vectorroom_create` writes SVG, PNG, or editable `.vectorroom` content; `vectorroom_preview` renders an inline preview. For an existing editable file, use `vectorroom_inspect_project` to get object IDs and its revision, then `vectorroom_arrange_project` or `vectorroom_update_project` to write a new file. Use `dry_run` where supported. Request path nodes when detailed path editing requires them.

## MotionRoom

- `motionroom_create` creates an editable composition in the MCP workspace, optionally from a PaintRoom or VectorRoom source. `motionroom_inspect` returns its SHA-256 revision, layer IDs, and resources; `motionroom_edit` applies ordered operations with that revision to a new output file. Large layer or operation arrays can be supplied as workspace JSON files.
- To animate saved PaintRoom artwork, first use `paintroom_export` to write a `.paintroom` file into the MCP workspace, then pass that file as `source_path` to `motionroom_create`. A VectorRoom source likewise needs to be a workspace `.vectorroom` file.
- `motionroom_preview` inspects a frame; `motionroom_review` compares sampled frames or two projects; `motionroom_lint` reports advisory layout, bounds, asset, and occlusion issues. Lint is approximate, so inspect the frames too.
- `motionroom_render` writes an exact-frame **silent** download as WebM or opaque MP4. Transparent output requires WebM/VP9; MP4 remains available for opaque output. `send_to_cliproom: true` and a workspace `audio_path` upload both media files and return a Cliproom URL to open them on separate tracks. Use the returned assets in Cliproom when assembling a render with sound; the MotionRoom download itself stays silent. Shared-linked assets can change separately from the project and missing links block export.

For an image-to-video workflow, create or import editable artwork in PaintRoom, export a `.paintroom` copy into the MCP workspace, and create/animate a MotionRoom composition from that path. Render it with `send_to_cliproom` and a workspace `audio_path`, then use the returned video and audio assets to assemble a `cliproom_render` with sound. Alternatively open the returned Cliproom URL and save an editable project. Review the rendered result and verify audio as described in [video-audio-capture.md](video-audio-capture.md).

## Color and review

`roomsuite_preset_list`, `roomsuite_preset_get`, `roomsuite_preset_create`, and `roomsuite_lut_inspect` manage portable looks and LUTs. Use `roomsuite_preset_preview` for before/after samples and `roomsuite_color_analyze` for bounded color statistics. Apply a look to an editable PixelRoom project or saved Cliproom clips with their corresponding preset tools and current revision. Statistics and contact-sheet similarity are aids, not judgments of visual quality.
