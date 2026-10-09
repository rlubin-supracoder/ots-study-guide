// Synthetic accounts in an isolated local Cloudflare runtime only. Never target production.
import {createRequire} from 'node:module';
import {readdir,mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare');
const root=path.resolve('dist'),sql=(await readdir(root)).filter(f=>f.endsWith('.sql'));
const runId=crypto.randomUUID().slice(0,8),persist=path.resolve('.wrangler','capacity-'+runId);
const port=await new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const options={name:'tether-classes-'+runId,port,compatibilityDate:'2026-09-25',modules:[{type:'ESModule',path:path.join(root,'worker.js')},...sql.map(file=>({type:'Text',path:path.join(root,file)}))],modulesRoot:root,durableObjects:{ACCOUNTABILITY:{className:'Accountability',useSQLite:true}},bindings:{BOOTSTRAP_ADMIN_EMAIL:'staff@example.test',MEMBER_PASSWORD:'legacy-test-password',MEMBER_PASSWORD_27_02:'new-test-password',PIN_PEPPER:'a'.repeat(64),APP_ORIGIN:'https://tether.test'},resourcePersistencePath:persist,telemetry:{enabled:false}};
const config={...convertV4MiniflareOptions(options),resourcePersistencePath:persist,unsafeDevRegistryPath:path.join(persist,'registry'),telemetry:{enabled:false}};
let mf;
async function start(){mf=new Miniflare(config);assert.equal(new URL(await mf.ready).port,String(port));}
const latency=[],sockets=[];
const second='/class/27-02';
async function call(prefix,route,body,cookies='',extra={}){
  const start=performance.now();
  const response=await mf.dispatchFetch('https://tether.test'+prefix+route,{method:body===undefined?'GET':'POST',headers:{Origin:'https://tether.test','Content-Type':'application/json','X-Tether-Request':'1',Cookie:cookies,...extra},body:body===undefined?undefined:JSON.stringify(body)});
  if(response.status===101)return response;
  const data=await response.json();latency.push(performance.now()-start);
  return {status:response.status,data,cookie:response.headers.get('Set-Cookie')?.split(';')[0]};
}
async function register(prefix,i){
  const gate=await call(prefix,'/api/unlock',{password:prefix?'new-test-password':'legacy-test-password'});assert.equal(gate.status,200);
  const profile={full_name:'Synthetic Member '+i,flight_number:'Test Flight',room_number:String(100+i),phone_number:'3345550123',pin:'0123',pin_confirmation:'0123'};
  const joined=await call(prefix,'/api/join',profile,gate.cookie);assert.equal(joined.status,200,joined.data.error);
  const cookies=gate.cookie+'; '+joined.cookie;const state=await call(prefix,'/api/state',undefined,cookies);assert.equal(state.status,200);
  return {cookies,user:state.data.user};
}
async function pool(items,fn,concurrency=20){const results=[];let next=0;await Promise.all(Array.from({length:concurrency},async()=>{while(next<items.length){const i=next++;results[i]=await fn(items[i],i);}}));return results;}
const action=(prefix,user,name,data,request_id=crypto.randomUUID())=>call(prefix,'/api/action',{action:name,data,request_id},user.cookies);
const expected_return_at=new Date(Date.now()+3600000).toISOString();
function waitFor(check,timeout=15000){return new Promise((resolve,reject)=>{const started=Date.now(),timer=setInterval(()=>{if(check()){clearInterval(timer);resolve();}else if(Date.now()-started>timeout){clearInterval(timer);reject(new Error('Live update deadline exceeded'));}},50);});}
try{
  await start();
  const legacy=await register('',999),legacyTrip=await action('',legacy,'checkout',{version:legacy.user.version,destination:'Legacy test trip',expected_return_at});assert.equal(legacyTrip.status,200);
  const legacyBefore=(await call('','/api/state',undefined,legacy.cookies)).data;
  const members=await pool(Array.from({length:200},(_,i)=>i),i=>register(second,i));
  console.log('Registered 200 separate new-class members from one shared network.');
  await pool(members,async member=>{
    const response=await call(second,'/api/live',undefined,member.cookies,{Upgrade:'websocket'});assert.equal(response.status,101);
    const socket=response.webSocket;socket.accept();const item={socket,updates:0};socket.addEventListener('message',event=>{assert.equal(event.data,'refresh');item.updates++;});sockets.push(item);
  });
  assert.equal(sockets.length,200);
  const checkouts=await pool(members,member=>action(second,member,'checkout',{version:member.user.version,destination:'Synthetic destination',expected_return_at}));
  checkouts.forEach(result=>assert.equal(result.status,200,result.data.error));
  await waitFor(()=>sockets.every(s=>s.updates>0));
  const states=await Promise.all(members.map(member=>call(second,'/api/state',undefined,member.cookies)));
  states.forEach(result=>{assert.equal(result.status,200);assert.equal(result.data.roster.length,200);assert.equal(result.data.class_id,'27-02');assert.ok(result.data.roster.every(r=>r.phone_number===undefined));});
  const duplicate=await action(second,members[0],'checkout',{version:states[0].data.user.version,destination:'Duplicate',expected_return_at});assert.equal(duplicate.status,409);
  const record_ids=states.map(state=>state.data.active.id);
  const checkins=await pool(members,(member,i)=>action(second,member,'checkin',{record_id:record_ids[i]}));checkins.forEach(r=>assert.equal(r.status,200));
  const after=await call(second,'/api/state',undefined,members[0].cookies);assert.equal(after.data.roster.length,0);
  assert.equal((await call(second,'/api/history',{},members[0].cookies)).data.records.length,1);
  // A class-27-02 cookie must never authorize a legacy API, including direct cookie renaming.
  assert.equal((await call('','/api/state',undefined,members[0].cookies)).status,401);
  assert.equal((await call('','/api/state',undefined,members[0].cookies.replaceAll('-27-02=','='))).status,401);
  const legacyAfter=(await call('','/api/state',undefined,legacy.cookies)).data;
  assert.deepEqual(legacyAfter.user,legacyBefore.user);assert.deepEqual(legacyAfter.active,legacyBefore.active);assert.deepEqual(legacyAfter.roster,legacyBefore.roster);
  console.log('200 live connections received updates; 200 concurrent roster reads and all checkout/check-in records verified. Legacy profile and active checkout unchanged.');
  for(const {socket}of sockets)socket.close(1000);
  await mf.dispose();await start();
  assert.equal((await call('','/api/state',undefined,legacy.cookies)).data.active.id,legacyTrip.data.record_id);
  const persisted=await pool(members,member=>call(second,'/api/state',undefined,member.cookies));persisted.forEach(r=>{assert.equal(r.status,200);assert.equal(r.data.active,null);});
  const gate=await call(second,'/api/unlock',{password:'new-test-password'});
  const pin=await call(second,'/api/connect-pin',{full_name:'Synthetic Member 0',phone_number:'3345550123',pin:'0123'},gate.cookie);assert.equal(pin.status,200);
  assert.equal((await call(second,'/api/state',undefined,gate.cookie+'; '+pin.cookie)).data.user.id,members[0].user.id);
  const ordered=latency.sort((a,b)=>a-b),report={users:200,live_connections:200,requests:ordered.length,p50_ms:Math.round(ordered[Math.floor(ordered.length*.5)]),p95_ms:Math.round(ordered[Math.floor(ordered.length*.95)]),max_ms:Math.round(ordered.at(-1)),class_isolation:true,legacy_preserved:true,restart_and_pin_recovery:true,environment:'local Cloudflare workerd; synthetic data; concurrency 20 actions and 200 roster reads'};
  await mkdir(path.resolve('../.local/tether-classes'),{recursive:true});await writeFile(path.resolve('../.local/tether-classes/capacity-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{for(const {socket}of sockets){try{socket.close(1000);}catch{}}await mf?.dispose();}
