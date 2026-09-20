import { forward } from './vendor/mgrs.mjs';
import { numberLabel, accuracyLabel, dateTimeLabel } from './shared.mjs';
import { groupInfo } from './groups.mjs';

export function mgrsLabel(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -80 || latitude > 84 || longitude < -180 || longitude > 180) return null;
  try {
    // Five digits per axis express a one-meter grid square, not GPS accuracy.
    const parts = forward([longitude, latitude], 5).match(/^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z]{2})(\d{5})(\d{5})$/);
    if (!parts) return null;
    return `${parts[1].padStart(2, '0')}${parts[2]} ${parts[3]} ${parts[4]} ${parts[5]}`;
  } catch { return null; }
}

export function coordinateDetails(person) {
  const { ping } = person;
  const grid = mgrsLabel(ping.latitude, ping.longitude);
  const latLon = `${ping.latitude.toFixed(6)}, ${ping.longitude.toFixed(6)}`;
  const mgrs = grid || 'Unavailable at this latitude';
  return {
    mgrs, latLon,
    copyText: [
      `${numberLabel(person.number)} — ${person.name} (${groupInfo(person.group).name})`,
      `MGRS (WGS 84): ${mgrs}${grid ? ' (1 m grid precision)' : ''}`,
      `Latitude, longitude (WGS 84): ${latLon}`,
      `Reported accuracy: ${accuracyLabel(ping.accuracy)} (phone estimate)`,
      `Captured: ${new Date(ping.capturedAt).toISOString()}`,
      `Received: ${new Date(ping.receivedAt).toISOString()}`,
    ].join('\n'),
  };
}

export function coordinatePanel(person) {
  const values = coordinateDetails(person);
  const panel = document.createElement('div');
  panel.className = 'coordinate-panel';
  for (const [label, value] of [['MGRS · WGS 84', values.mgrs], ['LATITUDE / LONGITUDE', values.latLon]]) {
    const line = document.createElement('div'); line.className = 'coordinate-line';
    const title = document.createElement('span'); title.className = 'coordinate-label'; title.textContent = label;
    const text = document.createElement('code'); text.textContent = value;
    line.append(title, text); panel.append(line);
  }
  const accuracy = document.createElement('span'); accuracy.className = 'coordinate-meta';
  accuracy.textContent = `Reported accuracy: ${accuracyLabel(person.ping.accuracy)} (phone estimate)`;
  const captured = document.createElement('time'); captured.className = 'coordinate-meta';
  captured.dateTime = new Date(person.ping.capturedAt).toISOString();
  captured.textContent = `Captured ${dateTimeLabel(person.ping.capturedAt)}`;
  const copy = document.createElement('button');
  copy.type = 'button'; copy.className = 'button secondary small copy-coordinates'; copy.textContent = 'Copy coordinates';
  copy.setAttribute('aria-label', `Copy coordinates for ${numberLabel(person.number)} ${person.name}`);
  const status = document.createElement('span'); status.className = 'coordinate-copy-status'; status.setAttribute('role', 'status');
  copy.addEventListener('click', async () => {
    copy.disabled = true;
    try {
      await navigator.clipboard.writeText(values.copyText);
      status.textContent = 'Coordinates copied.';
    } catch {
      status.textContent = 'Copy unavailable. Select the coordinates above to copy manually.';
    } finally { copy.disabled = false; }
  });
  panel.append(accuracy, captured, copy, status);
  return panel;
}
