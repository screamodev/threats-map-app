PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS raw_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id   INTEGER NOT NULL,
  channel_id    INTEGER NOT NULL,
  channel_name  TEXT NOT NULL,
  text          TEXT NOT NULL,
  timestamp     INTEGER NOT NULL,
  received_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  processed     INTEGER NOT NULL DEFAULT 0,
  UNIQUE(channel_id, telegram_id)
);

CREATE TABLE IF NOT EXISTS parsed_events (
  id              TEXT PRIMARY KEY,
  raw_message_id  INTEGER NOT NULL REFERENCES raw_messages(id),
  event_type      TEXT NOT NULL,
  weapon_type     TEXT,
  weapon_count    INTEGER DEFAULT 1,
  location_name   TEXT,
  location_lat    REAL,
  location_lng    REAL,
  heading_name    TEXT,
  heading_lat     REAL,
  heading_lng     REAL,
  via_name        TEXT,
  via_lat         REAL,
  via_lng         REAL,
  confidence      REAL NOT NULL DEFAULT 0.5,
  parser_layer    TEXT NOT NULL,
  is_preliminary  INTEGER DEFAULT 0,
  is_correction   INTEGER DEFAULT 0,
  incident_id     TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  filtered_out    INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS incidents (
  id              TEXT PRIMARY KEY,
  weapon_type     TEXT NOT NULL,
  weapon_count    INTEGER DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'active',
  first_seen_at   INTEGER NOT NULL,
  last_updated_at INTEGER NOT NULL,
  source_channels TEXT NOT NULL DEFAULT '[]',
  confidence      REAL NOT NULL DEFAULT 0.5,
  trajectory      TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS gazetteer (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical TEXT NOT NULL,
  lat       REAL NOT NULL,
  lng       REAL NOT NULL,
  type      TEXT NOT NULL,
  parent    TEXT,
  aliases   TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS unmatched_locations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL UNIQUE,
  occurrence_count INTEGER DEFAULT 1,
  resolved         INTEGER DEFAULT 0,
  created_at       INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_raw_messages_processed ON raw_messages(processed);
CREATE INDEX IF NOT EXISTS idx_raw_messages_timestamp ON raw_messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_parsed_events_incident ON parsed_events(incident_id);
CREATE INDEX IF NOT EXISTS idx_parsed_events_created ON parsed_events(created_at);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_last_updated ON incidents(last_updated_at);
CREATE INDEX IF NOT EXISTS idx_gazetteer_canonical ON gazetteer(canonical);
