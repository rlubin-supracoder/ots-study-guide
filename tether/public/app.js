import { centralInput,centralToUTC,dateTime } from './time.mjs';
const $=selector=>document.querySelector(selector);
const el=(tag,className,content)=>{const node=document.createElement(tag);if(className)node.className=className;if(content!==undefined)node.textContent=content;return node;};
let state=null,view='home',staffView='records',busy=false,fresh=false,profileVersion,historyOffset=0,adminOffset=0,auditOffset=0,memberFilter=null,rosterSignature='',adminSignature='',personalOverdue=false,users=[],lastSync=0,serverOffset=0,refreshPromise;
const retries=new Map();
const now=()=>Date.now()+serverOffset;
function notice(message,error=false){const node=$('#notice');node.textContent=message;node.hidden=!message;node.classList.toggle('error-state',error);}
function dialogError(message){$('#dialogError').textContent=message;$('#dialogError').hidden=!message;}
function lock(){fresh=false;document.body.classList.add('locked');$('#authError').hidden=false;$('#dialog').close();state=null;for(const id of ['personal','roster','myHistory','adminHistory','usersList','auditList','stats'])$('#'+id).replaceChildren();$('#profileForm').reset();}
async function api(path,data){
  let response;
  try{response=await fetch(path,{method:data===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'manual',headers:data===undefined?{}:{'Content-Type':'application/json','X-Tether-Request':'1'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(15000)});}
  catch{throw new Error('Connection interrupted or session expired. Your change could not be confirmed. Refresh your status or sign in again before retrying.');}
  if(response.type==='opaqueredirect'||response.status===401||response.status===403){lock();throw new Error('Sign-in or administrator approval is required.');}
  if(!response.headers.get('Content-Type')?.includes('application/json')){lock();throw new Error('Your session ended. Sign in again.');}
  const result=await response.json();if(!response.ok)throw new Error(result.error||'The request could not be completed.');return result;
}
function setBusy(value){busy=value;for(const button of document.querySelectorAll('button[type=submit],.hero,[data-mutation]'))button.disabled=value||(!fresh&&button.classList.contains('hero'));$('#closeDialog').disabled=value;}
async function mutate(action,data){
  if(busy)return false;
  const signature=JSON.stringify({action,data});let request=retries.get(signature);
  if(!request){request={action,data,request_id:crypto.randomUUID()};retries.set(signature,request);}
  setBusy(true);dialogError('');notice('');
  try{
    await api('/api/action',request);retries.delete(signature);
    if(refreshPromise)await refreshPromise;
    const synced=await refresh(true);
    if(!synced)throw new Error('The change was saved, but the latest status could not be loaded. Reconnect before taking another action.');
    $('#dialog').close();notice('Saved. Your accountability status is up to date.');return true;
  }catch(error){
    fresh=false;await refresh(false);notice(error.message,true);if($('#dialog').open)dialogError(error.message);return false;
  }finally{setBusy(false);}
}
function button(label,handler,className='button'){const b=el('button',className,label);b.type='button';b.addEventListener('click',handler);return b;}
function statusBadge(label,className=''){const node=el('div','status '+className);node.append(el('span','status-dot'),document.createTextNode(label));return node;}
function details(items){const list=el('dl','detail-grid');for(const [label,value,wide]of items){const wrap=el('div',wide?'wide':'');wrap.append(el('dt','',label),el('dd','',value||'—'));list.append(wrap);}return list;}
function renderPersonal(){
  if(!state)return;
  const box=$('#personal'),u=state.user,a=state.active;personalOverdue=!!a&&Date.parse(a.expected_return_at)<now();box.replaceChildren();box.setAttribute('aria-busy','false');
  box.append(el('h2','',u.full_name||'Welcome to Tether'),el('p','identity',state.profile_complete?`Flight ${u.flight_number} · Room ${u.room_number}`:'A few details, then you’re ready to go.'));
  if(!state.profile_complete){box.append(el('p','','Complete your profile before your first checkout.'),button('SET UP MY PROFILE',()=>navigate('profile'),'button hero'));return;}
  box.append(statusBadge(a?'OFF CAMPUS':'ON CAMPUS',a?'off':''));
  if(a){box.append(details([['Destination',a.destination,true],['Expected return',dateTime(a.expected_return_at)],['Checked out',dateTime(a.checked_out_at)]]));if(Date.parse(a.expected_return_at)<now())box.append(el('p','tag overdue','OVERDUE — Please return or contact staff.'));}
  const action=button(a?'CHECK IN':'CHECK OUT',a?checkin:checkout,'button hero'+(a?' checkin':''));action.disabled=busy||!fresh;box.append(action,el('p','action-note',fresh?(a?'Back on campus? Confirm your return.':'Leaving campus? Add your destination and return time.'):'Status is unverified. Reconnect to continue.'));
}
function tripCard(record,staff=false,history=false){
  const overdue=record.status==='ACTIVE'&&Date.parse(record.expected_return_at)<now();
  const card=el('article','trip'+(overdue?' overdue':''));
  const top=el('div','trip-top');top.append(el('h3','',record.full_name),el('span','tag'+(overdue?' overdue':''),overdue?'OVERDUE':record.status==='ACTIVE'?'OFF CAMPUS':record.status==='ADMIN_CLOSED'?'STAFF CLOSED':'CHECKED IN'));card.append(top,el('p','meta',`Flight ${record.flight_number} · Room ${record.room_number}`),el('p','destination',record.destination));
  const times=el('div','times');for(const [label,value]of [['Checked out',record.checked_out_at],['Expected return',record.expected_return_at],...(history?[['Checked in',record.checked_in_at]]:[])]){const p=el('p');p.append(el('span','label',label),document.createTextNode(value?dateTime(value):'Still off campus'));times.append(p);}card.append(times);
  if(staff){
    const contact=el('details','contact');contact.append(el('summary','','Contact member'));const link=el('a','',record.phone_number);link.href='tel:'+record.phone_number.replace(/\D/g,'');contact.append(link);card.append(contact);
    const actions=el('div','actions');if(record.status==='ACTIVE')actions.append(button('Check member in',()=>manualCheckin(record)));
    if(history)actions.append(button('Correct record',()=>correct(record)));
    actions.append(button('Member history',()=>showMemberHistory(record.user_id,record.full_name),'text-button'));card.append(actions);
  }
  return card;
}
function renderRoster(){
  const signature=JSON.stringify([state.roster,state.user.role,state.roster.map(r=>Date.parse(r.expected_return_at)<now())]);if(signature===rosterSignature)return;rosterSignature=signature;
  $('#count').textContent=state.roster.length;const box=$('#roster');box.replaceChildren();
  if(!state.roster.length){const empty=el('div','empty');empty.append(el('strong','','Everyone is currently on campus.'),el('span','','The next departure will appear here.'));box.append(empty);}
  else for(const record of state.roster)box.append(tripCard(record,state.user.role==='admin'));
}
async function refresh(force=false){
  if(refreshPromise)return refreshPromise;
  refreshPromise=(async()=>{try{
    const next=await api('/api/state');serverOffset=Date.parse(next.server_time)-Date.now();lastSync=Date.now();fresh=true;document.body.classList.remove('locked');$('#authError').hidden=true;
    const changed=JSON.stringify([next.user,next.active])!==JSON.stringify([state?.user,state?.active]);state=next;$('#adminNav').hidden=state.user.role!=='admin';
    if(view==='admin'&&state.user.role!=='admin')navigate('home');
    if(changed||force||personalOverdue!==(!!state.active&&Date.parse(state.active.expected_return_at)<now())||!$('#personal .hero'))renderPersonal();else if($('#personal .hero'))$('#personal .hero').disabled=busy;
    renderRoster();$('#sync').textContent='● Updated just now';return true;
  }catch(error){fresh=false;$('#sync').textContent='Connection lost · status unverified';if(state)renderPersonal();if(force)notice(error.message,true);return false;}finally{refreshPromise=null;}})();return refreshPromise;
}
async function navigate(next){
  if(!state)return;view=next;
  for(const section of document.querySelectorAll('.view'))section.hidden=section.id!==next;
  for(const b of document.querySelectorAll('[data-view]')){if(b.dataset.view===next)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
  notice('');
  try{
    if(next==='profile'){profileVersion=state.user.version;for(const field of ['full_name','flight_number','room_number','phone_number'])$('#profileForm').elements[field].value=state.user[field]||'';}
    if(next==='history'){historyOffset=0;await loadHistory(false);}
    if(next==='admin'){await loadUsers();await staffTab(staffView);}
  }catch(error){notice(error.message,true);}
}
function modal(title){$('#dialogTitle').textContent=title;$('#dialogBody').replaceChildren();dialogError('');if(!$('#dialog').open)$('#dialog').showModal();return $('#dialogBody');}
function field(form,label,name,type='text',value='',required=true,max){const wrap=el('label','',label),input=el('input');input.name=name;input.type=type;input.value=value;input.required=required;if(max)input.maxLength=max;wrap.append(input);form.append(wrap);return input;}
function submit(form,label){const b=el('button','button primary',label);b.type='submit';form.append(b);return b;}
function checkout(){
  if(!fresh||!state.profile_complete)return;
  const u={...state.user};const box=modal('Plan your checkout'),form=el('form','form-stack');
  field(form,'Destination / location','destination','text','',true,160).minLength=2;
  field(form,'Expected return · Central Time','return','datetime-local',centralInput(new Date(now()+2*3600000).toISOString()));
  form.append(el('p','hint','Use a business name or general destination. Times are always Maxwell AFB local time, even if your phone is set to another timezone.'));
  submit(form,'Review checkout');box.append(form);
  form.addEventListener('submit',event=>{event.preventDefault();try{
    const destination=form.elements.destination.value.trim(),expected_return_at=centralToUTC(form.elements.return.value);
    if(Date.parse(expected_return_at)<=now())throw new Error('Expected return must be in the future.');
    const review=modal('Confirm checkout');review.append(details([['Name',u.full_name,true],['Flight',u.flight_number],['Room',u.room_number],['Destination',destination,true],['Expected return',dateTime(expected_return_at),true]]));
    const actions=el('div','actions');const confirm=button('CONFIRM CHECK OUT',()=>mutate('checkout',{destination,expected_return_at,version:u.version}),'button primary');confirm.dataset.mutation='1';actions.append(confirm,button('Go back',()=>{modal('Plan your checkout').append(form);}));review.append(actions);confirm.focus();
  }catch(error){dialogError(error.message);}});
}
function checkin(){
  const record=state.active;if(!record||!fresh)return;
  const box=modal('Back on campus?');box.append(el('p','','Confirm that you have returned to the OTS campus.'),el('p','hint',`Returning from ${record.destination}.`));
  const b=button('CONFIRM CHECK IN',()=>mutate('checkin',{record_id:record.id}),'button primary hero');b.dataset.mutation='1';box.append(b);
}
async function loadHistory(staff,append=false){
  const body=staff?historyFilters():{};body.offset=staff?adminOffset:historyOffset;
  const data=await api(staff?'/api/admin/history':'/api/history',body);const target=$(staff?'#adminHistory':'#myHistory');
  if(staff&&!append){const signature=JSON.stringify([data.records,data.records.map(r=>r.status==='ACTIVE'&&Date.parse(r.expected_return_at)<now())]);if(signature===adminSignature&&target.childElementCount)return;adminSignature=signature;}
  if(!append)target.replaceChildren();
  if(!data.records.length&&!append)target.append(el('p','empty','No checkout records to show.'));
  for(const record of data.records)target.append(tripCard(record,staff,true));
  $(staff?'#moreAdminHistory':'#moreHistory').hidden=!data.more;
}
function historyFilters(){
  const form=$('#filterForm'),data={};for(const name of ['search','flight','status'])if(form.elements[name].value.trim())data[name]=form.elements[name].value.trim();
  if(form.elements.from.value)data.from=centralToUTC(form.elements.from.value+'T00:00');
  if(form.elements.through.value){const d=new Date(form.elements.through.value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);data.to=centralToUTC(d.toISOString().slice(0,10)+'T00:00');}
  if(data.from&&data.to&&data.to<=data.from)throw new Error('The end date must be on or after the start date.');
  if(memberFilter)data.user_id=memberFilter.id;return data;
}
async function showMemberHistory(id,name){memberFilter={id,name};$('#filterForm').reset();$('#memberFilter').textContent=`Showing history for ${name}. Use Reset to show everyone.`;$('#memberFilter').hidden=false;await navigate('admin');await staffTab('records');}
async function loadUsers(){
  const result=await api('/api/admin/users',{});users=result.users;renderStats();
  const box=$('#usersList');box.replaceChildren();for(const user of users){const card=el('article','user-card');card.append(el('h3','',user.full_name||'Profile not yet completed'),el('p','meta',user.email),el('p','meta',`${user.role==='admin'?'Administrator':'Member'} · ${user.enabled?'Enabled':'Disabled'}${user.flight_number?' · Flight '+user.flight_number:''}`));const actions=el('div','actions');actions.append(button('Manage access',()=>manageUser(user)),button('View history',()=>showMemberHistory(user.id,user.full_name||user.email),'text-button'));card.append(actions);box.append(card);}
}
function renderStats(){if(!state?.counts)return;const c=state.counts,counts=[['On campus',c.on_campus],['Off campus',c.off_campus],['Overdue',c.overdue]];$('#stats').replaceChildren();for(const [label,n]of counts){const item=el('div','stat');item.append(el('strong','',n),el('span','',label));$('#stats').append(item);}if(c.pending){const p=el('p','hint',`${c.pending} approved account${c.pending===1?'':'s'} awaiting profile setup; excluded from campus counts.`);$('#stats').append(p);}}
async function staffTab(next){staffView=next;for(const b of document.querySelectorAll('[data-staff]'))b.setAttribute('aria-pressed',String(b.dataset.staff===next));$('#staffRecords').hidden=next!=='records';$('#staffUsers').hidden=next!=='users';$('#staffAudit').hidden=next!=='audit';if(next==='records'){adminOffset=0;await loadHistory(true);}if(next==='users')await loadUsers();if(next==='audit'){auditOffset=0;await loadAudit();}}
async function loadAudit(append=false){const data=await api('/api/admin/audit',{offset:auditOffset});const box=$('#auditList');if(!append)box.replaceChildren();for(const row of data.records){const card=el('article','audit-card');card.append(el('h3','',row.action.replaceAll('_',' ')),el('p','meta',`${dateTime(row.at)} · ${row.actor_email||'System setup'}`));if(row.subject_name)card.append(el('p','',row.subject_name));const detail=el('details');detail.append(el('summary','','View change details'),el('pre','',JSON.stringify(JSON.parse(row.detail),null,2)));card.append(detail);box.append(card);}$('#moreAudit').hidden=!data.more;}
function manualCheckin(record){const box=modal('Staff check-in'),form=el('form','form-stack');form.append(el('p','',`Confirm ${record.full_name} has returned to campus.`));field(form,'Reason / accountability note','reason','text','',true,240).minLength=3;submit(form,'Check member in');box.append(form);form.addEventListener('submit',async event=>{event.preventDefault();if(await mutate('admin_checkin',{record_id:record.id,reason:form.elements.reason.value}))await refreshStaff();});}
function correct(record){
  const box=modal('Correct checkout record'),form=el('form','form-stack');form.append(el('p','',record.full_name),el('p','hint','All times are Central. Clear actual check-in to reopen a trip. The original values and your reason remain in the audit trail.'));
  field(form,'Destination','destination','text',record.destination,true,160);
  field(form,'Checked out · Central Time','checked_out_at','datetime-local',centralInput(record.checked_out_at));
  field(form,'Expected return · Central Time','expected_return_at','datetime-local',centralInput(record.expected_return_at));
  field(form,'Actual check-in · Central Time','checked_in_at','datetime-local',record.checked_in_at?centralInput(record.checked_in_at):'',false);
  field(form,'Reason for correction','reason','text','',true,240).minLength=3;submit(form,'Save audited correction');box.append(form);
  form.addEventListener('submit',async event=>{event.preventDefault();try{const data={record_id:record.id,version:record.version,destination:form.elements.destination.value,reason:form.elements.reason.value};for(const key of ['checked_out_at','expected_return_at','checked_in_at']){const value=form.elements[key].value;data[key]=value?(value===centralInput(record[key]||new Date(0).toISOString())?record[key]:centralToUTC(value)):null;}if(await mutate('correct',data))await refreshStaff();}catch(error){dialogError(error.message);}});
}
function manageUser(user){
  const box=modal('Manage member access'),form=el('form','form-stack');form.append(el('p','',user.full_name||user.email));
  for(const [name,label,options]of [['role','Role',[['member','Member'],['admin','Administrator']]],['enabled','Account access',[['1','Enabled'],['0','Disabled']]]]){const wrap=el('label','',label),select=el('select');select.name=name;for(const [value,caption]of options){const option=el('option','',caption);option.value=value;select.append(option);}select.value=String(user[name]);wrap.append(select);form.append(wrap);}
  field(form,'Reason for change','reason','text','',true,240).minLength=3;submit(form,'Save access settings');box.append(form);
  form.addEventListener('submit',async event=>{event.preventDefault();if(await mutate('user_update',{user_id:user.id,version:user.version,role:form.elements.role.value,enabled:form.elements.enabled.value==='1',reason:form.elements.reason.value}))await loadUsers();});
}
async function refreshStaff(){if(view==='admin'){await loadUsers();await staffTab(staffView);}}
function guarded(fn){return async event=>{try{await fn(event);}catch(error){notice(error.message,true);}};}
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>navigate(b.dataset.view));
for(const b of document.querySelectorAll('[data-staff]'))b.addEventListener('click',guarded(()=>staffTab(b.dataset.staff)));
$('#closeDialog').addEventListener('click',()=>$('#dialog').close());$('#dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('#profileForm').addEventListener('submit',guarded(async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.target));data.version=profileVersion;if(await mutate('profile',data))await navigate('home');}));
$('#filterForm').addEventListener('submit',guarded(async event=>{event.preventDefault();adminOffset=0;await loadHistory(true);}));
$('#resetFilters').addEventListener('click',guarded(async()=>{$('#filterForm').reset();memberFilter=null;$('#memberFilter').hidden=true;adminOffset=0;await loadHistory(true);}));
$('#inviteForm').addEventListener('submit',guarded(async event=>{event.preventDefault();if(await mutate('invite',{email:event.target.elements.email.value})){event.target.reset();await loadUsers();}}));
$('#moreHistory').addEventListener('click',guarded(async()=>{historyOffset+=50;await loadHistory(false,true);}));
$('#moreAdminHistory').addEventListener('click',guarded(async()=>{adminOffset+=50;await loadHistory(true,true);}));
$('#moreAudit').addEventListener('click',guarded(async()=>{auditOffset+=50;await loadAudit(true);}));
$('#logout').addEventListener('click',()=>{lock();retries.clear();});
window.addEventListener('offline',()=>{fresh=false;$('#sync').textContent='Offline · status unverified';renderPersonal();notice('You are offline. Reconnect to verify your status before checking in or out.',true);});
window.addEventListener('online',()=>refresh(true));
window.addEventListener('pageshow',event=>{if(event.persisted){lock();refresh(true);}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});
setInterval(async()=>{if(document.hidden||busy||document.body.classList.contains('locked'))return;const ok=await refresh();if(ok){renderStats();if(view==='admin'&&!$('#dialog').open&&!$('#staffRecords').contains(document.activeElement)){try{if(staffView==='records'&&adminOffset===0)await loadHistory(true);}catch{}}}if(Date.now()-lastSync>30000){fresh=false;renderPersonal();}},15000);
await refresh(true);
