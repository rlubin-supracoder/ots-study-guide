import { DurableObject } from 'cloudflare:workers';
import initial from '../migrations/001_initial.sql';
import sessions from '../migrations/002_member_sessions.sql';
import pins from '../migrations/003_profile_pins.sql';
import reports from '../migrations/004_daily_reports.sql';
import {captureReport,reportWindow} from './reports.mjs';
import {CLASSES} from './classes.mjs';
import { Database } from './database.mjs';
import { databaseRequest } from './service.mjs';
import { serveRequest } from './http.mjs';
import { staffEmails } from './auth.mjs';
import { digest } from './auth.mjs';
import { AppError } from './validation.mjs';
export default {
  fetch(request,env) {return serveRequest(request,env);},
  async scheduled(controller,env) {
    if(!reportWindow(controller.scheduledTime))return;
    const stub=env.ACCOUNTABILITY.get(env.ACCOUNTABILITY.idFromName(CLASSES['27-01'].object));
    await stub.dailyReport(controller.scheduledTime);
  }
};
export class Accountability extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.db=new Database(ctx.storage,[{version:1,sql:initial},{version:2,sql:sessions},{version:3,sql:pins},{version:4,sql:reports}],env.BOOTSTRAP_ADMIN_EMAIL);
    this.db.provisionStaff(staffEmails(env));
    this.env=env;
  }
  dailyReport(scheduledTime) {
    // This RPC is callable by our Worker binding, never through a public HTTP route.
    if(!this.ctx.id.equals(this.env.ACCOUNTABILITY.idFromName(CLASSES['27-01'].object)))throw new AppError('Reports are only available for Class 27-01.',403);
    return captureReport(this.db,scheduledTime);
  }
  async fetch(request) {
    const response=await databaseRequest(this.db,request,this.env,credentials=>this.connect( credentials));
    if(response.ok&&request.headers.get('X-Tether-Class')==='27-02'&&['/api/action','/api/profile-pin','/api/device-code','/api/logout','/api/join','/api/connect','/api/connect-pin'].includes(new URL(request.url).pathname))this.changed();
    return response;
  }
  connect(credentials) {
    const existing=this.ctx.getWebSockets(credentials.userId);
    for(const socket of existing.slice(0,Math.max(0,existing.length-4)))socket.close(1000,'Another device connected.');
    if(this.ctx.getWebSockets().length>=1000)throw new AppError('Live updates are busy. Your roster will refresh automatically.',503);
    const pair=new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1],[credentials.userId]);
    pair[1].serializeAttachment(credentials);
    return new Response(null,{status:101,webSocket:pair[0]});
  }
  changed() {
    if(this.broadcastPending||!this.ctx.getWebSockets().length)return;
    this.broadcastPending=true;
    // One invalidation per burst, carrying no roster or personal information.
    this.ctx.waitUntil(new Promise(resolve=>setTimeout(resolve,500)).then(async()=>{
      this.broadcastPending=false;
      await this.ctx.storage.sync();
      const passwordVersion=this.env.MEMBER_PASSWORD_27_02?await digest(this.env.MEMBER_PASSWORD_27_02):null;
      for(const socket of this.ctx.getWebSockets()){
        try{
          const credentials=socket.deserializeAttachment();
          this.db.memberPrincipal(credentials.gateHash,credentials.deviceHash,passwordVersion);
          socket.send('refresh');
        }catch{try{socket.close(1008,'Sign in again.');}catch{}}
      }
    }));
  }
  webSocketMessage(socket){socket.close(1008,'This connection only receives updates.');}
  webSocketClose(socket,code){try{socket.close(code===1006?1001:code);}catch{}}
  webSocketError(socket){try{socket.close(1011,'Reconnect.');}catch{}}
}
