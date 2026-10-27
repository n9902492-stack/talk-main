import test from 'node:test';
import assert from 'node:assert/strict';
import {openPostgresDatabase} from '../backend/src/postgres-database.mjs';
import {resetHarness} from './helpers/password-reset.mjs';
const enabled=process.env.TALK_POSTGRES_TEST==='1'&&process.env.PGHOST==='127.0.0.1'&&process.env.PGDATABASE==='talk_auth_test';
test('real PostgreSQL reset migration, delivery claim, verification and atomic password/session update',{skip:!enabled},async t=>{
  const database=await openPostgresDatabase(process.env,{migrate:true}),h=await resetHarness({database});t.after(async()=>{await h.close();await database.close();});
  const account=await h.verified('reset-postgres@example.test'),user=h.client();
  assert.ok(await database.withContext(()=>database.prepare("SELECT version FROM schema_migrations WHERE version='008_password_reset.sql'").get()));
  assert.equal((await user.reset('request',{email:'reset-postgres@example.test'})).status,202);await h.flush();assert.ok(h.code());
  assert.equal((await user.reset('verify',{code:h.code()})).status,200);
  const results=await Promise.all([user.reset('complete',{password:'postgres new password',confirmPassword:'postgres new password'}),user.reset('complete',{password:'postgres new password',confirmPassword:'postgres new password'})]);
  assert.equal(results.filter(r=>r.status===200).length,1);assert.equal((await account.request('session')).body.user,null);
  assert.equal((await user.post('email/login',{email:'reset-postgres@example.test',password:h.password})).status,401);
  assert.equal((await user.post('email/login',{email:'reset-postgres@example.test',password:'postgres new password'})).status,200);
});
