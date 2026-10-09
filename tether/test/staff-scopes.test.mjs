import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT,createLocalJWKSet,exportJWK} from 'jose';
import {fixture} from './helpers.mjs';
import {serveRequest} from '../src/http.mjs';
import {databaseRequest} from '../src/service.mjs';
import {verifyToken,staffEmails,staffClasses} from '../src/auth.mjs';
import {CLASSES} from '../src/classes.mjs';
const {privateKey,publicKey}=await generateKeyPair('RS256');
const keys=createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:'scope-test',alg:'RS256'}]});
const scoped='class-staff@example.test',second='/staff/class/27-02';
async function token(address=scoped){return new SignJWT({email:address}).setProtectedHeader({alg:'RS256',kid:'scope-test'}).setSubject('staff-scope-test').setIssuedAt().setIssuer('https://test.cloudflareaccess.com').setAudience('scope-test').setExpirationTime('5m').sign(privateKey);}
function harness(){
  const old=fixture(),next=fixture(),objects=new Map([[CLASSES['27-01'].object,old],[CLASSES['27-02'].object,next]]);
  const env={APP_ORIGIN:'https://tether.test',ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',ACCESS_AUD:'scope-test',BOOTSTRAP_ADMIN_EMAIL:'staff@example.test',STAFF_EMAILS:'other-staff@example.test',STAFF_EMAILS_27_02:scoped,MEMBER_PASSWORD:'old-password',MEMBER_PASSWORD_27_02:'new-password',PIN_PEPPER:'a'.repeat(64),ACCOUNTABILITY:{idFromName:v=>v,get:name=>({fetch:r=>databaseRequest(objects.get(name).db,r,env)})},ASSETS:{fetch:r=>new Response(new URL(r.url).pathname)}};
  for(const f of [old,next])f.db.provisionStaff(staffEmails(env));
  const request=async(path,body,address=scoped,extra={})=>serveRequest(new Request(env.APP_ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json','X-Tether-Request':'1','Cf-Access-Jwt-Assertion':await token(address),...extra},body:body===undefined?undefined:JSON.stringify(body)}),env,(r,e)=>verifyToken(r.headers.get('Cf-Access-Jwt-Assertion'),e,keys));
  return {old,next,env,request};
}
test('class-specific staff is allowed only in 27-02 and existing staff keeps both classes',()=>{
  const h=harness();assert.deepEqual(staffClasses(scoped,h.env),['27-02']);
  for(const email of ['staff@example.test','other-staff@example.test'])assert.deepEqual(staffClasses(email,h.env),['27-01','27-02']);
  assert.equal(staffEmails(h.env).includes(scoped),false);assert.equal(staffEmails(h.env,'27-02').includes(scoped),true);
  h.env.STAFF_EMAILS_27_02=' Class-Staff@Example.Test, class-staff@example.test ';assert.equal(staffEmails(h.env,'27-02').filter(e=>e===scoped).length,1);
  assert.throws(()=>staffEmails(h.env,'not-a-class'));
});
test('signed scoped staff can use 27-02 admin tools and is provisioned only there',async()=>{
  const h=harness(),legacy=JSON.stringify(h.old.db.rows('SELECT * FROM users'));
  assert.equal(await (await h.request(second)).text(),'/index.html');
  const state=await (await h.request(second+'/api/state')).json();assert.equal(state.user.role,'admin');assert.equal(state.user.email,scoped);assert.deepEqual(state.staff_classes,['27-02']);
  for(const route of ['/api/admin/users','/api/admin/history','/api/admin/audit'])assert.equal((await h.request(second+route,{})).status,200);
  h.next.invite('member@example.test');h.next.setup('member@example.test');const trip=h.next.checkout('member@example.test');
  const response=await h.request(second+'/api/action',{action:'admin_checkin',request_id:crypto.randomUUID(),data:{record_id:trip.record_id,reason:'Return verified'}});assert.equal(response.status,200);
  assert.equal(h.next.db.one('SELECT status FROM checkouts WHERE id=?',trip.record_id).status,'ADMIN_CLOSED');
  const audit=h.next.db.one("SELECT * FROM audit WHERE action='ADMIN_CHECKED_IN'");assert.equal(audit.actor_id,state.user.id);
  assert.equal(JSON.stringify(h.old.db.rows('SELECT * FROM users')),legacy);
  assert.equal(h.next.db.one("SELECT COUNT(*) n FROM audit WHERE subject_id=? AND action='STAFF_APPROVED'",state.user.id).n,1);
});
test('27-01 endpoints reject scoped staff regardless of forged headers, query or a preexisting admin row',async()=>{
  const h=harness();h.old.db.provisionStaff([scoped]);
  h.old.invite('legacy-member@example.test');h.old.setup('legacy-member@example.test');const trip=h.old.checkout('legacy-member@example.test');
  const before=JSON.stringify(['users','checkouts','audit'].map(table=>h.old.db.rows('SELECT * FROM '+table)));
  const forged={'X-Tether-Class':'27-02','X-Tether-Mode':'staff','X-Verified-Email':'staff@example.test'};
  for(const prefix of ['/staff','/staff/class/27-01']){
    assert.equal((await h.request(prefix+'/api/state?class=27-02',undefined,scoped,forged)).status,403);
    for(const route of ['/api/admin/users','/api/admin/history','/api/admin/audit','/api/device-code'])assert.equal((await h.request(prefix+route,{},scoped,forged)).status,403);
    assert.equal((await h.request(prefix+'/api/action',{action:'admin_checkin',request_id:crypto.randomUUID(),data:{record_id:trip.record_id,reason:'Wrong class'}},scoped,forged)).status,403);
  }
  assert.equal(JSON.stringify(['users','checkouts','audit'].map(table=>h.old.db.rows('SELECT * FROM '+table))),before);
});
test('internal service rechecks class scope; default staff page redirects scoped staff without querying legacy records',async()=>{
  const h=harness();
  const r=await h.request('/staff');assert.equal(r.status,303);assert.equal(r.headers.get('Location'),second);
  const internal=await databaseRequest(h.old.db,new Request('https://internal/api/admin/users',{method:'POST',headers:{'X-Tether-Mode':'staff','X-Tether-Class':'27-01','X-Verified-Email':scoped},body:JSON.stringify({method:'POST',body:{}})}),h.env);
  assert.equal(internal.status,403);assert.equal(h.old.db.one('SELECT id FROM users WHERE email=?',scoped),undefined);
  for(const path of ['/staff','/staff/api/state',second,second+'/api/state'])assert.equal((await h.request(path,undefined,'outsider@example.test')).status,403);
  for(const prefix of ['/staff',second])assert.equal((await h.request(prefix+'/api/state',undefined,'other-staff@example.test')).status,200);
});
test('disabled or removed scoped staff is denied and never automatically re-enabled',async()=>{
  const h=harness(),user=(await (await h.request(second+'/api/state')).json()).user;
  h.next.db.sql.exec('UPDATE users SET enabled=0 WHERE id=?',user.id);
  assert.equal((await h.request(second+'/api/state')).status,403);assert.equal(h.next.db.one('SELECT enabled FROM users WHERE id=?',user.id).enabled,0);
  h.next.db.sql.exec('UPDATE users SET enabled=1 WHERE id=?',user.id);h.env.STAFF_EMAILS_27_02='';
  assert.equal((await h.request(second+'/api/state')).status,403);
  assert.equal((await h.request('/staff/api/state')).status,403);
  assert.equal((await h.request(second+'/api/state',undefined,'staff@example.test')).status,200);
});
test('scoped staff JWT never grants member-route admin access and invalid JWTs are rejected',async()=>{
  const h=harness();
  for(const route of ['/api/state','/class/27-02/api/state','/class/27-02/api/admin/users'])assert.equal((await h.request(route,route.endsWith('users')?{}:undefined)).status,401);
  assert.equal((await h.request(second+'/api/state',undefined,scoped,{'Cf-Access-Jwt-Assertion':'forged'})).status,401);
});
