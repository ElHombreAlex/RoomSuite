# Cliproom performance notes

The benchmark is a diagnostic comparison, not a promise about another device or a substitute for testing on physical phones. Run it with the unmodified 2.5 checkout and the optional MCP dependencies installed in this checkout:

```sh
node mcp/benchmarks/cliproom-performance.mjs /path/to/RoomSuite-v2.5 result.json
```

Set `ROOMSUITE_BROWSER_PATH` if Playwright's Chromium is not installed. The script starts temporary loopback servers, generates two moving VP8 videos (1920 × 1080 at 24 fps and 1280 × 720 at 30 fps), and composites them on separate tracks in a 1080p, 3.5-second silent timeline. It measures page startup, time from opening the project to the first decoded preview, editor draw times, decoded and dropped source frames, and WebM export. Each playback scenario is sampled twice; exports are sampled once. It removes its own temporary data and leaves the baseline checkout unchanged.

On November 2, 2026, a Windows desktop with an AMD Ryzen 7 5700G, 31 GiB RAM and headless Chrome 156 produced the following results. The inputs are generated motion graphics, not camera footage. JavaScript heap is a point-in-time browser estimate and excludes decoded video, native and GPU memory.

| Scenario | Startup | First preview | Editor draws in 3.5 seconds | Mean draw | Export |
|---|---:|---:|---:|---:|---|
| 2.5 neutral | 119–128 ms | 50–60 ms | 92–93 | 0.91–0.95 ms | 91 encoded frames, 3.58 s |
| Current neutral | 124–125 ms | 51–56 ms | 92 | 1.06–1.08 ms | 91 encoded frames, 3.59 s |
| Current advanced grade on both clips | 123–128 ms | 618–797 ms | 15 | 257–263 ms | Realtime: 6 frames, 5.51 s; every-frame: 105 frames at 30 fps, 32.65 s |
| Current advanced grade, fast preview | 134–140 ms | 139–362 ms | 90–92 | 34–35 ms | Realtime export still uses full quality and captured 6 frames in this sample |

The advanced grade includes exposure, temperature, vibrance, HSL, grain and sharpening. The browser reported zero dropped *source decoder* frames in these samples; that does not count frames the editor failed to draw. Estimated JavaScript heap during playback was about 2.6 MiB for 2.5 neutral, 3.4–4.9 MiB for current neutral, and 79–109 MiB for the full advanced grade. These are not process-memory peaks.

For this same machine and scenario, a provisional investigation threshold is neutral startup over 250 ms, first preview over 120 ms, fewer than 80 editor draws, or fewer than 105 frames in the every-frame export. These thresholds use roughly twice the observed baseline times and headroom below its draw count; repeat the run and investigate rather than treating them as cross-device pass/fail limits. Actual phone and low-memory testing, longer projects, audio, other codecs and camera footage remain necessary. Advanced full-resolution color is CPU-bound; use **Fast color preview** while editing and **Every frame** export when realtime output stutters. Every-frame export may be substantially slower and uses server memory for decoded audio and the output.

## Processing-path experiment

`node mcp/benchmarks/color-paths.mjs result.json` compares an intentionally simple integer brightness-like transform on one opaque 1280 × 720 buffer. On the same desktop and Chrome, the median of five warm runs was 4.4 ms for a copied JavaScript byte buffer, 7.9 ms including Canvas 2D read/write, 3.9 ms for a worker round trip, 3.0 ms for a small WebAssembly kernel with input/output copies, 4.6 ms for WebGL2 with upload and synchronous readback, and 5.0 ms for WebGPU with upload and readback. The WebGL renderer reported an NVIDIA GeForce RTX 4060 Ti via Direct3D 11; WebGPU reported a non-fallback NVIDIA adapter. All paths matched the test kernel exactly on this opaque input.

These are different transfer and presentation paths for one simple kernel, not a benchmark of the full curves, HSL, LUT, masks, grain and sharpening pipeline. They exclude video decoding and do not establish transparent-pixel parity, mobile GPU support or multi-track playback performance. Workers can reduce main-thread blocking but require asynchronous frame scheduling; GPU and WASM implementations would need to reproduce the complete shared color pipeline and its alpha and export semantics. RoomSuite currently uses the shared Canvas/JavaScript implementation for consistent preview and export, with the optional reduced-size preview. The experiment measures alternatives without silently switching a user's rendered result.

## Mobile-sized browser check

`node mcp/benchmarks/mobile-webkit.mjs` runs a separate mobile-sized WebKit check after installing Playwright's WebKit browser. On the Windows desktop above, Playwright WebKit 27.2 with an emulated iPhone 13 profile opened and graded an image, saved a local look, created an all-day calendar event, displayed the CalDAV setup message and downloaded a short every-frame Cliproom export. This is an emulated browser profile on desktop hardware, not a physical iPhone, a phone performance measurement or proof of compatibility with every mobile browser.
