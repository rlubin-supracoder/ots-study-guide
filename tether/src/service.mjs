import { AppError,admin,profile,id,text } from './validation.mjs';
import { digest,randomToken,sessionCookie,matchesPassword } from './auth.mjs';
import { json,failure } from './http.mjs';
export async function databaseRequest(db,request,env={}) {
  try {
    const path=new URL(request.url).pathname;
    const {method,body}=await request.json();
    const staff=request.headers.get('X-Tether-Mode')==='staff';
    const gateHash=request.headers.get('X-Member-gate'),deviceHash=request.headers.get('X-Member-device');
    const passwordVersion=env.MEMBER_PASSWORD?await digest(env.MEMBER_PASSWORD):null;
    const responseWithCookie=(value,kind,token,maxAge)=>{const response=json(value);response.headers.append('Set-Cookie',sessionCookie(kind,token,maxAge));return response;};
    if(!staff&&path==='/api/unlock'&&method==='POST') {
      db.loginLimit(request.headers.get('X-Client-Hash')||'unknown');
      if(!env.MEMBER_PASSWORD)throw new AppError('Member sign-in is temporarily unavailable.',503);
      if(!await matchesPassword(body.password,env.MEMBER_PASSWORD))throw new AppError('Incorrect campus password.',401);
      const token=randomToken();db.createSession('gate',await digest(token),null,passwordVersion);
      return responseWithCookie({ok:true},'gate',token,86400);
    }
    if(!staff&&path==='/api/logout'&&method==='POST') {
      if(gateHash)db.sql.exec('DELETE FROM sessions WHERE token_hash=?',gateHash);
      const response=responseWithCookie({ok:true},'gate','',0);
      if(body.forget_device===true){if(deviceHash)db.sql.exec('DELETE FROM sessions WHERE token_hash=?',deviceHash);response.headers.append('Set-Cookie',sessionCookie('device','',0));}
      return response;
    }
    if(!staff&&path==='/entry') {
      try{db.gate(gateHash,passwordVersion);}catch{return json({mode:'login'});}
      const device=db.session(deviceHash,'device');
      if(!device)return json({mode:'setup'});
      db.authorize({userId:device.user_id});return json({mode:'member'});
    }
    if(!staff&&['/api/join','/api/connect'].includes(path)&&method==='POST') {
      db.gate(gateHash,passwordVersion);db.loginLimit(request.headers.get('X-Client-Hash')||'unknown');
      if(db.session(deviceHash,'device'))throw new AppError('This device already has a profile. Refresh to continue.',409);
      const token=randomToken(),hash=await digest(token);
      if(path==='/api/join')db.join(gateHash,hash,passwordVersion,body,await digest(JSON.stringify(profile(body))));
      else {
        const code=typeof body.code==='string'?body.code.replace(/[ -]/g,'').toLowerCase():'';
        if(!/^[a-f0-9]{32}$/.test(code))throw new AppError('Enter a valid connection code.');
        db.connect(gateHash,hash,passwordVersion,await digest(code));
      }
      return responseWithCookie({ok:true},'device',token,365*86400);
    }
    let actor;
    if(staff){
      actor=request.headers.get('X-Verified-Email');
      if(!env.BOOTSTRAP_ADMIN_EMAIL||actor!==env.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase())throw new AppError('Staff access denied.',403);
    }else actor=db.memberPrincipal(gateHash,deviceHash,passwordVersion);
    const user=db.authorize(actor);if(staff)admin(user);
    db.limit(user,path==='/api/action'||path==='/api/device-code');
    if (path==='/access') return json({ok:true});
    if (path==='/api/state' && method==='GET') return json(db.state(user));
    if (method!=='POST') throw new AppError('Method not allowed.',405);
    if(path==='/api/device-code') {
      const target=staff&&body.user_id?id(body.user_id):user.id;
      const code=randomToken(16);
      const reason=body.reset?text(body.reason,'Reason',240,3):null;
      const hash=await digest(code);
      const currentActor=staff?actor:db.memberPrincipal(gateHash,deviceHash,passwordVersion);
      db.issueConnection(db.authorize(currentActor),hash,target,reason);
      return json({code:code.match(/.{4}/g).join('-'),expires_in_hours:24});
    }
    if (path==='/api/action') {
      const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body)))),b=>b.toString(16).padStart(2,'0')).join('');
      const currentActor=staff?actor:db.memberPrincipal(gateHash,deviceHash,passwordVersion);
      return json(db.mutate(currentActor,body,fingerprint));
    }
    if (path==='/api/history') return json(db.history(user,body));
    if (path==='/api/admin/history') return json(db.history(user,body,true));
    if (path==='/api/admin/users') return json({users:db.users(user)});
    if (path==='/api/admin/audit') return json(db.auditHistory(user,body));
    throw new AppError('Page not found.',404);
  } catch(error) {return failure(error);}
}
