import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,storage,migrations} from './helpers.mjs';
import {Database} from '../src/database.mjs';
import {serveRequest} from '../src/http.mjs';
import {databaseRequest} from '../src/service.mjs';
import {hashPin,confirmedPin} from '../src/pin.mjs';
const pepper='a'.repeat(64),details={full_name:'PIN Test Member',flight_number:'19',room_number:'321',phone_number:'3345550142',pin:'0123',pin_confirmation:'0123'};
const cookie=response=>response.headers.get('Set-Cookie')?.split(';')[0];
function harness(){
  const f=fixture(),env={APP_ORIGIN:'https://tether.test',MEMBER_PASSWORD:'campus-password',BOOTSTRAP_ADMIN_EMAIL:'staff@example.test',PIN_PEPPER:pepper,ACCOUNTABILITY:{idFromName:x=>x,get:()=>({fetch:r=>databaseRequest(f.db,r,env)})},ASSETS:{fetch:async()=>new Response('Application')}};
  const request=(path,body,Cookie='')=>serveRequest(new Request(env.APP_ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{Cookie,Origin:env.APP_ORIGIN,'Content-Type':'application/json','X-Tether-Request':'1'},body:body===undefined?undefined:JSON.stringify(body)}),env,async()=>({email:'staff@example.test'}));
  const gate=async()=>cookie(await request('/api/unlock',{password:env.MEMBER_PASSWORD}));
  const join=async(data=details)=>{const g=await gate(),r=await request('/api/join',data,g);assert.equal(r.status,200);return g+'; '+cookie(r);};
  const state=async cookies=>{const r=await request('/api/state',undefined,cookies);assert.equal(r.status,200);return r.json();};
  const recover=(g,values={})=>request('/api/connect-pin',{full_name:details.full_name,phone_number:details.phone_number,pin:details.pin,...values},g);
  return {...f,env,request,gate,join,state,recover};
}
test('PIN format is four digits, retains leading zeroes, and hashes with random salt and a server secret',async()=>{
  for(const value of ['123','12345','12a3',1234,'１２３４',' 1234'])assert.throws(()=>confirmedPin({pin:value,pin_confirmation:value}),/four digits/);
  assert.throws(()=>confirmedPin({pin:'0123',pin_confirmation:'1230'}),/do not match/);
  assert.equal(confirmedPin({pin:'0123',pin_confirmation:'0123'}),'0123');
  const a=await hashPin('0123',pepper),b=await hashPin('0123',pepper);assert.notEqual(a.salt,b.salt);assert.notEqual(a.hash,b.hash);
  assert.deepEqual(await hashPin('0123',pepper,a.salt),a);
  assert.notEqual((await hashPin('0123','b'.repeat(64),a.salt)).hash,a.hash);
  await assert.rejects(()=>hashPin('0123',undefined),/temporarily unavailable/);
});
test('new profiles require a confirmed PIN and lost-response retries cannot change it',async()=>{
  const h=harness(),g=await h.gate();
  for(const patch of [{pin:undefined},{pin_confirmation:'9999'},{pin:'abcd',pin_confirmation:'abcd'}])assert.equal((await h.request('/api/join',{...details,...patch},g)).status,400);
  assert.equal(h.db.one('SELECT COUNT(*) n FROM users').n,1);
  assert.equal((await h.request('/api/join',details,g)).status,200);
  assert.equal((await h.request('/api/join',details,g)).status,200);
  assert.equal((await h.request('/api/join',{...details,pin:'4321',pin_confirmation:'4321'},g)).status,409);
  assert.equal(h.db.one('SELECT COUNT(*) n FROM profile_pins').n,1);
});
test('PIN migration preserves profiles, active/completed records, audit and connected sessions exactly',()=>{
  const s=storage(),clock=()=> '2026-09-25T17:00:00.000Z';let db=new Database(s,migrations.slice(0,2),'staff@example.test',clock);
  const u=db.authorize('staff@example.test');
  db.mutate(u.email,{action:'profile',request_id:crypto.randomUUID(),data:{full_name:'Existing Member',flight_number:'19',room_number:'321',phone_number:'3345550142',version:u.version}},'test-profile');
  const active=crypto.randomUUID();
  for(const [recordId,status,checkin]of [[active,'ACTIVE',null],[crypto.randomUUID(),'COMPLETED','2026-09-25T16:00:00.000Z']])db.sql.exec("INSERT INTO checkouts(id,user_id,full_name,flight_number,room_number,phone_number,destination,checked_out_at,expected_return_at,checked_in_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",recordId,u.id,'Existing Member','19','321','(334) 555-0142','Existing destination','2026-09-25T15:00:00.000Z','2026-09-25T22:00:00.000Z',checkin,status,clock(),clock());
  db.createSession('device','1'.repeat(64),u.id);db.createSession('gate','2'.repeat(64),null,'existing-password');
  const tables=['users','checkouts','audit','sessions','requests'],before=Object.fromEntries(tables.map(table=>[table,db.rows('SELECT * FROM '+table)]));
  db=new Database(s,migrations,'staff@example.test',clock);
  for(const table of tables)assert.deepEqual(db.rows('SELECT * FROM '+table),before[table]);
  assert.equal(db.state(db.authorize(u.email)).user.has_pin,false);
  assert.equal(db.state(db.authorize(u.email)).active.id,active);
  const action=(action,data)=>db.mutate({userId:u.id},{action,data,request_id:crypto.randomUUID()},crypto.randomUUID());
  action('checkin',{record_id:active});assert.equal(db.state(db.authorize(u.email)).active,null);
  const checkout={destination:'Next trip',expected_return_at:'2026-09-25T22:00:00.000Z',version:db.authorize(u.email).version};
  assert.throws(()=>action('checkout',checkout),/profile PIN/);
  db.savePin({userId:u.id},{salt:'3'.repeat(32),hash:'4'.repeat(64)});action('checkout',checkout);
  assert.equal(db.history(db.authorize(u.email)).records.length,3);assert.equal(db.authorize(u.email).id,u.id);
});
test('PIN recovery preserves the same off-campus identity and history without revealing credentials',async()=>{
  const h=harness(),original=await h.join(),before=await h.state(original);
  const trip=await h.request('/api/action',{action:'checkout',request_id:crypto.randomUUID(),data:{version:before.user.version,destination:'Existing trip',expected_return_at:'2026-09-25T22:00:00.000Z'}},original);assert.equal(trip.status,200);
  const oldState=await h.state(original),g=await h.gate(),response=await h.recover(g,{full_name:'pin test member',phone_number:'+1 (334) 555-0142'});assert.equal(response.status,200);
  const restored=await h.state(g+'; '+cookie(response));assert.equal(restored.user.id,oldState.user.id);assert.deepEqual(restored.active,oldState.active);assert.equal(restored.user.role,'member');
  assert.equal(h.db.one('SELECT COUNT(*) n FROM users').n,2);
  const pin=h.db.pinRecord(before.user.id);for(const result of [restored,await (await h.request('/staff/api/admin/users',{})).json(),h.db.auditHistory(h.staff(),{})]){const text=JSON.stringify(result);assert.ok(!text.includes(pin.hash));assert.ok(!text.includes(pin.salt));assert.ok(!text.includes('"pin":"0123"'));}
  assert.equal((await h.request('/api/admin/users',{},g+'; '+cookie(response))).status,403);
});
test('PIN guessing locks after five attempts across gates; connection code and normal status still work',async()=>{
  const h=harness(),original=await h.join(),g=await h.gate();
  for(let i=0;i<5;i++)assert.equal((await h.recover(g,{pin:'9999'})).status,401);
  const another=await h.gate();assert.equal((await h.recover(another)).status,401);
  const state=await h.state(original);assert.equal(state.user.pin_locked,true);assert.equal(state.active,null);
  const code=(await (await h.request('/api/device-code',{},original)).json()).code;
  const connected=await h.request('/api/connect',{code},another);assert.equal(connected.status,200);
  const newCookies=another+'; '+cookie(connected);
  assert.equal((await h.request('/api/profile-pin',{pin:'4321',pin_confirmation:'4321',replace:true},newCookies)).status,200);
  assert.equal((await h.state(original)).user.pin_locked,false);
  assert.equal((await h.recover(await h.gate(),{pin:'4321'})).status,200);
});
test('concurrent guesses cannot bypass the five-attempt cap and wrong/unknown profiles share errors',async()=>{
  const h=harness(),original=await h.join(),g=await h.gate();
  const results=await Promise.all(Array.from({length:15},()=>h.recover(g,{pin:'9999'})));
  assert.ok(results.every(r=>r.status===401));assert.equal(h.db.pinRecord((await h.state(original)).user.id).failed_attempts,5);
  const wrong=await results[0].json(),unknown=await (await h.recover(g,{full_name:'Unknown Person'})).json();assert.deepEqual(wrong,unknown);
  assert.equal((await h.recover(g)).status,401);
});
test('missing PIN, wrong contact details, disabled profile and duplicate identity cannot be claimed',async()=>{
  const h=harness(),original=await h.join(),u=(await h.state(original)).user,g=await h.gate();
  assert.equal((await h.recover(g,{phone_number:'3345550199'})).status,401);
  h.db.sql.exec('UPDATE users SET enabled=0 WHERE id=?',u.id);assert.equal((await h.recover(g)).status,401);h.db.sql.exec('UPDATE users SET enabled=1 WHERE id=?',u.id);
  h.invite('duplicate@example.test');h.send('duplicate@example.test','profile',{...details,version:1});assert.equal((await h.recover(g)).status,401);
  h.db.sql.exec("UPDATE users SET enabled=0 WHERE email='duplicate@example.test'");h.db.sql.exec('DELETE FROM profile_pins WHERE user_id=?',u.id);assert.equal((await h.recover(g)).status,401);
  assert.equal((await h.state(original)).user.has_pin,false);
});
test('PIN updates require current authorization, can only change the caller, and staff PINs never grant staff sessions',async()=>{
  const h=harness(),a=await h.join(),b=await h.join({...details,full_name:'Other Member',room_number:'322'}),other=(await h.state(b)).user;
  const previous=h.db.pinRecord(other.id).hash;
  assert.equal((await h.request('/api/profile-pin',{pin:'4567',pin_confirmation:'4567',replace:true,user_id:other.id},a)).status,200);assert.equal(h.db.pinRecord(other.id).hash,previous);
  assert.equal((await h.request('/api/profile-pin',{pin:'4567',pin_confirmation:'4567'})).status,401);
  h.setup(h.staff().email,'Staff Person');assert.equal((await h.request('/staff/api/profile-pin',{pin:'6789',pin_confirmation:'6789',replace:true})).status,200);
  const g=await h.gate(),r=await h.recover(g,{full_name:'Staff Person',phone_number:'3345550123',pin:'6789'});assert.equal(r.status,200);
  const cookies=g+'; '+cookie(r);assert.equal((await h.state(cookies)).user.role,'member');assert.equal((await h.request('/api/admin/users',{},cookies)).status,403);
});
test('staff reset clears the old PIN and invalidates an in-flight PIN verification',async()=>{
  const h=harness(),cookies=await h.join(),user=(await h.state(cookies)).user,g=await h.gate();
  const connect=h.db.connectPin.bind(h.db);h.db.connectPin=(...args)=>{h.db.issueConnection(h.staff(),'c'.repeat(64),user.id,'Lost device');return connect(...args);};
  assert.equal((await h.recover(g)).status,401);assert.equal(h.db.pinRecord(user.id),undefined);
});

test('PIN recovery requires the campus gate and CSRF checks; missing configuration never consumes an account attempt',async()=>{
  const h=harness(),cookies=await h.join(),user=(await h.state(cookies)).user,g=await h.gate();
  assert.equal((await h.recover('')).status,401);
  const forged=await serveRequest(new Request(h.env.APP_ORIGIN+'/api/connect-pin',{method:'POST',headers:{Cookie:g,Origin:'https://untrusted.test','Content-Type':'application/json','X-Tether-Request':'1'},body:JSON.stringify(details)}),h.env);
  assert.equal(forged.status,403);assert.equal(h.db.pinRecord(user.id).failed_attempts,0);
  delete h.env.PIN_PEPPER;
  assert.equal((await h.recover(g)).status,503);assert.equal(h.db.pinRecord(user.id).failed_attempts,0);
  assert.equal((await h.state(cookies)).user.id,user.id);
});
