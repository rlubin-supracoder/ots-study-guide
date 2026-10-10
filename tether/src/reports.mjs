import {zipSync,strToU8} from 'fflate';
import {reportTemplate} from './report-template.mjs';
import {AppError,complete,admin} from './validation.mjs';

export const XLSX_TYPE='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const zone='America/Chicago';
const partsFormat=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const displayFormat=new Intl.DateTimeFormat('en-US',{timeZone:zone,dateStyle:'medium',timeStyle:'long'});
const parts=value=>Object.fromEntries(partsFormat.formatToParts(new Date(value)).map(p=>[p.type,p.value]));
const dateKey=p=>`${p.year}-${p.month}-${p.day}`;

// Both UTC hours are scheduled. Only the one corresponding to local 21:00 runs.
export function reportWindow(time) {
  const ms=Number(time);if(!Number.isFinite(ms))return null;
  const p=parts(ms);if(p.hour!=='21')return null;
  return {report_date:dateKey(p),scheduled_for:new Date(Math.floor(ms/3600000)*3600000).toISOString()};
}
export function nextReportAt(time) {
  const start=Math.floor(Date.parse(time)/3600000)*3600000;
  for(let i=1;i<=26;i++){const candidate=start+i*3600000;if(reportWindow(candidate))return new Date(candidate).toISOString();}
  throw new Error('Could not determine next report time.');
}
export function lastName(name) {
  let value=(name||'').trim();if(!value)return '';
  if(value.includes(',')){
    const [first,...rest]=value.split(',');
    if(!/^(?:jr\.?|sr\.?|ii|iii|iv|v)$/i.test(rest.join(',').trim()))return first.trim();
    value=first.trim();
  }
  const words=value.split(/\s+/u);
  while(words.length>1&&/^(?:jr\.?|sr\.?|ii|iii|iv|v)$/i.test(words.at(-1)))words.pop();
  let i=words.length-1;
  while(i>1&&/^(?:de|del|della|der|di|du|la|le|van|von)$/i.test(words[i-1]))i--;
  return words.slice(i).join(' ');
}
const collator=new Intl.Collator('en',{sensitivity:'base',numeric:true});
export function sortedUsers(rows) {
  return rows.map(u=>({...u,last_name:lastName(u.full_name)})).sort((a,b)=>Number(!a.last_name)-Number(!b.last_name)||collator.compare(a.last_name,b.last_name)||collator.compare(a.full_name||'',b.full_name||'')||a.id.localeCompare(b.id));
}
function excelTime(value) {
  if(!value)return null;
  const p=parts(value);
  return (Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-Date.UTC(1899,11,30))/86400000;
}
const escape=value=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const status=u=>u.trip_status==='ACTIVE'?'OFF CAMPUS':complete(u)?'ON CAMPUS':'PROFILE INCOMPLETE';
const overdue=(u,captured)=>u.trip_status==='ACTIVE'&&u.expected_return_at<captured;
export function buildReport(rows,metadata) {
  const sorted=sortedUsers(rows),files={...reportTemplate},path='xl/worksheets/sheet1.xml';
  let sheet=files[path];
  const styleRow=sheet.match(/<x:row r="8"[^>]*>.*?<\/x:row>/s)[0];
  const styles=[...styleRow.matchAll(/<x:c r="[A-O]8" s="(\d+)"/g)].map(m=>m[1]);
  const data=sorted.map((u,index)=>{
    const values=[u.last_name,u.full_name||'',u.flight_number||'',u.room_number||'',u.phone_number||'',status(u),overdue(u,metadata.captured_at)?'Yes':'No',excelTime(u.checked_out_at),excelTime(u.expected_return_at),excelTime(u.checked_in_at),u.destination||'',u.enabled?'Enabled':'Disabled',complete(u)?'Complete':'Incomplete',u.role==='admin'?'Staff':'Member',u.id];
    const row=index+8;
    // Explicit inline strings prevent names/destinations from becoming Excel formulas.
    return `<x:row r="${row}" ht="${Math.max(34,Math.min(150,Math.ceil((u.destination||'').length/38)*15))}" customHeight="1">`+values.map((v,i)=>`<x:c r="${String.fromCharCode(65+i)}${row}" s="${styles[i]}"${typeof v==='number'?' t="n"':' t="inlineStr"'}>${typeof v==='number'?`<x:v>${v}</x:v>`:`<x:is><x:t xml:space="preserve">${escape(v)}</x:t></x:is>`}</x:c>`).join('')+'</x:row>';
  }).join('');
  const end=Math.max(8,sorted.length+7);
  const counts=`${sorted.length} accounts. ${sorted.filter(u=>status(u)==='ON CAMPUS').length} on campus. ${sorted.filter(u=>status(u)==='OFF CAMPUS').length} off campus. ${sorted.filter(u=>overdue(u,metadata.captured_at)).length} overdue. ${sorted.filter(u=>!complete(u)).length} incomplete profiles.`;
  sheet=sheet.replace(styleRow,data).replace('{{scheduled}}',escape(displayFormat.format(new Date(metadata.scheduled_for)))).replace('{{captured}}',escape(displayFormat.format(new Date(metadata.captured_at)))).replace('{{counts}}',escape(counts));
  sheet=sheet.replace('</x:sheetData>',`</x:sheetData><x:autoFilter ref="A7:O${end}" />`);
  sheet=sheet.replace('sqref="F8:F8"',`sqref="F8:F${end}"`).replace('sqref="G8:G8"',`sqref="G8:G${end}"`);
  sheet=sheet.replace('text="OFF CAMPUS" />','text="OFF CAMPUS"><x:formula>NOT(ISERROR(SEARCH("OFF CAMPUS",F8)))</x:formula></x:cfRule>').replace('text="Yes" />','text="Yes"><x:formula>NOT(ISERROR(SEARCH("Yes",G8)))</x:formula></x:cfRule>');
  files[path]=sheet;
  return zipSync(Object.fromEntries(Object.entries(files).map(([name,xml])=>[name,strToU8(xml)])),{level:6});
}

