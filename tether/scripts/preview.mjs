// Local-only UI harness. Synthetic identities are outside the Worker entry point and public assets.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fixture} from '../test/helpers.mjs';
import {serveRequest} from '../src/http.mjs';
import {databaseRequest} from '../src/service.mjs';
const f=fixture();f.setTime(new Date().toISOString());f.setup('staff@example.test','Preview Staff');
for(const [email,name] of [['member@example.test','Preview Member'],['overdue@example.test','Preview Overdue']]){f.invite(email);f.setup(email,name);}
f.setTime(new Date(Date.now()-3*3600000).toISOString());f.send('overdue@example.test','checkout',{destination:'Preview destination',expected_return_at:new Date(Date.now()-3600000).toISOString(),version:f.db.authorize('overdue@example.test').version});
f.db.clock=()=>new Date().toISOString();
const origin='http://127.0.0.1:8791';
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const env={APP_ORIGIN:origin,ACCOUNTABILITY:{idFromName:x=>x,get:()=>({fetch:r=>databaseRequest(f.db,r)})},ASSETS:{fetch:async request=>{const path=new URL(request.url).pathname;try{return new Response(await readFile(new URL('../public'+path,import.meta.url)),{headers:{'Content-Type':mime[path.slice(path.lastIndexOf('.'))]||'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}}}};
createServer(async(req,res)=>{
  try{
    if(req.url==='/preview/member'||req.url==='/preview/staff'){res.writeHead(303,{'Set-Cookie':`preview-role=${req.url.endsWith('member')?'member':'staff'}; Path=/; HttpOnly; SameSite=Strict`,Location:'/'});return res.end();}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const request=new Request(origin+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
    const response=await serveRequest(request,env,async()=>({email:req.headers.cookie?.includes('preview-role=member')?'member@example.test':'staff@example.test'}));
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Preview failure');}
}).listen(8791,'127.0.0.1',()=>console.log('Local synthetic preview: '+origin));
