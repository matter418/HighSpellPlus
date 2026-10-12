// Paste into DevTools console (F12) while in-game. Runs for DUR, then shows the result in an overlay
// on the page (click it to copy) and stores it in window.__probe. Does not depend on console.log,
// which the game stubs out.
(() => {
    const DUR = 30000;
    const SLOW_FRAME_MS = 33; // under 30 fps
    const frames = [];
    const longTasks = [];
    const box = document.createElement('div');
    box.style.cssText =
        'position:fixed;top:8px;left:8px;z-index:999999;background:#000c;color:#0f0;font:12px monospace;padding:6px 8px;border-radius:4px;max-width:90vw;white-space:pre-wrap;cursor:pointer';
    box.textContent = `probe running ${DUR / 1000}s…`;
    document.body.appendChild(box);
    const t0 = performance.now();
    let last = t0;
    const heap0 = performance.memory?.usedJSHeapSize ?? 0;
    const po = new PerformanceObserver(l =>
        l.getEntries().forEach(e => longTasks.push(e.duration))
    );
    try {
        po.observe({ entryTypes: ['longtask'] });
    } catch {}
    const tick = now => {
        frames.push(now - last);
        last = now;
        if (now - t0 < DUR) requestAnimationFrame(tick);
        else done();
    };
    function done() {
        po.disconnect();
        const s = [...frames].sort((a, b) => a - b);
        const p = q => s[Math.min(s.length - 1, Math.floor(s.length * q))];
        const avg = s.reduce((a, b) => a + b, 0) / s.length;
        const heap = performance.memory?.usedJSHeapSize ?? 0;
        const out = {
            where: location.host || 'highspellplus',
            core: !!document.highlite,
            nPlugins:
                document.highlite?.managers?.PluginManager?.plugins?.length ??
                0,
            fps: +(1000 / avg).toFixed(1),
            p50ms: +p(0.5).toFixed(2),
            p95ms: +p(0.95).toFixed(2),
            p99ms: +p(0.99).toFixed(2),
            framesOver33ms: s.filter(x => x > SLOW_FRAME_MS).length,
            longTasks: longTasks.length,
            longTaskMs: +longTasks.reduce((a, b) => a + b, 0).toFixed(0),
            heapMB: +(heap / 1048576).toFixed(0),
            heapGrowthMB: +((heap - heap0) / 1048576).toFixed(0),
        };
        const line = 'PROBE ' + JSON.stringify(out);
        window.__probe = line;
        box.textContent = line + '\n(click to copy)';
        box.onclick = () => {
            navigator.clipboard?.writeText(line);
            box.textContent = line + '\n(copied)';
        };
        // The game stubs console.log, so use warn and error: those are the two levels the shell
        // forwards to its console window.
        try {
            console.warn(line);
            console.error(line);
        } catch {}
    }
    requestAnimationFrame(tick);
})();
