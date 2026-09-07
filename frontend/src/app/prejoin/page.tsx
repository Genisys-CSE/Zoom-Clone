"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { DEF_CAM_KEY, DEF_MIC_KEY } from "@/components/ProfileMenu";
import { getAdmission, getHostToken, getHostView, joinMeeting, validateMeeting } from "@/lib/api";
import { getSessionName } from "@/lib/session";

function PrejoinInner() {
  const params = useSearchParams();
  const router = useRouter();
  const meetingId = params.get("meetingId") ?? "";
  // pid = a join already happened upstream (JoinView waiting path)
  const [pid, setPid] = useState<number | null>(() => {
    const p = Number(params.get("pid"));
    return Number.isFinite(p) && p > 0 ? p : null;
  });
  const [name, setName] = useState(
    () => params.get("name") ?? getSessionName() ?? "",
  );
  // Priority: explicit join-form choice (?mic/?cam) > profile Settings
  // defaults > on. localStorage guarded for prerender.
  const stored = (param: string, key: string) =>
    params.get(param) ??
    (typeof window !== "undefined" ? localStorage.getItem(key) : null) ??
    "on";
  const [micOn, setMicOn] = useState(() => stored("mic", DEF_MIC_KEY) !== "off");
  const [camOn, setCamOn] = useState(() => stored("cam", DEF_CAM_KEY) !== "off");
  const [camBlocked, setCamBlocked] = useState(false);
  const [joining, setJoining] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [denied, setDenied] = useState("");
  // Passcode field is always visible — direct invite links skip every
  // earlier form, so this screen can't assume one was collected.
  const [passcode, setPasscode] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Hosts see their meeting's passcode pre-filled (owner-only host-view).
  // Guests always type it themselves — never leaked to them.
  useEffect(() => {
    if (!getHostToken(meetingId)) return;
    getHostView(meetingId)
      .then((m) => m.passcode && setPasscode(m.passcode))
      .catch(() => {});
  }, [meetingId]);

  // Meeting's video policy enforced here: hosts follow host_video,
  // guests follow participant_video — unless an explicit ?cam= choice
  // (join form) or a manual toggle already decided.
  useEffect(() => {
    if (params.get("cam")) return; // explicit choice wins
    validateMeeting(meetingId)
      .then((m) => {
        if (!m) return;
        const wantOn = getHostToken(meetingId) ? m.host_video : m.participant_video;
        if (!wantOn) {
          setCamOn(false);
          streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = false));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  // Ask for camera+mic once on mount, applying join-form choices
  const micRef = useRef(micOn);
  micRef.current = micOn;
  const camRef = useRef(camOn);
  camRef.current = camOn;
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
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => alive && setCamBlocked(true));
    // Stop camera when leaving the page
    return () => {
      alive = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Waiting-room poll: host admits -> auto-enter the room
  useEffect(() => {
    if (pid === null) return;
    setWaiting(true);
    const t = setInterval(async () => {
      try {
        const { admitted } = await getAdmission(meetingId, pid);
        if (admitted) {
          clearInterval(t);
          enterRoom();
        }
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, meetingId]);

  function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
  }

  function toggleCam() {
    const next = !camOn;
    setCamOn(next);
    streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
  }

  function enterRoom() {
    // Carry mic/cam state + waiting ticket into the room
    const q = new URLSearchParams({
      name: name.trim(),
      ...(micOn ? {} : { mic: "off" }),
      ...(camOn ? {} : { cam: "off" }),
      ...(pid !== null ? { pid: String(pid) } : {}),
    });
    router.push(`/meeting/${meetingId}?${q.toString()}`);
  }

  async function handleJoin() {
    if (!name.trim() || joining || waiting) return;
    // Already joined upstream (JoinView waiting path) — don't double-join,
    // the waiting poll takes over.
    if (pid !== null) {
      setWaiting(true);
      return;
    }
    setJoining(true);
    setDenied("");
    try {
      // Host token (owner flows stored it) skips passcode + waiting room.
      // Otherwise the passcode field above rides along ("" when none needed).
      const res = await joinMeeting(
        meetingId,
        name.trim(),
        passcode,
        getHostToken(meetingId),
      );
      if (res.admitted) {
        enterRoom();
      } else {
        setPid(res.participant_id); // -> waiting poll above takes over
      }
    } catch (e) {
      const status = (e as Error & { status?: number }).status;
      setDenied(
        status === 403
          ? "Wrong passcode — try again below"
          : status === 429
            ? "Too many wrong passcodes — try again in a minute"
            : status === 409
              ? "The host hasn't started this meeting yet"
              : status === 410
                ? "This meeting has ended"
                : "Couldn't reach the server",
      );
      // Field stays visible so they can retry right here
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-room text-white">
      <div className="flex items-center p-4">
        <span className="text-[18px] font-extrabold tracking-tight text-white">
          zoom
        </span>
      </div>

      <div className="flex flex-1 items-center justify-center px-4">
        <div className="relative h-[260px] w-[640px] max-w-full overflow-hidden rounded-xl bg-black sm:h-[360px]">
          {!camBlocked && (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-cover ${camOn ? "" : "invisible"}`}
            />
          )}
          {(camBlocked || !camOn) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-zoom-blue text-2xl font-bold">
                {name.trim().charAt(0).toUpperCase() || "J"}
              </div>
              <p className="text-sm text-white/60">
                {camBlocked ? "Camera unavailable" : "Camera off"}
              </p>
            </div>
          )}
          <span className="absolute bottom-3 left-3 rounded bg-black/60 px-2 py-0.5 text-[12px]">
            {name.trim() || "You"}
          </span>
        </div>
      </div>

      {waiting ? (
        <div className="flex flex-col items-center gap-2 pb-10 text-center">
          <Clock className="h-6 w-6 animate-pulse text-zoom-blue" />
          <p className="text-sm font-medium">Waiting for the host to let you in…</p>
          <p className="text-xs text-white/50">You&apos;ll enter automatically</p>
          <button
            onClick={() => router.push("/")}
            className="mt-2 text-[13px] text-white/60 underline hover:text-white"
          >
            Leave
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 pb-10">
          {/* Always visible: direct invite links skip every earlier form */}
          <input
            value={passcode}
            onChange={(e) => setPasscode(e.target.value.replace(/\D/g, "").slice(0, 10))}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            placeholder="Meeting passcode (if required)"
            inputMode="numeric"
            className="w-48 rounded-md border border-white/20 bg-toolbar px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-zoom-blue"
          />
          <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={toggleMic}
            title={micOn ? "Mute" : "Unmute"}
            className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
              micOn ? "bg-toolbar hover:bg-white/20" : "bg-zoom-red"
            }`}
          >
            {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
          </button>
          <button
            onClick={toggleCam}
            title={camOn ? "Stop video" : "Start video"}
            className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
              camOn ? "bg-toolbar hover:bg-white/20" : "bg-zoom-red"
            }`}
          >
            {camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          </button>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            placeholder="Your name"
            className="w-48 rounded-md border border-white/20 bg-toolbar px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-zoom-blue"
          />
          <button
            onClick={handleJoin}
            disabled={!name.trim() || joining}
            className="rounded-md bg-zoom-blue px-6 py-2 text-sm font-semibold hover:bg-zoom-blue-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {joining ? "Joining…" : "Join Now"}
          </button>
          </div>
        </div>
      )}
      {denied && (
        <p className="-mt-6 pb-8 text-center text-sm text-zoom-red">{denied}</p>
      )}
    </div>
  );
}

export default function PrejoinPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-room text-sm text-white/60">
          Loading… <Link href="/" className="ml-2 underline">Back</Link>
        </div>
      }
    >
      <PrejoinInner />
    </Suspense>
  );
}
