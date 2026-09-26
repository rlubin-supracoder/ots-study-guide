import {createRequire} from 'node:module';
import {readdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare');
const root=path.resolve('dist'),sql=(await readdir(root)).filter(f=>f.endsWith('.sql'));
const persist=path.resolve('.wrangler','runtime-test-'+crypto.randomUUID());
const options={name:'tether-runtime-test',compatibilityDate:'2026-09-25',modules:[{type:'ESModule',path:path.join(root,'worker.js')},...sql.map(file=>({type:'Text',path:path.join(root,file)}))],modulesRoot:root,durableObjects:{ACCOUNTABILITY:{className:'Accountability',useSQLite:true}},bindings:{BOOTSTRAP_ADMIN_EMAIL:'staff@example.test',MEMBER_PASSWORD:'runtime-password',APP_ORIGIN:'https://tether.test',ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',ACCESS_AUD:'test'},resourcePersistencePath:persist,telemetry:{enabled:false}};
const runtimeOptions={...convertV4MiniflareOptions(options),resourcePersistencePath:persist,telemetry:{enabled:false}};
let mf=new Miniflare(runtimeOptions);
async function client(){const ns=await mf.getDurableObjectNamespace('ACCOUNTABILITY');return ns.get(ns.idFromName('tether-accountability-v1'));}
let stub=await client();
async function call(email,path,body,method=body===undefined?'GET':'POST'){
  const response=await stub.fetch('https://internal'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Tether-Mode':'staff','X-Verified-Email':email},body:JSON.stringify({method,body})});
  return {status:response.status,data:await response.json()};
}
const action=(email,action,data,request_id=crypto.randomUUID())=>call(email,'/api/action',{action,data,request_id});
try{
  assert.equal((await mf.dispatchFetch('https://tether.test/api/state')).status,401);
  assert.equal((await call('unapproved@example.test','/api/state')).status,403);
  let state=(await call('staff@example.test','/api/state')).data;
  assert.equal(state.user.role,'admin');
  assert.equal((await action('staff@example.test','profile',{version:state.user.version,full_name:'Runtime Staff',flight_number:'27-01',room_number:'101',phone_number:'3345550123'})).status,200);
  state=(await call('staff@example.test','/api/state')).data;
  const data={destination:'Runtime test',expected_return_at:new Date(Date.now()+3600000).toISOString(),version:state.user.version};
  const results=await Promise.all(Array.from({length:20},()=>action('staff@example.test','checkout',data)));
  assert.equal(results.filter(r=>r.status===200).length,1);
  assert.equal(results.filter(r=>r.status===409).length,19);
  const active=(await call('staff@example.test','/api/state')).data.active;
  await mf.dispose();mf=new Miniflare(runtimeOptions);stub=await client();
  assert.equal((await call('staff@example.test','/api/state')).data.active.id,active.id);
  assert.equal((await action('staff@example.test','checkin',{record_id:active.id})).status,200);
  const history=await call('staff@example.test','/api/history',{});
  assert.equal(history.data.records[0].status,'COMPLETED');
  assert.equal((await call('staff@example.test','/api/state')).data.roster.length,0);
  const memberCall=(path,body,cookie='')=>mf.dispatchFetch('https://tether.test'+path,{method:body===undefined?'GET':'POST',headers:{Origin:'https://tether.test','Content-Type':'application/json','X-Tether-Request':'1',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});
  const unlocked=await memberCall('/api/unlock',{password:'runtime-password'});assert.equal(unlocked.status,200);
  const gate=unlocked.headers.get('Set-Cookie').split(';')[0];
  const joined=await memberCall('/api/join',{full_name:'Runtime Member',flight_number:'27-01',room_number:'102',phone_number:'3345550124'},gate);assert.equal(joined.status,200);
  const cookies=gate+'; '+joined.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await (await memberCall('/api/state',undefined,cookies)).json()).user.role,'member');
  assert.equal((await memberCall('/api/admin/users',{},cookies)).status,403);
  await mf.dispose();mf=new Miniflare(runtimeOptions);stub=await client();
  assert.equal((await (await memberCall('/api/state',undefined,cookies)).json()).user.full_name,'Runtime Member');
  console.log('Cloudflare runtime passed: migrations, staff authorization, concurrent checkout, restart persistence, check-in, history, password login and remembered member sessions.');
}finally{await mf.dispose();}
