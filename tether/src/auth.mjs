import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AppError, email } from './validation.mjs';
const keySets = new Map();
export async function verifyToken(token, env, keys) {
  if (!env.ACCESS_AUD || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN || '')) throw new AppError('Sign-in is temporarily unavailable.',503);
  if (!token) throw new AppError('Your session has expired. Sign in again.',401);
  const issuer=`https://${env.ACCESS_TEAM_DOMAIN}`;
  if (!keys) {
    if (!keySets.has(issuer)) keySets.set(issuer,createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)));
    keys=keySets.get(issuer);
  }
  try {
    const {payload}=await jwtVerify(token,keys,{issuer,audience:env.ACCESS_AUD,algorithms:['RS256'],requiredClaims:['exp','sub','email','iat']});
    return {email:email(payload.email),sub:payload.sub};
  } catch { throw new AppError('Your session has expired. Sign in again.',401); }
}
export async function identity(request,env) { return verifyToken(request.headers.get('Cf-Access-Jwt-Assertion'),env); }
export function randomToken(bytes=32) {return Array.from(crypto.getRandomValues(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
export async function digest(value) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export function cookieToken(request,name) {
  const value=request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);
  return /^[a-f0-9]{64}$/.test(value||'')?value:null;
}
export function sessionCookie(kind,token,maxAge) {return `__Host-tether-${kind}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;}
export async function matchesPassword(value,expected) {
  if(typeof value!=='string'||value.length>128||!expected)return false;
  const a=await digest(value),b=await digest(expected);let difference=0;
  for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}
export function csrf(request,env) {
  if (request.headers.get('Origin')!==env.APP_ORIGIN || request.headers.get('X-Tether-Request')!=='1' || request.headers.get('Sec-Fetch-Site')==='cross-site') throw new AppError('Request origin could not be verified.',403);
  if (request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json') throw new AppError('A JSON request is required.',415);
}
export async function bodyOf(request) {
  if (Number(request.headers.get('Content-Length'))>8192 || !request.body) throw new AppError('Invalid request size.',413);
  const reader=request.body.getReader(), chunks=[]; let length=0;
  while (true) {
    const {value,done}=await reader.read(); if (done) break;
    length+=value.length;
    if (length>8192) { await reader.cancel(); throw new AppError('Request is too large.',413); }
    chunks.push(value);
  }
  const bytes=new Uint8Array(length); let offset=0;
  for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
  try {
    const body=JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body!=='object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {throw new AppError('Invalid JSON request.');}
}
