import { acquirePosition } from './acquire.mjs';
import { api, numberLabel, accuracyLabel, timeLabel, setMessage } from './shared.mjs';

const $ = id => document.getElementById(id);
let session;
let acquisition;
let pending;
let busy = false;
let refreshBusy = false;
let generation = 0;

function render() {
  if (!session) return;
  const active = session.status === 'active';
  $('exerciseStatus').textContent = active ? 'Exercise active' : session.status === 'ended' ? 'Exercise ended' : 'Stand by';
  $('exerciseStatus').className = `badge ${active ? 'active' : ''}`;
  $('connectionStatus').textContent = navigator.onLine ? (active ? 'Ready for check-ins' : 'Waiting for the controller') : 'No connection';
  $('joinCard').hidden = !active || !!session.participant;
  $('checkinCard').hidden = !session.participant;
  $('sendLocation').disabled = !active || busy || !navigator.onLine;
  $('joinButton').disabled = !active || busy || !navigator.onLine;
  if (session.participant) {
    $('participantName').textContent = session.participant.name;
    $('participantNumber').textContent = numberLabel(session.participant.number);
    const ping = session.participant.ping;
    $('receipt').hidden = !ping;
    if (ping) {
      $('receiptText').textContent = `Captured ${timeLabel(ping.capturedAt)} · received ${timeLabel(ping.receivedAt)} · ${accuracyLabel(ping.accuracy)} estimate${ping.quality === 'approximate' ? ' (approximate)' : ''}`;
    }
  }
}

async function refresh() {
  if (refreshBusy) return;
  refreshBusy = true;
  try {
    const next = await api('/api/session');
    const removed = session?.participant && !next.participant && session.exerciseId === next.exerciseId;
    const changed = session && (removed || session.exerciseId !== next.exerciseId || (session.status === 'active' && next.status !== 'active'));
    if (changed) {
      generation++;
      acquisition?.cancel(); acquisition = null; pending = null; busy = false;
      $('approximateActions').hidden = $('retryDelivery').hidden = true;
      resetButton();
      setMessage(removed ? 'The admin removed your entry. Join again if you need a new number.' : next.status === 'active' ? 'A new exercise has started. Join with your code name.' : 'The exercise has closed. No new positions will be sent.');
    } else if (!session) {
      setMessage(next.status === 'active' ? (next.participant ? 'Ready when you are. Each press sends one location.' : 'Join the exercise to receive your number.') : 'Your controller will open the exercise when it is time to begin.');
    }
    session = next;
    render();
  } catch (error) { $('connectionStatus').textContent = 'Unable to connect'; if (!session) setMessage(error.message, 'error'); }
  finally { refreshBusy = false; }
}

$('joinForm').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  busy = true; render();
  try {
    session = await api('/api/join', { name: $('codeName').value });
    setMessage('You are on the roster. Tap the button when you are ready to share your position.');
  } catch (error) { setMessage(error.message, 'error'); }
  finally { busy = false; render(); }
});

function resetButton() {
  $('sendLocation').classList.remove('acquiring');
  $('sendLabel').textContent = 'Send my location';
  $('sendHint').textContent = 'ONE TAP. ONE CHECK-IN.';
}

async function acquire() {
  if (busy || session?.status !== 'active' || !session.participant) return;
  const currentGeneration = ++generation;
  busy = true; pending = null;
  $('approximateActions').hidden = $('retryDelivery').hidden = true;
  $('accuracyValue').textContent = 'Acquiring…';
  $('sendLocation').classList.add('acquiring');
  $('sendLabel').textContent = 'Acquiring position';
  $('sendHint').textContent = 'KEEP THIS PAGE OPEN';
  setMessage('Finding a fresh position with a five-meter accuracy target. This may take up to 30 seconds.');
  render();
  acquisition = acquirePosition({ geolocation: navigator.geolocation, onProgress: fix => {
    $('accuracyValue').textContent = accuracyLabel(fix.accuracy);
    setMessage(`Current estimate: ${accuracyLabel(fix.accuracy)}. ${fix.accuracy <= 5 ? 'Target met. Sending check-in…' : 'Waiting for a better position…'}`);
  } });
  try {
    const fix = await acquisition.promise;
    if (currentGeneration !== generation) return;
    acquisition = null;
    pending = { ...fix, exerciseId: session.exerciseId, requestId: crypto.randomUUID(), acceptApproximate: false };
    if (fix.accuracy <= 5) await deliver(currentGeneration);
    else {
      $('approximateActions').hidden = false;
      $('sendApproximate').textContent = `Send approximate position (${accuracyLabel(fix.accuracy)})`;
      setMessage(`The best reported accuracy was ${accuracyLabel(fix.accuracy)}. Nothing has been sent. Retry or choose to share this approximate position.`, 'error');
    }
  } catch (error) { if (currentGeneration === generation) setMessage(error.message, 'error'); }
  finally { if (currentGeneration === generation) { acquisition = null; busy = false; resetButton(); render(); } }
}

async function deliver(currentGeneration = generation) {
  if (!pending || session?.status !== 'active') return;
  busy = true; render();
  $('approximateActions').hidden = $('retryDelivery').hidden = true;
  $('sendLabel').textContent = 'Sending check-in';
  $('sendHint').textContent = 'AWAITING RECEIPT';
  setMessage('Sending your position to exercise control…');
  try {
    const result = await api('/api/ping', pending);
    if (currentGeneration !== generation) return;
    session.participant = result.participant;
    pending = null;
    setMessage(`Location received. You are marker ${numberLabel(session.participant.number)} on the shared team map.`, 'success');
  } catch (error) {
    if (currentGeneration !== generation) return;
    setMessage(error.message, 'error');
    if (!error.status || error.status >= 500) $('retryDelivery').hidden = false;
    else { pending = null; await refresh(); }
  } finally { if (currentGeneration === generation) { busy = false; resetButton(); render(); } }
}

$('sendLocation').addEventListener('click', acquire);
$('retryFix').addEventListener('click', acquire);
$('sendApproximate').addEventListener('click', () => { if (pending && !busy) { pending.acceptApproximate = true; deliver(); } });
$('retryDelivery').addEventListener('click', () => { if (!busy) deliver(); });
window.addEventListener('online', () => { refresh(); render(); });
window.addEventListener('offline', () => { render(); setMessage('No connection. Check-ins will only be confirmed after the server receives them.', 'error'); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && acquisition) {
    generation++; acquisition.cancel(); acquisition = null; busy = false;
    resetButton(); render(); setMessage('Location acquisition stopped when the page was hidden. Tap again when you are ready.');
  } else if (!document.hidden) refresh();
});
window.addEventListener('pagehide', () => { generation++; acquisition?.cancel(); });
setInterval(() => { if (!document.hidden && !busy) refresh(); }, 15_000);
refresh();
