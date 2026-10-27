function repository(db) {
  const get = (sql, ...p) => db.prepare(sql).get(...p), all = (sql, ...p) => db.prepare(sql).all(...p), run = (sql, ...p) => db.prepare(sql).run(...p);
  const transaction = async (host, fn) => {
    await db.exec("BEGIN IMMEDIATE");
    try {
      await db.lockIdentity(`scheduling:${host}`);
      const result = await fn();
      await db.exec("COMMIT");
      return result;
    } catch (e) {
      await db.exec("ROLLBACK");
      throw e;
    }
  };
  const profile = async (id) => {
    const row = await get("SELECT * FROM scheduling_profiles WHERE host_id=?", id);
    return row ? { ...row, settings: JSON.parse(row.settings) } : null;
  };
  const event = async (id) => {
    const row = await get("SELECT * FROM scheduling_events WHERE id=?", id);
    return row ? { ...row, settings: JSON.parse(row.settings) } : null;
  };
  const occurrenceRows = (host, from, to) => all("SELECT o.*,(SELECT COUNT(*) FROM scheduling_bookings b WHERE b.occurrence_id=o.id AND b.status='confirmed') AS count FROM scheduling_occurrences o WHERE host_id=? AND ends_at>? AND starts_at<? AND status='confirmed'", host, from, to);
  return { db, get, all, run, transaction, profile, event, occurrenceRows };
}
export {
  repository
};
