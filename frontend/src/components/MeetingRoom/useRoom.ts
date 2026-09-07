"use client";

import { useEffect, useRef, useState } from "react";

export interface Peer {
  id: string;
  name: string;
  stream: MediaStream | null;
  micOff: boolean;
  reaction?: string;
}

export interface RoomChat {
  from: string;
  fromId: string;
  text: string;
  time: string;
}

const WS_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(
  /^http/,
  "ws",
);

const STUN = [{ urls: "stun:stun.l.google.com:19302" }];

// Full-mesh WebRTC room over the FastAPI signaling socket.
// Whoever is already inside offers to each newcomer (peer-joined),
// so exactly one offer exists per pair — no glare.
export function useRoom(
  meetingId: string,
  name: string,
  local: MediaStream | null,
  opts: { onForceMute: () => void; onRemoved: () => void; onMeetingEnded: () => void },
  auth: { host: string; pid: string } = { host: "", pid: "" },
) {
  const [selfId, setSelfId] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [denied, setDenied] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [chat, setChat] = useState<RoomChat[]>([]);
  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const wsRef = useRef<WebSocket | null>(null);
  const selfIdRef = useRef("");
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const patchPeer = (id: string, patch: Partial<Peer>) =>
    setPeers((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  useEffect(() => {
    if (!local) return;
    // Credentials: host token (owner flows) or waiting ticket (guests).
    // Server closes the socket when neither checks out — no lurkers.
    const q = new URLSearchParams({ name });
    if (auth.host) q.set("host", auth.host);
    if (auth.pid) q.set("pid", auth.pid);
    const ws = new WebSocket(`${WS_URL}/ws/${meetingId}?${q.toString()}`);
    wsRef.current = ws;
    let welcomed = false;
    // Server closes unknowns (1008): surface it instead of hanging on "connecting"
    ws.onclose = () => {
      if (!welcomed) setDenied(true);
    };

    const send = (msg: object) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    // One connection per remote peer, carrying our camera+mic
    function getPc(id: string): RTCPeerConnection {
      const existing = pcs.current.get(id);
      if (existing) return existing;
      const pc = new RTCPeerConnection({ iceServers: STUN });
      local!.getTracks().forEach((t) => pc.addTrack(t, local!));
      pc.onicecandidate = (e) => {
        if (e.candidate) send({ kind: "ice", to: id, candidate: e.candidate });
      };
      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        setPeers((ps) =>
          ps.some((p) => p.id === id)
            ? ps.map((p) => (p.id === id ? { ...p, stream } : p))
            : [...ps, { id, name: "Guest", stream, micOff: false }],
        );
      };
      pcs.current.set(id, pc);
      return pc;
    }

    async function callPeer(id: string, peerName: string) {
      setPeers((ps) =>
        ps.some((p) => p.id === id)
          ? ps.map((p) => (p.id === id ? { ...p, name: peerName } : p))
          : [...ps, { id, name: peerName, stream: null, micOff: false }],
      );
      const pc = getPc(id);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ kind: "offer", to: id, sdp: offer.sdp, type: offer.type });
    }

    async function answerPeer(from: string, sdp: string, type: RTCSdpType) {
      const pc = getPc(from);
      await pc.setRemoteDescription({ sdp, type });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({ kind: "answer", to: from, sdp: answer.sdp, type: answer.type });
    }

    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);
      const pc = (id: string) => pcs.current.get(id);
      switch (msg.kind) {
        case "welcome":
          welcomed = true;
          setSelfId(msg.id);
          selfIdRef.current = msg.id;
          setIsHost(!!msg.is_host);
          break;
        case "peer-joined":
          if (msg.id !== selfIdRef.current) await callPeer(msg.id, msg.name);
          break;
        case "offer":
          await answerPeer(msg.from, msg.sdp, msg.type);
          break;
        case "answer":
          await pc(msg.from)?.setRemoteDescription({ sdp: msg.sdp, type: msg.type });
          break;
        case "ice":
          try {
            await pc(msg.from)?.addIceCandidate(msg.candidate);
          } catch {
            /* candidate arrived before remote description — safe to drop */
          }
          break;
        case "peer-left":
          pcs.current.get(msg.id)?.close();
          pcs.current.delete(msg.id);
          setPeers((ps) => ps.filter((p) => p.id !== msg.id));
          break;
        case "chat":
          setChat((c) => [...c, msg]);
          break;
        case "mute":
          patchPeer(msg.id, { micOff: msg.micOff });
          break;
        case "reaction":
          patchPeer(msg.fromId, { reaction: msg.emoji });
          // Clear the emoji after 3s — transient like real Zoom
          setTimeout(() => patchPeer(msg.fromId, { reaction: undefined }), 3000);
          break;
        case "mute-all": // host mutes everyone, incl. me
        case "mute-one": // host mutes just me — same local effect
          optsRef.current.onForceMute();
          break;
        case "removed":
          optsRef.current.onRemoved();
          break;
        case "meeting-ended":
          optsRef.current.onMeetingEnded();
          break;
      }
    };

    return () => {
      ws.close();
      pcs.current.forEach((p) => p.close());
      pcs.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, local]);

  // One sender for every socket message — the six wrappers below
  // differ only in payload, so they stay one-liners.
  function emit(msg: object) {
    wsRef.current?.send(JSON.stringify(msg));
  }

  function sendChat(text: string) {
    emit({ kind: "chat", text });
  }

  function sendMute(micOff: boolean) {
    emit({ kind: "mute", micOff });
  }

  function sendMuteAll() {
    emit({ kind: "mute-all" });
  }

  function sendMuteOne(to: string) {
    emit({ kind: "mute-one", to });
  }

  function sendRemove(to: string) {
    emit({ kind: "remove", to });
  }

  function sendReaction(emoji: string) {
    emit({ kind: "reaction", emoji });
  }

  // Swap the outgoing video track on every connection (screen share).
  function replaceVideoTrack(track: MediaStreamTrack) {
    pcs.current.forEach((pc) => {
      pc.getSenders().find((s) => s.track?.kind === "video")?.replaceTrack(track);
    });
  }

  return { selfId, isHost, denied, peers, chat, sendChat, sendMute, sendMuteAll, sendMuteOne, sendRemove, sendReaction, replaceVideoTrack };
}
