import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,migration,migrations,storage} from './helpers.mjs';
import {Database} from '../src/database.mjs';
test('membership must be approved; migrations and bootstrap are idempotent',()=>{
  const f=fixture();assert.throws(()=>f.db.authorize('stranger@example.test'),/not been approved/);
  new Database(f.s,[{version:1,sql:migration}],'other@example.test');assert.equal(f.db.one('SELECT COUNT(*) n FROM users').n,1);
});
test('session migration upgrades the existing database without replacing profiles or trips',()=>{
  const s=storage(),clock=()=> '2026-09-25T17:00:00.000Z';
  let db=new Database(s,[migrations[0]],'staff@example.test',clock);
  const send=(action,data)=>db.mutate('staff@example.test',{action,data,request_id:crypto.randomUUID()},crypto.randomUUID());
  send('profile',{full_name:'Existing Staff',flight_number:'27-01',room_number:'104',phone_number:'3345550123',version:1});
  const user=db.authorize('staff@example.test');const trip=send('checkout',{destination:'Existing destination',expected_return_at:'2026-09-25T22:00:00.000Z',version:user.version});
  db=new Database(s,migrations,'staff@example.test',clock);
  assert.equal(db.state(db.authorize('staff@example.test')).active.id,trip.record_id);
  assert.equal(db.authorize('staff@example.test').id,user.id);
  assert.equal(db.authorize('staff@example.test').account_type,'email');
  assert.equal(db.one('SELECT COUNT(*) n FROM schema_migrations').n,2);
  new Database(s,migrations,'other@example.test',clock);assert.equal(db.one('SELECT COUNT(*) n FROM users').n,1);
});
test('required profile and invalid phone, script, excessive fields are rejected',()=>{
  const f=fixture();f.invite('member@example.test');assert.throws(()=>f.checkout('member@example.test'),/Complete/);
  for(const patch of [{phone_number:'123'},{full_name:'<script>alert(1)</script>'},{room_number:'A'.repeat(21)},{flight_number:''}])assert.throws(()=>f.send('member@example.test','profile',{full_name:'Test Person',flight_number:'1',room_number:'2',phone_number:'3345550123',version:1,...patch}));
  f.setup('member@example.test');assert.equal(f.db.authorize('member@example.test').phone_number,'(334) 555-0123');
});
test('checkout, duplicate protection, checkin, history and audit persist',()=>{
  const f=fixture();f.invite('member@example.test');f.setup('member@example.test');const user=()=>f.db.authorize('member@example.test');
  const result=f.checkout(user().email);assert.equal(f.db.state(user()).roster.length,1);assert.equal(f.db.state(user()).active.checked_out_at,'2026-09-25T17:00:00.000Z');assert.throws(()=>f.checkout(user().email),/already checked out/);
  f.setTime('2026-09-25T18:00:00.000Z');f.send(user().email,'checkin',{record_id:result.record_id});f.send(user().email,'checkin',{record_id:result.record_id});assert.equal(f.db.state(user()).roster.length,0);assert.equal(f.db.history(user()).records[0].checked_in_at,'2026-09-25T18:00:00.000Z');assert.equal(f.db.one("SELECT COUNT(*) n FROM audit WHERE action='CHECKED_IN'").n,1);
});
test('idempotency replays committed responses and rejects reused identifiers with changed payloads',()=>{
  const f=fixture();f.setup(f.staff().email);const key=crypto.randomUUID(),data={destination:'Test place',expected_return_at:'2026-09-25T22:00:00.000Z',version:f.staff().version};
  const a=f.send(f.staff().email,'checkout',data,key);assert.deepEqual(f.send(f.staff().email,'checkout',data,key),a);assert.throws(()=>f.send(f.staff().email,'checkout',{...data,destination:'Other'},key),/identifier/);assert.equal(f.db.one('SELECT COUNT(*) n FROM checkouts').n,1);
});
test('database unique index independently prevents simultaneous active records',()=>{
  const f=fixture();f.setup(f.staff().email);f.checkout(f.staff().email);
  assert.throws(()=>f.db.sql.exec("INSERT INTO checkouts SELECT ?,user_id,full_name,flight_number,room_number,phone_number,destination,checked_out_at,expected_return_at,checked_in_at,status,version,created_at,updated_at FROM checkouts LIMIT 1",crypto.randomUUID()),/UNIQUE/);
});
test('stale devices cannot create a new checkout after another device or administrator changes status',()=>{
  const f=fixture();f.invite('member@example.test');f.setup('member@example.test');const old=f.db.authorize('member@example.test'),r=f.checkout(old.email);
  f.send(f.staff().email,'admin_checkin',{record_id:r.record_id,reason:'Confirmed return'});
  assert.throws(()=>f.send(old.email,'checkout',{version:old.version,destination:'Stale',expected_return_at:'2026-09-25T22:00:00.000Z'}),/another device/);
  const next=f.checkout(old.email);f.send(old.email,'checkin',{record_id:r.record_id});assert.equal(f.db.state(f.db.authorize(old.email)).active.id,next.record_id);
});
test('members cannot access admin data or edit someone else; member roster excludes phone',()=>{
  const f=fixture();f.invite('member@example.test');f.setup('member@example.test');f.setup(f.staff().email);const r=f.checkout(f.staff().email),m=f.db.authorize('member@example.test');
  assert.throws(()=>f.send(m.email,'checkin',{record_id:r.record_id}),/not found/);assert.throws(()=>f.send(m.email,'invite',{email:'intruder@example.test'}),/Administrator/);
  for(const call of [()=>f.db.history(m,{},true),()=>f.db.users(m),()=>f.db.auditHistory(m,{})])assert.throws(call,/Administrator/);
  assert.equal(f.db.history(m).records.length,0);assert.equal('phone_number' in f.db.state(m).roster[0],false);assert.equal('phone_number' in f.db.state(f.staff()).roster[0],true);
});
test('profile edits do not overwrite the required trip snapshots',()=>{
  const f=fixture();f.setup(f.staff().email,'First Name');f.checkout(f.staff().email);f.setup(f.staff().email,'Second Name');assert.equal(f.db.state(f.staff()).active.full_name,'First Name');
});
test('admin corrections preserve before/after audit and prevent overlapping active trips',()=>{
  const f=fixture();f.setup(f.staff().email);const r=f.checkout(f.staff().email);f.setTime('2026-09-25T18:00:00.000Z');f.send(f.staff().email,'checkin',{record_id:r.record_id});let record=f.db.history(f.staff()).records[0];
  f.send(f.staff().email,'correct',{record_id:r.record_id,version:record.version,destination:'Corrected place',checked_out_at:record.checked_out_at,expected_return_at:record.expected_return_at,checked_in_at:null,reason:'Check-in was accidental'});
  assert.equal(f.db.state(f.staff()).active.destination,'Corrected place');const audit=f.db.one("SELECT detail FROM audit WHERE action='RECORD_CORRECTED'");assert.equal(JSON.parse(audit.detail).before.destination,'Test destination');assert.equal(JSON.parse(audit.detail).after.checked_in_at,null);
  assert.throws(()=>f.send(f.staff().email,'correct',{record_id:r.record_id,version:record.version,...record}),/identifier|another device/);
});
test('invalid/past return, bad correction and failed transactions leave no partial changes',()=>{
  const f=fixture();f.setup(f.staff().email);const before=f.db.one('SELECT COUNT(*) n FROM audit').n;
  for(const data of [{destination:'Fine',expected_return_at:'2026-09-25T16:00:00.000Z'},{destination:'A'.repeat(161),expected_return_at:'2026-09-25T22:00:00.000Z'},{destination:'Fine',expected_return_at:'2026-02-30T22:00:00.000Z'}])assert.throws(()=>f.send(f.staff().email,'checkout',{version:f.staff().version,...data}));
  assert.equal(f.db.one('SELECT COUNT(*) n FROM checkouts').n,0);assert.equal(f.db.one('SELECT COUNT(*) n FROM audit').n,before);
});
test('disable requires closing active trips; disabled accounts are denied even on an existing session',()=>{
  const f=fixture();f.invite('member@example.test');f.setup('member@example.test');const r=f.checkout('member@example.test');let user=f.db.authorize('member@example.test');
  assert.throws(()=>f.send(f.staff().email,'user_update',{user_id:user.id,version:user.version,role:'member',enabled:false,reason:'No longer enrolled'}),/Check this member in/);
  f.send(f.staff().email,'admin_checkin',{record_id:r.record_id,reason:'Confirmed on campus'});user=f.db.authorize(user.email);f.send(f.staff().email,'user_update',{user_id:user.id,version:user.version,role:'member',enabled:false,reason:'No longer enrolled'});assert.throws(()=>f.db.authorize(user.email),/disabled/);
  assert.throws(()=>f.send(f.staff().email,'user_update',{user_id:f.staff().id,version:f.staff().version,role:'member',enabled:false,reason:'Disable self'}),/Another administrator/);
});
test('history filters, SQL metacharacters and pagination are safely handled',()=>{
  const f=fixture();f.setup(f.staff().email);f.checkout(f.staff().email);
  assert.equal(f.db.history(f.staff(),{search:"' OR 1=1 --"},true).records.length,0);
  assert.equal(f.db.history(f.staff(),{flight:'27-01',status:'ACTIVE',from:'2026-09-25T00:00:00.000Z',to:'2026-09-26T00:00:00.000Z'},true).records.length,1);
  assert.throws(()=>f.db.history(f.staff(),{offset:-1},true),/Invalid page/);
});
test('sensitive endpoint rate limit survives application reconstruction',()=>{
  const f=fixture();for(let i=0;i<30;i++)f.db.limit(f.staff(),true);const reopened=new Database(f.s,[{version:1,sql:migration}],null,f.db.clock);assert.throws(()=>reopened.limit(f.staff(),true),/Too many/);
});
