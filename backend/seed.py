"""Seed the DB: demo users + permanent PMI rooms + sample meetings.

Only TWO users exist (user1, user2 — password == name). No dummy user.
Idempotent and non-destructive: inserts only what is missing,
never deletes. Run with:
    .venv/bin/python seed.py

Demo logins (password == name):
    user1 / user1      user2 / user2
"""
from datetime import datetime, timedelta

from database import get_conn, hash_password, init_db

USERS = [
    # id, name, email, pmi, password
    (2, "user1", "user1@example.com", "1111111111", "user1"),
    (3, "user2", "user2@example.com", "2222222222", "user2"),
]


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M")


def ensure_meeting(conn, meeting_id: str, topic: str, **cols) -> None:
    """Insert only when this meeting_id is not already present."""
    exists = conn.execute(
        "SELECT 1 FROM meetings WHERE meeting_id = ?", (meeting_id,)
    ).fetchone()
    if exists:
        return
    keys = ["meeting_id", "topic", *cols.keys()]
    placeholders = ", ".join(["?"] * len(keys))
    conn.execute(
        f"INSERT INTO meetings ({', '.join(keys)}) VALUES ({placeholders})",
        (meeting_id, topic, *cols.values()),
    )


def main() -> None:
    init_db()
    now = datetime.now()
    with get_conn() as conn:
        for uid, name, email, pmi, password in USERS:
            conn.execute(
                """INSERT INTO users (id, name, email, pmi, password_hash)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash""",
                (uid, name, email, pmi, hash_password(password)),
            )
            # Permanent PMI room per user: idle until the host Starts it,
            # then guests get the waiting room (never listed — live/idle only)
            ensure_meeting(
                conn, pmi, f"{name}'s Personal Meeting Room",
                type="pmi", status="idle", host_id=uid,
            )

        ensure_meeting(
            conn, "1112223330", "Design Sync",
            scheduled_at=iso(now + timedelta(days=1, hours=2)),
            duration_min=30, type="scheduled", status="scheduled", host_id=1,
        )
        ensure_meeting(
            conn, "1112223331", "Team Standup",
            scheduled_at=iso(now + timedelta(days=2, hours=-4)),
            duration_min=15, type="scheduled", status="scheduled", host_id=1,
        )
        # Cross-user test meetings (each user hosts one, the other joins)
        ensure_meeting(
            conn, "1217149015", "User1 Team Sync",
            scheduled_at=iso(now + timedelta(hours=3)),
            duration_min=45, type="scheduled", status="scheduled", host_id=2,
        )
        ensure_meeting(
            conn, "1112223330", "Design Sync",
            scheduled_at=iso(now + timedelta(days=1, hours=2)),
            duration_min=30, type="scheduled", status="scheduled", host_id=1,
        )
        ensure_meeting(
            conn, "123456789", "Weekly Review",
            duration_min=42, type="instant", status="ended", host_id=1,
        )
        ensure_meeting(
            conn, "987654321", "Client Demo",
            duration_min=28, type="instant", status="ended", host_id=1,
        )

    print("seed ok (missing rows inserted, existing data untouched)")


if __name__ == "__main__":
    main()
