import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {zipSync,strToU8} from 'fflate';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare');
const directory=path.resolve('.wrangler/runtime-harness');await mkdir(directory,{recursive:true});
const script=path.join(directory,'worker.mjs');
await build({stdin:{contents:"import app from './src/worker.mjs'; export {SheetMonitor} from './src/worker.mjs'; import {parseWorkbook} from './src/parser.mjs'; export default {async fetch(request,env){if(new URL(request.url).pathname==='/test-parser')return Response.json(parseWorkbook(new Uint8Array(await request.arrayBuffer())));return app.fetch(request,env);}};",resolveDir:process.cwd(),sourcefile:'runtime-harness.mjs'},outfile:script,bundle:true,format:'esm',external:['cloudflare:workers'],platform:'browser'});
const options=convertV4MiniflareOptions({name:'ops-runtime-test',compatibilityDate:'2026-09-25',modules:[{type:'ESModule',path:script}],modulesRoot:directory,durableObjects:{SHEETS:{className:'SheetMonitor',useSQLite:true}},bindings:{APP_ORIGIN:'https://ops.test',LIVE_ENABLED:'false'},telemetry:{enabled:false}});
const mf=new Miniflare(options);
const fixture=zipSync(Object.fromEntries(Object.entries({'xl/workbook.xml':'<workbook xmlns:r="urn:rel"><sheets><sheet name="Tasks" r:id="r1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>','xl/styles.xml':'<styleSheet><fonts><font><color rgb="FFFF0000"/></font></fonts><cellXfs><xf fontId="0"/></cellXfs></styleSheet>','xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="2"><c r="B2"><v>12</v></c></row></sheetData></worksheet>'}).map(([k,v])=>[k,strToU8(v)])));
try{
  const r=await mf.dispatchFetch('https://ops.test/test-parser',{method:'POST',body:fixture});assert.equal(r.status,200);const summary=await r.json();assert.equal(summary.flagged_cells,1);assert.equal(summary.rows[0].items[0].cell,'B2');
  assert.equal((await mf.dispatchFetch('https://ops.test/api/summary')).status,503);assert.equal((await mf.dispatchFetch('https://ops.test/api/status')).status,200);
  const ns=await mf.getDurableObjectNamespace('SHEETS'),stub=ns.get(ns.idFromName('sheet-summary-v1'));assert.equal((await stub.fetch('https://internal/api/summary')).status,503);
  for(const file of process.argv.slice(2)){const start=performance.now();const result=await mf.dispatchFetch('https://ops.test/test-parser',{method:'POST',body:await readFile(file)});assert.equal(result.status,200);const data=await result.json();assert.ok(data.scanned_cells>0);console.log(JSON.stringify({runtime_sample_ms:Math.round(performance.now()-start),scanned_cells:data.scanned_cells,flagged_cells:data.flagged_cells,coverage:data.coverage}));}
  await writeFile(path.resolve('../.local/ops-synthetic.xlsx'),fixture).catch(()=>{});
  console.log('Cloudflare runtime checks passed: ZIP/XML parsing, red detection, disabled live routes, and isolated storage.');
}finally{await mf.dispose();}
