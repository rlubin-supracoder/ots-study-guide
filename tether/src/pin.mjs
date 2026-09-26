import {AppError} from './validation.mjs';
import {randomToken} from './auth.mjs';
const encoder=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export function pinValue(value) {
  if(typeof value!=='string'||!/^\d{4}$/.test(value))throw new AppError('Your profile PIN must be exactly four digits.');
  return value;
}
export function confirmedPin(body) {
  const pin=pinValue(body.pin);
  if(pin!==body.pin_confirmation)throw new AppError('The two PINs do not match.');
  return pin;
}
export async function pinFingerprint(value,pepper) {
  if(typeof pepper!=='string'||!/^[a-f0-9]{64}$/i.test(pepper))throw new AppError('Profile PINs are temporarily unavailable. Use a connection code or contact staff.',503);
  const key=await crypto.subtle.importKey('raw',encoder.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(value)));
}
export async function hashPin(pin,pepper,salt=randomToken(16)) {
  pinValue(pin);
  const secret=await pinFingerprint('tether-profile-pin:'+pin,pepper);
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),'PBKDF2',false,['deriveBits']);
  const hash=hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:100000},key,256));
  return {salt,hash};
}
export function sameHash(a,b) {
  if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
  let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}
