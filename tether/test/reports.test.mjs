import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {fixture,storage,migrations} from './helpers.mjs';
import {Database} from '../src/database.mjs';
import {buildReport,captureReport,lastName,sortedUsers,reportWindow,nextReportAt,listReports,readReport,XLSX_TYPE} from '../src/reports.mjs';
import {databaseRequest} from '../src/service.mjs';
import {digest} from '../src/auth.mjs';

const time='2026-09-26T02:00:00.000Z';
const xml=file=>strFromU8(unzipSync(new Uint8Array(file))['xl/worksheets/sheet1.xml']);
function prepared(){
  const f=fixture();
  for(const [address,name]of [['b@example.test','Alex Baker Jr.'],['a@example.test','Zoë Adams'],['c@example.test','Taylor Clark']]){f.invite(address);f.setup(address,name);}
  f.checkout('b@example.test');
  const closed=f.checkout('c@example.test');f.send('c@example.test','checkin',{record_id:closed.record_id});
  f.db.sql.exec('UPDATE users SET enabled=0 WHERE email=?','c@example.test');
  f.setTime(time);return f;
}

test('21:00 Central scheduling follows DST without double reports',()=>{
  for(const value of ['2026-07-02T02:00:00Z','2026-03-09T02:00:00Z','2026-11-02T03:00:00Z','2026-01-02T03:00:00Z'])assert.ok(reportWindow(Date.parse(value)));
  for(const value of ['2026-07-02T03:00:00Z','2026-01-02T02:00:00Z','2026-03-08T02:00:00Z','2026-11-01T03:00:00Z'])assert.equal(reportWindow(Date.parse(value)),null);
  assert.equal(reportWindow(Date.parse('2026-07-02T02:55:00Z')).scheduled_for,'2026-07-02T02:00:00.000Z');
  assert.equal(nextReportAt('2026-03-08T03:01:00Z'),'2026-03-09T02:00:00.000Z');
  assert.equal(nextReportAt('2026-11-01T02:01:00Z'),'2026-11-02T03:00:00.000Z');
  assert.equal(reportWindow(NaN),null);
});
test('last-name sorting retains original names and handles suffixes, commas and blank profiles',()=>{
  assert.equal(lastName('Alex Baker Jr.'),'Baker');assert.equal(lastName('Alex Baker, Jr.'),'Baker');assert.equal(lastName('Smith, Jordan'),'Smith');
  assert.equal(lastName('Riley de la Cruz'),'de la Cruz');assert.equal(lastName('Dana Van Buren III'),'Van Buren');
  const names=['Taylor Clark','Alex Baker Jr.','Zoë Adams',null,'Smith, Jordan'];
  assert.deepEqual(sortedUsers(names.map((full_name,id)=>({id:String(id),full_name}))).map(u=>u.full_name),['Zoë Adams','Alex Baker Jr.','Taylor Clark','Smith, Jordan',null]);
});
test('report captures all accounts atomically, keeps history, and never overwrites a saved date',()=>{
  const f=prepared(),before=JSON.stringify(f.db.rows('SELECT * FROM users'));
  assert.equal(captureReport(f.db,Date.parse(time)).created,true);
  const listing=listReports(f.db,f.staff());assert.equal(listing.reports[0].user_count,4);
  const original=readReport(f.db,f.staff(),'2026-09-25'),sheet=xml(original);
  assert.ok(sheet.indexOf('Zoë Adams')<sheet.indexOf('Alex Baker Jr.'));
  for(const value of ['OFF CAMPUS','ON CAMPUS','PROFILE INCOMPLETE','Disabled','(334) 555-0123','Test destination'])assert.ok(sheet.includes(value),value);
  assert.ok(sheet.includes('t="n"><x:v>'));assert.ok(sheet.includes('x:autoFilter ref="A7:O11"'));
  assert.equal(JSON.stringify(f.db.rows('SELECT * FROM users')),before);
  const active=f.db.one("SELECT id FROM checkouts WHERE status='ACTIVE'");
  f.setTime('2026-09-26T02:05:00.000Z');f.send('b@example.test','checkin',{record_id:active.id});
  assert.equal(captureReport(f.db,Date.parse('2026-09-26T02:05:00Z')).created,false);
  assert.deepEqual(readReport(f.db,f.staff(),'2026-09-25'),original);
  const reopened=new Database(f.s,migrations,'staff@example.test',()=>time);
  assert.deepEqual(readReport(reopened,f.staff(),'2026-09-25'),original);
  assert.equal(f.db.one("SELECT COUNT(*) n FROM audit WHERE action='DAILY_REPORT_CREATED'").n,1);
});
test('late reports disclose actual capture and stale schedules cannot fabricate a prior date',()=>{
  const f=prepared();f.setTime('2026-09-26T02:05:23.000Z');captureReport(f.db,Date.parse(time));
  const row=listReports(f.db,f.staff()).reports[0];assert.equal(row.captured_at,'2026-09-26T02:05:23.000Z');assert.equal(row.scheduled_for,time);
  f.setTime('2026-09-27T02:00:00.000Z');assert.equal(captureReport(f.db,Date.parse(time)),null);
  f.setTime('2026-09-26T03:00:00.000Z');assert.equal(captureReport(f.db,Date.parse(time)),null);
});
test('report migration preserves every prior table, session, PIN and active trip',()=>{
  const f=prepared();f.db.sql.exec('DROP TABLE daily_reports');f.db.sql.exec('DELETE FROM schema_migrations WHERE version=4');
  const tables=['users','checkouts','sessions','profile_pins','audit','metadata'];
  const before=JSON.stringify(tables.map(t=>f.db.rows('SELECT * FROM '+t)));
  new Database(f.s,migrations,'staff@example.test',()=>time);
  assert.equal(JSON.stringify(tables.map(t=>f.db.rows('SELECT * FROM '+t))),before);
});
test('Excel contains safe literal strings, Central numeric dates, filters and frozen headers for 200 users',()=>{
  const rows=Array.from({length:200},(_,i)=>({id:String(i),full_name:`Member Surname${i}`,flight_number:'001',room_number:'001',phone_number:'(334) 555-0123',enabled:1,role:'member',trip_status:'ACTIVE',checked_out_at:time,expected_return_at:'2026-09-26T03:00:00.000Z',destination:'=HYPERLINK("https://invalid.test", "A&B <text>")'}));
  const file=buildReport(rows,{scheduled_for:time,captured_at:time}),sheet=xml(file);
  assert.ok(file.length<1800000);assert.equal((sheet.match(/<x:row /g)||[]).length,207);
  assert.ok(!sheet.includes('<x:f>'));assert.ok(sheet.includes('=HYPERLINK(&quot;https://invalid.test&quot;, &quot;A&amp;B &lt;text&gt;&quot;)'));
  assert.ok(sheet.includes('topLeftCell="C8"'));assert.ok(sheet.includes('ref="A7:O207"'));
  const serial=Number(sheet.match(/<x:c r="H8"[^>]*><x:v>([^<]+)/)[1]);
  assert.equal(new Date(Date.UTC(1899,11,30)+serial*86400000).toISOString(),'2026-09-25T21:00:00.000Z');
});
test('listing is paginated and never returns workbook bytes or personal fields',()=>{
  const f=prepared();
  for(let i=1;i<=40;i++){const date=new Date(Date.UTC(2026,7,i)).toISOString().slice(0,10);f.db.sql.exec('INSERT INTO daily_reports VALUES (?,?,?,?,?)',date,time,time,0,new Uint8Array([1]));}
  const first=listReports(f.db,f.staff());assert.equal(first.reports.length,31);assert.equal(first.more,true);
  assert.deepEqual(Object.keys(first.reports[0]).sort(),['captured_at','report_date','scheduled_for','user_count']);
  const second=listReports(f.db,f.staff(),first.reports.at(-1).report_date);assert.equal(second.reports.length,9);assert.equal(second.more,false);
  assert.throws(()=>listReports(f.db,f.staff(),"' OR 1=1"));
});
test('only approved 27-01 staff can list/download; anonymous, members and scoped staff are denied',async()=>{
  const f=prepared();captureReport(f.db,Date.parse(time));
  const env={BOOTSTRAP_ADMIN_EMAIL:'staff@example.test',STAFF_EMAILS_27_02:'second@example.test',MEMBER_PASSWORD:'test-password'};
  const call=(path,headers={},method='GET')=>databaseRequest(f.db,new Request('https://internal'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({method,body:{}})}),env);
  const staff={'X-Tether-Mode':'staff','X-Verified-Email':'staff@example.test'};
  const path='/api/admin/reports/2026-09-25.xlsx';
  for(const url of ['/api/admin/reports',path]){
    assert.equal((await call(url)).status,401);
    assert.equal((await call(url,{'X-Tether-Mode':'staff','X-Verified-Email':'second@example.test'})).status,403);
    assert.equal((await call(url,{...staff,'X-Tether-Class':'27-02'})).status,403);
  }
  const pass=await digest(env.MEMBER_PASSWORD);f.db.createSession('gate','gate',null,pass);f.db.createSession('device','device',f.staff().id);
  const device={'X-Member-gate':'gate','X-Member-device':'device'};
  assert.equal((await call(path,device)).status,403);
  const response=await call(path,staff);assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),XLSX_TYPE);
  assert.match(response.headers.get('Cache-Control'),/no-store/);assert.match(response.headers.get('Content-Disposition'),/attachment/);assert.match(response.headers.get('X-Robots-Tag'),/noindex/);
  assert.ok((await response.arrayBuffer()).byteLength>1000);
  assert.equal((await call('/api/admin/reports/2025-01-01.xlsx',staff)).status,404);
  assert.equal((await call(path,staff,'POST')).status,404);
  assert.throws(()=>readReport(f.db,{role:'member'},'2026-09-25'));
});
