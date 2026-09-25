import { AppError } from './validation.mjs';
import { json,failure } from './http.mjs';
export async function databaseRequest(db,request) {
  try {
    const actor=request.headers.get('X-Verified-Email');
    const path=new URL(request.url).pathname;
    const {method,body}=await request.json();
    const user=db.authorize(actor);
    db.limit(user,path==='/api/action');
    if (path==='/access') return json({ok:true});
    if (path==='/api/state' && method==='GET') return json(db.state(user));
    if (method!=='POST') throw new AppError('Method not allowed.',405);
    if (path==='/api/action') {
      const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body)))),b=>b.toString(16).padStart(2,'0')).join('');
      return json(db.mutate(actor,body,fingerprint));
    }
    if (path==='/api/history') return json(db.history(user,body));
    if (path==='/api/admin/history') return json(db.history(user,body,true));
    if (path==='/api/admin/users') return json({users:db.users(user)});
    if (path==='/api/admin/audit') return json(db.auditHistory(user,body));
    throw new AppError('Page not found.',404);
  } catch(error) {return failure(error);}
}
