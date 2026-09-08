"use client";

import { RefObject, useEffect, useRef, useState } from "react";
import { MicOff, RotateCw } from "lucide-react";

export interface TilePerson {
  key: string;
  id?: string;
  name: string;
  isSelf?: boolean;
  micOff?: boolean;
  stream?: MediaStream | null;
  failed?: boolean;
}

// Plays a remote peer's stream. Browsers (especially mobile) often block
// autoplay WITH sound until the user taps — without the fallback below the
// tile stays black and silent even though media is flowing.
function RemoteVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream;
    const attempt = v.play();
    if (attempt) {
      attempt.then(() => setBlocked(false)).catch(() => setBlocked(true));
    }
  }, [stream]);
  const unblock = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = false;
    const attempt = v.play();
    if (attempt) attempt.then(() => setBlocked(false)).catch(() => {});
    else setBlocked(false);
  };
  return (
    <div className="relative h-full w-full">
      <video
        ref={ref}
        autoPlay
        playsInline
        onPlaying={() => setBlocked(false)}
        className="h-full w-full object-cover"
      />
      {blocked && (
        <button
          onClick={unblock}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/70 text-[12px] text-white"
        >
          <span className="text-xl">🔊</span>
          Tap to enable audio/video
        </button>
      )}
    </div>
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
  onRetry,
}: {
  people: TilePerson[];
  selfVideoRef: RefObject<HTMLVideoElement | null>;
  camOn: boolean;
  selfName: string;
  isHostSelf: boolean;
  onRetry: (id: string) => void;
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
              {p.failed ? (
                <>
                  <p className="text-[11px] text-zoom-red">Connection failed</p>
                  <button
                    onClick={() => p.id && onRetry(p.id)}
                    className="flex items-center gap-1 rounded-md bg-zoom-blue px-3 py-1 text-[12px] font-semibold text-white hover:bg-zoom-blue-hover"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    Retry
                  </button>
                </>
              ) : (
                <p className="text-[11px] text-white/50">connecting…</p>
              )}
            </div>
          )}
          {p.micOff && (
            <span className="absolute right-2 top-2 rounded bg-black/60 p-1">
              <MicOff className="h-3.5 w-3.5 text-zoom-red" />
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
