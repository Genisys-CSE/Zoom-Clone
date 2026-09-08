"use client";

import {
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  ShieldCheck,
  Users,
  Video,
  VideoOff,
} from "lucide-react";

export interface ControlState {
  micOn: boolean;
  camOn: boolean;
  showParticipants: boolean;
  showChat: boolean;
  sharing: boolean;
  recording: boolean;
  securityOpen: boolean;
}

// Bottom toolbar — exact Zoom order. Pure presentational: state in, events out.
export default function ControlBar({
  s,
  onToggleMic,
  onToggleCam,
  onToggleSecurity,
  onToggleParticipants,
  onToggleChat,
  onToggleShare,
  onToggleRecord,
  onLeave,
}: {
  s: ControlState;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleSecurity: () => void;
  onToggleParticipants: () => void;
  onToggleChat: () => void;
  onToggleShare: () => void;
  onToggleRecord: () => void;
  onLeave: () => void;
}) {
  const btn =
    "flex h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-2 text-white transition-colors hover:bg-white/15";
  const off = "bg-zoom-red hover:bg-zoom-red";

  return (
    <div className="flex h-16 shrink-0 items-center gap-1 overflow-x-auto bg-toolbar px-4 sm:justify-center">
      <div className="flex shrink-0 items-center gap-1">
      <button onClick={onToggleMic} title="Mute/Unmute (Alt+A)" className={`${btn} ${s.micOn ? "" : off}`}>
        {s.micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
      </button>
      <button onClick={onToggleCam} title="Start/Stop video (Alt+V)" className={`${btn} ${s.camOn ? "" : off}`}>
        {s.camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
      </button>
      <button
        onClick={onToggleSecurity}
        title="Security"
        className={`${btn} ${s.securityOpen ? "bg-white/15" : ""}`}
      >
        <ShieldCheck className="h-5 w-5" />
      </button>
      <button
        onClick={onToggleParticipants}
        title="Participants (Alt+U)"
        className={`${btn} ${s.showParticipants ? "bg-white/15" : ""}`}
      >
        <Users className="h-5 w-5" />
      </button>
      <button
        onClick={onToggleChat}
        title="Chat (Alt+H)"
        className={`${btn} ${s.showChat ? "bg-white/15" : ""}`}
      >
        <MessageSquare className="h-5 w-5" />
      </button>
      <button
        onClick={onToggleShare}
        title="Share screen (Alt+S)"
        className={`${btn} ${s.sharing ? "bg-zoom-green" : ""}`}
      >
        <MonitorUp className="h-5 w-5" />
      </button>
      <button
        onClick={onToggleRecord}
        title={s.recording ? "Stop recording (downloads file)" : "Record this meeting (Alt+R)"}
        className={`${btn} ${s.recording ? "bg-zoom-red" : ""}`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${s.recording ? "bg-white" : "border-2 border-white"}`} />
      </button>
      <div className="flex-1" />
      <button
        onClick={onLeave}
        className="flex h-10 shrink-0 items-center gap-2 rounded-lg bg-zoom-red px-5 text-sm font-semibold text-white hover:brightness-110"
      >
        <PhoneOff className="h-4 w-4" />
        Leave
      </button>
      </div>
    </div>
  );
}
