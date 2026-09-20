import { GROUPS } from '../public/groups.mjs';

export const MAX_PARTICIPANTS = 100;
export const TARGET_ACCURACY = 5;
export const RETENTION_MS = 24 * 60 * 60 * 1000;

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function codeName(value) {
  if (typeof value !== 'string') throw new AppError('Enter your code name.');
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,23}$/u.test(name)) {
    throw new AppError('Use 1–24 letters, numbers, spaces, hyphens, or underscores.');
  }
  return name;
}

export function validatePing(body, now) {
  if (!body || typeof body !== 'object') throw new AppError('Invalid check-in.');
  const { latitude, longitude, accuracy, capturedAt, requestId } = body;
  if (![latitude, longitude, accuracy, capturedAt].every(v => typeof v === 'number' && Number.isFinite(v))) {
    throw new AppError('The phone did not provide a valid location. Please try again.');
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || accuracy <= 0 || accuracy > 100000) {
    throw new AppError('The phone reported an invalid location.');
  }
  if (capturedAt > now + 60_000 || capturedAt < now - 10 * 60_000) {
    throw new AppError('This location is too old. Acquire a fresh position.');
  }
  if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId)) throw new AppError('Invalid check-in identifier.');
  if (accuracy > TARGET_ACCURACY && body.acceptApproximate !== true) {
    throw new AppError('The five-meter target was not met. Retry or explicitly send the approximate position.');
  }
  return { latitude, longitude, accuracy, capturedAt, requestId, receivedAt: now, quality: accuracy <= TARGET_ACCURACY ? 'target-met' : 'approximate' };
}

export function initialState() {
  return { exerciseId: crypto.randomUUID(), status: 'standby', startedAt: null, endedAt: null, expiresAt: null, participants: [], nextNumber: 1 };
}

export function publicParticipant(person) {
  if (!person) return null;
  const { number, name, joinedAt, ping, pingCount } = person;
  return { number, name, group: GROUPS.includes(person.group) ? person.group : null, joinedAt, ping, pingCount };
}

export function register(state, name, tokenHash, now, group) {
  if (state.status !== 'active') throw new AppError('The controller has not opened this exercise.', 409);
  const existing = state.participants.find(p => p.tokenHash === tokenHash);
  if (existing && GROUPS.includes(existing.group)) return existing;
  if (!GROUPS.includes(group)) throw new AppError('Choose Alpha, Bravo, or Charlie as your group.');
  // Participants from before groups were added keep their number and latest check-in.
  if (existing) { existing.group = group; return existing; }
  const cleaned = codeName(name);
  if (state.participants.some(p => p.name.toLowerCase() === cleaned.toLowerCase())) {
    throw new AppError('That code name is already assigned. Use your original browser or choose another name.', 409);
  }
  if (state.participants.length >= MAX_PARTICIPANTS) throw new AppError('This exercise has reached its participant limit.', 409);
  const person = { number: state.nextNumber++, name: cleaned, group, tokenHash, joinedAt: now, ping: null, pingCount: 0 };
  state.participants.push(person);
  return person;
}

export function recordPing(state, tokenHash, exerciseId, body, now) {
  if (state.status !== 'active') throw new AppError('The exercise is closed. This location was not submitted.', 409);
  if (exerciseId !== state.exerciseId) throw new AppError('A new exercise has started. Rejoin before checking in.', 409);
  const person = state.participants.find(p => p.tokenHash === tokenHash);
  if (!person) throw new AppError('Join the exercise before sending a location.', 401);
  if (person.ping?.requestId === body?.requestId) return person;
  const ping = validatePing(body, now);
  if (person.ping && ping.capturedAt <= person.ping.capturedAt) throw new AppError('A newer location is already on the map. Acquire a fresh position.', 409);
  if (person.ping && now - person.ping.receivedAt < 2000) throw new AppError('Wait a moment before sending another location.', 429);
  person.ping = ping;
  person.pingCount++;
  return person;
}

export function removeParticipant(state, number) {
  if (!Number.isInteger(number) || number < 1) throw new AppError('Invalid participant number.');
  const index = state.participants.findIndex(person => person.number === number);
  if (index === -1) throw new AppError('This participant has already been removed.', 404);
  state.participants.splice(index, 1);
  // Keep remaining numbers stable; do not reuse a removed participant's number.
  return state;
}

export function changeExercise(state, action, now) {
  if (action === 'start') {
    if (state.status === 'active') throw new AppError('The exercise is already active.', 409);
    if (state.participants.length) throw new AppError('Clear the previous roster before starting a new exercise.', 409);
    state.exerciseId = crypto.randomUUID();
    state.status = 'active';
    state.startedAt = now;
    state.endedAt = null;
    state.expiresAt = now + RETENTION_MS;
  } else if (action === 'end') {
    if (state.status !== 'active') throw new AppError('No exercise is active.', 409);
    state.status = 'ended';
    state.endedAt = now;
  } else if (action === 'clear') {
    if (state.status === 'active') throw new AppError('End the exercise before clearing its data.', 409);
    Object.assign(state, initialState());
  } else throw new AppError('Unknown exercise action.');
  return state;
}
