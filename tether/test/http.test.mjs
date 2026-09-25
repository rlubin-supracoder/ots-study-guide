import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT,createLocalJWKSet,exportJWK} from 'jose';
import {fixture} from './helpers.mjs';
import {serveRequest} from '../src/http.mjs';
import {databaseRequest} from '../src/service.mjs';
import {verifyToken} from '../src/auth.mjs';
const {privateKey,publicKey}=await generateKeyPair('RS256');
const keys=createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:'test',alg:'RS256'}]});
const envBase={APP_ORIGIN:'https://tether.test',ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',ACCESS_AUD:'test-audience'};
async function token(email='staff@example.test',options={}){return new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('test-user').setIssuedAt().setIssuer('https://test.cloudflareaccess.com').setAudience(options.audience||'test-audience').setExpirationTime(options.exp||'5m').sign(privateKey);}
function harness(){const f=fixture();const env={...envBase,ACCOUNTABILITY:{idFromName:v=>v,get:()=>({fetch:r=>databaseRequest(f.db,r)})},ASSETS:{fetch:async()=>new Response('Private application')}};return {...f,request:async(path,jwt,body,headers={})=>{const req=new Request(env.APP_ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{...(jwt?{'Cf-Access-Jwt-Assertion':jwt}:{}),...(body?{'Content-Type':'application/json','Origin':env.APP_ORIGIN,'X-Tether-Request':'1'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});return serveRequest(req,env,(r,e)=>verifyToken(r.headers.get('Cf-Access-Jwt-Assertion'),e,keys));},env};}
test('anonymous app, assets and APIs deny all private content',async()=>{const h=harness();for(const path of ['/','/app.js','/api/state','/api/admin/users']){const r=await h.request(path);assert.equal(r.status,401);assert.equal(r.headers.get('Cache-Control'),'no-store, max-age=0');assert.match(r.headers.get('X-Robots-Tag'),/noindex/);}});
test('forged, expired and wrong-audience JWTs cannot authenticate',async()=>{const h=harness();for(const jwt of ['not-a-jwt',await token(undefined,{exp:1}),await token(undefined,{audience:'other'})])assert.equal((await h.request('/api/state',jwt)).status,401);});
test('a verified email is insufficient without membership approval',async()=>{const h=harness();assert.equal((await h.request('/',await token('stranger@example.test'))).status,403);});
test('member and admin login; staff APIs enforce roles and CSRF',async()=>{
  const h=harness();h.invite('member@example.test');const jwt=await token('member@example.test');assert.equal((await h.request('/api/state',jwt)).status,200);
  assert.equal((await h.request('/api/admin/users',jwt,{})).status,403);assert.equal((await h.request('/api/admin/users',await token(),{})).status,200);
  assert.equal((await h.request('/api/action',jwt,{action:'profile'},{Origin:'https://evil.test'})).status,403);
  assert.equal((await h.request('/api/action',jwt,{action:'profile'},{'X-Tether-Request':''})).status,403);
});
test('twenty near-simultaneous checkout requests create exactly one trip',async()=>{
  const h=harness();h.setup(h.staff().email);const jwt=await token(),data={destination:'Testing',expected_return_at:'2026-09-25T22:00:00.000Z',version:h.staff().version};
  const responses=await Promise.all(Array.from({length:20},()=>h.request('/api/action',jwt,{request_id:crypto.randomUUID(),action:'checkout',data})));
  assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal(responses.filter(r=>r.status===409).length,19);assert.equal(h.db.one('SELECT COUNT(*) n FROM checkouts').n,1);
});
test('database outages fail closed without leaking error details',async()=>{
  const h=harness();h.env.ACCOUNTABILITY.get=()=>({fetch(){throw new Error('secret database detail');}});
  const r=await h.request('/api/state',await token());assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/secret database/);
});
test('HTTP redirects to HTTPS and unknown hosts fail closed',async()=>{
  const h=harness();const r=await serveRequest(new Request('http://tether.test/'),h.env);assert.equal(r.status,308);assert.equal(r.headers.get('Location'),'https://tether.test/');
  assert.equal((await serveRequest(new Request('https://other.test/'),h.env)).status,404);
});
