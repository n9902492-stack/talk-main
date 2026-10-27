CREATE TABLE scheduling_metric_visits (
 event_id TEXT NOT NULL REFERENCES scheduling_events(id), token_hash TEXT NOT NULL, selected INTEGER NOT NULL DEFAULT 0,
 completed INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, PRIMARY KEY(event_id,token_hash)
);
CREATE TABLE scheduling_conversions (
 event_id TEXT NOT NULL REFERENCES scheduling_events(id), local_date TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind='completion'),
 count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(event_id,local_date,kind)
);
