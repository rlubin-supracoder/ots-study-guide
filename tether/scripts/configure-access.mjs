import {readFile} from 'node:fs/promises';
if(!process.env.CLOUDFLARE_ACCESS_TOKEN_FILE||!process.env.TETHER_STAFF_EMAIL)throw new Error('Set CLOUDFLARE_ACCESS_TOKEN_FILE and TETHER_STAFF_EMAIL.');
const token=(await readFile(process.env.CLOUDFLARE_ACCESS_TOKEN_FILE,'utf8')).trim();
const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const domain=new URL(config.vars.APP_ORIGIN).hostname,staffDomain=domain+'/staff',email=process.env.TETHER_STAFF_EMAIL.trim().toLowerCase();
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Invalid staff email.');
async function api(path,method='GET',body){
 const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+config.account_id+'/access/'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const result=await response.json();if(!result.success)throw new Error('Access configuration failed ('+response.status+'): '+JSON.stringify(result.errors));return result.result;
}
const apps=(await api('apps')).filter(a=>a.domain===domain||a.domain===staffDomain);
if(apps.length!==1)throw new Error('Expected exactly one existing Tether Access application.');
let app=await api('apps/'+apps[0].id);
if(app.aud!==config.vars.ACCESS_AUD||app.type!=='self_hosted'||app.allowed_idps?.length!==1)throw new Error('Unexpected application audience, type or identity provider.');
const policies=await api('apps/'+app.id+'/policies');
if(policies.length!==1||policies[0].decision!=='allow'||policies[0].reusable)throw new Error('Unexpected policy configuration; review before changing.');
if(!process.argv.includes('--apply')){console.log(JSON.stringify({current:app.domain,target:staffDomain,policyCount:policies.length,mode:'review'}));process.exit(0);}
// Restrict staff identity first. Deploy the password-protected Worker before applying this script.
await api('apps/'+app.id+'/policies/'+policies[0].id,'PUT',{name:'Tether designated administrator',decision:'allow',precedence:1,include:[{email:{email}}],exclude:[],require:[]});
app=await api('apps/'+app.id,'PUT',{
 name:'Tether — Staff',type:'self_hosted',domain:staffDomain,destinations:[{type:'public',uri:staffDomain}],
 allowed_idps:app.allowed_idps,auto_redirect_to_identity:true,session_duration:'24h',app_launcher_visible:false,
 http_only_cookie_attribute:true,same_site_cookie_attribute:'lax',path_cookie_attribute:true,
 allow_authenticate_via_warp:false,options_preflight_bypass:false
});
const verified=await api('apps/'+app.id),verifiedPolicies=await api('apps/'+app.id+'/policies');
if(verified.domain!==staffDomain||verified.aud!==config.vars.ACCESS_AUD||verifiedPolicies.length!==1||JSON.stringify(verifiedPolicies[0].include)!==JSON.stringify([{email:{email}}]))throw new Error('Configuration verification failed.');
console.log(JSON.stringify({appId:app.id,domain:verified.domain,audienceUnchanged:true,restrictedToDesignatedEmail:true,configured:true}));
