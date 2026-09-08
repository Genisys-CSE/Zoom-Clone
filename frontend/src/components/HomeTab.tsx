"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Trash2,
  VideoOff,
} from "lucide-react";
import { getSessionName, onAuthChange } from "@/lib/session";
import {
  acceptInvite,
  authMe,
  claimHost,
  createInstant,
  declineInvite,
  deleteMeeting,
  formatMeetingId,
  getHostView,
  getInbox,
  getRecent,
  getUpcoming,
  saveHostToken,
  startMeeting,
  toRecent,
  toUpcoming,
  ymd,
  type HostView,
  type Invite,
} from "@/lib/api";
import type { RecentMeeting, UpcomingMeeting } from "@/lib/types";

export default function HomeTab() {
  const router = useRouter();
  const [now, setNow] = useState(new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  // Null identity = logged out: no dummy user, lists stay empty.
  // Initialized from storage synchronously so reload never flashes
  // the logged-out screen for a signed-in user.
  const [userName, setUserName] = useState<string | null>(() => getSessionName());
  const [ready, setReady] = useState(false);
  const [userPmi, setUserPmi] = useState("");
  const [actionError, setActionError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, HostView>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [upcomingMeetings, setUpcoming] = useState<UpcomingMeeting[]>([]);
  const [recentMeetings, setRecent] = useState<RecentMeeting[]>([]);
  // Meeting invitations from other users (inbox, polled)
  const [inbox, setInbox] = useState<Invite[]>([]);
  const inboxTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Calendar day navigation: null = show all upcoming
  const [dayOffset, setDayOffset] = useState<number | null>(null);

  function loadIdentity() {
    const session = getSessionName();
    if (inboxTimer.current) {
      clearInterval(inboxTimer.current);
      inboxTimer.current = null;
    }
    if (!session) {
      // Logged out: clear everything, show login prompts
      setUserName(null);
      setUserPmi("");
      setUpcoming([]);
      setRecent([]);
      setInbox([]);
      setReady(true);
      return;
    }
    authMe().then((u) => {
      setUserName(u.name);
      setUserPmi(u.pmi);
      // Per-user dashboard: only this user's meetings.
      // Recent = hosted OR attended (guest rows match display name).
      getUpcoming().then((ms) => setUpcoming(ms.map(toUpcoming))).catch(() => setUpcoming([]));
      getRecent().then((ms) => setRecent(ms.map(toRecent))).catch(() => setRecent([]));
      const loadInbox = () =>
        getInbox().then(setInbox).catch(() => {});
      loadInbox();
      const poll = setInterval(loadInbox, 10000);
      inboxTimer.current = poll;
    }).catch(() => {
      setUserName(null);
      setUpcoming([]);
      setRecent([]);
    }).finally(() => setReady(true));
  }

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    loadIdentity();
    // Re-run when ProfileMenu signs in/out (same-tab storage is silent)
    const off = onAuthChange(loadIdentity);
    return () => {
      clearInterval(t);
      if (inboxTimer.current) clearInterval(inboxTimer.current);
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clock = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const longDate = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // Selected calendar day (defaults to today)
  const selected = new Date(now);
  if (dayOffset !== null) selected.setDate(now.getDate() + dayOffset);
  const shortSelected = selected.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const shown =
    dayOffset === null
      ? upcomingMeetings
      : upcomingMeetings.filter((m) => m.dateKey === ymd(selected));

  function needLogin(): boolean {
    if (userName) return false;
    setActionError("Please sign in from the avatar menu first");
    return true;
  }

  async function startInstant(usePmi: boolean) {
    setMenuOpen(false);
    setActionError("");
    if (needLogin()) return;
    const name = userName as string;
    try {
      if (usePmi) {
        // PMI room is permanent — claim host powers, wake it live,
        // then walk in as host
        const { host_token } = await claimHost(userPmi);
        saveHostToken(userPmi, host_token);
        await startMeeting(userPmi);
        router.push(`/prejoin?meetingId=${userPmi}&name=${encodeURIComponent(name)}`);
        return;
      }
      const m = await createInstant(name);
      saveHostToken(m.meeting_id, m.host_token);
      router.push(`/meeting/${m.meeting_id}?name=${encodeURIComponent(name)}`);
    } catch {
      // Backend down / refused: say so instead of silently doing nothing
      setActionError("Couldn't start the meeting — is the backend running?");
    }
  }

  // Host entry for a scheduled meeting: claim powers first so the room
  // opens as host instead of landing the owner in their own waiting room.
  async function startScheduled(m: UpcomingMeeting) {
    setActionError("");
    if (needLogin()) return;
    try {
      const { host_token } = await claimHost(m.meetingId);
      saveHostToken(m.meetingId, host_token);
      await startMeeting(m.meetingId);
      router.push(`/prejoin?meetingId=${m.meetingId}&name=${encodeURIComponent(userName as string)}`);
    } catch {
      setActionError("Couldn't start the meeting — is the backend running?");
    }
  }

  // Details dropdown: owner-only full view (passcode included).
  // Fetched once per meeting, cached for the session.
  async function toggleDetails(m: UpcomingMeeting) {
    if (expandedId === m.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(m.id);
    if (!details[m.meetingId]) {
      try {
        const d = await getHostView(m.meetingId);
        setDetails((prev) => ({ ...prev, [m.meetingId]: d }));
      } catch {
        /* stays collapsed on failure */
        setExpandedId(null);
      }
    }
  }

  function copyDetails(m: UpcomingMeeting) {
    const d = details[m.meetingId];
    if (!d) return;
    const text = [
      `${d.topic}`,
      `Join: ${window.location.origin}/prejoin?meetingId=${d.meeting_id}`,
      `Meeting ID: ${formatMeetingId(d.meeting_id)}`,
      ...(d.passcode ? [`Passcode: ${d.passcode}`] : []),
    ].join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(m.id);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {});
  }

  // Accept = mark accepted, head to prejoin as guest.
  // Decline = row vanishes for good.
  async function joinInvitation(inv: Invite) {
    try {
      await acceptInvite(inv.id);
    } catch { /* join anyway — meeting may still be live */ }
    setInbox((list) => list.filter((i) => i.id !== inv.id));
    router.push(
      `/prejoin?meetingId=${inv.meeting_id}&name=${encodeURIComponent(userName ?? "Guest")}`,
    );
  }

  async function declineInvitation(inv: Invite) {
    setInbox((list) => list.filter((i) => i.id !== inv.id));
    try {
      await declineInvite(inv.id);
    } catch { /* already gone locally */ }
  }

  async function removeUpcoming(id: string, meetingId: string) {
    setUpcoming((list) => list.filter((x) => x.id !== id));
    setExpandedId((cur) => (cur === id ? null : cur));
    try {
      await deleteMeeting(meetingId);
    } catch {
      /* already gone locally */
    }
  }

  async function removeRecent(m: RecentMeeting) {
    setRecent((rs) => rs.filter((r) => r.id !== m.id));
    try {
      await deleteMeeting(m.meetingId);
    } catch {
      /* already removed locally */
    }
  }

  const tileBtn =
    "flex h-14 w-14 items-center justify-center rounded-[20px] text-white transition-all hover:-translate-y-1 hover:shadow-[0_4px_11px_0_#b3b3b3] active:translate-y-0 active:shadow-none";
  const tileLabel = "mt-3 text-[14px] leading-4 text-[#6e7680]";

  return (
    <div className="flex min-h-full flex-col items-center px-6 pb-10">
      {/* Header: mt-64px mb-28px / clock 40px-600 / day 16px */}
      <header className="mb-7 mt-16 flex flex-col items-center">
        <p className="text-[40px] font-semibold leading-10 tracking-[0.37px]">
          {clock}
        </p>
        <p className="mt-2 text-[16px] leading-5 text-[#0404138f]">
          {longDate}
        </p>
        {!ready ? null : !userName && (
          <p className="mt-2 text-[13px] text-zoom-blue">
            Sign in from the avatar menu to see your meetings
          </p>
        )}
      </header>

      {/* Actions: gap 60px, mb 24px */}
      <div className="mb-6 flex items-start justify-center gap-6 sm:gap-[60px]">
        {/* New meeting with dropdown */}
        <div className="relative flex w-[88px] flex-col items-center">
          <button
            onClick={() => startInstant(false)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuOpen((v) => !v);
            }}
            title="New meeting (right-click for options)"
            className={`${tileBtn} bg-zoom-orange active:bg-[#e56829]`}
          >
            <VideoOff className="h-7 w-7" strokeWidth={2} />
          </button>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className={`${tileLabel} flex items-center gap-[5px] whitespace-nowrap`}
          >
            New meeting
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <div className="absolute top-[92px] z-10 w-44 rounded-lg border border-line bg-white py-1 text-left text-[13px] shadow-lg">
              <button
                onClick={() => startInstant(false)}
                className="block w-full px-3 py-1.5 text-left hover:bg-zoom-blue hover:text-white"
              >
                Start with video
              </button>
              <button
                onClick={() => startInstant(true)}
                className="block w-full px-3 py-1.5 text-left hover:bg-zoom-blue hover:text-white"
              >
                Use my PMI
              </button>
            </div>
          )}
        </div>

        <Link href="/join" className="flex w-[88px] flex-col items-center">
          <span className={`${tileBtn} bg-zoom-blue active:bg-zoom-blue-hover`}>
            <Plus className="h-7 w-7" strokeWidth={2.4} />
          </span>
          <span className={`${tileLabel} whitespace-nowrap`}>Join</span>
        </Link>

        <Link href="/schedule" className="flex w-[88px] flex-col items-center">
          <span className={`${tileBtn} bg-zoom-blue active:bg-zoom-blue-hover`}>
            <CalendarDays className="h-7 w-7" strokeWidth={2} />
          </span>
          <span className={`${tileLabel} whitespace-nowrap`}>Schedule</span>
        </Link>
      </div>

      {/* Cards column: 600px */}
      <div className="flex w-[600px] max-w-full flex-col">
        {actionError && (
          <p className="mb-4 rounded-lg border border-zoom-red/30 bg-zoom-red/5 px-4 py-2.5 text-center text-[13px] text-zoom-red">
            {actionError}
          </p>
        )}
        {/* Inbox: live invitations from other users */}
        {inbox.map((inv) => (
          <div
            key={inv.id}
            className="mb-4 flex items-center gap-3 rounded-lg border border-zoom-blue/40 bg-zoom-blue/5 px-4 py-3"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zoom-blue text-sm font-bold text-white">
              {inv.from_name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold">{inv.topic}</p>
              <p className="text-[12px] text-ink-secondary">
                {inv.from_name} invited you to join now
              </p>
            </div>
            <button
              onClick={() => joinInvitation(inv)}
              className="shrink-0 rounded-md bg-zoom-blue px-3 py-1 text-[12px] font-semibold text-white hover:bg-zoom-blue-hover"
            >
              Join
            </button>
            <button
              onClick={() => declineInvitation(inv)}
              className="shrink-0 rounded-md border border-line bg-white px-3 py-1 text-[12px] font-medium hover:bg-black/5"
            >
              Decline
            </button>
          </div>
        ))}
        {/* Calendar / upcoming card */}
        <section className="mb-4 overflow-hidden rounded-lg border border-line bg-white">
          <header className="flex items-center justify-center px-4 py-3">
            <h3 className="text-[14px] font-semibold">
              {dayOffset === null || dayOffset === 0 ? `Today, ${shortSelected}` : shortSelected}
            </h3>
          </header>

          <div className="flex items-center gap-2 border-t border-line px-4 py-2">
            <button
              onClick={() => setDayOffset(0)}
              className="rounded-full border border-line px-2.5 py-0.5 text-[12px] font-medium hover:bg-black/5"
            >
              <Calendar className="mr-1 inline h-3 w-3" />
              Today
            </button>
            <button
              onClick={() => setDayOffset((d) => (d ?? 0) - 1)}
              title="Previous day"
              className="rounded p-0.5 hover:bg-black/5"
            >
              <ChevronLeft className="h-4 w-4 text-ink-secondary" />
            </button>
            <button
              onClick={() => setDayOffset((d) => (d ?? 0) + 1)}
              title="Next day"
              className="rounded p-0.5 hover:bg-black/5"
            >
              <ChevronRight className="h-4 w-4 text-ink-secondary" />
            </button>
            {dayOffset !== null && (
              <button
                onClick={() => setDayOffset(null)}
                className="ml-auto text-[12px] text-zoom-blue hover:underline"
              >
                Show all
              </button>
            )}
          </div>

          <div className="min-h-[220px] border-t border-line">
            {shown.length === 0 ? (
              <div className="flex h-[220px] flex-col items-center justify-center text-[14px] text-ink-secondary">
                <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden>
                  <ellipse cx="36" cy="58" rx="18" ry="5" fill="#E8EEF7" />
                  <path d="M36 18c-8 0-14 6-14 16 0 10 14 22 14 22s14-12 14-22c0-10-6-16-14-16z" fill="#D6E4F7" />
                  <rect x="33" y="12" width="6" height="8" rx="2" fill="#B7C9E4" />
                </svg>
                <p className="mt-2">
                  {!ready ? "Loading…" : !userName ? "Please login first." : "No meetings scheduled."}
                </p>
              </div>
            ) : (
              <ul>
                {shown.map((m) => (
                  <li
                    key={m.id}
                    className="border-b border-line last:border-b-0"
                  >
                    <div className="flex items-center gap-4 px-4 py-3">
                      <button
                        onClick={() => toggleDetails(m)}
                        title="Show details"
                        className="w-16 shrink-0 text-left text-[12px] font-medium text-ink-secondary hover:text-zoom-blue"
                      >
                        {m.time.split(",")[1]?.trim().split(" - ")[0] ?? m.time}
                        <span className="ml-1">{expandedId === m.id ? "▴" : "▾"}</span>
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium">{m.title}</div>
                        <div className="text-[12px] text-ink-secondary">{m.time}</div>
                      </div>
                      <Link
                        href={`/prejoin?meetingId=${m.meetingId}&name=${encodeURIComponent(userName ?? "Guest")}`}
                        className="rounded-md border border-line bg-white px-3 py-1 text-[12px] font-medium text-ink hover:bg-black/5"
                      >
                        Join
                      </Link>
                      <button
                        onClick={() => startScheduled(m)}
                        title="Start as host"
                        className="shrink-0 rounded-md bg-zoom-blue px-3 py-1 text-[12px] font-semibold text-white hover:bg-zoom-blue-hover"
                      >
                        Start
                      </button>
                      <button
                        onClick={() => removeUpcoming(m.id, m.meetingId)}
                        title="Delete meeting"
                        className="shrink-0 rounded-md p-1.5 text-ink-secondary hover:bg-black/5 hover:text-zoom-red"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    {expandedId === m.id && details[m.meetingId] && (
                      <div className="mx-4 mb-3 rounded-lg bg-app-bg p-3 text-[12px] leading-6">
                        <p><span className="text-ink-secondary">Meeting ID: </span>{formatMeetingId(details[m.meetingId].meeting_id)}</p>
                        {details[m.meetingId].description && (
                          <p><span className="text-ink-secondary">About: </span>{details[m.meetingId].description}</p>
                        )}
                        <p><span className="text-ink-secondary">Passcode: </span>{details[m.meetingId].passcode || "none"}</p>
                        <p><span className="text-ink-secondary">Duration: </span>{details[m.meetingId].duration_min} min</p>
                        <p className="truncate"><span className="text-ink-secondary">Invite link: </span>{window.location.origin}/prejoin?meetingId={details[m.meetingId].meeting_id}</p>
                        <button
                          onClick={() => copyDetails(m)}
                          className="mt-2 rounded-md bg-zoom-blue px-3 py-1 font-semibold text-white hover:bg-zoom-blue-hover"
                        >
                          {copiedId === m.id ? "Copied!" : "Copy Invitation"}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Recent meetings (PDF requirement — always visible) */}
        <section className="mb-4 overflow-hidden rounded-lg border border-line bg-white">
          <header className="flex items-center gap-2 px-4 py-3 text-[14px] font-semibold">
            <Clock className="h-4 w-4 text-ink-secondary" />
            Recent
          </header>
          <ul className="border-t border-line">
            {recentMeetings.length === 0 && (
              <li className="px-4 py-6 text-center text-[13px] text-ink-secondary">
                {!ready ? "Loading…" : !userName ? "Please login first." : "No recent meetings"}
              </li>
            )}
            {recentMeetings.map((m) => (
              <li
                key={m.id}
                className="group flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{m.title}</div>
                  <div className="text-[12px] text-ink-secondary">
                    {m.id} · {m.date} · {m.duration}
                  </div>
                </div>
                <button
                  title="Delete"
                  onClick={() => removeRecent(m)}
                  className="ml-auto hidden shrink-0 rounded-md p-1.5 text-ink-secondary hover:bg-black/5 hover:text-zoom-red group-hover:block"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
