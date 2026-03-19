// Cut It First — Step 1a: Selection UI
// Works from the outer Drive page, communicates with YouTube iframe via postMessage

(function () {
  'use strict';

  console.log('[Cut It First] Content script loaded on:', window.location.href,
    'isTopFrame:', window === window.top);

  // Only run in the top frame — the YT iframe is a direct child of the top-level Drive page.
  // Running in sub-frames creates invisible buttons confined to those frames.
  if (window !== window.top) {
    console.log('[Cut It First] Skipping — not the top frame.');
    return;
  }

  // ── State ──────────────────────────────────────────────
  const state = {
    phase: 'IDLE', // IDLE → START_SET → END_SET → CONFIRMED
    startTime: null,
    endTime: null,
    duration: null,
    currentTime: 0,
    isPaused: true,
  };

  // ── DOM references ─────────────────────────────────────
  let ytIframe = null;
  let markBtn = null;
  let checkmarkBtn = null;
  let startPinEl = null;
  let endPinEl = null;
  let segmentEl = null;
  let pollingInterval = null;

  // ── Find the YouTube iframe ────────────────────────────
  // Returns any YT iframe (for detecting presence / setting up message listener)
  function findYTIframe() {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      if (iframe.src && iframe.src.includes('youtube.googleapis.com/embed')) {
        return iframe;
      }
    }
    return null;
  }

  // Returns the VISIBLE YT iframe (non-zero dimensions) — Drive may have multiple
  function findVisibleYTIframe() {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      if (iframe.src && iframe.src.includes('youtube.googleapis.com/embed')) {
        const r = iframe.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return iframe;
      }
    }
    return null;
  }

  function init() {
    ytIframe = findYTIframe();
    if (ytIframe) {
      onIframeFound();
    } else {
      const obs = new MutationObserver(() => {
        ytIframe = findYTIframe();
        if (ytIframe) {
          obs.disconnect();
          onIframeFound();
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  function onIframeFound() {
    console.log('[Cut It First] YouTube iframe found:', ytIframe.src);

    // Passively listen for messages — Drive already registers with the YT embed,
    // so events (infoDelivery, onStateChange) are already flowing. We just eavesdrop.
    // Sending our own "listening" command hijacks Drive's channel and breaks seeking.
    window.addEventListener('message', onYTMessage);
  }

  function postToYT(data) {
    if (!ytIframe || !ytIframe.contentWindow) return;
    try {
      ytIframe.contentWindow.postMessage(JSON.stringify(data), '*');
    } catch (e) {
      // ignore cross-origin errors
    }
  }

  function onYTMessage(event) {
    let data;
    try {
      data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch (e) {
      return; // not JSON, ignore
    }

    if (!data || !data.event) return;

    if (data.event === 'onStateChange') {
      // YT states: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
      const ytState = data.info;
      console.log('[Cut It First] YT state changed:', ytState);

      if (ytState === 2) {
        // Paused — show button (currentTime & duration come via passive infoDelivery)
        state.isPaused = true;
        // Small delay to let infoDelivery arrive before showing button
        setTimeout(() => {
          console.log('[Cut It First] Showing button. time:', state.currentTime, 'duration:', state.duration, 'phase:', state.phase);
          showMarkButton();
        }, 200);
      } else if (ytState === 1) {
        // Playing
        state.isPaused = false;
        hideMarkButton();
      }
    }

    if (data.event === 'infoDelivery' && data.info) {
      if (typeof data.info.currentTime === 'number') {
        state.currentTime = data.info.currentTime;
      }
      if (typeof data.info.duration === 'number' && data.info.duration > 0) {
        if (!state.duration) console.log('[Cut It First] Duration:', data.info.duration);
        state.duration = data.info.duration;
      }
      // Check playerState in infoDelivery too
      if (typeof data.info.playerState === 'number') {
        const wasPaused = state.isPaused;
        state.isPaused = data.info.playerState === 2;
        if (state.isPaused && !wasPaused) {
          showMarkButton();
        } else if (!state.isPaused && wasPaused) {
          hideMarkButton();
        }
      }
    }
  }

  // ── Progress bar area (overlay on top of iframe) ───────
  function getProgressBarRect() {
    // Always re-find the visible iframe — Drive may swap/hide the original
    const visibleIframe = findVisibleYTIframe();
    if (!visibleIframe) return null;
    const ir = visibleIframe.getBoundingClientRect();
    // Progress bar is near the bottom of the iframe
    return {
      left: ir.left + 12,
      right: ir.right - 12,
      width: ir.width - 24,
      top: ir.bottom - 16,
      bottom: ir.bottom - 4,
      height: 12,
    };
  }

  function timeToX(time) {
    const bar = getProgressBarRect();
    if (!bar || !state.duration) return 0;
    const frac = time / state.duration;
    return bar.left + frac * bar.width;
  }

  // ── Mark Start / Mark End button ───────────────────────
  function createMarkButton() {
    if (markBtn) return markBtn;
    markBtn = document.createElement('div');
    markBtn.id = 'cif-mark-btn';
    Object.assign(markBtn.style, {
      position: 'fixed',
      zIndex: '2147483647',
      background: '#1a73e8',
      color: '#fff',
      padding: '5px 12px',
      borderRadius: '16px',
      fontFamily: "'Google Sans', Roboto, Arial, sans-serif",
      fontSize: '12px',
      fontWeight: '500',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      transform: 'translateX(-50%)',
      userSelect: 'none',
      whiteSpace: 'nowrap',
      display: 'none',
    });
    markBtn.addEventListener('click', onMarkClick);
    document.body.appendChild(markBtn);
    return markBtn;
  }

  function showMarkButton() {
    const btn = createMarkButton();
    const bar = getProgressBarRect();
    const isTop = window === window.top;
    console.log('[Cut It First] showMarkButton — isTopFrame:', isTop,
      'bar:', bar, 'iframeRect:', ytIframe?.getBoundingClientRect());
    if (!bar) return;

    if (state.phase === 'IDLE') {
      btn.textContent = 'Mark Start';
      const x = timeToX(state.currentTime);
      btn.style.left = x + 'px';
      btn.style.top = (bar.top - 30) + 'px';
      btn.style.display = 'block';
      console.log('[Cut It First] Button positioned at left:', x, 'top:', bar.top - 30);
    } else if (state.phase === 'START_SET') {
      if (state.currentTime > state.startTime) {
        btn.textContent = 'Mark End';
        const x = timeToX(state.currentTime);
        btn.style.left = x + 'px';
        btn.style.top = (bar.top - 30) + 'px';
        btn.style.display = 'block';
      } else {
        btn.style.display = 'none';
      }
    } else if (state.phase === 'END_SET') {
      btn.style.display = 'none';
      showCheckmarkButton();
    } else {
      btn.style.display = 'none';
    }
  }

  function hideMarkButton() {
    if (markBtn) markBtn.style.display = 'none';
  }

  function onMarkClick(e) {
    e.stopPropagation();
    e.preventDefault();

    if (state.phase === 'IDLE') {
      state.startTime = state.currentTime;
      state.phase = 'START_SET';
      console.log('[Cut It First] Start set at:', state.startTime);
      renderStartPin();
      hideMarkButton();
    } else if (state.phase === 'START_SET') {
      state.endTime = state.currentTime;
      state.phase = 'END_SET';
      console.log('[Cut It First] End set at:', state.endTime);
      renderEndPin();
      renderSegment();
      hideMarkButton();
      showCheckmarkButton();
    }
  }

  // ── Pin markers ────────────────────────────────────────
  function createPin(id, color) {
    const pin = document.createElement('div');
    pin.id = id;
    Object.assign(pin.style, {
      position: 'fixed',
      zIndex: '2147483646',
      width: '3px',
      height: '14px',
      background: color,
      borderRadius: '1px',
      transform: 'translateX(-50%)',
      pointerEvents: 'none',
      display: 'none',
    });
    document.body.appendChild(pin);
    return pin;
  }

  function renderStartPin() {
    if (!startPinEl) startPinEl = createPin('cif-start-pin', '#1a73e8');
    const bar = getProgressBarRect();
    if (!bar) return;
    const x = timeToX(state.startTime);
    startPinEl.style.left = x + 'px';
    startPinEl.style.top = (bar.top - 3) + 'px';
    startPinEl.style.display = 'block';
  }

  function renderEndPin() {
    if (!endPinEl) endPinEl = createPin('cif-end-pin', '#1a73e8');
    const bar = getProgressBarRect();
    if (!bar) return;
    const x = timeToX(state.endTime);
    endPinEl.style.left = x + 'px';
    endPinEl.style.top = (bar.top - 3) + 'px';
    endPinEl.style.display = 'block';
  }

  // ── Segment highlight ─────────────────────────────────
  function renderSegment() {
    if (!segmentEl) {
      segmentEl = document.createElement('div');
      segmentEl.id = 'cif-segment';
      Object.assign(segmentEl.style, {
        position: 'fixed',
        zIndex: '2147483645',
        height: '4px',
        background: 'rgba(26, 115, 232, 0.6)',
        borderRadius: '2px',
        pointerEvents: 'none',
        display: 'none',
      });
      document.body.appendChild(segmentEl);
    }

    const bar = getProgressBarRect();
    if (!bar) return;
    const x1 = timeToX(state.startTime);
    const x2 = timeToX(state.endTime);
    segmentEl.style.left = x1 + 'px';
    segmentEl.style.top = (bar.top + (bar.height - 4) / 2) + 'px';
    segmentEl.style.width = (x2 - x1) + 'px';
    segmentEl.style.display = 'block';
  }

  // ── Checkmark (confirm) button ─────────────────────────
  function showCheckmarkButton() {
    if (!checkmarkBtn) {
      checkmarkBtn = document.createElement('div');
      checkmarkBtn.id = 'cif-confirm-btn';
      checkmarkBtn.textContent = '✓';
      Object.assign(checkmarkBtn.style, {
        position: 'fixed',
        zIndex: '2147483647',
        background: '#34a853',
        color: '#fff',
        width: '26px',
        height: '26px',
        borderRadius: '50%',
        display: 'none',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '15px',
        fontWeight: 'bold',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        transform: 'translateX(-50%)',
        userSelect: 'none',
      });
      checkmarkBtn.addEventListener('click', onConfirm);
      document.body.appendChild(checkmarkBtn);
    }

    const bar = getProgressBarRect();
    if (!bar) return;
    const midX = (timeToX(state.startTime) + timeToX(state.endTime)) / 2;
    checkmarkBtn.style.left = midX + 'px';
    checkmarkBtn.style.top = (bar.top - 34) + 'px';
    checkmarkBtn.style.display = 'flex';
  }

  function onConfirm(e) {
    e.stopPropagation();
    e.preventDefault();
    state.phase = 'CONFIRMED';
    if (segmentEl) segmentEl.style.background = 'rgba(52, 168, 83, 0.7)';
    if (startPinEl) startPinEl.style.background = '#34a853';
    if (endPinEl) endPinEl.style.background = '#34a853';
    if (checkmarkBtn) checkmarkBtn.style.display = 'none';
    hideMarkButton();
    console.log('[Cut It First] Segment confirmed:', state.startTime, '→', state.endTime);
  }

  // ── Reposition all overlays ────────────────────────────
  function repositionAll() {
    if (state.startTime !== null) renderStartPin();
    if (state.endTime !== null) renderEndPin();
    if (state.startTime !== null && state.endTime !== null) renderSegment();
    if (state.phase === 'END_SET' && checkmarkBtn) showCheckmarkButton();
  }

  window.addEventListener('resize', repositionAll);

  // ── Start ──────────────────────────────────────────────
  init();
})();
