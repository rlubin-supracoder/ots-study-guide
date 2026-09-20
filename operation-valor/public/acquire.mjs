export function acquirePosition({ geolocation, onProgress = () => {}, duration = 30_000, now = Date.now, timers = globalThis }) {
  let watch;
  let timeout;
  let settled = false;
  let best = null;
  let rejectPromise;
  const stop = () => {
    if (watch !== undefined) geolocation.clearWatch(watch);
    if (timeout !== undefined) timers.clearTimeout(timeout);
  };
  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject;
    if (!geolocation) { settled = true; reject(new Error('Location services are unavailable in this browser.')); return; }
    const finish = (error, result) => {
      if (settled) return;
      settled = true; stop();
      if (error) reject(error); else resolve(result);
    };
    timeout = timers.setTimeout(() => {
      if (best) finish(null, best);
      else finish(new Error('No fresh GPS position was found. Move into open sky and try again.'));
    }, duration);
    try {
      watch = geolocation.watchPosition(position => {
        if (settled) return;
        const { latitude, longitude, accuracy } = position.coords;
        const capturedAt = position.timestamp;
        if (![latitude, longitude, accuracy, capturedAt].every(Number.isFinite) || accuracy <= 0 || accuracy > 100000 || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || capturedAt < now() - 15_000 || capturedAt > now() + 60_000) return;
        const fix = { latitude, longitude, accuracy, capturedAt };
        if (!best || fix.accuracy <= best.accuracy) best = fix;
        onProgress(best);
        if (fix.accuracy <= 5) finish(null, fix);
      }, error => {
        if (error.code === 1) finish(new Error('Location permission was denied. Enable precise location for this site in your browser settings, then try again.'));
        // Transient GPS errors may recover before the overall acquisition deadline.
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: duration });
      if (settled) stop();
    } catch { finish(new Error('Could not start location services. Check your browser settings and try again.')); }
  });
  return { promise, cancel() { if (!settled) { settled = true; stop(); rejectPromise(new Error('Location acquisition cancelled.')); } } };
}
