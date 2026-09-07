"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import {
  authMe,
  getThread,
  searchUsers,
  sendChatMessage,
  type ChatMessage,
  type SearchedUser,
} from "@/lib/api";
import { getSessionName, onAuthChange } from "@/lib/session";

// 1:1 chat with full server-side history. Polls every 3s;
// history survives reloads because it lives in SQLite, not memory.
export default function ChatView() {
  const [meId, setMeId] = useState<number | null>(null);
  // Sync session read: reload with a session never flashes logged-out.
  const [ready, setReady] = useState(false);
  const [peers, setPeers] = useState<SearchedUser[]>([]);
  const [peerId, setPeerId] = useState<number | null>(null);
  const [thread, setThread] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  function loadIdentity() {
    const session = getSessionName();
    if (!session) {
      setMeId(null);
      setPeers([]);
      setThread([]);
      setPeerId(null);
      setReady(true);
      return;
    }
    authMe()
      .then((u) => {
        setMeId(u.id);
        // Everyone except me = conversation list
        searchUsers("")
          .then((users) => {
            const others = users.filter((x) => x.id !== u.id);
            setPeers(others);
            setPeerId((prev) =>
              prev && others.some((x) => x.id === prev) ? prev : others[0]?.id ?? null,
            );
          })
          .catch(() => {});
      })
      .catch(() => setMeId(null))
      .finally(() => setReady(true));
  }

  useEffect(() => {
    loadIdentity();
    return onAuthChange(loadIdentity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Thread for the selected peer, refreshed on a short poll
  useEffect(() => {
    if (peerId === null) return;
    let alive = true;
    const load = () =>
      getThread(peerId)
        .then((ms) => alive && setThread(ms))
        .catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [meId, peerId]);

  // Stick to the newest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread]);

  async function send() {
    const text = draft.trim();
    if (!text || meId === null || peerId === null || sending) return;
    setSending(true);
    try {
      const m = await sendChatMessage(peerId, text);
      setThread((t) => [...t, m]);
      setDraft("");
    } catch {
      /* keep the draft so nothing is lost */
    } finally {
      setSending(false);
    }
  }

  if (!ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-[13px] text-ink-secondary">Loading…</p>
      </div>
    );
  }

  if (meId === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-[16px] font-semibold">Please login first.</p>
        <p className="text-[13px] text-ink-secondary">
          Sign in from the avatar menu to chat.
        </p>
      </div>
    );
  }

  const peer = peers.find((p) => p.id === peerId);

  return (
    <div className="flex h-full flex-col sm:flex-row">
      {/* Conversation list */}
      <div className="flex max-h-40 shrink-0 flex-col overflow-y-auto border-b border-line sm:max-h-none sm:w-[240px] sm:border-b-0 sm:border-r">
        <h3 className="px-4 pb-1 pt-3 text-[15px] font-bold">Chats</h3>
        {peers.length === 0 && (
          <p className="px-4 py-6 text-[13px] text-ink-secondary">No one to chat with yet.</p>
        )}
        {peers.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeerId(p.id)}
            className={`flex items-center gap-3 px-4 py-2.5 text-left hover:bg-black/[.04] ${
              p.id === peerId ? "bg-zoom-blue/10" : ""
            }`}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zoom-blue text-xs font-bold text-white">
              {p.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold">{p.name}</p>
              <p className="truncate text-[12px] text-ink-secondary">{p.email}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Thread */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!peer ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-ink-secondary">
            <MessageSquare className="h-4 w-4" />
            Pick a conversation
          </div>
        ) : (
          <>
            <header className="border-b border-line px-4 py-3">
              <p className="text-[14px] font-semibold">{peer.name}</p>
            </header>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {thread.length === 0 && (
                <p className="py-8 text-center text-[13px] text-ink-secondary">
                  No messages yet — say hi.
                </p>
              )}
              {thread.map((m) => {
                const mine = m.from_user_id === meId;
                return (
                  <div key={m.id} className={`mb-2 flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[70%] rounded-2xl px-3 py-1.5 text-[13px] ${
                        mine ? "bg-zoom-blue text-white" : "bg-app-bg"
                      }`}
                      title={new Date(m.created_at.replace(" ", "T")).toLocaleString()}
                    >
                      {m.text}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            <div className="flex items-center gap-2 border-t border-line p-3">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder={`Message ${peer.name}…`}
                className="min-w-0 flex-1 rounded-full border border-line px-4 py-2 text-[13px] outline-none focus:border-zoom-blue"
              />
              <button
                onClick={send}
                disabled={!draft.trim() || sending}
                className="rounded-full bg-zoom-blue p-2.5 text-white hover:bg-zoom-blue-hover disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
