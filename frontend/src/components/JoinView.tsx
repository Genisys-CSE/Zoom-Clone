"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { joinMeeting, validateMeeting } from "@/lib/api";
import { getSessionName } from "@/lib/session";

const SAVED_NAME_KEY = "zoom-clone-name";

export default function JoinView() {
  const params = useSearchParams();
  // Prefilled from topbar search (?id=) or remembered name.
  // localStorage only exists in the browser — guard for prerender.
  const [rawId, setRawId] = useState(params.get("id") ?? "");
  const [name, setName] = useState(
    () =>
      (typeof window !== "undefined" && localStorage.getItem(SAVED_NAME_KEY)) ||
      getSessionName() ||
      "",
  );
  const [remember, setRemember] = useState(true);
  const [noAudio, setNoAudio] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const router = useRouter();

  const digits = rawId.replace(/\D/g, "").slice(0, 11);
  const pretty =
    digits.length > 6
      ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
      : digits.length > 3
        ? `${digits.slice(0, 3)}-${digits.slice(3)}`
        : digits;

  const valid = digits.length >= 9 && name.trim().length > 0;

  async function handleJoin() {
    if (!valid) {
      setError(
        digits.length < 9
          ? "This meeting ID is not valid"
          : "Please enter your name",
      );
      return;
    }
    // Remember-name actually persists now
    if (remember) localStorage.setItem(SAVED_NAME_KEY, name.trim());
    else localStorage.removeItem(SAVED_NAME_KEY);
    const av = {
      ...(noAudio ? { mic: "off" } : {}),
      ...(videoOff ? { cam: "off" } : {}),
    };
    // Mic/cam choices ride along and prejoin applies them
    const goPrejoin = (extra: Record<string, string> = {}) => {
      const q = new URLSearchParams({
        meetingId: digits,
        name: name.trim(),
        ...av,
        ...extra,
      });
      router.push(`/prejoin?${q.toString()}`);
    };
    setChecking(true);
    try {
      // Step 1: does it exist + is a passcode required?
      const meeting = await validateMeeting(digits);
      if (!meeting) {
        setError("This meeting ID is not valid");
        return;
      }
      if (meeting.status === "ended") {
        setError("This meeting has ended");
        return;
      }
      if (meeting.status === "idle") {
        setError("The host hasn't started this meeting yet");
        return;
      }
      if (meeting.has_passcode && !passcode) {
        // Field is already visible above — just point at it
        setError("This meeting needs a passcode — enter it above");
        return;
      }
      // Step 2: entry gate — 403 wrong passcode, waiting room holds
      try {
        const res = await joinMeeting(digits, name.trim(), passcode);
        if (!res.admitted) goPrejoin({ pid: String(res.participant_id) });
        else goPrejoin();
      } catch (e) {
        const status = (e as Error & { status?: number }).status;
        if (status === 403) {
          setError("Wrong passcode — try again");
        } else if (status === 409) {
          setError("The host hasn't started this meeting yet");
        } else if (status === 429) {
          setError("Too many wrong passcodes — try again in a minute");
        } else throw e;
      }
    } catch {
      setError((prev) => prev || "Couldn't reach the server. Is the backend running?");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex h-full justify-center overflow-y-auto px-4">
      <div className="w-full max-w-[400px] pt-16 sm:pt-24">
        <h1 className="text-[22px] font-bold">Join Meeting</h1>

        <input
          autoFocus
          value={pretty}
          onChange={(e) => {
            setRawId(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => e.key === "Enter" && handleJoin()}
          placeholder="Meeting ID or Personal Link Name"
          inputMode="numeric"
          className={`mt-4 w-full rounded-lg border px-3 py-2 text-[14px] outline-none focus:ring-2 ${
            error
              ? "border-zoom-red focus:ring-zoom-red/30"
              : "border-line focus:border-zoom-blue focus:ring-zoom-blue/30"
          }`}
        />
        {error && <p className="mt-1 text-[12px] text-zoom-red">{error}</p>}

        {/* Always visible: direct-link guests never passed a form before this */}
        <input
          value={passcode}
          onChange={(e) => setPasscode(e.target.value.replace(/\D/g, "").slice(0, 10))}
          onKeyDown={(e) => e.key === "Enter" && handleJoin()}
          placeholder="Meeting passcode (if required)"
          inputMode="numeric"
          className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-[14px] outline-none focus:border-zoom-blue focus:ring-2 focus:ring-zoom-blue/30"
        />

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleJoin()}
          placeholder="Your name"
          className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-[14px] outline-none focus:border-zoom-blue focus:ring-2 focus:ring-zoom-blue/30"
        />

        <div className="mt-3 flex flex-col gap-2 text-[13px]">
          {[
            { label: "Remember my name for future meetings", v: remember, set: setRemember },
            { label: "Do not connect to audio", v: noAudio, set: setNoAudio },
            { label: "Turn off my video", v: videoOff, set: setVideoOff },
          ].map((c) => (
            <label key={c.label} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={c.v}
                onChange={(e) => c.set(e.target.checked)}
                className="h-4 w-4 accent-zoom-blue"
              />
              {c.label}
            </label>
          ))}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={() => router.push("/")}
            className="rounded-md border border-line bg-white px-4 py-1 text-[13px] font-medium text-ink hover:bg-black/5"
          >
            Cancel
          </button>
          <button
            onClick={handleJoin}
            disabled={!valid || checking}
            className="rounded-md bg-zoom-blue px-4 py-1 text-[13px] font-semibold text-white transition-colors hover:bg-zoom-blue-hover disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-ink-secondary"
          >
            {checking ? "Checking…" : "Join"}
          </button>
        </div>
      </div>
    </div>
  );
}
