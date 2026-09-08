"""Zoom Clone API — FastAPI + SQLite.

Security model (demo-grade, explained honestly in README):
  login session   HttpOnly cookie (zc_session) → server-side sessions table.
                  Every host op checks the caller OWNS the meeting.
  passcode        guest entry gate, never returned in public responses.
  host_token      per-meeting capability for the WS + waiting-room bypass,
                  returned ONCE at create/claim.
"""
import os
import random
import secrets
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from database import get_conn, hash_password, init_db

SESSION_COOKIE = "zc_session"
SESSION_DAYS = 7


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()  # create tables on startup
    # Self-seed demo data (idempotent): free-tier disks wipe SQLite on
    # sleep/restart and there's no Shell access, so the app must be
    # usable immediately after every boot with zero manual steps.
    try:
        from seed import main as run_seed
        run_seed()
    except Exception:
        pass  # DB stays usable; endpoints report their own errors
    yield


app = FastAPI(title="Zoom Clone API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # Comma-separated in prod, e.g. FRONTEND_ORIGIN=https://zoom-clone.vercel.app
    allow_origins=[o.strip() for o in os.environ.get(
        "FRONTEND_ORIGIN", "http://localhost:3000").split(",") if o.strip()],
    allow_credentials=True,  # lets the browser send the session cookie
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- request shapes ----------

class InstantCreate(BaseModel):
    display_name: str = "John Doe"


class ScheduledCreate(BaseModel):
    topic: str
    description: str = ""
    date: str  # "2026-09-08"
    time: str  # "14:00"
    duration_min: int = 30
    timezone: str = "UTC"
    use_pmi: bool = False
    passcode: str = ""
    waiting_room: bool = True
    host_video: bool = True
    participant_video: bool = False
    audio: str = "both"


class JoinCreate(BaseModel):
    display_name: str
    passcode: str = ""
    host_token: str = ""


class MeetingUpdate(BaseModel):
    topic: Optional[str] = None
    passcode: Optional[str] = None
    waiting_room: Optional[bool] = None


class LoginRequest(BaseModel):
    name: str
    password: str = ""


class InviteRequest(BaseModel):
    to_user_id: int


class ChatSend(BaseModel):
    to_user_id: int
    text: str


# ---------- helpers ----------

def row_to_meeting(row: sqlite3.Row) -> dict:
    """Public serializer — host_token and passcode NEVER leave the server.
    Callers that must return them (create/claim) attach explicitly.
    has_passcode tells the UI whether to show a passcode field."""
    m = dict(row)
    m.pop("host_token", None)
    m["has_passcode"] = bool(m.pop("passcode", ""))
    # SQLite has no bool: 0/1 -> True/False for the frontend
    for k in ("waiting_room", "host_video", "participant_video"):
        m[k] = bool(m[k])
    return m


def require_session(request: Request) -> sqlite3.Row:
    """Who's calling, from the HttpOnly session cookie. No cookie or
    unknown token -> 401. This is what makes per-user auth real:
    endpoints compare THIS id against meeting.host_id."""
    token = request.cookies.get(SESSION_COOKIE, "")
    if token:
        with get_conn() as conn:
            user = conn.execute(
                """SELECT u.id, u.name, u.email, u.pmi FROM users u
                   JOIN sessions s ON s.user_id = u.id WHERE s.token = ?""",
                (token,),
            ).fetchone()
            if user:
                return user
    raise HTTPException(status_code=401, detail="Not signed in")


def require_host(meeting_id: str, request: Request) -> sqlite3.Row:
    """The meeting row, if the caller owns it — else 403.
    user2 can no longer touch user1's meetings, even with direct API calls."""
    with get_conn() as conn:
        row = get_meeting_or_404(conn, meeting_id)
        user = session_user(request)
        if not user or user["id"] != row["host_id"]:
            raise HTTPException(status_code=403, detail="Host only")
        return row


def session_user(request: Request) -> Optional[sqlite3.Row]:
    """Same lookup as require_session, but returns None instead of 401."""
    try:
        return require_session(request)
    except HTTPException:
        return None


# Brute-force guard: passcodes are 6 digits, so unlimited tries = crackable.
# Per-meeting fail counter with a 60s lock. In-memory (resets on restart)
# and demo-simple — production uses Redis + backoff.
MAX_PASSCODE_FAILS = 5
PASSCODE_LOCK_SECONDS = 60
_passcode_attempts: dict[str, dict] = {}


def check_passcode_gate(mid: str) -> None:
    a = _passcode_attempts.get(mid)
    if a and a["fails"] >= MAX_PASSCODE_FAILS and time.time() < a["locked_until"]:
        raise HTTPException(
            status_code=429, detail="Too many wrong passcodes — try again in a minute"
        )


def register_passcode_fail(mid: str) -> None:
    a = _passcode_attempts.setdefault(mid, {"fails": 0, "locked_until": 0.0})
    a["fails"] += 1
    if a["fails"] >= MAX_PASSCODE_FAILS:
        a["locked_until"] = time.time() + PASSCODE_LOCK_SECONDS


def reset_passcode_gate(mid: str) -> None:
    _passcode_attempts.pop(mid, None)


def generate_meeting_id(conn: sqlite3.Connection) -> str:
    """Random 10-digit ID, retry until unique."""
    while True:
        mid = "".join(random.choices("0123456789", k=10))
        exists = conn.execute(
            "SELECT 1 FROM meetings WHERE meeting_id = ?", (mid,)
        ).fetchone()
        if not exists:
            return mid


def get_meeting_or_404(conn: sqlite3.Connection, meeting_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM meetings WHERE meeting_id = ?",
        (meeting_id.replace("-", ""),),  # accept "123-456-789" too
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return row


def refresh_meeting(conn: sqlite3.Connection, row_id: int) -> sqlite3.Row:
    """Re-read a row we just wrote (SQLite has no RETURNING here)."""
    return conn.execute("SELECT * FROM meetings WHERE id = ?", (row_id,)).fetchone()


# ---------- routes ----------

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/meetings/instant", status_code=201)
def create_instant(body: InstantCreate, request: Request):
    """Instant meeting: NULL scheduled_at, status live. Host = whoever's
    signed in (cookie) — the name field is just display text."""
    user = require_session(request)
    with get_conn() as conn:
        mid = generate_meeting_id(conn)
        token = secrets.token_hex(16)
        cur = conn.execute(
            """INSERT INTO meetings (meeting_id, topic, type, status, host_id, host_token)
               VALUES (?, ?, 'instant', 'live', ?, ?)""",
            (mid, f"{body.display_name.strip() or user['name']}'s Meeting", user["id"], token),
        )
        conn.execute(
            """INSERT INTO participants (meeting_id, display_name)
               VALUES (?, ?)""",
            (cur.lastrowid, body.display_name),
        )
        meeting = refresh_meeting(conn, cur.lastrowid)
        return {
            **row_to_meeting(meeting),
            "host_token": token,
            "invite_path": f"/prejoin?meetingId={mid}",
        }


@app.get("/meetings/{meeting_id}")
def validate_meeting(meeting_id: str):
    """Public join check: 404 = 'not valid'. Includes has_passcode
    so the UI knows whether to ask for one."""
    with get_conn() as conn:
        return row_to_meeting(get_meeting_or_404(conn, meeting_id))


@app.post("/meetings/{meeting_id}/claim")
def claim_host(meeting_id: str, request: Request):
    require_host(meeting_id, request)
    """Mint a fresh host_token for this meeting (owner UI only, e.g. PMI Start).
    Rotation means leaked tokens die on next claim."""
    with get_conn() as conn:
        row = get_meeting_or_404(conn, meeting_id)
        token = secrets.token_hex(16)
        conn.execute(
            "UPDATE meetings SET host_token = ? WHERE id = ?", (token, row["id"])
        )
        return {"host_token": token}


@app.post("/meetings/{meeting_id}/start")
def start_meeting(meeting_id: str, request: Request):
    require_host(meeting_id, request)
    """Host opens the room: status -> live. PMI rooms rest at idle until
    this is called, so guests see 'not started' instead of an empty room."""
    with get_conn() as conn:
        row = get_meeting_or_404(conn, meeting_id)
        if row["status"] == "ended" and row["type"] != "pmi":
            raise HTTPException(status_code=410, detail="Meeting has ended")
        conn.execute(
            "UPDATE meetings SET status = 'live', updated_at = datetime('now') WHERE id = ?",
            (row["id"],),
        )
        return row_to_meeting(refresh_meeting(conn, row["id"]))


@app.post("/meetings/scheduled", status_code=201)
def create_scheduled(body: ScheduledCreate, request: Request):
    user = require_session(request)
    with get_conn() as conn:
        token = secrets.token_hex(16)
        if body.use_pmi:
            # Schedule INTO your existing PMI room (it already exists from
            # seed) — update it in place instead of inserting a duplicate.
            row = conn.execute(
                "SELECT * FROM meetings WHERE meeting_id = ? AND host_id = ?",
                (user["pmi"], user["id"]),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="PMI room not found")
            conn.execute(
                """UPDATE meetings SET topic = ?, description = ?,
                   scheduled_at = ?, duration_min = ?, timezone = ?,
                   passcode = ?, waiting_room = ?,
                   host_video = ?, participant_video = ?,
                   status = 'scheduled', host_token = ?,
                   updated_at = datetime('now') WHERE id = ?""",
                (body.topic, body.description,
                 f"{body.date}T{body.time}", body.duration_min,
                 body.timezone, body.passcode, int(body.waiting_room),
                 int(body.host_video), int(body.participant_video),
                 token, row["id"]),
            )
            meeting = refresh_meeting(conn, row["id"])
            return {
                **row_to_meeting(meeting),
                "host_token": token,
                "invite_path": f"/prejoin?meetingId={user['pmi']}",
            }
        mid = generate_meeting_id(conn)
        try:
            cur = conn.execute(
                """INSERT INTO meetings
                   (meeting_id, topic, description, scheduled_at, duration_min,
                    timezone, type, passcode, waiting_room,
                    host_video, participant_video, audio, status, host_id, host_token)
                   VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, 'scheduled', ?, ?)""",
                (mid, body.topic, body.description,
                 f"{body.date}T{body.time}", body.duration_min,
                 body.timezone, body.passcode, int(body.waiting_room),
                 int(body.host_video),
                 int(body.participant_video), body.audio,
                 user["id"], token),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="Meeting ID already exists")
        meeting = refresh_meeting(conn, cur.lastrowid)
        return {
            **row_to_meeting(meeting),
            "host_token": token,
            "invite_path": f"/prejoin?meetingId={mid}",
        }


@app.get("/meetings")
def list_meetings(request: Request, status: Optional[str] = None):
    """Your dashboard list. host_id comes from YOUR cookie, never from
    the query — passing someone else's id changes nothing."""
    user = require_session(request)
    with get_conn() as conn:
        query = "SELECT * FROM meetings WHERE host_id = ?"
        args: list = [user["id"]]
        if status:
            query += " AND status = ?"
            args.append(status)
        query += " ORDER BY scheduled_at" if status else " ORDER BY created_at DESC"
        rows = conn.execute(query, args).fetchall()
        return [row_to_meeting(r) for r in rows]


@app.get("/meetings/recent/list")
def recent_meetings(request: Request):
    """Ended meetings you hosted OR attended (display-name match)."""
    user = require_session(request)
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT DISTINCT m.* FROM meetings m
               LEFT JOIN participants p ON p.meeting_id = m.id
               WHERE m.status = 'ended'
                 AND (m.host_id = ? OR p.display_name = ?)
               ORDER BY m.created_at DESC""",
            (user["id"], user["name"]),
        ).fetchall()
        return [row_to_meeting(r) for r in rows]


@app.get("/meetings/{meeting_id}/host-view")
def host_view(meeting_id: str, request: Request):
    """Full details incl. passcode — only if you own the meeting."""
    row = require_host(meeting_id, request)
    with get_conn() as conn:
        full = conn.execute("SELECT * FROM meetings WHERE id = ?", (row["id"],)).fetchone()
        m = dict(full)
        m.pop("host_token", None)  # capability stays server-side
        for k in ("waiting_room", "host_video", "participant_video"):
            m[k] = bool(m[k])
        return m


@app.get("/users/search")
def search_users(request: Request, q: str = ""):
    """Username search for the topbar. Signed-in users only; hashes never leave."""
    require_session(request)
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT id, name, email, pmi FROM users
               WHERE name LIKE ? ORDER BY name LIMIT 8""",
            (f"%{q.strip()}%",),
        ).fetchall()
        return [dict(r) for r in rows]


@app.post("/meetings/{meeting_id}/invite", status_code=201)
def invite_user(meeting_id: str, body: InviteRequest, request: Request):
    """Invite a user to YOUR live meeting. Only the host can invite —
    the invite is stamped from you, not from a form field."""
    row = require_host(meeting_id, request)
    me = session_user(request)
    with get_conn() as conn:
        if row["status"] == "ended":
            raise HTTPException(status_code=410, detail="Meeting has ended")
        guest = conn.execute(
            "SELECT id FROM users WHERE id = ?", (body.to_user_id,)
        ).fetchone()
        if not guest or guest["id"] == me["id"]:
            raise HTTPException(status_code=404, detail="No such user")
        existing = conn.execute(
            """SELECT id FROM invites WHERE meeting_id = ? AND to_user_id = ?
               AND status = 'pending'""",
            (row["id"], body.to_user_id),
        ).fetchone()
        if existing:
            return {"invite_id": existing["id"], "duplicate": True}
        cur = conn.execute(
            "INSERT INTO invites (meeting_id, from_user_id, to_user_id) VALUES (?, ?, ?)",
            (row["id"], me["id"], body.to_user_id),
        )
        return {"invite_id": cur.lastrowid, "duplicate": False}


@app.get("/invites/inbox")
def inbox(request: Request):
    """YOUR pending invitations (id comes from your cookie, not the query)."""
    me = require_session(request)
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT i.id, i.status, m.meeting_id, m.topic,
                      u.name AS from_name
               FROM invites i
               JOIN meetings m ON m.id = i.meeting_id
               JOIN users u ON u.id = i.from_user_id
               WHERE i.to_user_id = ? AND i.status = 'pending'
                 AND m.status != 'ended'
               ORDER BY i.created_at DESC""",
            (me["id"],),
        ).fetchall()
        return [dict(r) for r in rows]


@app.post("/invites/{invite_id}/accept")
def accept_invite(invite_id: int, request: Request):
    me = require_session(request)
    with get_conn() as conn:
        cur = conn.execute(
            """UPDATE invites SET status = 'accepted'
               WHERE id = ? AND to_user_id = ? AND status = 'pending'""",
            (invite_id, me["id"]),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Invite not found")
        return {"accepted": True}


@app.post("/invites/{invite_id}/decline")
def decline_invite(invite_id: int, request: Request):
    me = require_session(request)
    with get_conn() as conn:
        cur = conn.execute(
            """UPDATE invites SET status = 'declined'
               WHERE id = ? AND to_user_id = ? AND status = 'pending'""",
            (invite_id, me["id"]),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Invite not found")
        return {"declined": True}


# ---------- direct messages (Chat tab) ----------

@app.get("/messages/thread")
def message_thread(request: Request, peer_id: int):
    """1:1 history — only if you're a party to it."""
    me = require_session(request)
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT id, from_user_id, to_user_id, text, created_at FROM messages
               WHERE (from_user_id = ? AND to_user_id = ?)
                  OR (from_user_id = ? AND to_user_id = ?)
               ORDER BY id""",
            (me["id"], peer_id, peer_id, me["id"]),
        ).fetchall()
        return [dict(r) for r in rows]


@app.post("/messages", status_code=201)
def send_message(body: ChatSend, request: Request):
    """Send as yourself — the sender comes from the cookie, never the form."""
    me = require_session(request)
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty message")
    if body.to_user_id == me["id"]:
        raise HTTPException(status_code=400, detail="Cannot message yourself")
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM users WHERE id = ?", (body.to_user_id,)
        ).fetchone():
            raise HTTPException(status_code=404, detail="No such user")
        cur = conn.execute(
            "INSERT INTO messages (from_user_id, to_user_id, text) VALUES (?, ?, ?)",
            (me["id"], body.to_user_id, text[:1000]),
        )
        row = conn.execute(
            "SELECT id, from_user_id, to_user_id, text, created_at FROM messages WHERE id = ?",
            (cur.lastrowid,),
        ).fetchone()
        return dict(row)


@app.post("/auth/login")
def login(body: LoginRequest, response: Response):
    """Name + password (password == name for seed users). On success the
    server mints a session token in the sessions table and sets it as an
    HttpOnly cookie — JS can never read it, only the browser sends it back.
    SameSite=None + Secure so it also works cross-origin on deploys
    (localhost counts as a secure context, so local dev works too)."""
    name = body.name.strip()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, name, email, pmi, password_hash FROM users WHERE name = ?",
            (name,),
        ).fetchone()
        if not row or row["password_hash"] != hash_password(body.password):
            raise HTTPException(status_code=401, detail="Wrong name or password")
        token = secrets.token_hex(24)
        conn.execute(
            "INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, row["id"])
        )
        user = dict(row)
        user.pop("password_hash", None)
    response.set_cookie(
        SESSION_COOKIE, token,
        httponly=True, samesite="none", secure=True,
        max_age=SESSION_DAYS * 86400, path="/",
    )
    return user


@app.post("/auth/logout")
def logout(request: Request, response: Response):
    """Kill this session server-side and clear the cookie."""
    token = request.cookies.get(SESSION_COOKIE, "")
    with get_conn() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@app.get("/auth/me")
def auth_me(request: Request):
    """Who owns this browser's cookie — the frontend's source of truth
    for identity (no more trusting a query param)."""
    return dict(require_session(request))


@app.get("/users/me")
def get_me(name: Optional[str] = None):
    """Public profile lookup by name (display only — NOT identity).
    Identity always comes from /auth/me + cookie."""
    if not name or not name.strip():
        raise HTTPException(status_code=404, detail="Not signed in")
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, name, email, pmi FROM users WHERE name = ?", (name.strip(),)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No such user")
        return dict(row)


@app.patch("/meetings/{meeting_id}")
def update_meeting(meeting_id: str, body: MeetingUpdate, request: Request):
    require_host(meeting_id, request)
    """Owner edits: topic rename, passcode set/clear, waiting-room toggle.
    This is what makes passcodes real on PMI/instant meetings too —
    any meeting can carry one, not just scheduled ones."""
    sets, args = [], []
    if body.topic is not None:
        topic = body.topic.strip()
        if not topic:
            raise HTTPException(status_code=400, detail="Topic required")
        sets.append("topic = ?")
        args.append(topic)
    if body.passcode is not None:
        sets.append("passcode = ?")
        args.append(body.passcode.strip()[:10])
    if body.waiting_room is not None:
        sets.append("waiting_room = ?")
        args.append(1 if body.waiting_room else 0)
    if not sets:
        raise HTTPException(status_code=400, detail="Nothing to update")
    with get_conn() as conn:
        row = get_meeting_or_404(conn, meeting_id)
        args.append(row["id"])
        conn.execute(
            f"UPDATE meetings SET {', '.join(sets)}, updated_at = datetime('now') WHERE id = ?",
            args,
        )
        updated = refresh_meeting(conn, row["id"])
        return row_to_meeting(updated)


@app.post("/meetings/{meeting_id}/end")
async def end_meeting(meeting_id: str, request: Request):
    require_host(meeting_id, request)
    """Host ended the meeting and told the live room so every socket drops.
    PMI rooms return to idle (permanent rooms can't die); the rest end."""
    with get_conn() as conn:
        row = get_meeting_or_404(conn, meeting_id)
        next_status = "idle" if row["type"] == "pmi" else "ended"
        conn.execute(
            "UPDATE meetings SET status = ?, updated_at = datetime('now') WHERE id = ?",
            (next_status, row["id"]),
        )
        conn.execute(
            "UPDATE participants SET left_at = datetime('now') WHERE meeting_id = ? AND left_at IS NULL",
            (row["id"],),
        )
        updated = refresh_meeting(conn, row["id"])
        mid = row["meeting_id"]
    await broadcast(mid, {"kind": "meeting-ended"})
    return row_to_meeting(updated)


@app.delete("/meetings/{meeting_id}")
def delete_meeting(meeting_id: str, request: Request):
    require_host(meeting_id, request)
    with get_conn() as conn:
        row = get_meeting_or_404(conn, meeting_id)
        conn.execute("DELETE FROM meetings WHERE id = ?", (row["id"],))
        return {"deleted": True}


@app.post("/meetings/{meeting_id}/join")
def join_meeting(meeting_id: str, body: JoinCreate):
    """Entry gate: passcode wall first, then waiting room.
    Returns participant_id so the guest can poll their own admission —
    nothing about other guests leaks."""
    name = body.display_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Display name required")
    with get_conn() as conn:
        row = get_meeting_or_404(conn, meeting_id)
        if row["status"] == "ended":
            raise HTTPException(status_code=410, detail="Meeting has ended")
        if row["status"] == "idle":
            # Host hasn't opened the room yet — no waiting room, just the fact
            raise HTTPException(status_code=409, detail="Meeting hasn't started yet")
        if row["passcode"]:
            check_passcode_gate(row["meeting_id"])
            if body.passcode != row["passcode"]:
                register_passcode_fail(row["meeting_id"])
                raise HTTPException(status_code=403, detail="Wrong passcode")
            reset_passcode_gate(row["meeting_id"])
        # Presenting the meeting's host_token skips passcode+waiting room
        # (owner UI path: create/claim first). Host status in the room
        # comes from the WS handshake, not this row.
        is_host_token = bool(
            body.host_token and row["host_token"] and body.host_token == row["host_token"]
        )
        held = bool(row["waiting_room"]) and not is_host_token
        cur = conn.execute(
            "INSERT INTO participants (meeting_id, display_name, admitted) VALUES (?, ?, ?)",
            (row["id"], name[:50], 0 if held else 1),
        )
        pid = cur.lastrowid
        if held:
            return {
                "admitted": False,
                "participant_id": pid,
                "meeting": row_to_meeting(row),
            }
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM participants WHERE meeting_id = ? AND left_at IS NULL AND admitted = 1",
            (row["id"],),
        ).fetchone()["c"]
        return {
            "admitted": True,
            "participant_id": pid,
            "meeting": row_to_meeting(row),
            "in_room": count,
        }


@app.get("/meetings/{meeting_id}/admission/{pid}")
def admission_status(meeting_id: str, pid: int):
    """Waiting guest polls their own admission flag."""
    with get_conn() as conn:
        row = get_meeting_or_404(conn, meeting_id)
        p = conn.execute(
            "SELECT admitted FROM participants WHERE id = ? AND meeting_id = ?",
            (pid, row["id"]),
        ).fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Not in lobby")
        return {"admitted": bool(p["admitted"])}


@app.get("/meetings/{meeting_id}/lobby")
def lobby_list(meeting_id: str, request: Request):
    require_host(meeting_id, request)
    """Host sees who's waiting (owner only)."""
    with get_conn() as conn:
        row = get_meeting_or_404(conn, meeting_id)
        rows = conn.execute(
            """SELECT id, display_name, joined_at FROM participants
               WHERE meeting_id = ? AND admitted = 0 AND left_at IS NULL
               ORDER BY joined_at""",
            (row["id"],),
        ).fetchall()
        return [dict(r) for r in rows]


@app.post("/meetings/{meeting_id}/admit/{pid}")
def admit_guest(meeting_id: str, pid: int, request: Request):
    require_host(meeting_id, request)
    """Host lets one waiting guest in (owner only)."""
    with get_conn() as conn:
        row = get_meeting_or_404(conn, meeting_id)
        cur = conn.execute(
            """UPDATE participants SET admitted = 1
               WHERE id = ? AND meeting_id = ? AND admitted = 0""",
            (pid, row["id"]),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Nobody waiting with that id")
        return {"admitted": True}


# ---------- signaling (WebRTC mesh) ----------
# rooms[meeting_id][client_id] = {"ws": ..., "name": ...}
# Server never touches audio/video — it only forwards offers, answers,
# ICE candidates and chat between browsers. Media flows peer-to-peer.
rooms: dict[str, dict[str, dict]] = {}


async def broadcast(mid: str, msg: dict, exclude: Optional[str] = None):
    for cid, client in list(rooms.get(mid, {}).items()):
        if cid == exclude:
            continue
        try:
            await client["ws"].send_json(msg)
        except Exception:
            pass


async def send_roster(mid: str):
    await broadcast(
        mid,
        {
            "kind": "roster",
            "peers": [
                {"id": cid, "name": c["name"]}
                for cid, c in rooms.get(mid, {}).items()
            ],
        },
    )


@app.websocket("/ws/{meeting_id}")
async def room_socket(ws: WebSocket, meeting_id: str):
    # Handshake BEFORE accept-adjacent work: must hold either the
    # per-meeting host_token (?host=) or an admitted join row (?pid=).
    # Otherwise close 1008 — no silent lurkers.
    await ws.accept()
    mid = meeting_id.replace("-", "")
    name = ws.query_params.get("name", "Guest")[:50]
    host_param = ws.query_params.get("host", "")
    pid_param = ws.query_params.get("pid", "")

    def _check_in_db():
        with get_conn() as c:
            row = c.execute(
                "SELECT id, status, host_token FROM meetings WHERE meeting_id = ?",
                (mid,),
            ).fetchone()
            if not row or row["status"] in ("ended", "idle"):
                return None
            is_host = bool(host_param and row["host_token"] and host_param == row["host_token"])
            if not is_host and pid_param:
                try:
                    pid = int(pid_param)
                except ValueError:
                    return None
                p = c.execute(
                    "SELECT admitted FROM participants WHERE id = ? AND meeting_id = ? AND left_at IS NULL",
                    (pid, row["id"]),
                ).fetchone()
                if p and p["admitted"]:
                    return {"row_id": row["id"], "is_host": False, "pid": pid}
                return None
            if is_host:
                return {"row_id": row["id"], "is_host": True, "pid": None}
            return None

    import asyncio as _asyncio
    check = await _asyncio.to_thread(_check_in_db)
    if check is None:
        await ws.close(code=1008)
        return

    cid = uuid.uuid4().hex[:8]
    room = rooms.setdefault(mid, {})
    room[cid] = {"ws": ws, "name": name, "is_host": check["is_host"],
                 "pid": check["pid"], "row_id": check["row_id"]}

    await ws.send_json({"kind": "welcome", "id": cid, "is_host": check["is_host"]})
    await broadcast(mid, {"kind": "peer-joined", "id": cid, "name": name}, exclude=cid)
    await send_roster(mid)

    try:
        while True:
            msg = await ws.receive_json()
            kind = msg.get("kind")
            me = rooms.get(mid, {}).get(cid, {})
            if kind in ("offer", "answer", "ice"):
                # Targeted signaling: forward to one peer, stamped with sender
                target = rooms.get(mid, {}).get(msg.get("to"))
                if target:
                    await target["ws"].send_json({**msg, "from": cid})
            elif kind == "chat":
                now = datetime.now().strftime("%-I:%M %p")
                await broadcast(
                    mid,
                    {"kind": "chat", "from": name, "fromId": cid,
                     "text": str(msg.get("text", ""))[:500], "time": now},
                )
            elif kind == "mute":
                await broadcast(
                    mid, {"kind": "mute", "id": cid,
                          "micOff": bool(msg.get("micOff"))}, exclude=cid)
            elif kind == "mute-all":
                # Host-only: anyone else's request is silently dropped
                if me.get("is_host"):
                    await broadcast(mid, {"kind": "mute-all"}, exclude=cid)
            elif kind in ("mute-one", "remove"):
                if not me.get("is_host"):
                    continue
                target = rooms.get(mid, {}).get(msg.get("to"))
                if target:
                    await target["ws"].send_json({**msg, "from": cid})
                    if kind == "remove":
                        await target["ws"].send_json({"kind": "removed"})
                        await target["ws"].close()
    except WebSocketDisconnect:
        pass
    finally:
        me = rooms.get(mid, {}).pop(cid, None)
        if me is None:
            return
        # Headcount honesty: whoever owned this socket is no longer in the
        # room. Guests carry their participant id; hosts are matched by
        # meeting + display name (most recent open row).
        def _stamp_left():
            with get_conn() as c:
                if me and me.get("pid"):
                    c.execute(
                        "UPDATE participants SET left_at = datetime('now') WHERE id = ? AND left_at IS NULL",
                        (me["pid"],),
                    )
                elif me:
                    c.execute(
                        """UPDATE participants SET left_at = datetime('now')
                           WHERE id = (SELECT id FROM participants
                                       WHERE meeting_id = ? AND display_name = ? AND left_at IS NULL
                                       ORDER BY joined_at DESC LIMIT 1)""",
                        (me.get("row_id"), me.get("name")),
                    )
        import asyncio as _asyncio2
        await _asyncio2.to_thread(_stamp_left)
        room = rooms.get(mid, {})
        if not room:
            rooms.pop(mid, None)  # don't hoard empty rooms forever
        else:
            await broadcast(mid, {"kind": "peer-left", "id": cid})
            await send_roster(mid)
