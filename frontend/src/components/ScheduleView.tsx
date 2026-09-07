"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { authMe, createScheduled, formatMeetingId } from "@/lib/api";

function randomPasscode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function ScheduleView() {
  const router = useRouter();
  const [topic, setTopic] = useState("Zoom Meeting");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState("14:00");
  const [durationMin, setDurationMin] = useState(30);
  const [usePmi, setUsePmi] = useState(false);
  const [passcode, setPasscode] = useState(randomPasscode());
  const [showPass, setShowPass] = useState(false);
  const [waitingRoom, setWaitingRoom] = useState(true);
  const [hostVideoOn, setHostVideoOn] = useState(true);
  const [participantVideoOn, setParticipantVideoOn] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  // Default topic follows whoever is signed in: "{name}'s Zoom Meeting"
  const [creator, setCreator] = useState("");
  const [creatorPmi, setCreatorPmi] = useState("");
  useEffect(() => {
    authMe()
      .then((u) => {
        setTopic(`${u.name}'s Zoom Meeting`);
        setCreator(u.name);
        setCreatorPmi(u.pmi);
      })
      .catch(() => {});
  }, []);

  const valid = topic.trim().length > 0 && date !== "" && time !== "";

  async function handleSave() {
    if (!valid || saving) return;
    if (!creator) {
      // Logged out: the meeting would belong to nobody — stop here
      setSaveError("Please sign in from the avatar menu first");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await createScheduled({
        topic: topic.trim(),
        description: description.trim(),
        date,
        time,
        duration_min: durationMin,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        use_pmi: usePmi,
        passcode,
        waiting_room: waitingRoom,
        host_video: hostVideoOn,
        participant_video: participantVideoOn,
        audio: "computer", // computer audio only; no dial-in service
      });
      router.push("/meetings");
    } catch {
      setSaveError("Couldn't save. Is the backend running?");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full justify-center overflow-y-auto">
      <div className="w-[560px] py-10">
        <h1 className="text-[22px] font-bold">Schedule a Meeting</h1>

        <label className="mt-6 block text-[13px] font-medium">Topic</label>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-[14px] outline-none focus:border-zoom-blue focus:ring-2 focus:ring-zoom-blue/30"
        />

        <label className="mt-4 block text-[13px] font-medium">
          Description <span className="font-normal text-ink-secondary">(Optional)</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Enter meeting description"
          className="mt-1 w-full resize-none rounded-lg border border-line px-3 py-2 text-[14px] outline-none focus:border-zoom-blue focus:ring-2 focus:ring-zoom-blue/30"
        />

        <label className="mt-4 block text-[13px] font-medium">When</label>
        <div className="mt-1 flex gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="flex-1 rounded-lg border border-line px-3 py-2 text-[14px] outline-none focus:border-zoom-blue"
          />
          <input
            type="time"
            value={time}
            step={900}
            onChange={(e) => setTime(e.target.value)}
            className="w-[130px] rounded-lg border border-line px-3 py-2 text-[14px] outline-none focus:border-zoom-blue"
          />
          <select
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value))}
            className="w-[110px] rounded-lg border border-line bg-white px-2 py-2 text-[14px] outline-none focus:border-zoom-blue"
          >
            {[15, 30, 45, 60].map((d) => (
              <option key={d} value={d}>
                {d} min
              </option>
            ))}
          </select>
        </div>
        <p className="mt-1 text-[12px] text-ink-secondary">
          Time Zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </p>

        <p className="mt-4 text-[13px] font-medium">Meeting ID</p>
        <div className="mt-1 flex gap-4 text-[13px]">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              checked={!usePmi}
              onChange={() => setUsePmi(false)}
              className="accent-zoom-blue"
            />
            Generate Automatically
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              checked={usePmi}
              onChange={() => setUsePmi(true)}
              className="accent-zoom-blue"
            />
            Personal Meeting ID {creatorPmi ? formatMeetingId(creatorPmi) : "…"}
          </label>
        </div>

        <p className="mt-4 text-[13px] font-medium">Security</p>
        <div className="mt-1 flex flex-col gap-2 text-[13px]">
          <div className="flex items-center gap-2">
            <span className="text-ink-secondary">Passcode</span>
            <div className="relative">
              <input
                value={passcode}
                onChange={(e) => setPasscode(e.target.value.replace(/\D/g, "").slice(0, 10))}
                type={showPass ? "text" : "password"}
                className="w-[140px] rounded-lg border border-line px-3 py-1.5 pr-9 text-[14px] outline-none focus:border-zoom-blue"
              />
              <button
                onClick={() => setShowPass(!showPass)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-secondary hover:text-ink"
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={waitingRoom}
              onChange={(e) => setWaitingRoom(e.target.checked)}
              className="h-4 w-4 accent-zoom-blue"
            />
            Waiting Room
          </label>
        </div>

        <p className="mt-4 text-[13px] font-medium">Video</p>
        <div className="mt-1 flex gap-6 text-[13px]">
          <span className="text-ink-secondary">Host</span>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={hostVideoOn}
              onChange={(e) => setHostVideoOn(e.target.checked)}
              className="h-4 w-4 accent-zoom-blue"
            />
            On
          </label>
          <span className="ml-4 text-ink-secondary">Participant</span>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={participantVideoOn}
              onChange={(e) => setParticipantVideoOn(e.target.checked)}
              className="h-4 w-4 accent-zoom-blue"
            />
            On
          </label>
        </div>

        <p className="mt-4 text-[13px] font-medium">Audio</p>
        <p className="mt-1 text-[13px] text-ink-secondary">Computer Audio</p>

        {saveError && (
          <p className="mt-4 text-[13px] text-zoom-red">{saveError}</p>
        )}
        <div className="mt-4 flex justify-end gap-2 pb-4">
          <button
            onClick={() => router.push("/")}
            className="rounded-md border border-line bg-white px-4 py-1 text-[13px] font-medium text-ink hover:bg-black/5"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!valid || saving}
            className="rounded-md bg-zoom-blue px-4 py-1 text-[13px] font-semibold text-white transition-colors hover:bg-zoom-blue-hover disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-ink-secondary"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
