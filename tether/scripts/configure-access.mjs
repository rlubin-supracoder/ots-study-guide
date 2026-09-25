import {readFile,writeFile} from 'node:fs/promises';
if (!process.env.CLOUDFLARE_ACCESS_TOKEN_FILE) throw new Error('Set CLOUDFLARE_ACCESS_TOKEN_FILE to the temporary setup token file.');
const token=(await readFile(process.env.CLOUDFLARE_ACCESS_TOKEN_FILE,'utf8')).trim();
const configPath=new URL('../wrangler.jsonc',import.meta.url);
const config=JSON.parse(await readFile(configPath,'utf8'));
const domain=new URL(config.vars.APP_ORIGIN).hostname;
async function api(path,body) {
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/access/${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();if(!result.success)throw new Error(`Access configuration failed (${response.status}): ${JSON.stringify(result.errors)}`);return result.result;
}
const organization=await api('organizations');
if(organization.auth_domain!==config.vars.ACCESS_TEAM_DOMAIN)throw new Error('Unexpected Access organization.');
const provider=(await api('identity_providers')).find(item=>item.type==='onetimepin');
if(!provider)throw new Error('Configure an email one-time PIN provider in Cloudflare Access first.');
const existing=(await api('apps')).filter(item=>item.domain===domain);
if(existing.length>1)throw new Error('Multiple matching Access applications require review.');
let app=existing[0];
if(!app)app=await api('apps',{
  name:'Tether — OTS Accountability',type:'self_hosted',domain,
  destinations:[{type:'public',uri:domain}],allowed_idps:[provider.id],auto_redirect_to_identity:true,
  session_duration:'24h',app_launcher_visible:false,
  http_only_cookie_attribute:true,same_site_cookie_attribute:'lax',path_cookie_attribute:false,
  allow_authenticate_via_warp:false,
});
const policies=await api(`apps/${app.id}/policies`);
const include=[{login_method:{id:provider.id}}];
if(!policies.length)await api(`apps/${app.id}/policies`,{name:'Verified email — membership enforced by Tether',decision:'allow',precedence:1,include,exclude:[],require:[]});
else if(policies.length!==1||policies[0].decision!=='allow'||JSON.stringify(policies[0].include)!==JSON.stringify(include))throw new Error('Unexpected existing policy; review before changing.');
app=await api(`apps/${app.id}`);
if(!app.aud)throw new Error('No audience tag returned.');
config.vars.ACCESS_AUD=app.aud;
await writeFile(configPath,JSON.stringify(config,null,2)+'\n');
console.log(JSON.stringify({appId:app.id,domain,audience:app.aud,session:app.session_duration,configured:true}));
