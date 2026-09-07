import type { RecentMeeting, UpcomingMeeting } from "./types";

// Single place for all backend calls. Base URL comes from .env.local.
// credentials:"include" sends the HttpOnly session cookie on every call —
// that cookie (not a header) is what proves identity to the server.
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Which server this browser talks to — shown in Profile > About. */
export const API_URL = API;

export interface ApiMeeting {
  id: number;
  meeting_id: string; // digits only, e.g. "123456789"
  topic: string;
  description: string;
  scheduled_at: string | null; // "2026-09-08T14:00"
  duration_min: number;
  timezone: string;
  type: string;
  has_passcode: boolean; // passcode itself never leaves the server
  waiting_room: boolean;
  host_video: boolean;
  participant_video: boolean;
  audio: string;
  status: string;
  created_at: string; // "2026-09-07 16:09:33"
}

export interface CreatedMeeting extends ApiMeeting {
  host_token: string; // returned ONCE — store in sessionStorage
  invite_path: string;
}

/** "123456789" -> "123-456-789" for display. */
export function formatMeetingId(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length > 6) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length > 3) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return d;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include", // session cookie goes along, cross-origin too
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const err = new Error(`API ${res.status}: ${path}`);
    (err as Error & { status: number }).status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

/** JSON write (session cookie authenticates). */
function post<T>(path: string, body: unknown, method = "POST"): Promise<T> {
  return req<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Session-authenticated GET (cookie goes along via req). */
function authedGet<T>(path: string): Promise<T> {
  return req<T>(path);
}

export const getUpcoming = () =>
  authedGet<ApiMeeting[]>("/meetings?status=scheduled");

export const getRecent = () => authedGet<ApiMeeting[]>("/meetings/recent/list");

/** Owner-only full details incl. passcode — feeds the details dropdown. */
export interface HostView extends ApiMeeting {
  passcode: string;
}

export const getHostView = (meetingId: string) =>
  authedGet<HostView>(`/meetings/${meetingId}/host-view`);

/** Returns the meeting, or null when the ID doesn't exist (404). */
export async function validateMeeting(id: string): Promise<ApiMeeting | null> {
  try {
    return await req<ApiMeeting>(`/meetings/${id}`);
  } catch (e) {
    if ((e as Error & { status?: number }).status === 404) return null;
    throw e;
  }
}

export interface SchedulePayload {
  topic: string;
  description: string;
  date: string;
  time: string;
  duration_min: number;
  timezone: string;
  use_pmi: boolean;
  passcode: string;
  waiting_room: boolean;
  host_video: boolean;
  participant_video: boolean;
  audio: string;
}

export const createScheduled = (data: SchedulePayload) =>
  post<CreatedMeeting>("/meetings/scheduled", data); // snake_case matches backend

export const createInstant = (displayName: string) =>
  post<CreatedMeeting>("/meetings/instant", { display_name: displayName });

export const deleteMeeting = (meetingId: string) =>
  req<{ deleted: boolean }>(`/meetings/${meetingId}`, { method: "DELETE" });

export const renameMeeting = (meetingId: string, topic: string) =>
  post<ApiMeeting>(`/meetings/${meetingId}`, { topic }, "PATCH");

export interface MeetingUpdate {
  topic?: string;
  passcode?: string;
  waiting_room?: boolean;
}

/** Owner edits: rename, set/clear passcode, waiting-room toggle. */
export const updateMeeting = (meetingId: string, update: MeetingUpdate) =>
  post<ApiMeeting>(`/meetings/${meetingId}`, update, "PATCH");

export const endMeeting = (meetingId: string) =>
  post<ApiMeeting>(`/meetings/${meetingId}/end`, {});

/** Mint a fresh host token (owner UI, e.g. PMI Start). Rotates old ones. */
export const claimHost = (meetingId: string) =>
  post<{ host_token: string }>(`/meetings/${meetingId}/claim`, {});

/** Host opens the room: status -> live (PMI wakes from idle). */
export const startMeeting = (meetingId: string) =>
  post<ApiMeeting>(`/meetings/${meetingId}/start`, {});

export interface JoinResult {
  admitted: boolean;
  participant_id: number;
  meeting?: ApiMeeting;
  in_room?: number;
}

/** Entry gate: wrong passcode -> 403, waiting room -> admitted:false. */
export const joinMeeting = (meetingId: string, displayName: string, passcode = "", hostToken = "") =>
  req<JoinResult>(`/meetings/${meetingId}/join`, {
    method: "POST",
    body: JSON.stringify({
      display_name: displayName,
      passcode,
      host_token: hostToken,
    }),
  });

/** Waiting guest polls their own flag. */
export const getAdmission = (meetingId: string, pid: number) =>
  req<{ admitted: boolean }>(`/meetings/${meetingId}/admission/${pid}`);

export interface LobbyGuest {
  id: number;
  display_name: string;
  joined_at: string;
}

/** Host sees who's waiting (owner only). */
export const getLobby = (meetingId: string) =>
  authedGet<LobbyGuest[]>(`/meetings/${meetingId}/lobby`);

/** Host lets one guest in (owner only). */
export const admitGuest = (meetingId: string, pid: number) =>
  post<{ admitted: boolean }>(`/meetings/${meetingId}/admit/${pid}`, {});

const hostKey = (mid: string) => `zoom-clone-host-${mid.replace(/\D/g, "")}`;

/** Per-meeting host capability. sessionStorage: dies with the tab (safer). */
export function saveHostToken(mid: string, token: string) {
  try {
    sessionStorage.setItem(hostKey(mid), token);
  } catch { /* private mode */ }
}

export function getHostToken(mid: string): string {
  try {
    return sessionStorage.getItem(hostKey(mid)) ?? "";
  } catch {
    return "";
  }
}

export interface ApiUser {
  id: number;
  name: string;
  email: string;
  pmi: string;
}

export const getMe = (name?: string) =>
  req<ApiUser>(name ? `/users/me?name=${encodeURIComponent(name)}` : "/users/me");

/** Who owns this browser's cookie — the one true identity call. */
export const authMe = () => req<ApiUser>("/auth/me");

/** Kill the server session (cookie cleared both sides). */
export const logout = () => post<{ ok: boolean }>("/auth/logout", {});

/* ---------- user search + invitations ---------- */

export interface SearchedUser {
  id: number;
  name: string;
  email: string;
  pmi: string;
}

/** Topbar username search (owner UI only). */
export const searchUsers = (q: string) =>
  authedGet<SearchedUser[]>(`/users/search?q=${encodeURIComponent(q)}`);

export interface Invite {
  id: number;
  status: string;
  meeting_id: string;
  topic: string;
  from_name: string;
}

/** Invite a user to a live meeting (owner UI). Dedupe handled server-side. */
export const inviteUser = (meetingId: string, toUserId: number) =>
  post<{ invite_id: number; duplicate: boolean }>(
    `/meetings/${meetingId}/invite`,
    { to_user_id: toUserId },
  );

/** Pending invitations for me (server reads my cookie). */
export const getInbox = () => authedGet<Invite[]>("/invites/inbox");

export const acceptInvite = (inviteId: number) =>
  post<{ accepted: boolean }>(`/invites/${inviteId}/accept`, {});

export const declineInvite = (inviteId: number) =>
  post<{ declined: boolean }>(`/invites/${inviteId}/decline`, {});

/* ---------- direct messages (Chat tab) ---------- */

export interface ChatMessage {
  id: number;
  from_user_id: number;
  to_user_id: number;
  text: string;
  created_at: string;
}

/** Full 1:1 history with a peer, oldest first. */
export const getThread = (peerId: number) =>
  authedGet<ChatMessage[]>(`/messages/thread?peer_id=${peerId}`);

export const sendChatMessage = (toUserId: number, text: string) =>
  post<ChatMessage>("/messages", { to_user_id: toUserId, text });

/** Demo login: name + password (password == name for seed users). */
export async function login(name: string, password: string): Promise<ApiUser | null> {
  try {
    return await post<ApiUser>("/auth/login", { name: name.trim(), password });
  } catch (e) {
    if ((e as Error & { status?: number }).status === 401) return null;
    throw e;
  }
}

/* ---------- backend shape -> display shape ---------- */

function dayLabel(d: Date): string {
  const today = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, tomorrow)) return "Tomorrow";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function clock(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Local YYYY-MM-DD for day filtering (no timezone library needed). */
export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function toUpcoming(m: ApiMeeting): UpcomingMeeting {
  const start = m.scheduled_at ? new Date(m.scheduled_at) : new Date();
  const end = new Date(start.getTime() + m.duration_min * 60000);
  return {
    id: String(m.id),
    meetingId: m.meeting_id,
    title: m.topic,
    day: String(start.getDate()).padStart(2, "0"),
    month: start
      .toLocaleDateString("en-US", { month: "short" })
      .toUpperCase(),
    dateKey: ymd(start),
    time: `${dayLabel(start)}, ${clock(start)} - ${clock(end)}`,
  };
}

export function toRecent(m: ApiMeeting): RecentMeeting {
  const created = new Date(m.created_at.replace(" ", "T"));
  return {
    id: formatMeetingId(m.meeting_id),
    meetingId: m.meeting_id,
    title: m.topic,
    date: created.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    duration: `${m.duration_min} min`,
  };
}
