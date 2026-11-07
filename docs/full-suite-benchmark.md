# RoomSuite full-suite campaign benchmark

This benchmark exercises all 12 rooms/suites and Shared files. It is a larger, different workload from the earlier campaign example; its cost should not be presented as comparable without describing the difference. No benchmark result is claimed here.

Before running, start a fresh agent session with RoomSuite MCP connected. Record the start time and usage or balances for every provider/account the parent and its subagents may use. Isolate those accounts from unrelated requests if possible and retain itemized usage. Copy the following prompt unchanged. After the final response, capture the final usage for all agents and independently review the outputs.

```text
Run the RoomSuite full-suite campaign benchmark as one complete parent session. You may delegate to subagents and choose suitable available models. Include every agent's work, retries, tool calls and model usage in the result. Use RoomSuite MCP for the substantive creation and export of the deliverables; local code is allowed to generate the specified audio input and to inspect outputs. Do not use external image-generation, video-generation or search services. Do not publish or send anything. Use a unique new benchmark folder in your MCP workspace and a corresponding Shared files folder. Do not overwrite or delete existing work, and preserve editable RoomSuite projects.

BRIEF
Create a launch campaign for the fictional Signal & Spark Makers Festival: 12 September 2027, 10:00–18:00 UTC; free entry; Rivemont Arts Hall, 18 Garden Street, Rivemont (fictional). It features local makers, live demonstrations and hands-on workshops. Call to action: “Come make something”. Use a cohesive visual identity. Do not invent additional event facts.

FIXED AUDIO INPUT
In the new MCP workspace folder, generate a 4-second mono PCM16 little-endian WAV at 48,000 Hz. For sample n = 0..191999, use frequency [440, 554, 659, 880][n // 48000]; the signed sample is 4000 if ((n * 2 * frequency // 48000) % 2) == 0, otherwise -4000. Write a standard 44-byte PCM WAV header with no metadata. The input must be 384044 bytes with SHA-256 27394dd64d1a7f4574f84da1cfc64b0018e3f4a5a4788a9fbacd1e88d554c836. This generated tone is an input fixture, not a finished audio deliverable. If the checksum differs, correct the fixture before proceeding.

REQUIRED WORK AND DELIVERABLES
- PaintRoom: create and save editable artwork and export it for the campaign. Include a PaintRoom-derived design among five distinct 1080 × 1350 PNG posters: announcement, activities, venue, reminder and event-day invitation. Each poster must show the festival name and date.
- VectorRoom: create and retain an editable .vectorroom motif; use a rendered version in at least one campaign design.
- PixelRoom: perform a visible color adjustment on a campaign image and include the edited result among the five posters, preserving the requested dimensions.
- MotionRoom: create and retain an editable composition, then export an 8-second (±0.25 s), 1080 × 1920 video at 24 fps. It must show visible motion, the festival name and date. MP4 is preferred; WebM is acceptable if MP4 is unavailable. Report the format.
- SoundRoom: process the fixed WAV input with a 0.2-second fade-in and fade-out, and export a processed WAV. Retain an editable SoundRoom session. Verify the output is audible and does not clip.
- CaptureRoom: create an editable image/text .capturescene template and record a 3-second 1280 × 720 scene from it. This is a prepared scene, not a live screen, camera or microphone capture. Save the template and playable recording.
- Cliproom: create and save an editable project combining the MotionRoom video, CaptureRoom recording and processed SoundRoom audio. Export a distinct 8-second (±0.25 s), 1080 × 1920 second campaign video, targeting 30 fps. Trim or arrange sources to fit. Verify picture, timing and audible audio; report actual format, frame rate and any dropped frames. MP4 is preferred; WebM is acceptable if necessary.
- DocSuite: create and export a DOCX strategy brief containing the event facts, audience, message, channel plan, call to action and the budget total below.
- GridSuite: create and export an XLSX budget with venue $800, materials $450, promotion $250 and contingency $100. Use a formula for the total and verify it calculates to $1,600. Retain the editable workbook.
- DeckSuite: create and export an editable PPTX with exactly five slides: overview; audience and goals; creative concept; launch channels and schedule; and delivery checklist. Show the $1,600 budget total consistently.
- PlanSuite: create and export an ICS calendar with teaser on 1 September, announcement on 4 September, reminder on 8 September and final reminder on 11 September, all in 2027 at 10:00–10:30 UTC; plus the festival on 12 September, 10:00–18:00 UTC. Do not sync externally.
- NotesRoom: create a project note with the brief, budget total and links or paths to at least two campaign outputs. Export the note as a .roomnote bundle.
- Shared files: create a new folder, upload a campaign image, list it and download it to a new MCP workspace path. Compare source and downloaded SHA-256 hashes. Reuse the shared asset in at least one RoomSuite task.

The required exports are five posters, two final videos, one DOCX, one XLSX, one PPTX, one ICS, one processed WAV, one .capturescene template, one CaptureRoom recording, one .vectorroom project and one .roomnote bundle: 16 files in total. Keep the other editable projects and report their paths or IDs as well. Every listed module must have at least one successful substantive action; discovery alone is not a pass.

VALIDATION AND ACCOUNTING
- Record UTC start/end, end-to-end wall time, RoomSuite version/commit, agent version, OS and hardware if available. List the parent and each subagent, their roles, and all models/providers. Do not guess missing values.
- For each room and Shared files, list the actual successful MCP action, resulting project or artifact, and pass/fail/not verified. Count MCP calls across the parent and subagents, including failures, retries and discovery calls made as tools; count each outer MCP invocation once. Report unavailable counts as unavailable.
- Independently inspect exported file types, PNG dimensions, video dimensions/duration/frame rate/audio, PPTX slide count, DOCX content, the XLSX formula and calculated total, ICS event count/times, WAV audibility, note bundle and the matching shared-file hashes. Identify any check that could not be performed.
- Save a contact sheet of the posters and beginning/middle/end frames of each final video. Review legibility, motion and consistent facts; report issues. Automated checks do not replace independent human review.
- List all required files with paths, sizes and SHA-256 checksums and report completed versus requested outputs. Report failures or unavailable codecs instead of silently changing requirements.
- Report cached and uncached input, output tokens and model API charges across all agents/providers, including failed attempts and orchestration, only when supported by usage records. Distinguish provider-billed cost from an estimate, cite the rates, and state whether the final response is included. If any agent's usage is missing, label the total incomplete or unavailable. Report other paid costs separately.

RETURN
Provide a results table, a 13-row module/Shared files coverage table, artifact paths and checksums, contact sheets, a machine-readable results JSON, limitations and the editable project locations. Human review remains pending until independently performed.
```

After the final response, capture the provider's full-session usage for the parent and all children, including any final response and other providers. Label token-derived figures as estimates unless reconciled with billing; incomplete usage cannot establish the cost of the whole run. Preserve redacted session records and artifacts. A single run is an example; report individual runs and their range or median if repeating it.
