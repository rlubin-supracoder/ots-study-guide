export class SourceError extends Error {constructor(code,message){super(message);this.code=code;}}
export function sourceReady(env){return ['MS_TENANT_ID','MS_CLIENT_ID','MS_CLIENT_SECRET','GRAPH_DRIVE_ID','GRAPH_ITEM_ID','SOURCE_SHAREPOINT_HOST','SOURCE_ITEM_GUID'].every(k=>typeof env[k]==='string'&&env[k].length>0);}
export async function readLimited(response,max){if(Number(response.headers.get('Content-Length'))>max)throw new SourceError('too_large','Source exceeds the workbook size limit.');if(!response.body)throw new SourceError('empty','Source response is empty.');const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new SourceError('too_large','Source exceeds the workbook size limit.');chunks.push(value);}}catch(e){await reader.cancel();throw e;}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;}
export async function readSource(env,etag,request=fetch){
  if(!sourceReady(env))throw new SourceError('not_configured','An approved source connection has not been configured.');
  if(!/^[a-f0-9-]{36}$/i.test(env.MS_TENANT_ID)||!/^[a-f0-9-]{36}$/i.test(env.MS_CLIENT_ID)||!/^[a-z0-9-]+\.sharepoint\.com$/.test(env.SOURCE_SHAREPOINT_HOST))throw new SourceError('configuration','Source connection settings need review.');
  const call=(url,options={})=>request(url,{...options,redirect:'error',signal:AbortSignal.timeout(25000)});
  const tokenResponse=await call(`https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.MS_CLIENT_ID,client_secret:env.MS_CLIENT_SECRET,scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'})});
  if(!tokenResponse.ok)throw new SourceError('source_auth','The source connection needs administrator attention.');
  const token=await tokenResponse.json();if(!token.access_token)throw new SourceError('source_auth','The source connection needs administrator attention.');
  const endpoint=`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(env.GRAPH_DRIVE_ID)}/items/${encodeURIComponent(env.GRAPH_ITEM_ID)}`;
  const headers={Authorization:'Bearer '+token.access_token};
  const metadata=async()=>{const r=await call(endpoint+'?$select=id,name,size,eTag,lastModifiedDateTime,webUrl,sharepointIds,@microsoft.graph.downloadUrl',{headers});if(!r.ok)throw new SourceError('source_read','The source could not be read. Check its read permission and try later.');return r.json();};
  const item=await metadata();
  if(new URL(item.webUrl).hostname!==env.SOURCE_SHAREPOINT_HOST||item.sharepointIds?.listItemUniqueId?.replace(/[{}]/g,'').toLowerCase()!==env.SOURCE_ITEM_GUID.replace(/[{}]/g,'').toLowerCase())throw new SourceError('source_mismatch','The configured file does not match the approved source.');
  if(!/\.xlsx$/i.test(item.name||'')||item.size>16*1024*1024)throw new SourceError('source_format','The source must be an .xlsx workbook of 16 MB or less.');
  const info={name:item.name,etag:item.eTag,modified_at:item.lastModifiedDateTime};
  if(etag&&item.eTag===etag)return {unchanged:true,...info};
  const url=new URL(item['@microsoft.graph.downloadUrl']);
  if(url.protocol!=='https:'||url.hostname!==env.SOURCE_SHAREPOINT_HOST||url.username||url.password)throw new SourceError('download_host','The source returned an unexpected download host.');
  // Never forward the Graph access token to the preauthenticated download URL.
  const response=await call(url);if(!response.ok)throw new SourceError('source_download','The workbook download did not complete.');
  const bytes=await readLimited(response,16*1024*1024);
  if((await metadata()).eTag!==item.eTag)throw new SourceError('source_changed','The workbook changed during reading. The next refresh will retry.');
  return {...info,bytes};
}
