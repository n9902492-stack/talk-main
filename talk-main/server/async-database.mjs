import { AsyncLocalStorage } from 'node:async_hooks';

/** Request-scoped transactions across async SQL calls, retaining local SQLite. */
export function asyncDatabase(driver) {
  if (driver.isAsyncAuthDatabase) return driver;
  const context = new AsyncLocalStorage();
  let sqliteOwner = null;
  let waiters = [];
  const wake = () => { const pending = waiters; waiters = []; for (const resolve of pending) resolve(); };
  const current = () => {
    const value = context.getStore();
    if (!value) throw new Error('Authentication database requires a request context.');
    return value;
  };
  const query = async (sql, params, single, change) => {
    const state = current();
    if (state.closed) throw new Error('Authentication request ended.');
    if (driver.kind === 'postgres') {
      const result = await (state.client || driver.pool).query(driver.parameterize(sql), params);
      return change ? { changes: result.rowCount } : single ? result.rows[0] : result.rows;
    }
    // SQLite is synchronous, but an async transaction must exclude queries from
    // other requests until its commit/rollback. Hashing/SMTP outside a transaction
    // remain concurrent, preserving cancellation and verification race checks.
    while (sqliteOwner && sqliteOwner !== state) await new Promise(resolve => waiters.push(resolve));
    if (state.closed) throw new Error('Authentication request ended.');
    const statement = driver.prepare(sql);
    return change ? statement.run(...params) : single ? statement.get(...params) : statement.all(...params);
  };
  async function exec(sql) {
    const state = current();
    const begin = sql === 'BEGIN IMMEDIATE';
    const finish = sql === 'COMMIT' || sql === 'ROLLBACK';
    if (state.closed && sql !== 'ROLLBACK') throw new Error('Authentication request ended.');
    if (driver.kind === 'postgres') {
      if (begin) {
        if (state.client) throw new Error('Nested authentication transaction.');
        state.client = await driver.pool.connect();
        if (state.closed) { state.client.release(); state.client = null; throw new Error('Authentication request ended.'); }
        try { await state.client.query('BEGIN'); } catch (error) { state.client.release(error); state.client = null; throw error; }
      } else if (finish) {
        if (!state.client) return;
        const client = state.client;
        state.client = null;
        let failure;
        try { await client.query(sql); } catch (error) { failure = error; throw error; } finally { client.release(failure); }
      } else await (state.client || driver.pool).query(sql);
      return;
    }
    // Re-check after every await before taking ownership; checking and assigning
    // the owner must occur together in one JavaScript turn.
    while (sqliteOwner && sqliteOwner !== state) await new Promise(resolve => waiters.push(resolve));
    if (finish && sqliteOwner !== state) return;
    if (begin) sqliteOwner = state;
    try { driver.exec(sql); }
    catch (error) { if (begin) { sqliteOwner = null; wake(); } throw error; }
    finally { if (finish && sqliteOwner === state) { sqliteOwner = null; wake(); } }
  }
  const adapter = {
    isAsyncAuthDatabase: true,
    kind: driver.kind || 'sqlite',
    prepare: sql => ({ get: (...params) => query(sql, params, true, false), all: (...params) => query(sql, params, false, false), run: (...params) => query(sql, params, false, true) }),
    exec,
    async lockIdentity(value) {
      const state = current();
      if (driver.kind === 'postgres') {
        if (!state.client) throw new Error('Identity locking requires a transaction.');
        await state.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [value]);
      }
    },
    async lockSession(hash) {
      const state = current();
      if (driver.kind === 'postgres') {
        if (!state.client) throw new Error('Session locking requires a transaction.');
        await state.client.query('SELECT token_hash FROM sessions WHERE token_hash=$1 FOR UPDATE', [hash]);
      }
    },
    middleware(req, res, next) {
      const state = { client: null, closed: false };
      const close = () => {
        if (state.closed) return;
        state.closed = true;
        // Unexpected disconnects/errors cannot leave an open transaction/pool
        // lease. Normal routes commit before sending a response.
        context.run(state, () => { void exec('ROLLBACK').catch(() => {}); });
      };
      res.once('finish', close); res.once('close', close);
      context.run(state, next);
    },
    withContext: operation => context.run({ client: null, closed: false }, operation),
    close: () => driver.kind === 'postgres' ? driver.pool.end() : driver.close(),
  };
  return adapter;
}
