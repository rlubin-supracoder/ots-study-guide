import { api, numberLabel, accuracyLabel, ageLabel, timeLabel, setMessage } from './shared.mjs';
import { groupInfo } from './groups.mjs';
import { coordinatePanel } from './coordinates.mjs';

const $ = id => document.getElementById(id);
const participantView = document.body.dataset.view === 'participant';
const apiRoot = participantView ? '/api/team' : '/api/control';
let snapshot;
let socket;
let reconnect;
let selected;
let action;
let actionExerciseId;
let actionParticipantNumber;
let busy = false;
let map;
let tiles;
let fitted = false;
let signedOut = false;
const markers = new Map();

function initMap() {
  if (!window.L) { setMessage('Map could not load. The numbered roster remains available; reload to retry the map.', 'error'); return; }
  map = L.map('map', { zoomControl: true, attributionControl: true }).setView([0, 0], 2);
}

function style(person) {
  return !person.ping || Date.now() - person.ping.capturedAt > 300_000 ? 'stale' : person.ping.quality === 'approximate' ? 'approximate' : 'good';
}
function popup(person) {
  const wrapper = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = `${numberLabel(person.number)} — ${person.name}`;
  wrapper.append(title, document.createElement('br'));
  const group = document.createElement('span');
  group.className = `group-badge ${groupInfo(person.group).className}`;
  group.textContent = groupInfo(person.group).name;
  wrapper.append(group, document.createElement('br'));
  const status = document.createElement('small');
  status.textContent = `${person.ping.quality === 'approximate' ? 'Approximate position' : 'Within accuracy target'}${style(person) === 'stale' ? ' · stale' : ''}`;
  wrapper.append(status, coordinatePanel(person));
  return wrapper;
}
function renderMap(people) {
  if (!map) return;
  const located = people.filter(person => person.ping);
  $('mapEmpty').hidden = located.length > 0;
  if (located.length && !tiles) tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
  for (const [number, record] of markers) {
    if (!located.some(person => person.number === number)) { map.removeLayer(record.marker); map.removeLayer(record.circle); markers.delete(number); }
  }
  for (const person of located) {
    const color = style(person);
    const group = groupInfo(person.group);
    const latlng = [person.ping.latitude, person.ping.longitude];
    let record = markers.get(person.number);
    if (!record) {
      const marker = L.marker(latlng, { title: `${numberLabel(person.number)} — ${person.name}`, keyboard: true }).addTo(map);
      const circle = L.circle(latlng, { radius: person.ping.accuracy, weight: 1, fillOpacity: .1, interactive: false }).addTo(map);
      marker.on('click', () => { selected = person.number; renderRoster(); });
      record = { marker, circle };
      markers.set(person.number, record);
    }
    const signature = `${person.ping.requestId}:${color}:${group.name}`;
    if (record.signature !== signature) {
      record.marker.setLatLng(latlng).setIcon(L.divIcon({ className: `number-marker ${color} ${group.className}`, html: `<span>${numberLabel(person.number)}</span>`, iconSize: [32, 32], iconAnchor: [16, 16] }));
      const label = `${numberLabel(person.number)} — ${person.name}, ${group.name}${color === 'stale' ? ', stale' : color === 'approximate' ? ', approximate' : ''}`;
      record.marker.getElement()?.setAttribute('aria-label', label);
      record.marker.getElement()?.setAttribute('title', label);
      record.marker.bindPopup(popup(person));
      record.circle.setLatLng(latlng).setRadius(person.ping.accuracy).setStyle({ color: group.color, dashArray: color === 'good' ? null : '4 4' });
      record.signature = signature;
    }
  }
  if (!fitted && located.length) { fitMap(); fitted = true; }
  if (!located.length) fitted = false;
}
function fitMap() {
  const points = snapshot?.participants.filter(person => person.ping).map(person => [person.ping.latitude, person.ping.longitude]) || [];
  if (map && points.length) map.fitBounds(points, { padding: [40, 40], maxZoom: 17 });
}

