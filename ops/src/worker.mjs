import {DurableObject} from 'cloudflare:workers';
import {parseWorkbook} from './parser.mjs';
import {readSource,SourceError,sourceReady} from './source.mjs';
import {handle,json,liveReady} from './http.mjs';
export default {
  async fetch(request,env){try{return await handle(request,env);}catch{return json({error:'The request could not be completed. Try again later.'},503);}},
  async scheduled(controller,env,ctx){if(liveReady(env)&&sourceReady(env))ctx.waitUntil(env.SHEETS.get(env.SHEETS.idFromName('sheet-summary-v1')).fetch('https://internal/api/refresh',{method:'POST'}));}
};
export class SheetMonitor extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.env=env;this.sql=ctx.storage.sql;this.sql.exec('CREATE TABLE IF NOT EXISTS snapshot(id INTEGER PRIMARY KEY CHECK(id=1), checked TEXT, succeeded TEXT, etag TEXT, summary TEXT, error TEXT)');this.sql.exec('INSERT OR IGNORE INTO snapshot(id) VALUES (1)');this.inflight=null;}
  state(){const row=[...this.sql.exec('SELECT * FROM snapshot WHERE id=1')][0];return {mode:'live',last_checked:row.checked,last_success:row.succeeded,stale:!row.succeeded||Date.now()-Date.parse(row.succeeded)>10*60000||!!row.error,error:row.error,summary:row.summary?JSON.parse(row.summary):null};}
  async refresh(){
    if(this.inflight)return this.inflight;
    const row=[...this.sql.exec('SELECT * FROM snapshot WHERE id=1')][0];if(row.checked&&Date.now()-Date.parse(row.checked)<60000)return this.state();
    this.inflight=(async()=>{const checked=new Date().toISOString();this.sql.exec('UPDATE snapshot SET checked=? WHERE id=1',checked);try{const source=await readSource(this.env,row.etag);if(source.unchanged&&row.summary){this.sql.exec('UPDATE snapshot SET succeeded=?,error=NULL WHERE id=1',checked);}else{const summary=parseWorkbook(source.bytes);summary.source={name:source.name,modified_at:source.modified_at};const data=JSON.stringify(summary);if(new TextEncoder().encode(data).length>1800000)throw new SourceError('summary_large','The summary is too large. Select a smaller workbook.');this.sql.exec('UPDATE snapshot SET succeeded=?,etag=?,summary=?,error=NULL WHERE id=1',checked,source.etag||null,data);} }catch(error){this.sql.exec('UPDATE snapshot SET error=? WHERE id=1',error instanceof SourceError?error.message:'Workbook could not be read completely. Check the source or retry later.');}return this.state();})();
    try{return await this.inflight;}finally{this.inflight=null;}
  }
  async fetch(request){if(!liveReady(this.env)||!sourceReady(this.env))return json({error:'Live source is not configured.'},503);if(request.method==='POST'&&new URL(request.url).pathname==='/api/refresh')return json(await this.refresh());if(request.method==='GET'&&new URL(request.url).pathname==='/api/summary')return json(this.state());return json({error:'Not found.'},404);}
}
