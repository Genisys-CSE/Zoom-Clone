"use client";

import { RefObject, useEffect, useRef } from "react";
import { MicOff } from "lucide-react";

export interface TilePerson {
  key: string;
  name: string;
  isSelf?: boolean;
  micOff?: boolean;
  stream?: MediaStream | null;
  reaction?: string;
}

// Plays a remote peer's stream into a <video> element.
function RemoteVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video ref={ref} autoPlay playsInline className="h-full w-full object-cover" />
  );
}

// Gallery grid. Self tile plays the live camera stream;
// remote tiles play peer streams (avatar while ICE connects).
export default function VideoGrid({
  people,
  selfVideoRef,
  camOn,
  selfName,
  isHostSelf,
}: {
  people: TilePerson[];
  selfVideoRef: RefObject<HTMLVideoElement | null>;
  camOn: boolean;
  selfName: string;
  isHostSelf: boolean;
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto p-3 sm:grid-cols-2">
      {people.map((p) => (
        <div
          key={p.key}
          className="relative min-h-[180px] overflow-hidden rounded-lg bg-black"
        >
          {p.isSelf ? (
            <>
              <video
                ref={selfVideoRef}
                autoPlay
                playsInline
                muted
                className={`h-full w-full object-cover ${camOn ? "" : "invisible"}`}
              />
              {!camOn && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zoom-blue text-xl font-bold text-white">
                    {selfName.charAt(0).toUpperCase()}
                  </div>
                </div>
              )}
            </>
          ) : p.stream ? (
            <RemoteVideo stream={p.stream} />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#3a4356] text-xl font-bold text-white">
                {p.name.charAt(0).toUpperCase()}
              </div>
              <p className="text-[11px] text-white/50">connecting…</p>
            </div>
          )}
          {p.micOff && (
            <span className="absolute right-2 top-2 rounded bg-black/60 p-1">
              <MicOff className="h-3.5 w-3.5 text-zoom-red" />
            </span>
          )}
          {p.reaction && (
            <span className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-2xl">
              {p.reaction}
            </span>
          )}
          <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-[12px] text-white">
            {p.name}
            {p.isSelf && isHostSelf ? " (host)" : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
