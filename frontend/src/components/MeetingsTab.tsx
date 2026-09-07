"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Pencil, RotateCw, Trash2, X } from "lucide-react";
import { authMe, formatMeetingId, claimHost, deleteMeeting, getHostView, getUpcoming, renameMeeting, saveHostToken, startMeeting, updateMeeting } from "@/lib/api";
import { getSessionName, onAuthChange } from "@/lib/session";

interface UpcomingRow {
  id: number;
  meetingId: string;
  topic: string;
  when: string;
}

export default function MeetingsTab() {
  // PMI card starts selected (blue) — matches real Zoom default state
  const [pmiSelected, setPmiSelected] = useState(true);
  const [pmi, setPmi] = useState("");
  const [upcoming, setUpcoming] = useState<UpcomingRow[]>([]);
  const [copied, setCopied] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTopic, setDraftTopic] = useState("My Personal Meeting ID (PMI)");
  // PMI security (owner-only): passcode + waiting room actually apply here.
  const [pmiPasscode, setPmiPasscode] = useState("");
  const [pmiWaiting, setPmiWaiting] = useState(true);
  const [secMsg, setSecMsg] = useState("");
  const router = useRouter();

  const [userName, setUserName] = useState<string | null>(() => getSessionName());
  const [ready, setReady] = useState(false);

  const load = () => {
    const session = getSessionName();
    if (!session) {
      // Logged out: no dummy PMI, no other user's meetings
      setUserName(null);
      setPmi("");
      setUpcoming([]);
      setReady(true);
      return;
    }
    authMe().then((u) => {
      setPmi(u.pmi);
      setUserName(u.name);
      // Owner view of the PMI room: real passcode + waiting flag
      getHostView(u.pmi).then((m) => {
        setPmiPasscode(m.passcode);
        setPmiWaiting(m.waiting_room);
      }).catch(() => {});
      getUpcoming().then((ms) =>
        setUpcoming(ms.map((m) => ({
          id: m.id, meetingId: m.meeting_id, topic: m.topic, when: m.scheduled_at ?? "",
        }))),
      ).catch(() => setUpcoming([]));
    }).catch(() => {
      setUserName(null);
      setPmi("");
      setUpcoming([]);
    }).finally(() => setReady(true));
  };

  useEffect(() => {
    load();
    return onAuthChange(load);
  }, []);

  const inviteText = [
    `${userName} is inviting you to a scheduled Zoom meeting.`,
    "",
    `Join: ${typeof window !== "undefined" ? window.location.origin : ""}/prejoin?meetingId=${pmi}`,
    `Meeting ID: ${formatMeetingId(pmi)}`,
    ...(pmiPasscode ? [`Passcode: ${pmiPasscode}`] : []),
  ].join("\n");

  function copyInvitation() {
    navigator.clipboard.writeText(inviteText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  async function startPmi() {
    try {
      // Claim host powers + wake the room live, then walk in as host
      const { host_token } = await claimHost(pmi);
      saveHostToken(pmi, host_token);
      await startMeeting(pmi);
    } catch {
      /* offline: prejoin shows the error */
    }
    router.push(`/prejoin?meetingId=${pmi}&name=${encodeURIComponent(userName ?? '')}`);
  }

  async function removeUpcoming(id: number, meetingId: string) {
    setUpcoming((list) => list.filter((x) => x.id !== id));
    try {
      await deleteMeeting(meetingId);
    } catch {
      /* already gone locally */
    }
  }

  async function startScheduled(meetingId: string) {    try {
      const { host_token } = await claimHost(meetingId);
      saveHostToken(meetingId, host_token);
      await startMeeting(meetingId);
      router.push(`/prejoin?meetingId=${meetingId}&name=${encodeURIComponent(userName ?? '')}`);
    } catch {
      /* offline: prejoin shows the error */
    }
  }

  async function saveTopic() {
    const topic = draftTopic.trim();
    if (!topic) return;
    setEditing(false);
    try {
      // PMI room row is renamed too — same endpoint, same table
      await renameMeeting(pmi, topic);
    } catch {
      /* name stays local on failure */
    }
  }

  return (
    <div className="flex h-full flex-col md:flex-row">
      {!ready ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-[14px] text-ink-secondary">Loading…</p>
        </div>
      ) : !userName ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-[16px] font-semibold">Please login first.</p>
          <p className="text-[13px] text-ink-secondary">
            Sign in from the avatar menu to see your Personal Meeting ID and meetings.
          </p>
        </div>
      ) : (
      <>
      {/* ---- Left panel: Upcoming ---- */}
      <div className="flex w-full shrink-0 flex-col border-b border-line md:h-full md:w-[360px] md:border-b-0 md:border-r">
        <div className="flex items-center px-4 pb-1 pt-3">
          <button onClick={load} title="Refresh list">
            <RotateCw className="h-3.5 w-3.5 cursor-pointer text-ink-secondary hover:text-ink" />
          </button>
          <h3 className="mx-auto text-[15px] font-bold">Upcoming</h3>
          <span className="w-3.5" />
        </div>

        {/* PMI card: h-78px, radius 12px — white, blue when selected */}
        <div className="px-4 pt-2">
          <button
            onClick={() => setPmiSelected((v) => !v)}
            className={`flex h-[78px] w-full flex-col items-center justify-center rounded-xl transition-colors ${
              pmiSelected
                ? "bg-zoom-blue text-white"
                : "bg-white text-ink hover:bg-[#e7f1fd]"
            }`}
          >
            <p className="mb-1 text-[18px] font-bold leading-[21px]">
              {formatMeetingId(pmi)}
            </p>
            <p className="text-[13px] leading-4">My Personal Meeting ID (PMI)</p>
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto">
          {upcoming.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-[14px] text-[#0404138f]">No upcoming meetings</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1 p-3">
              {upcoming.map((m) => (
                <li
                  key={m.id}
                  className="group flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-black/[.04]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">{m.topic}</p>
                    <p className="text-[12px] text-ink-secondary">{m.when}</p>
                  </div>
                  <button
                    onClick={() => startScheduled(m.meetingId)}
                    title="Start as host"
                    className="hidden shrink-0 rounded-md bg-zoom-blue px-2.5 py-0.5 text-[12px] font-semibold text-white hover:bg-zoom-blue-hover group-hover:block"
                  >
                    Start
                  </button>
                  <button
                    onClick={() => removeUpcoming(m.id, m.meetingId)}
                    title="Delete meeting"
                    className="hidden shrink-0 rounded-md p-1 text-ink-secondary hover:bg-black/5 hover:text-zoom-red group-hover:block"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ---- Right panel: detail, padding 48px 40px ---- */}
      <div className="min-w-0 flex-1 overflow-y-auto px-10 pb-10 pt-12">
        {editing ? (
          <div className="mb-8 flex items-center gap-2">
            <input
              autoFocus
              value={draftTopic}
              onChange={(e) => setDraftTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTopic();
                if (e.key === "Escape") setEditing(false);
              }}
              className="w-full max-w-[420px] rounded-md border border-zoom-blue px-3 py-1.5 text-[20px] font-bold outline-none"
            />
            <button
              onClick={saveTopic}
              title="Save"
              className="rounded-md bg-zoom-blue p-2 text-white hover:bg-zoom-blue-hover"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              onClick={() => setEditing(false)}
              title="Cancel"
              className="rounded-md bg-black/5 p-2 hover:bg-black/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <h1 className="mb-8 text-[24px] font-bold leading-[29px] text-[#39394d]">
            {draftTopic}
          </h1>
        )}
        <p className="my-4 text-[13px] leading-4">{formatMeetingId(pmi)}</p>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={startPmi}
            className="rounded-md bg-zoom-blue px-5 py-1 text-[13px] font-semibold text-white hover:bg-zoom-blue-hover"
          >
            Start
          </button>
          <button
            onClick={copyInvitation}
            className="flex items-center gap-1.5 rounded-md border border-[#0e72ed] bg-white px-3 py-1 text-[13px] font-medium text-zoom-blue hover:bg-[#e7f1fd]"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copied!" : "Copy Invitation"}
          </button>
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1 text-[13px] font-medium hover:bg-black/5"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
        </div>

        <button
          onClick={() => setShowInvite((v) => !v)}
          className="mt-10 text-[13px] text-zoom-blue hover:underline"
        >
          {showInvite ? "Hide Meeting Invitation" : "Show Meeting Invitation"}
        </button>
        {showInvite && (
          <pre className="mt-3 max-w-[520px] whitespace-pre-wrap rounded-lg bg-app-bg p-4 text-[13px] leading-6">
            {inviteText}
          </pre>
        )}

        {/* PMI security: passcodes are settable here, so the option is real */}
        <div className="mt-8 max-w-[520px] rounded-lg border border-line p-4">
          <p className="text-[14px] font-semibold">Security</p>
          <div className="mt-2 flex items-center gap-2 text-[13px]">
            <span className="text-ink-secondary">Passcode</span>
            <input
              value={pmiPasscode}
              onChange={(e) => setPmiPasscode(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="none"
              inputMode="numeric"
              className="w-[140px] rounded-md border border-line px-3 py-1 text-[13px] outline-none focus:border-zoom-blue"
            />
            <button
              onClick={async () => {
                try {
                  await updateMeeting(pmi, { passcode: pmiPasscode });
                  setSecMsg("Saved");
                } catch {
                  setSecMsg("Couldn't save");
                }
                setTimeout(() => setSecMsg(""), 2000);
              }}
              className="rounded-md bg-zoom-blue px-3 py-1 text-[13px] font-semibold text-white hover:bg-zoom-blue-hover"
            >
              Save
            </button>
            {secMsg && <span className="text-[12px] text-ink-secondary">{secMsg}</span>}
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[13px]">
            <input
              type="checkbox"
              checked={pmiWaiting}
              onChange={async (e) => {
                const next = e.target.checked;
                setPmiWaiting(next);
                try {
                  await updateMeeting(pmi, { waiting_room: next });
                } catch {
                  setPmiWaiting(!next);
                }
              }}
              className="h-4 w-4 accent-zoom-blue"
            />
            Waiting Room
          </label>
          <p className="mt-1 text-[12px] text-ink-secondary">
            Clear the passcode to open the room to anyone with the link.
          </p>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