function renderRoster() {
  if (!snapshot) return;
  const search = $('rosterSearch').value.toLowerCase().trim();
  const groupFilter = $('groupFilter').value;
  $('unassignedOption').hidden = !snapshot.participants.some(person => !person.group) && groupFilter !== 'Unassigned';
  const people = snapshot.participants.filter(person =>
    (!groupFilter || groupInfo(person.group).name === groupFilter) &&
    (!search || `${numberLabel(person.number)} ${person.name}`.toLowerCase().includes(search)));
  $('rosterCount').textContent = groupFilter || search ? `${people.length} / ${snapshot.participants.length}` : people.length;
  $('rosterCount').setAttribute('aria-label', `${people.length} of ${snapshot.participants.length} participants shown`);
  $('filterSummary').textContent = groupFilter || search ? `Showing ${people.length} of ${snapshot.participants.length}. Map shows all groups.` : 'Map and list show all groups.';
  const fragment = document.createDocumentFragment();
  for (const person of people) {
    const group = groupInfo(person.group);
    const row = document.createElement('button');
    row.type = 'button'; row.className = `roster-row ${style(person)} ${group.className} ${person.number === selected ? 'selected' : ''}`;
    row.setAttribute('aria-label', `${numberLabel(person.number)} ${person.name}, ${group.name}${person.ping ? ', show position' : ', awaiting first check-in'}`);
    const number = document.createElement('span'); number.className = 'roster-number'; number.textContent = numberLabel(person.number);
    const detail = document.createElement('span'); detail.className = 'roster-detail';
    const name = document.createElement('strong'); name.textContent = person.name;
    const groupLabel = document.createElement('span'); groupLabel.className = `group-badge ${group.className}`; groupLabel.textContent = group.name;
    const status = document.createElement('small');
    status.textContent = person.ping ? `${ageLabel(person.ping.capturedAt)} · ${accuracyLabel(person.ping.accuracy)} estimate${person.ping.quality === 'approximate' ? ' · approximate' : ''}${style(person) === 'stale' ? ' · stale' : ''}` : 'Awaiting first check-in';
    detail.append(name, groupLabel, status);
    if (person.ping) {
      const receipt = document.createElement('small'); receipt.textContent = `Received ${timeLabel(person.ping.receivedAt)} · ${person.pingCount} check-in${person.pingCount === 1 ? '' : 's'}`;
      detail.append(receipt);
    }
    row.append(number, detail);
    row.addEventListener('click', () => {
      selected = person.number;
      if (person.ping && map) { map.setView([person.ping.latitude, person.ping.longitude], Math.max(map.getZoom(), 17)); markers.get(person.number)?.marker.openPopup(); }
      renderRoster();
    });
    const entry = document.createElement('div'); entry.className = `roster-entry ${group.className}`;
    entry.append(row);
    // Copy is a sibling of the map-focus button, never a nested button.
    if (person.ping) entry.append(coordinatePanel(person));
    if (!participantView) {
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'remove-participant'; remove.textContent = 'Remove';
      remove.disabled = busy;
      remove.setAttribute('aria-label', `Remove ${numberLabel(person.number)} ${person.name}`);
      remove.addEventListener('click', () => {
        action = 'remove'; actionParticipantNumber = person.number;
        confirmAction(`Remove ${numberLabel(person.number)} — ${person.name}?`, 'Their code name and latest position will disappear from everyone’s map. They can join again with a new number.', 'Remove participant');
      });
      entry.append(remove);
    }
    fragment.append(entry);
  }
  if (!people.length) { const empty = document.createElement('p'); empty.className = 'empty-roster'; empty.textContent = search || groupFilter ? 'No participants match this group and search.' : 'Participants appear here when they join the exercise.'; fragment.append(empty); }
  $('roster').replaceChildren(fragment);
}

