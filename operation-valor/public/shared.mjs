export async function api(path, body) {
  let response;
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin', cache: 'no-store',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Valor-Request': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
  } catch { throw new Error('Connection interrupted. Delivery has not been confirmed. Check your connection and retry.'); }
  if (!response.headers.get('Content-Type')?.includes('application/json')) {
    throw Object.assign(new Error('Your sign-in expired. Reload this page to sign in again.'), { status: 401 });
  }
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'The request could not be completed.'), { status: response.status });
  return data;
}
export const numberLabel = number => String(number).padStart(2, '0');
export const accuracyLabel = accuracy => `${Number(accuracy.toFixed(1))} m`;
export function ageLabel(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ago`;
}
export const timeLabel = timestamp => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export function setMessage(text, kind = '') { const node = document.getElementById('message'); node.textContent = text; node.className = `message ${kind}`; }
