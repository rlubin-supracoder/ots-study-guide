import { identity,csrf,bodyOf } from './auth.mjs';
import { AppError } from './validation.mjs';
export const securityHeaders={
  'Cache-Control':'no-store, max-age=0',
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'X-Robots-Tag':'noindex, nofollow, noarchive',
  'Referrer-Policy':'no-referrer',
  'Strict-Transport-Security':'max-age=31536000',
  'Permissions-Policy':'geolocation=(), camera=(), microphone=(), browsing-topics=()',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
export function json(value,status=200) { return new Response(JSON.stringify(value),{status,headers:{...securityHeaders,'Content-Type':'application/json; charset=utf-8',...(status===429?{'Retry-After':'60'}:{})}}); }
export function failure(error) { return json({error:error instanceof AppError?error.message:'The server could not confirm this request. Refresh your status before trying again.'},error instanceof AppError?error.status:503); }
export async function serveRequest(request,env,authenticate=identity) {
  try {
    const url=new URL(request.url);
    if (url.protocol!=='https:' && env.APP_ORIGIN.startsWith('https:')) return new Response(null,{status:308,headers:{...securityHeaders,Location:env.APP_ORIGIN+url.pathname}});
    if (url.origin!==env.APP_ORIGIN) throw new AppError('Unknown application address.',404);
    if (!['GET','HEAD','POST'].includes(request.method)) throw new AppError('Method not allowed.',405);
    const actor=await authenticate(request,env);
    const stub=env.ACCOUNTABILITY.get(env.ACCOUNTABILITY.idFromName('tether-accountability-v1'));
    const isApi=url.pathname.startsWith('/api/');
    const body=request.method==='POST'?(csrf(request,env),await bodyOf(request)):null;
    const headers={'Content-Type':'application/json','X-Verified-Email':actor.email};
    const response=await stub.fetch(new Request('https://internal'+(isApi?url.pathname:'/access'),{method:'POST',headers,body:JSON.stringify({method:request.method,body})}));
    if (!response.ok || isApi) return response;
    if (request.method!=='GET' && request.method!=='HEAD') throw new AppError('Method not allowed.',405);
    const assets=new Set(['/','/index.html','/app.js','/app.css','/time.mjs','/manifest.webmanifest','/icon.svg','/icon-192.png','/icon-512.png','/apple-touch-icon.png']);
    if (!assets.has(url.pathname)) throw new AppError('Page not found.',404);
    if (url.pathname==='/') url.pathname='/index.html';
    const asset=await env.ASSETS.fetch(new Request(url,{method:request.method}));
    return new Response(asset.body,{status:asset.status,headers:{...Object.fromEntries(asset.headers),...securityHeaders}});
  } catch(error) { return failure(error); }
}