function render() {
  if (!snapshot) return;
  const people = snapshot.participants;
  $('exerciseStatus').textContent = snapshot.status === 'active' ? 'Exercise active' : snapshot.status === 'ended' ? 'Exercise ended' : 'Stand by';
  $('exerciseStatus').className = `badge ${snapshot.status === 'active' ? 'active' : ''}`;
  if (!participantView) {
    $('startExercise').disabled = busy || snapshot.status === 'active' || people.length > 0;
    $('endExercise').disabled = busy || snapshot.status !== 'active';
    $('clearExercise').disabled = busy || snapshot.status === 'active' || (snapshot.status === 'standby' && !people.length);
  }
  $('totalCount').textContent = $('rosterCount').textContent = people.length;
  $('pingCount').textContent = people.filter(person => person.ping).length;
  $('qualityCount').textContent = people.filter(person => person.ping?.accuracy <= 5).length;
  $('staleCount').textContent = people.filter(person => style(person) === 'stale').length;
  $('retention').textContent = snapshot.expiresAt ? `Automatic data clearing: ${new Date(snapshot.expiresAt).toLocaleString()}` : 'Check-in data clears automatically 24 hours after exercise start.';
  renderRoster(); renderMap(people);
}
function receive(data) {
  if (signedOut) return;
  if (snapshot?.exerciseId !== data.exerciseId) { selected = undefined; fitted = false; }
  snapshot = data; render();
}
function endSession(message) {
  signedOut = true; busy = true; clearTimeout(reconnect); socket?.close();
  snapshot = { status: 'standby', participants: [], expiresAt: null };
  selected = undefined; render();
  if (tiles) { map.removeLayer(tiles); tiles = null; }
  map?.setView([0, 0], 2);
  $('liveStatus').textContent = participantView ? 'Join to view' : 'Sign in again';
  $('liveStatus').className = 'badge warn';
  setMessage(message, 'error');
}
async function refresh() {
  try { receive(await api(`${apiRoot}/state`)); }
  catch (error) {
    setMessage(error.message, 'error');
    if (error.status === 401 || error.status === 403) endSession(error.message);
  }
}
function connect() {
  if (signedOut) return;
  const url = new URL(`${apiRoot}/live`, location.origin); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(url);
  socket.addEventListener('open', () => {
    $('liveStatus').textContent = 'Live connection'; $('liveStatus').className = 'badge online';
    setMessage('Roster and map update automatically as participants check in.');
  });
  socket.addEventListener('message', event => {
    if (event.data === 'pong') return;
    try { receive(JSON.parse(event.data)); } catch { setMessage('An update could not be read. Reconnecting…', 'error'); socket.close(); }
  });
  socket.addEventListener('close', event => {
    if (signedOut) return;
    $('liveStatus').textContent = 'Reconnecting'; $('liveStatus').className = 'badge warn';
    if (event.code === 4001) { endSession(participantView ? 'Your participation has ended or the exercise was cleared. Return to check-in to join again.' : 'Controller session expired. Reload this page to sign in again.'); return; }
    if (!signedOut) { refresh(); clearTimeout(reconnect); reconnect = setTimeout(connect, 5000); }
  });
  socket.addEventListener('error', () => setMessage('Live connection interrupted. Checking for updates and reconnecting…', 'error'));
}

const descriptions = {
  start: ['Start Operation Valor?', 'Participants can join and submit check-ins. Data will automatically clear 24 hours from now.', 'Start exercise'],
  end: ['End this exercise?', 'New check-ins will stop. The current map and roster remain available until you clear them or the retention period expires.', 'End exercise'],
  clear: ['Clear this exercise’s data?', 'This removes all code names and positions from the app and resets participant numbering. This cannot be undone from the app.', 'Clear data'],
};
function confirmAction(title, text, button) {
  actionExerciseId = snapshot.exerciseId;
  $('confirmTitle').textContent = title; $('confirmText').textContent = text; $('confirmButton').textContent = button;
  $('confirmAction').returnValue = 'cancel'; $('confirmAction').showModal();
}
for (const [id, kind] of [['startExercise', 'start'], ['endExercise', 'end'], ['clearExercise', 'clear']]) {
  $(id)?.addEventListener('click', () => {
    action = kind;
    confirmAction(...descriptions[kind]);
  });
}
$('confirmAction')?.addEventListener('close', async () => {
  if ($('confirmAction').returnValue !== 'confirm' || busy) return;
  busy = true; render();
  try {
    receive(await api(action === 'remove' ? '/api/control/remove' : '/api/control/action', { action, exerciseId: actionExerciseId, number: actionParticipantNumber }));
    setMessage(action === 'remove' ? 'Participant removed from the shared map and roster.' : action === 'start' ? 'Exercise opened. Participants can now join.' : action === 'end' ? 'Exercise ended. New check-ins are closed.' : 'Exercise data cleared. Ready for a new exercise.', 'success');
  }
  catch (error) { setMessage(error.message, 'error'); await refresh(); }
  finally { busy = false; render(); }
});
$('fitMap').addEventListener('click', fitMap);
$('rosterSearch').addEventListener('input', renderRoster);
$('groupFilter').addEventListener('change', renderRoster);
setInterval(() => { if (!document.hidden && snapshot) render(); }, 10_000);
setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send('ping'); else if (!signedOut) refresh(); }, 30_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !signedOut) refresh(); });
window.addEventListener('pagehide', () => { signedOut = true; clearTimeout(reconnect); socket?.close(); });
initMap();
await refresh();
connect();
