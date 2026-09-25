import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {Database} from '../src/database.mjs';
export const migration=readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8');
export function storage(filename=':memory:') {
  const sqlite=new DatabaseSync(filename);sqlite.exec('PRAGMA foreign_keys=ON');
  return {sqlite,sql:{exec(query,...params){if(!params.length&&query.includes(';')){sqlite.exec(query);return [];}return sqlite.prepare(query).all(...params);}},transactionSync(fn){sqlite.exec('BEGIN IMMEDIATE');try{const result=fn();sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
}
export function fixture(filename) {
  const s=storage(filename);let time='2026-09-25T17:00:00.000Z';
  const db=new Database(s,[{version:1,sql:migration}],'staff@example.test',()=>time);
  const send=(email,action,data={},request_id=crypto.randomUUID())=>{const body={action,data,request_id};return db.mutate(email,body,JSON.stringify(body));};
  const staff=()=>db.authorize('staff@example.test');
  const invite=address=>send(staff().email,'invite',{email:address});
  const setup=(address,name='Test Member')=>send(address,'profile',{full_name:name,flight_number:'27-01',room_number:'101',phone_number:'3345550123',version:db.authorize(address).version});
  const checkout=address=>send(address,'checkout',{destination:'Test destination',expected_return_at:'2026-09-25T22:00:00.000Z',version:db.authorize(address).version});
  return {db,s,send,staff,invite,setup,checkout,setTime:v=>{time=v;}};
}
