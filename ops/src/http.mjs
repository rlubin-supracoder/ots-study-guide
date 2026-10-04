import {createRemoteJWKSet,jwtVerify} from 'jose';
const keys=new Map();
export const protection={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Strict-Transport-Security':'max-age=31536000; includeSubDomains','Permissions-Policy':'geolocation=(), camera=(), microphone=()','Content-Security-Policy':"default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"};
export function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{...protection,'Content-Type':'application/json; charset=utf-8'}});}
export function liveReady(env){return env.LIVE_ENABLED==='true'&&!!env.ACCESS_AUD&&!!env.ALLOWED_EMAILS&&/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN||'');}
export async function authorize(request,env,keySet){
  if(!liveReady(env))return false;const token=request.headers.get('Cf-Access-Jwt-Assertion');if(!token)return false;
  try{const issuer='https://'+env.ACCESS_TEAM_DOMAIN;if(!keySet){if(!keys.has(issuer))keys.set(issuer,createRemoteJWKSet(new URL(issuer+'/cdn-cgi/access/certs')));keySet=keys.get(issuer);}const {payload}=await jwtVerify(token,keySet,{issuer,audience:env.ACCESS_AUD,algorithms:['RS256'],requiredClaims:['exp','sub','email','iat']});return typeof payload.email==='string'&&env.ALLOWED_EMAILS.split(',').map(s=>s.trim().toLowerCase()).includes(payload.email.toLowerCase());}catch{return false;}
}
const publicFiles=new Set(['/','/index.html','/app.css','/app.js','/parse-worker.js','/icon.svg']);
export async function handle(request,env,verify=authorize){
  const url=new URL(request.url),origin=new URL(env.APP_ORIGIN);if(url.hostname!==origin.hostname)return json({error:'Unknown host.'},421);
  if(url.protocol==='http:'&&origin.protocol==='https:')return new Response(null,{status:308,headers:{...protection,Location:env.APP_ORIGIN+url.pathname}});
  if(url.pathname==='/api/status'&&request.method==='GET')return json({live_configured:liveReady(env),mode:liveReady(env)?'available':'local_file'});
  if(url.pathname==='/api/summary'||url.pathname==='/api/refresh'||url.pathname==='/live'){
    if(!liveReady(env))return json({error:'Live connection is not configured. You can check a downloaded workbook in this browser.'},503);
    if(!await verify(request,env))return json({error:'Sign in through the approved Access policy.'},401);
    if(url.pathname==='/live'&&request.method==='GET'){const response=await env.ASSETS.fetch(new Request(env.APP_ORIGIN+'/index.html'));return secured(response);}
    if(url.pathname==='/live')return json({error:'Method not allowed.'},405);
    if(url.pathname==='/api/summary'&&request.method!=='GET'||url.pathname==='/api/refresh'&&request.method!=='POST')return json({error:'Method not allowed.'},405);
    if(request.method==='POST'&&(request.headers.get('Origin')!==env.APP_ORIGIN||request.headers.get('X-Sheet-Request')!=='1'))return json({error:'Request origin could not be verified.'},403);
    if(request.method==='POST'&&(Number(request.headers.get('Content-Length')||0)>0||request.body!==null))return json({error:'This endpoint does not accept uploaded data.'},400);
    const stub=env.SHEETS.get(env.SHEETS.idFromName('sheet-summary-v1'));return secured(await stub.fetch('https://internal'+url.pathname,{method:request.method}));
  }
  if(!['GET','HEAD'].includes(request.method))return json({error:'Method not allowed.'},405);
  if(!publicFiles.has(url.pathname))return json({error:'Not found.'},404);
  return secured(await env.ASSETS.fetch(new Request(env.APP_ORIGIN+(url.pathname==='/'?'/index.html':url.pathname),request)));
}
function secured(response){const result=new Response(response.body,response);for(const [k,v]of Object.entries(protection))result.headers.set(k,v);return result;}
