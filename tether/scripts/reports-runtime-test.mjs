// Fixed time and synthetic profiles exist only in this isolated local harness.
import {createRequire} from 'node:module';
import {readdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare');
const root=path.resolve('dist'),sql=(await readdir(root)).filter(f=>f.endsWith('.sql'));
const harness=path.join(root,'report-harness.mjs');
await writeFile(harness,`import worker,{Accountability as ProductionAccountability} from './worker.js';
export default worker;
export class Accountability extends ProductionAccountability {
  constructor(ctx,env){super(ctx,env);this.db.clock=()=> '2026-10-11T02:00:03.000Z';}
}`);
const runId=crypto.randomUUID().slice(0,8),persist=path.resolve('.wrangler','rpt-'+runId);
const port=await new Promise(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const options={name:'tether-reports-'+runId,port,compatibilityDate:'2026-09-25',modules:[{type:'ESModule',path:harness},{type:'ESModule',path:path.join(root,'worker.js')},...sql.map(file=>({type:'Text',path:path.join(root,file)}))],modulesRoot:root,durableObjects:{ACCOUNTABILITY:{className:'Accountability',useSQLite:true}},bindings:{BOOTSTRAP_ADMIN_EMAIL:'staff@example.test',MEMBER_PASSWORD:'test-password',PIN_PEPPER:'a'.repeat(64),APP_ORIGIN:'https://tether.test'},resourcePersistencePath:persist,telemetry:{enabled:false}};
const config={...convertV4MiniflareOptions(options),resourcePersistencePath:persist,unsafeDevRegistryPath:path.join(persist,'registry'),telemetry:{enabled:false}};
let mf=new Miniflare(config);
const time=new Date('2026-10-11T02:00:00.000Z');
async function stubFor(name='tether-accountability-v1'){const ns=await mf.getDurableObjectNamespace('ACCOUNTABILITY');return ns.get(ns.idFromName(name));}
async function call(path,body){const stub=await stubFor();return stub.fetch('https://internal'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Tether-Mode':'staff','X-Verified-Email':'staff@example.test'},body:JSON.stringify({method:body===undefined?'GET':'POST',body})});}
try{
  let response=await call('/api/state');const state=await response.json();
  assert.equal((await call('/api/action',{action:'profile',request_id:crypto.randomUUID(),data:{version:state.user.version,full_name:'Synthetic Example',flight_number:'001',room_number:'007',phone_number:'3345550123'}})).status,200);
  const worker=await mf.getWorker();
  assert.equal((await worker.scheduled({scheduledTime:time,cron:'*/5 2,3 * * *'})).outcome,'ok');
  let listing=await(await call('/api/admin/reports')).json();assert.equal(listing.reports.length,1);assert.equal(listing.reports[0].report_date,'2026-10-10');
  response=await call('/api/admin/reports/2026-10-10.xlsx');assert.equal(response.status,200);
  const file=new Uint8Array(await response.arrayBuffer());
  assert.ok(strFromU8(unzipSync(file)['xl/worksheets/sheet1.xml']).includes('Synthetic Example'));
  assert.equal((await worker.scheduled({scheduledTime:time,cron:'*/5 2,3 * * *'})).outcome,'ok');
  const second=await stubFor('tether-accountability-class-27-02-v1');await assert.rejects(()=>second.dailyReport(time.getTime()));
  await mf.dispose();mf=new Miniflare(config);
  response=await call('/api/admin/reports/2026-10-10.xlsx');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),file);
  listing=await(await call('/api/admin/reports')).json();assert.equal(listing.reports.length,1);
  assert.equal((await mf.dispatchFetch('https://tether.test/api/admin/reports/2026-10-10.xlsx')).status,401);
  assert.equal((await mf.dispatchFetch('https://tether.test/api/dailyReport')).status,401);
  console.log('Daily reports runtime passed: scheduled event, DO RPC, SQLite BLOB, XLSX download, duplicate delivery, restart persistence, class isolation and anonymous denial.');
}finally{await mf.dispose();}
