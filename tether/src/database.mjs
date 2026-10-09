import { AppError, text, email, profile, complete, instant, expected, id, version, admin } from './validation.mjs';

const rosterFields = 'id,user_id,full_name,flight_number,room_number,destination,checked_out_at,expected_return_at,checked_in_at,status,version';
export class Database {
  constructor(storage, migrations, bootstrapEmail, clock = () => new Date().toISOString()) {
    this.storage = storage; this.sql = storage.sql; this.clock = clock;
    storage.transactionSync(() => {
      this.sql.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
      for (const migration of migrations) if (!this.one('SELECT version FROM schema_migrations WHERE version=?', migration.version)) {
        this.sql.exec(migration.sql);
        this.sql.exec('INSERT INTO schema_migrations VALUES (?,?)', migration.version, this.clock());
      }
      if (!this.one("SELECT value FROM metadata WHERE key='bootstrapped'") && bootstrapEmail) {
        const now = this.clock(), userId = crypto.randomUUID();
        this.sql.exec("INSERT INTO users(id,email,role,created_at,updated_at) VALUES (?,?,'admin',?,?)", userId, email(bootstrapEmail), now, now);
        this.audit(null, userId, null, 'ADMIN_BOOTSTRAPPED', {}, now);
        this.sql.exec("INSERT INTO metadata VALUES ('bootstrapped','1')");
      }
    });
  }
  rows(query, ...params) { return Array.from(this.sql.exec(query, ...params)); }
  one(query, ...params) { return this.rows(query, ...params)[0]; }
  provisionStaff(addresses) {
    const approved=[...new Set(addresses.map(email))];
    this.storage.transactionSync(()=>{
      for(const address of approved) {
        const key='staff-provisioned:'+address;
        if(this.one('SELECT value FROM metadata WHERE key=?',key))continue;
        const existing=this.one('SELECT * FROM users WHERE email=? COLLATE NOCASE',address);
        const userId=existing?.id||crypto.randomUUID(),now=this.clock();
        if(!existing)this.sql.exec("INSERT INTO users(id,email,role,created_at,updated_at) VALUES (?,?,'admin',?,?)",userId,address,now,now);
        else if(existing.role!=='admin')this.sql.exec("UPDATE users SET role='admin',version=version+1,updated_at=? WHERE id=?",now,userId);
        this.audit(null,userId,null,'STAFF_APPROVED',{source:'deployment configuration',previous_role:existing?.role||null},now);
        this.sql.exec('INSERT INTO metadata VALUES (?,?)',key,'1');
      }
    });
  }
  authorize(identity) {
    const member=typeof identity==='object'&&identity!==null;
    const user = member?this.one('SELECT * FROM users WHERE id=?',id(identity.userId)):this.one('SELECT * FROM users WHERE email=? COLLATE NOCASE', email(identity));
    if (!user?.enabled) throw new AppError('Your account has not been approved or has been disabled. Contact your Tether administrator.', 403);
    return member?{...user,role:'member'}:user;
  }
  pinRecord(userId) {return this.one('SELECT * FROM profile_pins WHERE user_id=?',userId);}
  savePin(identity,credentials,expectedRevision=0) {
    return this.storage.transactionSync(()=>{
      const user=this.authorize(identity),existing=this.pinRecord(user.id),now=this.clock();
      if((existing?.revision||0)!==expectedRevision)throw new AppError('Your PIN changed on another device. Refresh and try again.',409);
      if(!/^[a-f0-9]{32}$/.test(credentials.salt)||!/^[a-f0-9]{64}$/.test(credentials.hash))throw new AppError('Invalid PIN configuration.',503);
      this.sql.exec('INSERT INTO profile_pins(user_id,salt,hash,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET salt=excluded.salt,hash=excluded.hash,revision=profile_pins.revision+1,failed_attempts=0,updated_at=excluded.updated_at',user.id,credentials.salt,credentials.hash,now,now);
      this.audit(user.id,user.id,null,existing?'PROFILE_PIN_CHANGED':'PROFILE_PIN_CREATED',{},now);
      return {ok:true};
    });
  }
  pinMember(fullName,phoneNumber) {
    const matches=this.rows('SELECT * FROM users WHERE enabled=1 AND phone_number=?',phoneNumber).filter(user=>user.full_name?.toLowerCase()===fullName.toLowerCase());
    return matches.length===1?matches[0]:null;
  }
  reservePinAttempt(fullName,phoneNumber) {
    return this.storage.transactionSync(()=>{
      const user=this.pinMember(fullName,phoneNumber),pin=user&&this.pinRecord(user.id);
      if(!pin||pin.failed_attempts>=5)return null;
      this.sql.exec('UPDATE profile_pins SET failed_attempts=failed_attempts+1 WHERE user_id=?',user.id);
      return pin;
    });
  }
  connectPin(gateHash,deviceHash,passwordVersion,attempt,fullName,phoneNumber) {
    return this.storage.transactionSync(()=>{
      this.gate(gateHash,passwordVersion);
      const user=this.pinMember(fullName,phoneNumber),current=user&&this.pinRecord(user.id);
      if(!attempt||!current||attempt.user_id!==user.id||current.revision!==attempt.revision||current.hash!==attempt.hash||current.salt!==attempt.salt)throw new AppError('Those details could not be verified. Use a connection code or try your current details.',401);
      this.createSession('device',deviceHash,user.id);
      this.sql.exec('UPDATE profile_pins SET failed_attempts=0 WHERE user_id=?',user.id);
      this.sql.exec('UPDATE sessions SET user_id=?,join_hash=NULL WHERE token_hash=?',user.id,gateHash);
      this.audit(user.id,user.id,null,'PROFILE_PIN_RECONNECTED',{},this.clock());
      return {ok:true};
    });
  }
  loginLimit(client, authenticatedSetup=false) {
    const window=Math.floor(Date.parse(this.clock())/900000);
    const lane=authenticatedSetup?'setup':'login';
    for(const [key,max]of [[`${lane}:${client}`,authenticatedSetup?600:60],[`${lane}:global`,1500]]) {
      const row=this.one('SELECT * FROM limits WHERE key=?',key),count=row?.window===window?row.count+1:1;
      if(count>max)throw new AppError('Too many sign-in attempts. Wait 15 minutes and try again.',429);
      this.sql.exec('INSERT INTO limits VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=excluded.count',key,window,count);
    }
    this.sql.exec("DELETE FROM limits WHERE (key LIKE 'login:%' OR key LIKE 'setup:%') AND window < ?",window-1);
  }
  session(hash,kind) {return hash?this.one('SELECT * FROM sessions WHERE token_hash=? AND kind=? AND expires_at>?',hash,kind,this.clock()):null;}
  gate(hash,passwordVersion) {
    const gate=this.session(hash,'gate');
    if(!gate||!passwordVersion||gate.password_version!==passwordVersion)throw new AppError('Enter the campus password to continue.',401);
    return gate;
  }
  memberPrincipal(gateHash,deviceHash,passwordVersion) {
    this.gate(gateHash,passwordVersion);
    const device=this.session(deviceHash,'device');
    if(!device)throw new AppError('Set up your profile or connect your existing device.',401);
    const principal={userId:device.user_id};this.authorize(principal);return principal;
  }
  createSession(kind,hash,userId=null,passwordVersion=null) {
    const now=this.clock(),duration=kind==='device'?365*86400000:86400000;
    this.sql.exec('INSERT INTO sessions(token_hash,kind,user_id,password_version,created_at,expires_at) VALUES (?,?,?,?,?,?)',hash,kind,userId,passwordVersion,now,new Date(Date.parse(now)+duration).toISOString());
    this.sql.exec('DELETE FROM sessions WHERE expires_at <= ?',now);
  }
  join(gateHash,deviceHash,passwordVersion,data,joinHash,pinCredentials) {
    return this.storage.transactionSync(()=>{
      const gate=this.gate(gateHash,passwordVersion),next=profile(data),now=this.clock();let userId=gate.user_id;
      if(userId) {
        if(gate.join_hash!==joinHash)throw new AppError('This setup already completed. Re-enter the original details or connect your existing profile.',409);
        this.authorize({userId});
      } else {
        if(this.one('SELECT id FROM users WHERE lower(full_name)=lower(?) AND lower(flight_number)=lower(?) AND lower(room_number)=lower(?)',next.full_name,next.flight_number,next.room_number))throw new AppError('A profile already uses these details. Use a connection code from your other device or contact staff.',409);
        if(this.one('SELECT COUNT(*) n FROM users').n>=1000)throw new AppError('The member limit has been reached. Contact staff.',409);
        userId=crypto.randomUUID();
        this.sql.exec("INSERT INTO users(id,email,full_name,flight_number,room_number,phone_number,account_type,created_at,updated_at) VALUES (?,?,?,?,?,?,'device',?,?)",userId,`${userId}@members.tether.invalid`,next.full_name,next.flight_number,next.room_number,next.phone_number,now,now);
        if(!pinCredentials||!/^[a-f0-9]{32}$/.test(pinCredentials.salt)||!/^[a-f0-9]{64}$/.test(pinCredentials.hash))throw new AppError('Create a four-digit profile PIN.');
        this.sql.exec('INSERT INTO profile_pins(user_id,salt,hash,created_at,updated_at) VALUES (?,?,?,?,?)',userId,pinCredentials.salt,pinCredentials.hash,now,now);
        this.sql.exec('UPDATE sessions SET user_id=?,join_hash=? WHERE token_hash=?',userId,joinHash,gateHash);
        this.audit(userId,userId,null,'MEMBER_REGISTERED',{},now);
        this.audit(userId,userId,null,'PROFILE_PIN_CREATED',{},now);
      }
      this.createSession('device',deviceHash,userId);
      return {ok:true};
    });
  }
  issueConnection(user,hash,targetId=user.id,reason=null) {
    return this.storage.transactionSync(()=>{
      if(targetId!==user.id)admin(user);
      const target=this.authorize({userId:targetId}),now=this.clock();
      if(reason) {
        admin(user);reason=text(reason,'Reason',240,3);
        this.sql.exec("DELETE FROM sessions WHERE user_id=? AND kind IN ('device','connect','gate')",target.id);
        this.sql.exec('DELETE FROM profile_pins WHERE user_id=?',target.id);
      } else this.sql.exec("DELETE FROM sessions WHERE user_id=? AND kind='connect'",target.id);
      this.createSession('connect',hash,target.id);
      this.audit(user.id,target.id,null,reason?'MEMBER_ACCESS_RESET':'DEVICE_CODE_CREATED',reason?{reason}:{},now);
    });
  }
  connect(gateHash,deviceHash,passwordVersion,codeHash) {
    return this.storage.transactionSync(()=>{
      const gate=this.gate(gateHash,passwordVersion);
      const code=this.session(codeHash,'connect');
      // A lost response may be retried from the same authenticated browser gate.
      const userId=code?.user_id||(gate.join_hash===codeHash?gate.user_id:null);
      if(!userId)throw new AppError('That connection code is invalid, expired or already used.',401);
      this.authorize({userId});this.createSession('device',deviceHash,userId);
      if(code){this.sql.exec('DELETE FROM sessions WHERE token_hash=?',codeHash);this.sql.exec('UPDATE sessions SET user_id=?,join_hash=? WHERE token_hash=?',userId,codeHash,gateHash);this.audit(userId,userId,null,'DEVICE_CONNECTED',{},this.clock());}
      return {ok:true};
    });
  }
  audit(actor, subject, record, action, detail, at) {
    this.sql.exec('INSERT INTO audit(actor_id,subject_id,record_id,action,at,detail) VALUES (?,?,?,?,?,?)', actor, subject, record, action, at, JSON.stringify(detail));
  }
  limit(user, write = false, scaled = false) {
    const window = Math.floor(Date.parse(this.clock()) / 60000), key = `${user.id}:${write ? 'write' : 'read'}`;
    if(scaled&&!write){
      if(this.readWindow!==window){this.readWindow=window;this.readLimits=new Map();}
      const count=(this.readLimits.get(key)||0)+1;this.readLimits.set(key,count);
      if(count>180)throw new AppError('Too many requests. Please wait a minute and try again.',429);
      return;
    }
    const row = this.one('SELECT * FROM limits WHERE key=?', key);
    const count = row?.window === window ? row.count + 1 : 1;
    if (count > (write ? 30 : 180)) throw new AppError('Too many requests. Please wait a minute and try again.', 429);
    this.sql.exec('INSERT INTO limits VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=excluded.count', key, window, count);
  }
  clearRosterCache(){this.rosterCache=null;}
  state(user,scaled=false) {
    const now = this.clock();
    const active = this.one('SELECT * FROM checkouts WHERE user_id=? AND status=?', user.id, 'ACTIVE') || null;
    const fields = rosterFields + (user.role === 'admin' ? ',phone_number' : '');
    const cache=scaled&&this.rosterCache?.[user.role];
    const roster=cache&&cache.expires>Date.parse(now)?cache.rows:this.rows(`SELECT ${fields} FROM checkouts WHERE status='ACTIVE' ORDER BY expected_return_at,checked_out_at`);
    if(scaled){this.rosterCache??={};this.rosterCache[user.role]={rows:roster,expires:cache&&cache.rows===roster?cache.expires:Date.parse(now)+5000};}
    const pin=this.pinRecord(user.id);
    const result={user:{...user,email:user.account_type==='device'?null:user.email,has_pin:!!pin,pin_locked:!!pin&&pin.failed_attempts>=5},active,profile_complete:complete(user),roster,server_time:now};
    if(user.role==='admin') {
      const ready=this.one('SELECT COUNT(*) AS n FROM users WHERE enabled=1 AND full_name IS NOT NULL').n;
      result.counts={on_campus:ready-roster.length,off_campus:roster.length,overdue:roster.filter(r=>r.expected_return_at<now).length,pending:this.one('SELECT COUNT(*) AS n FROM users WHERE enabled=1 AND full_name IS NULL').n};
    }
    return result;
  }
  history(user, body = {}, staff = false) {
    if (staff) admin(user);
    const conditions = [], params = [];
    if (!staff) { conditions.push('c.user_id=?'); params.push(user.id); }
    if (staff && body.user_id) { conditions.push('c.user_id=?'); params.push(id(body.user_id)); }
    if (body.flight) { conditions.push('c.flight_number=?'); params.push(text(body.flight, 'Flight', 20)); }
    if (body.status) {
      if (!['ACTIVE','COMPLETED','ADMIN_CLOSED','OVERDUE'].includes(body.status)) throw new AppError('Invalid status.');
      if (body.status === 'OVERDUE') { conditions.push("c.status='ACTIVE' AND c.expected_return_at < ?"); params.push(this.clock()); }
      else { conditions.push('c.status=?'); params.push(body.status); }
    }
    if (body.from) { conditions.push('c.checked_out_at >= ?'); params.push(instant(body.from)); }
    if (body.to) { conditions.push('c.checked_out_at < ?'); params.push(instant(body.to)); }
    if (body.search) {
      const search = `%${text(body.search, 'Search', 100).replace(/[!%_]/g, '!$&')}%`;
      conditions.push("(c.full_name LIKE ? ESCAPE '!' OR c.destination LIKE ? ESCAPE '!' OR c.room_number LIKE ? ESCAPE '!')"); params.push(search,search,search);
    }
    const offset = body.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) throw new AppError('Invalid page.');
    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    const records = this.rows(`SELECT c.* FROM checkouts c${where} ORDER BY c.checked_out_at DESC,c.id LIMIT 51 OFFSET ?`, ...params, offset);
    return { records: records.slice(0,50), more: records.length > 50, offset, server_time: this.clock() };
  }
  users(user) {
    admin(user);
    return this.rows("SELECT u.*, c.id AS active_id FROM users u LEFT JOIN checkouts c ON c.user_id=u.id AND c.status='ACTIVE' ORDER BY u.enabled DESC,u.full_name,u.email").map(u=>({...u,email:u.account_type==='device'?null:u.email}));
  }
  auditHistory(user, body) {
    admin(user);
    const offset = body.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) throw new AppError('Invalid page.');
    const where = body.user_id ? 'WHERE a.subject_id=?' : '';
    const params = body.user_id ? [id(body.user_id)] : [];
    const records = this.rows(`SELECT a.*, CASE WHEN u.account_type='device' THEN u.full_name ELSE u.email END AS actor_email, s.full_name AS subject_name FROM audit a LEFT JOIN users u ON a.actor_id=u.id LEFT JOIN users s ON a.subject_id=s.id ${where} ORDER BY a.id DESC LIMIT 51 OFFSET ?`, ...params, offset);
    return { records: records.slice(0,50), more: records.length > 50, offset };
  }
  mutate(identity, body, fingerprint) {
    return this.storage.transactionSync(() => {
      const user = this.authorize(identity), now = this.clock();
      const requestId = id(body.request_id);
      const previous = this.one('SELECT * FROM requests WHERE actor_id=? AND request_id=?', user.id, requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new AppError('This request identifier was already used. Refresh and try again.', 409);
        return JSON.parse(previous.result);
      }
      const result = this.apply(user, body, now);
      this.clearRosterCache();
      this.sql.exec('INSERT INTO requests VALUES (?,?,?,?,?)', user.id, requestId, fingerprint, JSON.stringify(result), now);
      this.sql.exec('DELETE FROM requests WHERE created_at < ?', new Date(Date.parse(now)-7*86400000).toISOString());
      return result;
    });
  }
  apply(user, body, now) {
    const data = body.data || {};
    if (body.action === 'profile') {
      version(user.version, data.version);
      const next = profile(data);
      this.sql.exec('UPDATE users SET full_name=?,flight_number=?,room_number=?,phone_number=?,version=version+1,updated_at=? WHERE id=?', next.full_name,next.flight_number,next.room_number,next.phone_number,now,user.id);
      this.audit(user.id,user.id,null,'PROFILE_UPDATED',{ fields: Object.keys(next).filter(k=>next[k]!==user[k]) },now);
      return { ok:true };
    }
    if (body.action === 'checkout') {
      if (!complete(user)) throw new AppError('Complete your profile before checking out.');
      version(user.version,data.version);
      if (this.one("SELECT id FROM checkouts WHERE user_id=? AND status='ACTIVE'",user.id)) throw new AppError('You are already checked out. Your current status has been refreshed.',409);
      if(!this.pinRecord(user.id))throw new AppError('Create your four-digit profile PIN before checking out. Refresh Tether if you do not see the PIN setup.',409);
      const destination=text(data.destination,'Destination',160,2), returnAt=expected(data.expected_return_at,now), recordId=crypto.randomUUID();
      this.sql.exec("INSERT INTO checkouts(id,user_id,full_name,flight_number,room_number,phone_number,destination,checked_out_at,expected_return_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)",recordId,user.id,user.full_name,user.flight_number,user.room_number,user.phone_number,destination,now,returnAt,now,now);
      this.sql.exec('UPDATE users SET version=version+1,updated_at=? WHERE id=?',now,user.id);
      this.audit(user.id,user.id,recordId,'CHECKED_OUT',{},now);
      return { ok:true, record_id:recordId };
    }
    if (body.action === 'checkin' || body.action === 'admin_checkin') {
      const manual=body.action==='admin_checkin'; if (manual) admin(user);
      const record=this.one('SELECT * FROM checkouts WHERE id=?',id(data.record_id));
      if (!record || (!manual && record.user_id!==user.id)) throw new AppError('Record not found.',404);
      if (record.status!=='ACTIVE') return { ok:true, record_id:record.id, already_closed:true };
      const reason=manual ? text(data.reason,'Reason',240,3) : null;
      this.sql.exec('UPDATE checkouts SET checked_in_at=?,status=?,version=version+1,updated_at=? WHERE id=?',now,manual?'ADMIN_CLOSED':'COMPLETED',now,record.id);
      this.sql.exec('UPDATE users SET version=version+1,updated_at=? WHERE id=?',now,record.user_id);
      this.audit(user.id,record.user_id,record.id,manual?'ADMIN_CHECKED_IN':'CHECKED_IN',manual?{reason}:{},now);
      return { ok:true, record_id:record.id };
    }
    admin(user);
    if (body.action==='invite') {
      const address=email(data.email);
      if (this.one('SELECT id FROM users WHERE email=?',address)) throw new AppError('This email is already on the user list. Re-enable the existing account if needed.',409);
      if (this.one('SELECT COUNT(*) AS n FROM users').n>=1000) throw new AppError('The user limit has been reached. Contact the application operator.',409);
      const userId=crypto.randomUUID();
      this.sql.exec("INSERT INTO users(id,email,created_at,updated_at) VALUES (?,?,?,?)",userId,address,now,now);
      this.audit(user.id,userId,null,'USER_APPROVED',{},now);
      return {ok:true,user_id:userId};
    }
    if (body.action==='user_update') {
      const target=this.one('SELECT * FROM users WHERE id=?',id(data.user_id));
      if (!target) throw new AppError('User not found.',404);
      version(target.version,data.version);
      if (!['admin','member'].includes(data.role) || typeof data.enabled!=='boolean') throw new AppError('Invalid account settings.');
      if (target.id===user.id && (!data.enabled || data.role!=='admin')) throw new AppError('Another administrator must change your own access.');
      if (!data.enabled && this.one("SELECT id FROM checkouts WHERE user_id=? AND status='ACTIVE'",target.id)) throw new AppError('Check this member in before disabling their account.');
      if (target.enabled && target.role==='admin' && (!data.enabled || data.role!=='admin') && this.one("SELECT COUNT(*) AS n FROM users WHERE enabled=1 AND role='admin'").n<=1) throw new AppError('Keep at least one enabled administrator.');
      const reason=text(data.reason,'Reason',240,3);
      this.sql.exec('UPDATE users SET role=?,enabled=?,version=version+1,updated_at=? WHERE id=?',data.role,Number(data.enabled),now,target.id);
      this.audit(user.id,target.id,null,'USER_ACCESS_CHANGED',{before:{role:target.role,enabled:!!target.enabled},after:{role:data.role,enabled:data.enabled},reason},now);
      return {ok:true};
    }
    if (body.action==='correct') {
      const record=this.one('SELECT * FROM checkouts WHERE id=?',id(data.record_id));
      if (!record) throw new AppError('Record not found.',404);
      version(record.version,data.version);
      const next={destination:text(data.destination,'Destination',160,2),expected_return_at:instant(data.expected_return_at),checked_out_at:instant(data.checked_out_at),checked_in_at:data.checked_in_at===null?null:instant(data.checked_in_at)};
      const reason=text(data.reason,'Reason',240,3);
      if (next.checked_out_at>now || next.expected_return_at<=next.checked_out_at || (next.checked_in_at && (next.checked_in_at<next.checked_out_at || next.checked_in_at>now))) throw new AppError('Return must follow departure; departure and actual check-in cannot be in the future.');
      if (!next.checked_in_at) {
        if (!this.one('SELECT enabled FROM users WHERE id=?',record.user_id)?.enabled) throw new AppError('Re-enable the member before reopening their trip.');
        if (this.one("SELECT id FROM checkouts WHERE user_id=? AND status='ACTIVE' AND id<>?",record.user_id,record.id)) throw new AppError('This member has another active trip. Close it before reopening this one.',409);
      }
      next.status=next.checked_in_at?'ADMIN_CLOSED':'ACTIVE';
      const before=Object.fromEntries(Object.keys(next).map(k=>[k,record[k]]));
      this.sql.exec('UPDATE checkouts SET destination=?,expected_return_at=?,checked_out_at=?,checked_in_at=?,status=?,version=version+1,updated_at=? WHERE id=?',next.destination,next.expected_return_at,next.checked_out_at,next.checked_in_at,next.status,now,record.id);
      this.sql.exec('UPDATE users SET version=version+1,updated_at=? WHERE id=?',now,record.user_id);
      this.audit(user.id,record.user_id,record.id,'RECORD_CORRECTED',{before,after:next,reason},now);
      return {ok:true,record_id:record.id};
    }
    throw new AppError('Unknown action.',404);
  }
}
