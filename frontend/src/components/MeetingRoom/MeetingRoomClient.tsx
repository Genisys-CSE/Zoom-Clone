"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, ShieldCheck, Users } from "lucide-react";
import ControlBar from "./ControlBar";
import VideoGrid, { type TilePerson } from "./VideoGrid";
import ParticipantsPanel from "./ParticipantsPanel";
import ChatPanel from "./ChatPanel";
import LeaveModal from "./LeaveModal";
import { useRoom } from "./useRoom";
import {
  admitGuest,
  endMeeting,
  formatMeetingId,
  getHostToken,
  getHostView,
  getLobby,
  validateMeeting,
  type ApiMeeting,
  type LobbyGuest,
} from "@/lib/api";

// Owns camera state + layout. Remote video, roster and chat
// come live from useRoom (WebRTC mesh over the signaling socket).
export default function MeetingRoomClient({
  meetingId,
  name,
  micOff,
  camOff,
  pid,
}: {
  meetingId: string;
  name: string;
  micOff: boolean;
  camOff: boolean;
  pid: string;
}) {
  const router = useRouter();
  const [meeting, setMeeting] = useState<ApiMeeting | null>(null);
  // Owner-only details (actual passcode) — shown in Security panel for hosts.
  const [hostPasscode, setHostPasscode] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(!micOff);
  const [camOn, setCamOn] = useState(!camOff);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [selfReaction, setSelfReaction] = useState<string | undefined>();
  const [lobby, setLobby] = useState<LobbyGuest[]>([]);
  const [lobbyPing, setLobbyPing] = useState<LobbyGuest | null>(null);
  const [endedMsg, setEndedMsg] = useState<string | null>(null);
  // Duration clock: counts down from entry (predictable for demos —
  // wall-clock schedules would instantly kill old test meetings).
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const selfVideo = useRef<HTMLVideoElement | null>(null);
  const screenTrack = useRef<MediaStreamTrack | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  const {
    selfId,
    isHost,
    denied,
    peers,
    chat,
    sendChat,
    sendMute,
    sendMuteAll,
    sendMuteOne,
    sendRemove,
    sendReaction,
    replaceVideoTrack,
    retryPeer,
  } = useRoom(meetingId, name, local, {
    // These run from socket events, but opts is rebuilt every render,
    // so they always see the current `local` stream — no stale closures.
    onForceMute: () => {
      setMicOn(false);
      local?.getAudioTracks().forEach((t) => (t.enabled = false));
    },
    onRemoved: () => router.push("/"),
    onMeetingEnded: () => {
      // Stop camera/mic: the room is over, don't keep hardware hot
      local?.getTracks().forEach((t) => t.stop());
      setEndedMsg("This meeting has been ended by the host");
    },
  }, {
    // Host capability (owner flows stored it) or waiting ticket (guests).
    // Server rejects the socket when neither checks out.
    host: getHostToken(meetingId),
    pid,
  });
  // Live copies of toggles for one-shot effects (mount/announce run once
  // but must see the latest value even if the user toggles early).
  const localRef = useRef<MediaStream | null>(null);
  localRef.current = local;
  const micRef = useRef(micOn);
  micRef.current = micOn;
  const camRef = useRef(camOn);
  camRef.current = camOn;

  useEffect(() => {
    validateMeeting(meetingId)
      .then((m) => {
        if (!m) return;
        setMeeting(m);
        // Clock starts on entry: duration_min minutes from now.
        setSecondsLeft(m.duration_min * 60);
      })
      .catch(() => {});
    // Hosts (stored token) also load the real passcode for the panel.
    // Guests never get this call — the field stays hidden for them.
    if (getHostToken(meetingId)) {
      getHostView(meetingId)
        .then((m) => setHostPasscode(m.passcode || null))
        .catch(() => {});
    }
  }, [meetingId]);

  // Self camera once, applying prejoin mic/cam choices
  useEffect(() => {
    let alive = true;
    navigator.mediaDevices
      ?.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (!alive) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.getAudioTracks().forEach((t) => (t.enabled = micRef.current));
        stream.getVideoTracks().forEach((t) => (t.enabled = camRef.current));
        setLocal(stream);
      })
      .catch(() => {});
    return () => {
      alive = false;
      setLocal((s) => {
        s?.getTracks().forEach((t) => t.stop());
        return null;
      });
    };
  }, []);

  // Attach self stream to the tile video element
  useEffect(() => {
    if (selfVideo.current && local) selfVideo.current.srcObject = local;
  }, [local]);

  // Duration enforcement: at zero the host ends for everyone
  // (server broadcasts, all sockets drop); guests just see the screen.
  useEffect(() => {
    if (secondsLeft === null || secondsLeft > 0 || endedMsg) return;
    if (isHost) {
      endMeeting(meetingId).catch(() => {}).finally(() => router.push("/"));
    } else {
      localRef.current?.getTracks().forEach((t) => t.stop());
      setEndedMsg("Meeting time ended");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((s) => (s === null ? s : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  function fmtClock(total: number): string {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
    return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
  }
  // Announce our mic state once connected so others see the badge
  const announced = useRef(false);
  useEffect(() => {
    if (selfId && !announced.current) {
      announced.current = true;
      sendMute(!micRef.current);
    }
  }, [selfId, sendMute]);

  // Host polls the waiting lobby; Admit buttons live in the roster panel.
  // New arrivals ALSO pop a toast so the host notices with panel closed.
  const seenLobby = useRef<Set<number>>(new Set());
  const lobbyInit = useRef(false);
  useEffect(() => {
    if (!isHost) return;
    const load = () =>
      getLobby(meetingId)
        .then((guests) => {
          if (!lobbyInit.current) {
            // First load = baseline, don't ping for people already waiting
            lobbyInit.current = true;
            guests.forEach((g) => seenLobby.current.add(g.id));
          } else {
            const fresh = guests.find((g) => !seenLobby.current.has(g.id));
            if (fresh) {
              seenLobby.current.add(fresh.id);
              setLobbyPing(fresh);
            }
          }
          setLobby(guests);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [isHost, meetingId]);

  async function admit(id: number) {
    try {
      await admitGuest(meetingId, id);
      setLobby((l) => l.filter((g) => g.id !== id));
      setLobbyPing((p) => (p?.id === id ? null : p));
    } catch {
      /* stays in lobby on failure */
    }
  }

  function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    local?.getAudioTracks().forEach((t) => (t.enabled = next));
    sendMute(!next);
  }

  function toggleCam() {
    const next = !camOn;
    setCamOn(next);
    local?.getVideoTracks().forEach((t) => (t.enabled = next));
  }

  // Back to camera (also runs when the OS share picker is dismissed).
  function stopSharing() {
    const cam = local?.getVideoTracks()[0];
    if (cam) replaceVideoTrack(cam);
    screenTrack.current?.stop();
    screenTrack.current = null;
    setSharing(false);
  }

  // Transient notice (screen-share errors etc.) — auto-clears.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showNotice(msg: string) {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }

  async function toggleShare() {
    if (sharing) {
      stopSharing();
      return;
    }
    // getDisplayMedia doesn't exist on insecure origins / old browsers —
    // without this check the button just silently does nothing.
    const dm = navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices);
    if (!dm) {
      showNotice("Screen sharing needs HTTPS — use Chrome or Edge on desktop");
      return;
    }
    try {
      const screen = await dm({ video: true });
      const track = screen.getVideoTracks()[0];
      if (!track) {
        showNotice("No screen track — try sharing a different window");
        return;
      }
      screenTrack.current = track;
      replaceVideoTrack(track);
      setSharing(true);
      track.onended = stopSharing;
    } catch {
      /* user cancelled the share picker — no notice needed */
    }
  }

  // Real local recording of your camera+mic; file downloads on stop
  function toggleRecord() {
    if (recording) {
      recorder.current?.stop();
      setRecording(false);
      return;
    }
    if (!local) return;
    try {
      const rec = new MediaRecorder(local);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = () => {
        const url = URL.createObjectURL(
          new Blob(chunks, { type: rec.mimeType || "video/webm" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `meeting-${meetingId}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
    } catch {
      /* MediaRecorder unsupported — button stays off */
    }
  }

  function react(emoji: string) {
    sendReaction(emoji);
    setSelfReaction(emoji);
    setTimeout(() => setSelfReaction(undefined), 3000);
  }

  const people: (TilePerson & { id?: string })[] = [
    { key: "self", name, isSelf: true, micOff: !micOn, reaction: selfReaction },
    ...peers.map((p) => ({
      key: p.id,
      id: p.id,
      name: p.name,
      micOff: p.micOff,
      stream: p.stream,
      reaction: p.reaction,
    })),
  ];

  async function endForAll() {
    try {
      await endMeeting(meetingId);
    } catch {
      /* room still closes locally */
    }
    router.push("/");
  }

  // Host ended it for everyone, or the duration ran out:
  // dead room would confuse, show why
  if (endedMsg) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-room text-white">
        <p className="text-lg font-semibold">{endedMsg}</p>
        <button
          onClick={() => router.push("/")}
          className="mt-2 rounded-md bg-zoom-blue px-5 py-2 text-sm font-semibold hover:bg-zoom-blue-hover"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  // Server rejected our socket (no host token, no valid ticket)
  if (denied) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-room text-white">
        <p className="text-lg font-semibold">Couldn&apos;t enter this meeting</p>
        <p className="text-sm text-white/60">
          The meeting may have ended, or you&apos;re not on the guest list.
        </p>
        <button
          onClick={() => router.push("/")}
          className="mt-2 rounded-md bg-zoom-blue px-5 py-2 text-sm font-semibold hover:bg-zoom-blue-hover"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-room text-white">
      <div className="flex h-12 shrink-0 items-center gap-3 overflow-x-auto bg-toolbar px-4 text-[13px]">
        <span className="flex shrink-0 items-center gap-1 text-white/70">
          <ShieldCheck className="h-4 w-4 text-zoom-green" />
          Protected
        </span>
        <span className="mx-auto max-w-[40%] truncate font-medium">
          {meeting?.topic ?? "Meeting"}
        </span>
        {secondsLeft !== null && (
          <span
            title="Time left"
            className={`shrink-0 rounded px-2 py-0.5 font-mono ${
              secondsLeft < 300 ? "bg-zoom-red/20 text-zoom-red" : "text-white/70"
            }`}
          >
            {fmtClock(secondsLeft)}
          </span>
        )}
        <button
          onClick={() => navigator.clipboard?.writeText(meetingId).catch(() => {})}
          title="Copy meeting ID"
          className="flex shrink-0 items-center gap-1.5 text-white/70 hover:text-white"
        >
          ID {formatMeetingId(meetingId)}
          <Copy className="h-3.5 w-3.5" />
        </button>
        <span className="flex shrink-0 items-center gap-1.5 text-white/70">
          <Users className="h-4 w-4" />
          {people.length}
          {selfId ? "" : " connecting…"}
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {lobbyPing && (
          <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-black/95 px-4 py-2.5 text-[13px] shadow-xl">
            <span>
              <span className="font-semibold">{lobbyPing.display_name}</span>
              {" "}is waiting to join
            </span>
            <button
              onClick={() => admit(lobbyPing.id)}
              className="rounded-md bg-zoom-green px-3 py-1 font-semibold hover:brightness-110"
            >
              Admit
            </button>
            <button
              onClick={() => setLobbyPing(null)}
              className="text-white/60 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}
        {notice && (
          <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg bg-black/95 px-4 py-2.5 text-[13px] text-white shadow-xl">
            {notice}
          </div>
        )}
        <VideoGrid
          people={people}
          selfVideoRef={selfVideo}
          camOn={camOn}
          selfName={name}
          isHostSelf={isHost}
          onRetry={(id) => retryPeer(id)}
        />
        {showParticipants && (
          <ParticipantsPanel
            people={people}
            isHost={isHost}
            lobby={isHost ? lobby : []}
            onAdmit={admit}
            onMuteAll={() => sendMuteAll()}
            onMuteOne={(id) => sendMuteOne(id)}
            onRemove={(id) => sendRemove(id)}
          />
        )}
        {showChat && (
          <ChatPanel
            messages={chat.map((c) => ({
              from: c.fromId === selfId ? name : c.from,
              text: c.text,
              time: c.time,
            }))}
            selfName={name}
            onSend={(text) => sendChat(text)}
          />
        )}
        {securityOpen && (
          <>
            <div
              className="absolute inset-0 z-10"
              onClick={() => setSecurityOpen(false)}
            />
            <div className="absolute bottom-3 left-1/2 z-20 w-[320px] -translate-x-1/2 rounded-lg bg-black/95 p-4 text-[13px] shadow-xl">
              <p className="mb-2 font-semibold">Meeting security</p>
              <p className="text-white/70">Topic: {meeting?.topic ?? "—"}</p>
              <p className="text-white/70">Meeting ID: {meetingId}</p>
              <p className="text-white/70">
                Passcode: {hostPasscode ? hostPasscode : meeting?.has_passcode ? "required" : "none"}
              </p>
              <p className="text-white/70">
                Waiting room: {meeting?.waiting_room ? "on" : "off"}
              </p>
              <p className="mt-2 flex items-center gap-1 text-zoom-green">
                <ShieldCheck className="h-3.5 w-3.5" /> Encrypted P2P media
              </p>
            </div>
          </>
        )}
      </div>

      <ControlBar
        s={{ micOn, camOn, showParticipants, showChat, sharing, recording, securityOpen }}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onToggleSecurity={() => setSecurityOpen((v) => !v)}
        onToggleParticipants={() => setShowParticipants((v) => !v)}
        onToggleChat={() => setShowChat((v) => !v)}
        onToggleShare={toggleShare}
        onToggleRecord={toggleRecord}
        onReact={react}
        onLeave={() => setLeaveOpen(true)}
      />

      <LeaveModal
        open={leaveOpen}
        isHost={isHost}
        onEndAll={endForAll}
        onLeave={() => router.push("/")}
        onCancel={() => setLeaveOpen(false)}
      />
    </div>
  );
}
