import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AppError } from './model.mjs';

const keySets = new Map();
export function localPreview(request, env) {
  return env.LOCAL_PREVIEW === 'true' && new URL(request.url).hostname === '127.0.0.1';
}

export async function controllerIdentity(request, env) {
  if (localPreview(request, env)) return { email: 'local-preview', exp: Math.floor(Date.now() / 1000) + 3600 };
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new AppError('Controller sign-in is not configured yet.', 503);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new AppError('Sign in through the controller address to continue.', 401);
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)) throw new AppError('Controller sign-in configuration is invalid.', 503);
  let keys = keySets.get(issuer);
  if (!keys) { keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)); keySets.set(issuer, keys); }
  try {
    const { payload } = await jwtVerify(token, keys, { issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'] });
    if (typeof payload.email !== 'string' || !payload.exp) throw new Error('Missing user identity');
    return payload;
  } catch { throw new AppError('Controller session expired. Sign in again.', 401); }
}

export function requireSameOrigin(request, env) {
  const expected = localPreview(request, env) ? new URL(request.url).origin : env.APP_ORIGIN;
  if (request.headers.get('Origin') !== expected || request.headers.get('X-Valor-Request') !== '1') {
    throw new AppError('Request origin could not be verified.', 403);
  }
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) throw new AppError('Expected a JSON request.', 415);
}

export async function readBody(request) {
  if (Number(request.headers.get('Content-Length')) > 2048) throw new AppError('Request is too large.', 413);
  if (!request.body) throw new AppError('Request body is missing.');
  const reader = request.body.getReader();
  const chunks = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 2048) { await reader.cancel(); throw new AppError('Request is too large.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new AppError('Invalid JSON request.'); }
}

export function participantToken(request) {
  const value = request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-valor=([a-f0-9]{64})(?:;|$)/)?.[1];
  return value || null;
}
export function newToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join(''); }
export async function digest(token) {
  if (!token) return null;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, '0')).join('');
}
