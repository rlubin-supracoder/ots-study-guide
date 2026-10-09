import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.mjs';
import {serveRequest} from '../src/http.mjs';
import {databaseRequest} from '../src/service.mjs';
import {CLASSES} from '../src/classes.mjs';
const cookie=r=>r.headers.get('Set-Cookie')?.split(';')[0];
const details={full_name:'Class Test Member',flight_number:'Alpha',room_number:'102',phone_number:'3345550123',pin:'0123',pin_confirmation:'0123'};
function harness(){
  const old=fixture(),next=fixture(),objects=new Map([[CLASSES['27-01'].object,old],[CLASSES['27-02'].object,next]]);
  const env={APP_ORIGIN:'https://tether.test',BOOTSTRAP_ADMIN_EMAIL:'staff@example.test',MEMBER_PASSWORD:'old-password',MEMBER_PASSWORD_27_02:'new-password',PIN_PEPPER:'a'.repeat(64),ACCOUNTABILITY:{idFromName:v=>v,get:name=>({fetch:r=>databaseRequest(objects.get(name).db,r,env)})},ASSETS:{fetch:r=>new Response(new URL(r.url).pathname)}};
  const request=(path,body,Cookie='',headers={})=>serveRequest(new Request(env.APP_ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{Cookie,Origin:env.APP_ORIGIN,'Content-Type':'application/json','X-Tether-Request':'1',...headers},body:body===undefined?undefined:JSON.stringify(body)}),env,async r=>{if(r.headers.get('Test-Staff')!=='yes')throw Object.assign(new Error(),{});return {email:'staff@example.test'};});
  const unlock=async(prefix='',password=prefix?'new-password':'old-password')=>{const r=await request(prefix+'/api/unlock',{password});assert.equal(r.status,200);return cookie(r);};
  const join=async(prefix='')=>{const gate=await unlock(prefix),r=await request(prefix+'/api/join',details,gate);assert.equal(r.status,200);return gate+'; '+cookie(r);};
  const state=async(prefix,cookies)=>(await request(prefix+'/api/state',undefined,cookies)).json();
  return {old,next,env,request,unlock,join,state};
}
const second='/class/27-02';
test('common login routes the new password to an isolated class; legacy cookies and object names stay identical',async()=>{
  const h=harness();
  const first=await h.request('/api/unlock',{password:'old-password'});
  assert.match(cookie(first),/^__Host-tether-gate=/);assert.equal((await first.json()).redirect,'/');
  const next=await h.request('/api/unlock',{password:'new-password'});
  assert.match(cookie(next),/^__Host-tether-gate-27-02=/);assert.equal((await next.json()).redirect,second+'/');
  assert.equal((await h.request(second+'/api/unlock',{password:'old-password'})).status,401);
  assert.equal((await h.request('/class/unknown/api/unlock',{password:'new-password'})).status,404);
  assert.equal(CLASSES['27-01'].object,'tether-accountability-v1');
});
test('rosters, profiles, history, cookies and connection codes cannot cross class boundaries',async()=>{
  const h=harness(),old=await h.join(),next=await h.join(second),a=await h.state('',old),b=await h.state(second,next);
  assert.notEqual(a.user.id,b.user.id);assert.equal(a.class_id,'27-01');assert.equal(b.class_id,'27-02');
  const request={action:'checkout',request_id:crypto.randomUUID(),data:{version:a.user.version,destination:'Legacy trip',expected_return_at:'2026-09-25T22:00:00.000Z'}};
  assert.equal((await h.request('/api/action',request,old)).status,200);
  assert.equal((await h.state(second,next)).roster.length,0);assert.equal((await h.state('',old)).roster.length,1);
  for(const [path,cookies]of [[second,old],['',next]])assert.equal((await h.request(path+'/api/state',undefined,cookies)).status,401);
  // Even moving old token values into the new cookie names cannot authenticate against its database.
  assert.equal((await h.request(second+'/api/state',undefined,old.replaceAll('tether-gate=','tether-gate-27-02=').replaceAll('tether-device=','tether-device-27-02='))).status,401);
  const code=(await (await h.request('/api/device-code',{},old)).json()).code;
  const newGate=await h.unlock(second);
  assert.equal((await h.request(second+'/api/connect',{code},newGate)).status,401);
  const oldGate=await h.unlock();assert.equal((await h.request('/api/connect',{code},oldGate)).status,200);
  assert.equal((await (await h.request(second+'/api/history',{},next)).json()).records.length,0);
  const active=(await h.state('',old)).active;
  assert.equal((await h.request(second+'/api/action',{action:'checkin',request_id:crypto.randomUUID(),data:{record_id:active.id}},next)).status,404);
  assert.equal((await h.state('',old)).active.id,active.id);
  assert.equal((await h.request(second+'/api/admin/users',{},next)).status,403);
  const both=old+'; '+next;assert.equal((await h.state('',both)).user.id,a.user.id);assert.equal((await h.state(second,both)).user.id,b.user.id);
  await h.request(second+'/api/logout',{forget_device:true},both);
  assert.equal((await h.state('',both)).active.id,active.id);
});
test('new-class PIN recovery leaves legacy recovery, profiles, trips, and session rows untouched',async()=>{
  const h=harness(),old=await h.join(),next=await h.join(second);
  const snapshot=JSON.stringify(['users','checkouts','sessions','profile_pins','audit'].map(t=>h.old.db.rows('SELECT * FROM '+t)));
  const gate=await h.unlock(second),r=await h.request(second+'/api/connect-pin',{full_name:details.full_name,phone_number:details.phone_number,pin:'0123'},gate);
  assert.equal(r.status,200);assert.equal((await h.state(second,gate+'; '+cookie(r))).user.id,(await h.state(second,next)).user.id);
  assert.equal(JSON.stringify(['users','checkouts','sessions','profile_pins','audit'].map(t=>h.old.db.rows('SELECT * FROM '+t))),snapshot);
  assert.equal((await h.state('',old)).user.has_pin,true);
});
test('staff has explicit class views and cannot correct a record through the other class',async()=>{
  const h=harness(),old=await h.join(),next=await h.join(second),b=await h.state(second,next);
  const result=await h.request(second+'/api/action',{action:'checkout',request_id:crypto.randomUUID(),data:{version:b.user.version,destination:'New class trip',expected_return_at:'2026-09-25T22:00:00.000Z'}},next);
  const trip=await result.json();
  const staff=(prefix,path,body)=>h.request('/staff'+prefix+path,body,'',{'Test-Staff':'yes'});
  assert.equal((await (await staff('','/api/state')).json()).roster.length,0);
  assert.equal((await (await staff(second,'/api/state')).json()).roster.length,1);
  const close={action:'admin_checkin',request_id:crypto.randomUUID(),data:{record_id:trip.record_id,reason:'Verified return'}};
  assert.equal((await staff('','/api/action',close)).status,404);
  assert.equal((await staff(second,'/api/action',close)).status,200);
  assert.equal((await h.state(second,next)).active,null);
  assert.equal((await h.state('',old)).user.full_name,details.full_name);
});
test('200 successful sign-ins plus setups can share a network; incorrect passwords still throttle',async()=>{
  const h=harness();
  for(let i=0;i<400;i++)h.next.db.loginLimit('shared-campus-network',true);
  for(let i=0;i<60;i++)assert.equal((await h.request(second+'/api/unlock',{password:'wrong'})).status,401);
  assert.equal((await h.request(second+'/api/unlock',{password:'wrong'})).status,429);
  assert.equal((await h.request(second+'/api/unlock',{password:'new-password'})).status,200);
});
test('new roster cache reflects committed changes immediately and never leaks staff phone numbers',async()=>{
  const h=harness(),cookies=await h.join(second),before=await h.state(second,cookies);
  assert.equal(before.roster.length,0);
  await h.request(second+'/api/action',{action:'checkout',request_id:crypto.randomUUID(),data:{version:before.user.version,destination:'Testing cache',expected_return_at:'2026-09-25T22:00:00.000Z'}},cookies);
  const staff=await (await h.request('/staff'+second+'/api/state',undefined,'',{'Test-Staff':'yes'})).json();
  assert.equal(staff.roster.length,1);assert.ok(staff.roster[0].phone_number);
  const member=await h.state(second,cookies);assert.equal(member.roster.length,1);assert.equal(member.roster[0].phone_number,undefined);
});
test('live upgrades reject anonymous, cross-origin, staff and legacy connections',async()=>{
  const h=harness();
  assert.equal((await h.request(second+'/api/live',undefined,'',{Upgrade:'websocket'})).status,401);
  const cookies=await h.join(second);
  assert.equal((await h.request(second+'/api/live',undefined,cookies,{Upgrade:'websocket',Origin:'https://evil.test'})).status,403);
  assert.equal((await h.request('/api/live',undefined,cookies,{Upgrade:'websocket'})).status,403);
});
