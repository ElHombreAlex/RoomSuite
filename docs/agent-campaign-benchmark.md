# RoomSuite agent campaign benchmark

This is a fixed brief for measuring a complete RoomSuite agent workflow. It is a benchmark specification, not a claim that a run has passed or cost a particular amount.

## Before the run

Start a new DeepSeek Harness session with RoomSuite MCP connected and the model you want to measure selected. Record usage or balances for the providers and accounts the agent and its subagents may use immediately before submitting the prompt. Ideally isolate them from unrelated work for the duration and retain itemized usage, since a balance change alone can include credits, other requests or billing adjustments. Record the start time and the rates in effect; don't disable caching unless that is the scenario you intend to measure. Send the prompt below unchanged. Make a note of any additional instructions or human edits during the run.

## Prompt to paste into the agent

```text
Run the RoomSuite campaign benchmark below as one complete parent session. You may delegate to subagents if useful, using the available models you consider suitable; include their work, calls and model usage in the results. Use RoomSuite MCP for the substantive creation and export of the deliverables. You may use local command-line tools to inspect and validate outputs. Do not use separate external image-generation, video-generation or search services, and do not publish or send anything. Use a new, uniquely named benchmark folder in your agent workspace and a corresponding Shared files folder; do not overwrite or delete existing work. Keep the editable RoomSuite projects as well as the exports.

CAMPAIGN BRIEF
Create a launch campaign for the fictional Signal & Spark Makers Festival.
- Event: 12 September 2027, 10:00–18:00 UTC; free entry.
- Location: Rivemont Arts Hall, 18 Garden Street, Rivemont (fictional).
- Activities: local makers, live demonstrations and hands-on workshops.
- Call to action: “Come make something”.
- Make the look coherent across the campaign. You may use RoomSuite's shapes, text and other locally available assets. Do not invent additional event details or claim that the festival is real.

DELIVERABLES
1. Five visually distinct portrait posters, each a 1080 × 1350 PNG. Cover: festival announcement, activities, the venue, a reminder and the event-day invitation. Each must show the festival name and event date. Where free entry appears, its wording must be accurate.
2. Two distinct silent vertical videos, each 1080 × 1920 pixels, 8 seconds (±0.25 s) at 24 fps, with visible motion and the festival name and event date. Make one a festival announcement and the other an activities highlight. Export MP4 if supported; WebM is acceptable if MP4 is unavailable, but report the actual format.
3. One editable PPTX with exactly five slides: overview; audience and goals; creative concept; launch channels and schedule; and delivery checklist.
4. One DOCX strategy brief with the event facts, target audience, key message, channel plan and the call to action.
5. One ICS calendar with exactly five events: teaser on 1 September, announcement on 4 September, reminder on 8 September and final reminder on 11 September, each at 10:00–10:30 UTC; plus the festival on 12 September, 10:00–18:00 UTC. Use 2027 for every date. Do not sync it to an external calendar.

EVIDENCE AND CHECKS
- Record UTC start and finish times, RoomSuite version/commit, agent version, OS and hardware, if observable. Identify the parent agent and every subagent used, their roles, and each model and provider. Do not guess unavailable values.
- Verify file formats and image dimensions, decode the videos and check their dimensions, duration and frame rate, inspect the PPTX slide count, and verify that the DOCX and ICS open and contain the required facts. Use independent local inspection tools where available; say which checks could not be performed.
- Save a contact sheet of the five posters and representative frames from the beginning, middle and end of both videos. Check that the text is legible, the event facts are consistent, and the videos show motion. Report any visual issue or uncertainty; do not call automated metadata checks a human quality review.
- List every required output with its path, size and SHA-256 checksum, and identify the editable project paths. Report completed versus requested deliverables and any partial results.
- Report RoomSuite MCP tool calls attempted, succeeded and failed across the parent and all subagents, including retries and discovery calls made as tool calls, if their records expose them. Count each outer MCP request once, including roomsuite_invoke; do not count items inside a batch as separate calls. Report shell or other tool calls separately, and use “unavailable” for any count you cannot substantiate.
- Report cached input, uncached input and output tokens and model API cost for the parent and all subagents, broken down by model/provider where possible. Include orchestration, retries and any failed child work. Identify whether each cost is provider-billed or calculated, include the rate/source, and state whether the final response is included. If a component is missing, label the combined total incomplete or unavailable; never treat missing usage as zero or estimate from text length. Report other paid charges separately.

RETURN
Give a concise results table with deliverable counts, individual checks, elapsed wall-clock time, agent and MCP call counts, usage, cost and limitations. Include the paths to the artifacts, visual evidence and a machine-readable results JSON. Clearly separate checks you performed from independent human review, which is pending. If anything fails or a codec is unavailable, report it; do not silently replace it with a different requirement.
```

## After the run

Once the agent's final response has completed, capture final usage or itemized charges across the parent and all subagents, including the final response and any additional providers. A session display or token-derived cost can be useful evidence but should be labeled as an estimate unless reconciled with provider billing. If any agent's usage is missing, the total is incomplete. Preserve redacted parent and child session transcripts and the exported artifacts; review the contact sheets and files independently. Remove credentials and private information before sharing any record.

For a README result, report each model/provider, whether subagents were used, RoomSuite version, date, number of completed and accepted outputs, attempted MCP calls, total model API cost and whether it is billed or estimated. Include failures, cache conditions, other paid services and the hardware/time context. Do not present an incomplete total as the cost of the whole run. One run is one example, not an average or a guarantee. Repeat the unchanged brief in fresh sessions to report a range or median, and publish the individual runs alongside it.
