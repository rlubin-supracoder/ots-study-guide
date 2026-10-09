import { AppError,admin,profile,id,text,phone } from './validation.mjs';
import { digest,randomToken,sessionCookie,matchesPassword,isStaffEmail,staffClasses } from './auth.mjs';
import {confirmedPin,pinValue,hashPin,pinFingerprint,sameHash} from './pin.mjs';
import { json,failure } from './http.mjs';
import { classFor } from './classes.mjs';
export async function databaseRequest(db,request,env={},liveConnect) {
  try {
    const path=new URL(request.url).pathname;
    const {method,body}=request.headers.get('Upgrade')?.toLowerCase()==='websocket'?{method:'GET',body:null}:await request.json();
    const classroom=classFor(request.headers.get('X-Tether-Class')||'27-01');
    const password=env[classroom.passwordKey],scaled=classroom.id==='27-02';
    const staff=request.headers.get('X-Tether-Mode')==='staff';
    const gateHash=request.headers.get('X-Member-gate'),deviceHash=request.headers.get('X-Member-device');
    const passwordVersion=password?await digest(password):null;
    const responseWithCookie=(value,kind,token,maxAge)=>{const response=json(value);response.headers.append('Set-Cookie',sessionCookie(kind,token,maxAge,classroom.cookieSuffix));return response;};
    if(!staff&&path==='/api/unlock'&&method==='POST') {
      const valid=await matchesPassword(body.password,password);
      db.loginLimit(request.headers.get('X-Client-Hash')||'unknown',scaled&&valid);
      if(!password)throw new AppError('Member sign-in is temporarily unavailable.',503);
      if(!valid)throw new AppError('Incorrect campus password.',401);
      const token=randomToken();db.createSession('gate',await digest(token),null,passwordVersion);
      return responseWithCookie({ok:true,class_id:classroom.id,redirect:classroom.prefix+'/'},'gate',token,86400);
    }
    if(!staff&&path==='/api/logout'&&method==='POST') {
      if(gateHash)db.sql.exec('DELETE FROM sessions WHERE token_hash=?',gateHash);
      const response=responseWithCookie({ok:true},'gate','',0);
      if(body.forget_device===true){if(deviceHash)db.sql.exec('DELETE FROM sessions WHERE token_hash=?',deviceHash);response.headers.append('Set-Cookie',sessionCookie('device','',0,classroom.cookieSuffix));}
      return response;
    }
    if(!staff&&path==='/entry') {
      try{db.gate(gateHash,passwordVersion);}catch{return json({mode:'login'});}
      const device=db.session(deviceHash,'device');
      if(!device)return json({mode:'setup'});
      db.authorize({userId:device.user_id});return json({mode:'member'});
    }
    if(!staff&&['/api/join','/api/connect','/api/connect-pin'].includes(path)&&method==='POST') {
      db.gate(gateHash,passwordVersion);db.loginLimit(request.headers.get('X-Client-Hash')||'unknown',scaled);
      if(db.session(deviceHash,'device'))throw new AppError('This device already has a profile. Refresh to continue.',409);
      const token=randomToken(),hash=await digest(token);
      if(path==='/api/join') {
        const value=confirmedPin(body),details=profile(body),credentials=await hashPin(value,env.PIN_PEPPER);
        const joinHash=await pinFingerprint('tether-profile-registration:'+JSON.stringify([details,value]),env.PIN_PEPPER);
        db.join(gateHash,hash,passwordVersion,body,joinHash,credentials);
      } else if(path==='/api/connect-pin') {
        const value=pinValue(body.pin),fullName=text(body.full_name,'Full name',100,2),phoneNumber=phone(body.phone_number);
        await pinFingerprint('tether-profile-pin-readiness',env.PIN_PEPPER);
        const attempt=db.reservePinAttempt(fullName,phoneNumber);
        const credentials=await hashPin(value,env.PIN_PEPPER,attempt?.salt||'0'.repeat(32));
        if(!sameHash(credentials.hash,attempt?.hash||'0'.repeat(64)))throw new AppError('Those details could not be verified. Check them or use a connection code. PIN recovery locks after five unsuccessful attempts; set a new PIN from a connected device to unlock it.',401);
        db.connectPin(gateHash,hash,passwordVersion,attempt,fullName,phoneNumber);
      } else {
        const code=typeof body.code==='string'?body.code.replace(/[ -]/g,'').toLowerCase():'';
        if(!/^[a-f0-9]{32}$/.test(code))throw new AppError('Enter a valid connection code.');
        db.connect(gateHash,hash,passwordVersion,await digest(code));
      }
      return responseWithCookie({ok:true},'device',token,365*86400);
    }
    let actor;
    if(staff){
      actor=request.headers.get('X-Verified-Email');
      if(!actor||!isStaffEmail(actor,env,classroom.id))throw new AppError('Staff access denied.',403);
      // Provision class-specific staff only after verifying that class's allowlist.
      db.provisionStaff([actor]);
    }else actor=db.memberPrincipal(gateHash,deviceHash,passwordVersion);
    const user=db.authorize(actor);if(staff)admin(user);
    db.limit(user,['/api/action','/api/device-code','/api/profile-pin'].includes(path),scaled);
    if(path==='/api/live'&&method==='GET'&&!staff&&scaled&&liveConnect)return liveConnect({userId:user.id,gateHash,deviceHash,passwordVersion});
    if (path==='/access') return json({ok:true});
    if (path==='/api/state' && method==='GET') return json({...db.state(user,scaled),class_id:classroom.id,...(staff?{staff_classes:staffClasses(actor,env)}:{})});
    if (method!=='POST') throw new AppError('Method not allowed.',405);
    if(path==='/api/profile-pin') {
      const value=confirmedPin(body),existing=db.pinRecord(user.id);
      if(existing&&body.replace!==true)throw new AppError('A PIN is already set. Refresh and use Change PIN in Profile.',409);
      const credentials=await hashPin(value,env.PIN_PEPPER);
      const currentActor=staff?actor:db.memberPrincipal(gateHash,deviceHash,passwordVersion);
      return json(db.savePin(currentActor,credentials,existing?.revision||0));
    }
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
