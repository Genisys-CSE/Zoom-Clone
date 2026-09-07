"use client";

import { Mic, MicOff, UserCheck, UserX } from "lucide-react";
import type { TilePerson } from "./VideoGrid";
import type { LobbyGuest } from "@/lib/api";

// Right-side roster. Host gets per-row Mute + Remove on hover,
// Mute All hits everyone via the socket, lobby guests get Admit buttons.
export default function ParticipantsPanel({
  people,
  isHost,
  lobby,
  onAdmit,
  onMuteAll,
  onMuteOne,
  onRemove,
}: {
  people: (TilePerson & { id?: string })[];
  isHost: boolean;
  lobby: LobbyGuest[];
  onAdmit: (pid: number) => void;
  onMuteAll: () => void;
  onMuteOne: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex h-full w-[300px] max-w-[70vw] shrink-0 flex-col border-l border-white/10 bg-toolbar text-white">
      <h3 className="border-b border-white/10 px-4 py-3 text-[14px] font-semibold">
        Participants ({people.length})
      </h3>
      <ul className="flex-1 overflow-y-auto">
        {isHost &&
          lobby.map((g) => (
            <li
              key={`lobby-${g.id}`}
              className="flex items-center gap-3 border-b border-dashed border-white/10 bg-zoom-blue/10 px-4 py-2.5"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-xs font-bold">
                {g.display_name.charAt(0).toUpperCase()}
              </div>
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {g.display_name}
                <span className="text-white/50"> · waiting</span>
              </span>
              <button
                title={`Admit ${g.display_name}`}
                onClick={() => onAdmit(g.id)}
                className="flex shrink-0 items-center gap-1 rounded-md bg-zoom-green px-2 py-1 text-[12px] font-semibold hover:brightness-110"
              >
                <UserCheck className="h-3.5 w-3.5" />
                Admit
              </button>
            </li>
          ))}
        {people.map((p) => (
          <li
            key={p.key}
            className="group flex items-center gap-3 px-4 py-2.5 hover:bg-white/5"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zoom-blue text-xs font-bold">
              {p.name.charAt(0).toUpperCase()}
            </div>
            <span className="min-w-0 flex-1 truncate text-[13px]">
              {p.name}
              {p.isSelf ? " (you)" : ""}
            </span>
            {p.micOff ? (
              <MicOff className="h-4 w-4 shrink-0 text-zoom-red" />
            ) : (
              <Mic className="h-4 w-4 shrink-0 text-white/60" />
            )}
            {isHost && !p.isSelf && p.id && (
              <span className="hidden shrink-0 gap-1 group-hover:flex">
                <button
                  title={`Mute ${p.name}`}
                  onClick={() => onMuteOne(p.id!)}
                  className="rounded p-1 hover:bg-white/15"
                >
                  <MicOff className="h-3.5 w-3.5" />
                </button>
                <button
                  title={`Remove ${p.name}`}
                  onClick={() => onRemove(p.id!)}
                  className="rounded p-1 hover:bg-zoom-red"
                >
                  <UserX className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2 border-t border-white/10 p-3">
        <button
          onClick={onMuteAll}
          className="flex-1 rounded-md bg-white/10 py-1.5 text-[12px] font-medium hover:bg-white/20"
        >
          Mute All
        </button>
        <button
          onClick={() =>
            navigator.clipboard
              ?.writeText(`${window.location.origin}/prejoin?meetingId=${window.location.pathname.split("/").pop()}`)
              .catch(() => {})
          }
          className="flex-1 rounded-md bg-white/10 py-1.5 text-[12px] font-medium hover:bg-white/20"
        >
          Copy Invite
        </button>
      </div>
    </div>
  );
}
