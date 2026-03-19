# Cut It First — Technical Notes

Non-obvious things that will break if you don't handle them.

## Step 1: Selection UI

- **Content script must run in top frame only.** Do NOT use `all_frames: true` — Drive loads many sub-frames (`_/og/bscframe`, `auth_warmup`, etc.) and the button would be appended to an invisible sub-frame's body. Use a `window !== window.top` guard. *(verified)*
- **Drive has multiple YouTube iframes — only one is visible.** The iframe found by `MutationObserver` at init time may later have `getBoundingClientRect()` returning all zeros (Drive swaps/hides it). Always re-query for a visible iframe (non-zero dimensions) when positioning overlays. Never cache the iframe ref for layout purposes. *(verified — the cached ref returned 0×0)*
- **Do NOT send `postMessage` to the YouTube embed.** Drive already registers as the YouTube iframe API listener. Sending your own `{ event: 'listening' }` or `addEventListener` commands hijacks the channel and **breaks seeking** (playhead bounces to start). Instead, passively eavesdrop on `window.message` events — `infoDelivery` (with `currentTime`, `duration`, `playerState`) and `onStateChange` are already flowing from Drive's own registration. *(verified — seeking broke, then fixed by removing postToYT calls)*
- The video element may not exist on page load — Drive lazy-loads the player. Use a `MutationObserver` to wait for the YouTube iframe to appear.
- `currentTime` and `duration` arrive via passive `infoDelivery` messages. There's a small delay after pause before the latest values arrive — add a ~200ms timeout before reading state and positioning the button.
- The user may seek the video while setting start/end times. Use the last `currentTime` from `infoDelivery`, not click positions.

## Step 2: Grab the video URL

- In Manifest V3, `chrome.webRequest` is observe-only from the background service worker (no blocking). Use `chrome.webRequest.onBeforeRequest` with a filter for `types: ["media"]` on `https://drive.google.com/*` and `https://*.googlevideo.com/*` to passively capture the URL.
- The actual video is often served from `*.googlevideo.com`, not `drive.google.com`. Your host permissions must include both.
- Google Drive may serve the video as DASH (adaptive bitrate). In that case there is no single video URL — there are separate audio and video stream URLs. You must capture both and mux them together with FFmpeg in Step 4.
- The video URL contains short-lived auth tokens in query params. It expires within minutes. Capture it close to when you need it, or re-trigger playback to get a fresh one.
- If the user hasn't played the video yet, there may be no video URL in network traffic. You may need to programmatically trigger a brief play (then pause) to force the request.
- The `range` query parameter in the captured URL may lock you to a specific byte range. Strip or modify range-related params before using the URL in Step 3.

## Step 3: Fetch the rough segment

- You cannot fetch from `*.googlevideo.com` in the content script due to CORS. The fetch must happen in the background service worker, which is not subject to CORS. Pass the URL via `chrome.runtime.sendMessage` and fetch from there.
- MV3 service workers terminate after ~30 seconds of inactivity and have a ~5 minute max lifetime per event. For large segments, this can kill your download mid-stream. Keep the service worker alive by opening a long-lived port from the content script (`chrome.runtime.connect`), or use `chrome.offscreen` to create an offscreen document that does the fetching (offscreen documents don't have the same timeout).
- To do a byte-range fetch you need to know the byte offset for a given timestamp. Video files are not linear — a timestamp at 50% of duration is NOT at 50% of file bytes. You must either:
  - Fetch the MP4's `moov` atom first to read the sample table and calculate byte offsets, or
  - Over-fetch generously (e.g. ±30 seconds) and let FFmpeg trim precisely in Step 4.
  The second approach is far simpler and recommended unless file sizes are extreme.
- Google may respond with `206 Partial Content` or `200 OK` depending on how the URL was constructed. Handle both.
- The response may be large (hundreds of MB). Don't hold it all in memory as an ArrayBuffer. Stream it into an `opfs` (Origin Private File System) file or a Blob to avoid crashing the tab.

## Step 4: Precise trim with FFmpeg

- FFmpeg.wasm must run in a Web Worker (or an offscreen document). It cannot run in the MV3 service worker because there's no `SharedArrayBuffer` support there and the lifetime is too short.
- `SharedArrayBuffer` requires cross-origin isolation headers (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`). You don't control Drive's headers. Solution: use an offscreen document with your own HTML page that sets these headers, or use the single-threaded build of FFmpeg.wasm (`@ffmpeg/ffmpeg` single-thread core) which doesn't need `SharedArrayBuffer`.
- The single-threaded FFmpeg.wasm core is ~30MB. Bundle it with the extension (don't load from CDN — CSP blocks it in MV3). Declare it under `web_accessible_resources` if the content script needs to reference it.
- If Google served DASH (separate audio + video streams), you must mux them here: `ffmpeg -i video.mp4 -i audio.mp4 -c copy -ss START -to END output.mp4`. Put `-ss`/`-to` after `-i` for frame-accurate (but slower) trimming. Before `-i` is faster but may be off by a few frames.
- For copy-mode trimming (`-c copy`), FFmpeg can only cut on keyframes. If the user wants frame-exact cuts, you need `-c:v libx264` re-encoding, which is much slower in WASM. Default to keyframe-accurate cuts and document the ±1 second tolerance.
- Write input/output files to FFmpeg's virtual filesystem (`ffmpeg.writeFile` / `ffmpeg.readFile`). The entire file must fit in WASM memory. For very large clips (>500MB) this will fail. Consider warning the user or limiting clip duration.

## Step 5: Save to Downloads

- Use `chrome.downloads.download({ url: blobUrl, filename: name })`. This requires `"downloads"` permission in the manifest.
- Create the Blob URL in the same context that calls `chrome.downloads` (background/offscreen). Blob URLs created in a content script are scoped to that page's origin and can't be downloaded by the extension.
- Sanitize the video title for use as a filename: strip `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|` and truncate to a reasonable length.
- `chrome.downloads` will silently add `.mp4` if the filename doesn't end with it, but only if the MIME type is set. Pass `{ type: 'video/mp4' }` when creating the Blob.
- After download completes, revoke the Blob URL (`URL.revokeObjectURL`) to free memory.
