import { DurableObject } from 'cloudflare:workers';
import initial from '../migrations/001_initial.sql';
import { Database } from './database.mjs';
import { databaseRequest } from './service.mjs';
import { serveRequest } from './http.mjs';
export default { fetch(request,env) {return serveRequest(request,env);} };
export class Accountability extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.db=new Database(ctx.storage,[{version:1,sql:initial}],env.BOOTSTRAP_ADMIN_EMAIL);
  }
  fetch(request) {return databaseRequest(this.db,request);}
}
