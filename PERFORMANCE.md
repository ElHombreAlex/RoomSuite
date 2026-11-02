# Cliproom performance notes

The benchmark is a diagnostic comparison, not a promise about another device or a substitute for testing on physical phones. Run it with an unmodified baseline checkout and the optional MCP dependencies installed in this checkout:

```sh
node mcp/benchmarks/cliproom-performance.mjs /path/to/baseline result.json
```

Set `ROOMSUITE_BROWSER_PATH` if Playwright's Chromium is not installed. The script starts temporary loopback servers, generates two moving VP8 videos (1920 × 1080 at 24 fps and 1280 × 720 at 30 fps), and composites them on separate tracks in a 1080p, 3.5-second silent timeline. It measures page startup, time from opening the project to the first decoded preview, editor draw times, decoded and dropped source frames, and WebM export. Each playback scenario is sampled twice; exports are sampled once. A 3.x baseline is also measured with the advanced grade; older baselines are measured neutral only. The script removes its own temporary data and leaves the baseline checkout unchanged.

On November 2, 2026, a Windows desktop with an AMD Ryzen 7 5700G, 31 GiB RAM and headless Chrome 156 produced the following results. The inputs are generated motion graphics, not camera footage. JavaScript heap is a point-in-time browser estimate and excludes decoded video, native and GPU memory.

| Scenario | Startup | First preview | Editor draws in 3.5 seconds | Mean draw | Export |
|---|---:|---:|---:|---:|---|
| 2.5 neutral | 119–128 ms | 50–60 ms | 92–93 | 0.91–0.95 ms | 91 encoded frames, 3.58 s |
| 3.0 neutral | 124–125 ms | 51–56 ms | 92 | 1.06–1.08 ms | 91 encoded frames, 3.59 s |
| 3.0 advanced grade on both clips | 123–128 ms | 618–797 ms | 15 | 257–263 ms | Realtime: 6 frames, 5.51 s; every-frame: 105 frames at 30 fps, 32.65 s |
| 3.0 advanced grade, fast preview | 134–140 ms | 139–362 ms | 90–92 | 34–35 ms | Realtime export still uses full quality and captured 6 frames in this sample |

The advanced grade includes exposure, temperature, vibrance, HSL, grain and sharpening. The browser reported zero dropped *source decoder* frames in these samples; that does not count frames the editor failed to draw. Estimated JavaScript heap during playback was about 2.6 MiB for 2.5 neutral, 3.4–4.9 MiB for current neutral, and 79–109 MiB for the full advanced grade. These are not process-memory peaks.

For this same machine and scenario, a provisional investigation threshold is neutral startup over 250 ms, first preview over 120 ms, fewer than 80 editor draws, or fewer than 105 frames in the every-frame export. These thresholds use roughly twice the observed baseline times and headroom below its draw count; repeat the run and investigate rather than treating them as cross-device pass/fail limits. Actual phone and low-memory testing, longer projects, audio, other codecs and camera footage remain necessary. Advanced full-resolution color is CPU-bound; use **Fast color preview** while editing and **Every frame** export when realtime output stutters. Every-frame export may be substantially slower and uses server memory for decoded audio and the output.

## Version 3.1 comparison

On the same Windows desktop and Chrome 156, a separate run compared the released 3.0 renderer directly with the 3.1 candidate using the same generated two-track project. These two playback samples and single exports per scenario are directional measurements, not a device-wide guarantee.

| Scenario | First preview | Editor draws in 3.5 seconds | Mean draw | Realtime export | Every-frame export |
|---|---:|---:|---:|---|---|
| 3.0 neutral | 61–75 ms | 102 | 0.7–0.8 ms | 98 frames, 3.61 s | — |
| 3.1 neutral | 61–62 ms | 102 | 0.7 ms | 103 frames, 3.61 s | — |
| 3.0 advanced | 690–740 ms | 13 | 291–309 ms | 5 frames, 5.85 s | 105 frames, 36.01 s |
| 3.1 advanced | 489–500 ms | 19–20 | 181–199 ms | 16 frames, 4.95 s | 105 frames, 23.45 s |
| 3.0 advanced, fast preview | 202–227 ms | 67–77 | 44–52 ms | 6 frames, 5.43 s | — |
| 3.1 advanced, fast preview | 197–198 ms | 84–89 | 37–41 ms | 16 frames, 4.82 s | — |

The every-frame result was about 35% faster in this sample and retained all 105 frames. Both every-frame exports used VP8; real-time WebM chose VP9 in 3.0 and VP8 in 3.1 when the browser reported support for both. Full-resolution real-time export still dropped most frames for this demanding grade; the improvement does not make that path reliable. Version 3.1 warns when completed canvas draws fall substantially below the 30 fps target, but that check is not an encoded-frame count and can miss other drops. The optimized CPU path retains the shared renderer and is checked against 3.0 pixel snapshots, including transparency and finishing effects. Physical mobile and low-end hardware, longer projects and other codecs remain untested by this comparison.

## Processing-path experiment

`node mcp/benchmarks/color-paths.mjs result.json` compares an intentionally simple integer brightness-like transform on one opaque 1280 × 720 buffer. On the same desktop and Chrome, the median of five warm runs was 4.4 ms for a copied JavaScript byte buffer, 7.9 ms including Canvas 2D read/write, 3.9 ms for a worker round trip, 3.0 ms for a small WebAssembly kernel with input/output copies, 4.6 ms for WebGL2 with upload and synchronous readback, and 5.0 ms for WebGPU with upload and readback. The WebGL renderer reported an NVIDIA GeForce RTX 4060 Ti via Direct3D 11; WebGPU reported a non-fallback NVIDIA adapter. All paths matched the test kernel exactly on this opaque input.

These are different transfer and presentation paths for one simple kernel, not a benchmark of the full curves, HSL, LUT, masks, grain and sharpening pipeline. They exclude video decoding and do not establish transparent-pixel parity, mobile GPU support or multi-track playback performance. Workers can reduce main-thread blocking but require asynchronous frame scheduling; GPU and WASM implementations would need to reproduce the complete shared color pipeline and its alpha and export semantics. RoomSuite currently uses the shared Canvas/JavaScript implementation for consistent preview and export, with the optional reduced-size preview. The experiment measures alternatives without silently switching a user's rendered result.

## Mobile-sized browser check

`node mcp/benchmarks/mobile-webkit.mjs` runs a separate mobile-sized WebKit check after installing Playwright's WebKit browser. On the Windows desktop above, Playwright WebKit 27.2 with an emulated iPhone 13 profile opened and graded an image, changed the tonal range and used the color wheel, saved a local look, created an all-day calendar event, displayed the CalDAV setup message and downloaded a short every-frame Cliproom export. This is an emulated browser profile on desktop hardware, not a physical iPhone, a phone performance measurement or proof of compatibility with every mobile browser.
