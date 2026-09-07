"""SQLite layer — raw sqlite3, no ORM.

Tables:
  users         demo accounts + Personal Meeting IDs
  meetings      instant + scheduled + pmi meetings (host_token per meeting)
  participants  joins: display name, host flag, waiting-room admission
  invites       user-to-user meeting invitations (pending/accepted/declined)
  messages      1:1 chat history for the Chat tab
"""
import hashlib
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "zoom.db"

# App-wide password salt. Demo-grade (no per-user salt, no stretching) —
# production uses bcrypt + JWT sessions.
PASSWORD_SALT = "Genisys"


def hash_password(password: str) -> str:
    return hashlib.sha256((PASSWORD_SALT + password).encode()).hexdigest()

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL,
    email   TEXT NOT NULL UNIQUE,
    pmi     TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS meetings (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id          TEXT NOT NULL UNIQUE,
    topic               TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    scheduled_at        TEXT,
    duration_min        INTEGER NOT NULL DEFAULT 30,
    timezone            TEXT NOT NULL DEFAULT 'UTC',
    type                TEXT NOT NULL DEFAULT 'instant',
    passcode            TEXT NOT NULL DEFAULT '',
    waiting_room        INTEGER NOT NULL DEFAULT 1,
    host_video          INTEGER NOT NULL DEFAULT 1,
    participant_video   INTEGER NOT NULL DEFAULT 0,
    audio               TEXT NOT NULL DEFAULT 'both',
    status              TEXT NOT NULL DEFAULT 'scheduled',
    host_id             INTEGER REFERENCES users(id),
    host_token          TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT
);

CREATE TABLE IF NOT EXISTS participants (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id    INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    display_name  TEXT NOT NULL,
    admitted      INTEGER NOT NULL DEFAULT 1,
    joined_at     TEXT NOT NULL DEFAULT (datetime('now')),
    left_at       TEXT
);

CREATE TABLE IF NOT EXISTS invites (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id    INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    from_user_id  INTEGER NOT NULL REFERENCES users(id),
    to_user_id    INTEGER NOT NULL REFERENCES users(id),
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id  INTEGER NOT NULL REFERENCES users(id),
    to_user_id    INTEGER NOT NULL REFERENCES users(id),
    text          TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # rows behave like dicts
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        # Mini-migration: fresh DBs already have these columns via SCHEMA,
        # existing DBs (created before the columns existed) get ALTERed.
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(meetings)")}
        # Dead columns removed (stored but never enforced/read):
        # auth_only (no identity system) and participants.is_host (host_id covers it)
        if "auth_only" in cols:
            conn.execute("ALTER TABLE meetings DROP COLUMN auth_only")
        if "updated_at" not in cols:
            conn.execute("ALTER TABLE meetings ADD COLUMN updated_at TEXT")
        if "host_token" not in cols:
            conn.execute("ALTER TABLE meetings ADD COLUMN host_token TEXT")
        ucols = {r["name"] for r in conn.execute("PRAGMA table_info(users)")}
        if "password_hash" not in ucols:
            conn.execute(
                "ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''"
            )
        pcols = {r["name"] for r in conn.execute("PRAGMA table_info(participants)")}
        if "admitted" not in pcols:
            conn.execute(
                "ALTER TABLE participants ADD COLUMN admitted INTEGER NOT NULL DEFAULT 1"
            )
        if "is_host" in pcols:
            conn.execute("ALTER TABLE participants DROP COLUMN is_host")
