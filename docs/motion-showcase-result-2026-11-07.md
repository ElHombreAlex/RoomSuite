# Motion showcase — 7 November 2026

One run of the [motion showcase brief](motion-showcase-benchmark.md) cost **CNY ¥1.20 in model API charges**, covering both hourly periods of the run, with no other task running in that window. The charge includes the parent agent and the subagent that created the score.

The workflow included **nine accepted MotionRoom composition revisions, 30 successful preview frames and multiple render passes** before the final edit. This is a concrete example of how a small model API budget can support a creative iteration loop.

## Workflow and result

The 30-second RoomSuite film used VectorRoom, MotionRoom and Cliproom, with original music created by the subagent. The Cliproom edit was rendered to WebM and then transcoded locally to a separate H.264/AAC master. No paid image, video or music-generation service was used.

| Measure | Result |
| --- | --- |
| Model | `deepseek-flash` for both parent and music subagent |
| RoomSuite MCP calls | 78 in the parent-session report: 71 successful, seven failed; failed calls were reportedly retried successfully |
| Elapsed time | Approximately 27–28 minutes including final packaging/reporting; the music subagent overlapped with the parent |
| Uncached input | 227,935 tokens across both agents |
| Cached input | 43,018,112 tokens across both agents |
| Output | 341,256 tokens across both agents |
| Combined tokens | 43,587,303, including repeatedly sent cached context |

These call, timing and token totals come from the agent's run report. The provider's itemized billing record and raw session logs were not supplied for independent review. Cached input represents approximately 99.47% of input tokens; it is not a count of unique content. The 78 calls are from the parent-session log and should not be assumed to count any subagent MCP calls. The model API charge does not include local hardware, electricity, human time or other possible services.

## Review of the supplied video

The video supplied for review depicts the six scenes in the agent's report. Local inspection of that file found 1280 × 720 H.264 video, a duration of approximately 30.054 seconds, and a 48 kHz stereo AAC audio track. The audio decoded and was not silent. Twelve sampled video frames were inspected; a full subjective viewing and listening review remains outstanding. Small labels, including the illustrative-interface notice, should be checked at the intended viewing size.

The supplied MP4 is a **Cliproom export distinct from the final master** listed in the report. The supplied copy is 5,424,067 bytes, has SHA-256 `55428be1b2d058930248ee5f7fe55c6f1b227eb123ccb51f07fadd7f20aba817`, and contains 866 encoded video packets over approximately 30.054 seconds (about 28.8 packets/s on average). The report lists a separate 5,198,004-byte master, SHA-256 `4c78d31a6940aa7846a0bdad095185c2d5a2dfa94dc65d83d197178f142c7717`, with 900 frames at 30 fps. That master was not available for this review, so its frame count, encoding and loudness have not been independently verified here.

This result covers the motion showcase, not the separate full-suite campaign benchmark. It is not a guarantee of future cost, performance, output quality or third-party pricing.
