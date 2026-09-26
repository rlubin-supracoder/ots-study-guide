import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT,createLocalJWKSet,exportJWK} from 'jose';
import {fixture} from './helpers.mjs';
import {serveRequest} from '../src/http.mjs';
import {databaseRequest} from '../src/service.mjs';
import {verifyToken} from '../src/auth.mjs';
const {privateKey,publicKey}=await generateKeyPair('RS256');
const keys=createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:'test',alg:'RS256'}]});
const envBase={APP_ORIGIN:'https://tether.test',ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',ACCESS_AUD:'test-audience',BOOTSTRAP_ADMIN_EMAIL:'staff@example.test',MEMBER_PASSWORD:'test-campus-password'};
const profile={full_name:'Test Member',flight_number:'27-01',room_number:'102',phone_number:'3345550123'};
async function token(email='staff@example.test',options={}){return new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('test-user').setIssuedAt().setIssuer('https://test.cloudflareaccess.com').setAudience(options.audience||'test-audience').setExpirationTime(options.exp||'5m').sign(privateKey);}
const cookie=r=>r.headers.get('Set-Cookie')?.split(';')[0];
function harness(){
  const f=fixture();const env={...envBase,ACCOUNTABILITY:{idFromName:v=>v,get:()=>({fetch:r=>databaseRequest(f.db,r,env)})},ASSETS:{fetch:async r=>new Response(new URL(r.url).pathname)}};
  const request=async(path,body,headers={})=>serveRequest(new Request(env.APP_ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{...(body!==undefined?{'Content-Type':'application/json',Origin:env.APP_ORIGIN,'X-Tether-Request':'1'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)}),env,(r,e)=>verifyToken(r.headers.get('Cf-Access-Jwt-Assertion'),e,keys));
  const unlock=async()=>{const r=await request('/api/unlock',{password:env.MEMBER_PASSWORD});assert.equal(r.status,200);return cookie(r);};
  const join=async(data=profile)=>{const gate=await unlock(),r=await request('/api/join',data,{Cookie:gate});assert.equal(r.status,200);return gate+'; '+cookie(r);};
  const staffRequest=async(path,body)=>request('/staff'+path,body,{'Cf-Access-Jwt-Assertion':await token()});
  return {...f,env,request,unlock,join,staffRequest};
}
test('anonymous visitors get only the password screen and generic assets; all personnel APIs fail closed',async()=>{
  const h=harness();assert.equal(await (await h.request('/')).text(),'/login.html');assert.equal((await h.request('/app.js')).status,200);
  for(const path of ['/api/state','/api/admin/users','/staff','/staff/api/state']){const r=await h.request(path);assert.equal(r.status,401);assert.equal(r.headers.get('Cache-Control'),'no-store, max-age=0');assert.match(r.headers.get('X-Robots-Tag'),/noindex/);}
});
test('staff requires a valid JWT for the designated email; forged member headers do not help',async()=>{
  const h=harness();for(const jwt of ['not-a-jwt',await token(undefined,{exp:1}),await token(undefined,{audience:'other'})])assert.equal((await h.request('/staff/api/state',undefined,{'Cf-Access-Jwt-Assertion':jwt})).status,401);
  assert.equal((await h.request('/staff',undefined,{'Cf-Access-Jwt-Assertion':await token('stranger@example.test')})).status,403);
  assert.equal((await h.request('/api/state',undefined,{'X-Tether-Mode':'staff','X-Verified-Email':'staff@example.test','Cf-Access-Jwt-Assertion':await token()})).status,401);
  assert.equal((await h.staffRequest('/api/admin/users',{})).status,200);
});
test('password validation, CSRF and server-held sessions protect member setup',async()=>{
  const h=harness();assert.equal((await h.request('/api/unlock',{password:'wrong'})).status,401);
  for(const headers of [{Origin:'https://evil.test'},{'X-Tether-Request':''}])assert.equal((await h.request('/api/unlock',{password:h.env.MEMBER_PASSWORD},headers)).status,403);
  const r=await h.request('/api/unlock',{password:h.env.MEMBER_PASSWORD}),gate=cookie(r);assert.equal(r.status,200);
  assert.match(r.headers.get('Set-Cookie'),/__Host-tether-gate=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict/);
  assert.equal(await (await h.request('/',undefined,{Cookie:gate})).text(),'/setup.html');
  assert.equal((await h.request('/api/state',undefined,{Cookie:gate})).status,401);
  assert.equal((await h.request('/api/join',profile)).status,401);
  assert.equal((await h.request('/api/join',{...profile,phone_number:'123'},{Cookie:gate})).status,400);
  assert.equal((await h.request('/api/join',{...profile,full_name:''},{Cookie:gate})).status,400);
  const joined=await h.request('/api/join',profile,{Cookie:gate});assert.equal(joined.status,200);
  const rawToken=cookie(joined).split('=')[1];assert.equal(h.db.one('SELECT token_hash FROM sessions WHERE token_hash=?',rawToken),undefined);
  const headers={Cookie:gate+'; '+cookie(joined)};assert.equal(await (await h.request('/',undefined,headers)).text(),'/index.html');
  const state=await (await h.request('/api/state',undefined,headers)).json();assert.equal(state.user.email,null);assert.equal(state.user.role,'member');assert.equal(state.user.full_name,profile.full_name);
  assert.equal((await h.request('/api/admin/users',{},headers)).status,403);
  assert.equal((await h.request('/staff/api/state',undefined,headers)).status,401);
});
test('member lifecycle uses authoritative status and preserves private history and ownership',async()=>{
  const h=harness(),a=await h.join(),b=await h.join({...profile,full_name:'Other Member',room_number:'103'});
  const request=(path,body,Cookie=a)=>h.request(path,body,{Cookie});
  const state=await (await request('/api/state')).json();
  const body={action:'checkout',request_id:crypto.randomUUID(),data:{destination:'Restaurant <script>alert(1)</script>',expected_return_at:'2026-09-25T22:00:00.000Z',version:state.user.version}};
  assert.equal((await request('/api/action',body)).status,400);body.data.destination='Restaurant';
  const first=await request('/api/action',body);assert.equal(first.status,200);const trip=await first.json();
  assert.equal((await request('/api/action',body)).status,200);
  assert.equal((await request('/api/action',{...body,request_id:crypto.randomUUID()})).status,409);
  const other=await (await request('/api/state',undefined,b)).json();assert.equal(other.roster.length,1);assert.equal(other.roster[0].phone_number,undefined);
  assert.equal((await request('/api/action',{action:'checkin',request_id:crypto.randomUUID(),data:{record_id:trip.record_id}},b)).status,404);
  assert.equal((await request('/api/action',{action:'admin_checkin',request_id:crypto.randomUUID(),data:{record_id:trip.record_id,reason:'Not staff'}},b)).status,403);
  const checkin={action:'checkin',request_id:crypto.randomUUID(),data:{record_id:trip.record_id}};
  assert.equal((await request('/api/action',checkin)).status,200);assert.equal((await request('/api/action',checkin)).status,200);
  assert.equal((await (await request('/api/state')).json()).roster.length,0);
  assert.equal((await (await request('/api/history',{})).json()).records.length,1);
  assert.equal((await (await request('/api/history',{},b)).json()).records.length,0);
});
test('setup retries after a lost response are safe; matching names cannot claim an existing account',async()=>{
  const h=harness(),gate=await h.unlock();
  for(let i=0;i<2;i++)assert.equal((await h.request('/api/join',profile,{Cookie:gate})).status,200);
  assert.equal(h.db.one("SELECT COUNT(*) n FROM users WHERE account_type='device'").n,1);
  assert.equal((await h.request('/api/join',{...profile,full_name:'Changed Name'},{Cookie:gate})).status,409);
  const other=await h.unlock();assert.equal((await h.request('/api/join',profile,{Cookie:other})).status,409);
});
test('device connection is one-use, preserves identity, and caps administrator devices to member permissions',async()=>{
  const h=harness(),member=await h.join();
  const issued=await (await h.request('/api/device-code',{}, {Cookie:member})).json();
  const gate=await h.unlock(),body={code:issued.code};
  const connected=await h.request('/api/connect',body,{Cookie:gate});assert.equal(connected.status,200);
  assert.equal((await h.request('/api/connect',body,{Cookie:gate})).status,200);
  const otherGate=await h.unlock();assert.equal((await h.request('/api/connect',body,{Cookie:otherGate})).status,401);
  const a=await (await h.request('/api/state',undefined,{Cookie:member})).json(),b=await (await h.request('/api/state',undefined,{Cookie:gate+'; '+cookie(connected)})).json();assert.equal(a.user.id,b.user.id);
  const staffCode=await (await h.staffRequest('/api/device-code',{})).json();
  const staffDevice=await h.request('/api/connect',{code:staffCode.code},{Cookie:otherGate});assert.equal(staffDevice.status,200);
  const staffCookies=otherGate+'; '+cookie(staffDevice),state=await (await h.request('/api/state',undefined,{Cookie:staffCookies})).json();assert.equal(state.user.id,h.staff().id);assert.equal(state.user.role,'member');
  assert.equal((await h.request('/api/admin/users',{}, {Cookie:staffCookies})).status,403);
});
test('logout remembers a device; forgetting, password rotation, expiry, disabled accounts and staff reset revoke access',async()=>{
  const h=harness(),cookies=await h.join(),device=cookies.split('; ')[1],user=(await (await h.request('/api/state',undefined,{Cookie:cookies})).json()).user;
  assert.equal((await h.request('/api/logout',{}, {Cookie:cookies})).status,200);assert.equal((await h.request('/api/state',undefined,{Cookie:cookies})).status,401);
  const freshGate=await h.unlock(),fresh=freshGate+'; '+device;assert.equal((await h.request('/api/state',undefined,{Cookie:fresh})).status,200);
  h.env.MEMBER_PASSWORD='rotated';assert.equal((await h.request('/api/state',undefined,{Cookie:fresh})).status,401);
  const newGate=await h.unlock(),current=newGate+'; '+device;
  h.db.sql.exec('UPDATE users SET enabled=0 WHERE id=?',user.id);assert.equal((await h.request('/api/state',undefined,{Cookie:current})).status,403);h.db.sql.exec('UPDATE users SET enabled=1 WHERE id=?',user.id);
  const reset=await h.staffRequest('/api/device-code',{user_id:user.id,reset:true,reason:'Device lost'});assert.equal(reset.status,200);assert.equal((await h.request('/api/state',undefined,{Cookie:current})).status,401);
  const connected=await h.request('/api/connect',{code:(await reset.json()).code},{Cookie:newGate});assert.equal(connected.status,200);
  const forgotten=await h.request('/api/logout',{forget_device:true},{Cookie:newGate+'; '+cookie(connected)});assert.equal(forgotten.headers.getSetCookie().length,2);
  const next=await h.unlock();assert.equal((await h.request('/api/state',undefined,{Cookie:next+'; '+cookie(connected)})).status,401);
  h.setTime('2026-09-27T17:00:00.000Z');assert.equal(await (await h.request('/',undefined,{Cookie:next})).text(),'/login.html');
});
test('connection codes expire and login guessing is rate limited',async()=>{
  const h=harness(),cookies=await h.join();const code=(await (await h.request('/api/device-code',{}, {Cookie:cookies})).json()).code;
  h.setTime('2026-09-27T17:00:00.000Z');const gate=await h.unlock();assert.equal((await h.request('/api/connect',{code},{Cookie:gate})).status,401);
  let last;for(let i=0;i<61;i++)last=await h.request('/api/unlock',{password:'wrong'});assert.equal(last.status,429);
});
test('twenty near-simultaneous checkout requests create exactly one trip',async()=>{
  const h=harness();h.setup(h.staff().email);const data={destination:'Testing',expected_return_at:'2026-09-25T22:00:00.000Z',version:h.staff().version};
  const responses=await Promise.all(Array.from({length:20},()=>h.staffRequest('/api/action',{request_id:crypto.randomUUID(),action:'checkout',data})));
  assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal(responses.filter(r=>r.status===409).length,19);assert.equal(h.db.one('SELECT COUNT(*) n FROM checkouts').n,1);
});
test('database outages fail closed without leaking error details',async()=>{const h=harness();h.env.ACCOUNTABILITY.get=()=>({fetch(){throw new Error('secret database detail');}});const r=await h.request('/api/state');assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/secret database/);});
test('HTTP redirects to HTTPS and unknown hosts fail closed',async()=>{const h=harness();const r=await serveRequest(new Request('http://tether.test/'),h.env);assert.equal(r.status,308);assert.equal(r.headers.get('Location'),'https://tether.test/');assert.equal((await serveRequest(new Request('https://other.test/'),h.env)).status,404);});
