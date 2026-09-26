import { DurableObject } from 'cloudflare:workers';
import initial from '../migrations/001_initial.sql';
import sessions from '../migrations/002_member_sessions.sql';
import { Database } from './database.mjs';
import { databaseRequest } from './service.mjs';
import { serveRequest } from './http.mjs';
import { staffEmails } from './auth.mjs';
export default { fetch(request,env) {return serveRequest(request,env);} };
export class Accountability extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.db=new Database(ctx.storage,[{version:1,sql:initial},{version:2,sql:sessions}],env.BOOTSTRAP_ADMIN_EMAIL);
    this.db.provisionStaff(staffEmails(env));
    this.env=env;
  }
  fetch(request) {return databaseRequest(this.db,request,this.env);}
}
