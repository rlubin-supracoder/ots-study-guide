import {createRequire} from 'node:module';
import {readdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare');
const root=path.resolve('dist'),sql=(await readdir(root)).find(f=>f.endsWith('.sql'));
const persist=path.resolve('.wrangler','runtime-test-'+crypto.randomUUID());
const options={name:'tether-runtime-test',compatibilityDate:'2026-09-25',modules:[{type:'ESModule',path:path.join(root,'worker.js')},{type:'Text',path:path.join(root,sql)}],modulesRoot:root,durableObjects:{ACCOUNTABILITY:{className:'Accountability',useSQLite:true}},bindings:{BOOTSTRAP_ADMIN_EMAIL:'staff@example.test',APP_ORIGIN:'https://tether.test',ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',ACCESS_AUD:'test'},resourcePersistencePath:persist,telemetry:{enabled:false}};
const runtimeOptions={...convertV4MiniflareOptions(options),resourcePersistencePath:persist,telemetry:{enabled:false}};
let mf=new Miniflare(runtimeOptions);
async function client(){const ns=await mf.getDurableObjectNamespace('ACCOUNTABILITY');return ns.get(ns.idFromName('tether-accountability-v1'));}
let stub=await client();
async function call(email,path,body,method=body===undefined?'GET':'POST'){
  const response=await stub.fetch('https://internal'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Verified-Email':email},body:JSON.stringify({method,body})});
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
  console.log('Cloudflare runtime passed: migration, membership, concurrent checkout, restart persistence, check-in, history.');
}finally{await mf.dispose();}
