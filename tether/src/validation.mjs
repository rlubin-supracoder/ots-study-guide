export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function text(value, label, max, min = 1) {
  if (typeof value !== 'string') throw new AppError(`${label} is required.`);
  const clean = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (clean.length < min || clean.length > max || /[\p{Cc}\p{Cf}<>]/u.test(clean)) throw new AppError(`${label} must contain ${min}–${max} plain-text characters.`);
  return clean;
}
export function email(value) {
  const clean = text(value, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new AppError('Enter a valid email address.');
  return clean;
}
export function profile(body) {
  const full_name = text(body.full_name, 'Full name', 100, 2);
  const flight_number = text(body.flight_number, 'Flight number', 20);
  const room_number = text(body.room_number, 'Room number', 20);
  let digits = String(body.phone_number ?? '').replace(/[() .+\-]/g, '');
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) throw new AppError('Enter a valid 10-digit U.S. phone number.');
  return { full_name, flight_number, room_number, phone_number: `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}` };
}
export function complete(user) { return Boolean(user.full_name && user.flight_number && user.room_number && user.phone_number); }
export function instant(value, label = 'Time') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new AppError(`${label} must be a valid UTC timestamp.`);
  return value;
}
export function expected(value, now) {
  instant(value, 'Expected return');
  if (value <= now) throw new AppError('Expected return must be in the future.');
  if (Date.parse(value) - Date.parse(now) > 7 * 86400000) throw new AppError('Expected return must be within seven days.');
  return value;
}
export function id(value) {
  if (typeof value !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)) throw new AppError('Invalid record identifier.');
  return value;
}
export function version(actual, supplied) {
  if (!Number.isInteger(supplied) || supplied !== actual) throw new AppError('This information changed on another device. Refresh and try again.', 409);
}
export function admin(user) { if (user.role !== 'admin') throw new AppError('Administrator access is required.', 403); }
