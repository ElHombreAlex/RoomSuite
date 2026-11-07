# Full-suite campaign — 7 November 2026

One run of the [full-suite campaign benchmark](full-suite-benchmark.md) cost **$0.06 USD in model API charges** for the parent, its two subagents and final reporting. The run turned a brief into a 16-file campaign package, with substantive work across all 12 rooms and Shared files.

The charge also covered creative iteration: the run included several poster drafts, three Cliproom renders and a revised slide deck. The technical details below come from the agent's benchmark report. A provider billing record and raw usage logs were not supplied for independent review; token counts were unavailable. The API figure does not include local hardware, electricity or human time.

## Workload and result

| Measure | Result |
| --- | --- |
| Workload | Fictional Signal & Spark Makers Festival campaign |
| RoomSuite | Version 3.5.3, commit `e7d45e065e833b04b20d5880e8c90e410b3e4de0`, standard MCP mode |
| Agent | DeepSeek Harness 0.2.1-rc.5; parent and two subagents used `deepseek-flash` according to the report |
| Environment | Ubuntu 24.04.5 LTS, Intel Core i5-10210U, 15 GiB RAM, software rendering |
| Coverage | Substantive actions in all 12 rooms/suites and Shared files |
| Outputs | 16 required files listed: five posters, two final videos, DOCX, XLSX, PPTX, ICS, WAV, CaptureRoom template and recording, VectorRoom project and NotesRoom bundle |
| RoomSuite MCP calls | 108 attempted: 102 successful, six failed, including 24 successful calls attributed to the productivity subagent |
| Time | 16 minutes 44 seconds from session start to writing the results JSON; final response and reporting were still outstanding, so this is not the complete end-to-end time |

The budget formula calculated to $1,600 and the uploaded and downloaded Shared file hashes matched. The productivity subagent completed its work. A second subagent was launched for an independent filesystem audit but did not return a report and was interrupted; the checks were performed by the parent agent. The report attributes zero MCP calls to that audit subagent, but its work and usage were not independently inspected.

## Important limitations

- The second, real-time Cliproom MP4 contained 179 frames over 8.036 seconds, approximately **22.3 fps against the 30 fps target**. The first MotionRoom video contained 192 frames over eight seconds at 24 fps. Neither file was provided for independent inspection.
- The report notes that DOCX/XLSX/PPTX metadata titles contain a double-escaped ampersand, although it says the body text is correct. It also says the Office documents were not opened in Word or PowerPoint for visual review.
- The 16 output files and contact sheets were not supplied here. Their file contents, hashes, visual quality, audio and the agent's module-coverage claims have not been independently verified. Human review remains pending.
- The report does not expose cached input, uncached input, output tokens or an itemized charge. The $0.06 model-provider charge applies to this run and is not a guarantee of future cost. The separate motion showcase is a different workload with its own charge.

For a follow-up quality check, the saved Cliproom project could be rendered in offline mode to WebM and inspected for duration, frame count, sound and visual quality. If an MP4 is needed, any subsequent transcode should be disclosed as a separate step. A successful re-render and its additional time or API cost have not been established by this report.

## Artifact inventory

The following sizes and SHA-256 values come from the agent's report. They identify its outputs and have not been independently checked.

| File | Bytes | SHA-256 from run report |
| --- | ---: | --- |
| `poster-01-announcement.png` | 162,248 | `65dac1cdd5f4a2fa14f23e4fe58627b373ae491ca51e92b15828b11a93867e9f` |
| `poster-02-activities.png` | 177,303 | `8a553aa941f7ef8deda3f38f383c5e847f4bc047e7ee448275879621316f5bad` |
| `poster-03-venue.png` | 178,355 | `31341f0460284426700780b7620ad4b2008842fc8f844f5d9c2a22baeceafcaf` |
| `poster-04-reminder.png` | 140,645 | `d992b6b59692caae842311c672d3b73eca0600a6e5a4b2a8cdcc89e10473b458` |
| `poster-05-invitation.png` | 165,215 | `016195af3a570310ad2b8f35bb422d802bf84f073c02d4834ab38974ec45a87f` |
| `video-01-motionroom-1080x1920.mp4` | 3,820,066 | `19f73b9778d2bad8206cf6aa5c5af1d1aa48eff6cabb2770e2c1328b06cf248d` |
| `video-02-cliproom-1080x1920.mp4` | 2,195,299 | `9f827c5fda407893ebb367d7b3ab3547c13e68358f8d08b76f8f73d07f31371d` |
| `strategy-brief.docx` | 12,529 | `b2a4c32f629e90843d137b8d86f5389daedc50a70146d7dbe4faa812441a99c7` |
| `budget.xlsx` | 6,676 | `29f39783f9fd582792c4cfe199f7abb17159ba96d49184ded7dada99e43cc714` |
| `launch-deck.pptx` | 94,338 | `b86ac1dbd4fc9f19b8ab092754e870abe69d0ab0493a0cebac868a4c13ff7354` |
| `campaign-calendar.ics` | 2,172 | `18cd02846d6ecd27d13512cec78ef4770c6dd1a38b72bf33de5434c2e115c921` |
| `signalspark-tone-processed.wav` | 384,044 | `c41d1bff0c3ab84235262279374ee5fd65f858f5fc90f64f7450ea25e8cdbe45` |
| `venue-scene.capturescene` | 162,576 | `e905befa1300dfc4f57051c78dee38eaad7b28e3bc0df76fbf7a9978cfca6e15` |
| `venue-scene-recording.webm` | 138,789 | `86792942fade3e2ec8ddbdec463dc66cc0a8af18294b8041def98226a117c53a` |
| `spark-motif-emblem.vectorroom` | 8,544 | `e0024a29d1125a1445e701aad0e376da148ae6971f5d5ea8b6760d4e77a7eedb` |
| `project-note.roomnote` | 3,197 | `b75f6d0e4aabe013a2c014a1b27b8f9050850d823a03e693cd5a49026b9a65c6` |

The pasted JSON report supplied for this review has SHA-256 `2f0d720a0743ad85959a26a48a80e81f97eb3471748978a6e6d2a1e5c10d0b64`. It is not included in this repository.