export function captureReport(db,scheduledTime) {
  const window=reportWindow(scheduledTime),captured_at=db.clock();
  // Never label a later day's current state as a missed historical snapshot.
  if(!window||reportWindow(Date.parse(captured_at))?.report_date!==window.report_date)return null;
  return db.storage.transactionSync(()=>{
    if(db.one('SELECT report_date FROM daily_reports WHERE report_date=?',window.report_date))return {created:false,report_date:window.report_date};
    const rows=db.rows(`SELECT u.id,u.full_name,u.flight_number,u.room_number,u.phone_number,u.enabled,u.role,
      c.status AS trip_status,c.destination,c.checked_out_at,c.expected_return_at,c.checked_in_at
      FROM users u LEFT JOIN checkouts c ON c.id=(SELECT id FROM checkouts WHERE user_id=u.id
      ORDER BY (status='ACTIVE') DESC,COALESCE(checked_in_at,checked_out_at) DESC,checked_out_at DESC,id DESC LIMIT 1)`);
    const file=buildReport(rows,{...window,captured_at});
    if(file.byteLength>1800000)throw new Error('Daily report exceeds storage limit.');
    db.sql.exec('INSERT INTO daily_reports(report_date,scheduled_for,captured_at,user_count,file) VALUES (?,?,?,?,?)',window.report_date,window.scheduled_for,captured_at,rows.length,file);
    db.audit(null,null,null,'DAILY_REPORT_CREATED',{report_date:window.report_date,user_count:rows.length,scheduled_for:window.scheduled_for,captured_at},captured_at);
    return {created:true,report_date:window.report_date};
  });
}
export function listReports(db,user,before) {
  admin(user);
  if(before!==undefined&&!/^\d{4}-\d{2}-\d{2}$/.test(before))throw new AppError('Invalid report date.');
  const reports=db.rows('SELECT report_date,scheduled_for,captured_at,user_count FROM daily_reports WHERE report_date<? ORDER BY report_date DESC LIMIT 32',before||'9999-99-99');
  return {reports:reports.slice(0,31),more:reports.length>31,next_at:nextReportAt(db.clock())};
}
export function readReport(db,user,date) {
  admin(user);
  const report=db.one('SELECT file FROM daily_reports WHERE report_date=?',date);
  if(!report)throw new AppError('This daily report is not available.',404);
  db.audit(user.id,null,null,'DAILY_REPORT_DOWNLOADED',{report_date:date},db.clock());
  return report.file;
}
