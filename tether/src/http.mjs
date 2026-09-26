import { identity,csrf,bodyOf,cookieToken,digest } from './auth.mjs';
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
    const staff=url.pathname==='/staff'||url.pathname.startsWith('/staff/');
    const publicAssets=new Set(['/app.js','/app.css','/entry.js','/time.mjs','/manifest.webmanifest','/icon.svg','/icon-192.png','/icon-512.png','/apple-touch-icon.png']);
    async function asset(path) {
      const assetUrl=new URL(path,env.APP_ORIGIN);
      const response=await env.ASSETS.fetch(new Request(assetUrl,{method:request.method}));
      return new Response(response.body,{status:response.status,headers:{...Object.fromEntries(response.headers),...securityHeaders}});
    }
    if(publicAssets.has(url.pathname)&&['GET','HEAD'].includes(request.method))return asset(url.pathname);
    let actor;
    if(staff) {
      actor=await authenticate(request,env);
      if(!env.BOOTSTRAP_ADMIN_EMAIL||actor.email!==env.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase())throw new AppError('This staff page is restricted to the designated administrator.',403);
    }
    const stub=env.ACCOUNTABILITY.get(env.ACCOUNTABILITY.idFromName('tether-accountability-v1'));
    const path=staff?url.pathname.slice('/staff'.length)||'/':url.pathname;
    const isApi=path.startsWith('/api/');
    const body=request.method==='POST'?(csrf(request,env),await bodyOf(request)):null;
    const headers={'Content-Type':'application/json','X-Tether-Mode':staff?'staff':'member'};
    if(actor)headers['X-Verified-Email']=actor.email;
    for(const kind of ['gate','device']){const value=cookieToken(request,`__Host-tether-${kind}`);if(value)headers[`X-Member-${kind}`]=await digest(value);}
    headers['X-Client-Hash']=await digest(request.headers.get('CF-Connecting-IP')||'unknown');
    const response=await stub.fetch(new Request('https://internal'+(isApi?path:staff?'/access':'/entry'),{method:'POST',headers,body:JSON.stringify({method:request.method,body})}));
    if(!response.ok||isApi)return response;
    if (request.method!=='GET' && request.method!=='HEAD') throw new AppError('Method not allowed.',405);
    if(!['/','/index.html'].includes(path))throw new AppError('Page not found.',404);
    if(staff)return asset('/index.html');
    const entry=await response.json();
    return asset(entry.mode==='member'?'/index.html':entry.mode==='setup'?'/setup.html':'/login.html');
  } catch(error) { return failure(error); }
}
