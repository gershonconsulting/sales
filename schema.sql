CREATE TABLE IF NOT EXISTS boxes (
  key TEXT PRIMARY KEY,
  name TEXT,
  stage TEXT,
  notes TEXT,
  owner TEXT,
  emails TEXT,
  last_in INTEGER,
  last_out INTEGER,
  last_update INTEGER,
  synced_at INTEGER
);
CREATE TABLE IF NOT EXISTS touches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  box_key TEXT,
  channel TEXT,
  at INTEGER,
  note TEXT
);
CREATE INDEX IF NOT EXISTS touches_box ON touches(box_key);
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  box_key TEXT,
  channel TEXT,
  to_addr TEXT,
  subject TEXT,
  body TEXT,
  status TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, salt TEXT, hash TEXT);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, email TEXT, expires INTEGER);
