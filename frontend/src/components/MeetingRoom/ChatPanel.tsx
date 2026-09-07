"use client";

import { useState } from "react";
import { Send } from "lucide-react";

export interface ChatMsg {
  from: string;
  text: string;
  time: string;
}

// Local-only chat. Real fan-out arrives with the signaling socket.
export default function ChatPanel({
  messages,
  selfName,
  onSend,
}: {
  messages: ChatMsg[];
  selfName: string;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function send() {
    if (!draft.trim()) return;
    onSend(draft.trim());
    setDraft("");
  }

  return (
    <div className="flex h-full w-[300px] max-w-[70vw] shrink-0 flex-col border-l border-white/10 bg-toolbar text-white">
      <h3 className="border-b border-white/10 px-4 py-3 text-[14px] font-semibold">
        Chat
      </h3>
      <div className="px-4 py-2 text-[12px] text-white/60">
        To: <span className="text-white">Everyone</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-2">
        {messages.length === 0 && (
          <p className="py-6 text-center text-[12px] text-white/40">
            No messages yet
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className="mb-2.5">
            <p className="text-[12px]">
              <span className="font-semibold text-zoom-blue">
                {m.from === selfName ? "You" : m.from}
              </span>{" "}
              <span className="text-white/40">{m.time}</span>
            </p>
            <p className="text-[13px]">{m.text}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-white/10 p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Type a message…"
          className="min-w-0 flex-1 rounded-md bg-white/10 px-3 py-1.5 text-[13px] outline-none placeholder:text-white/40 focus:ring-1 focus:ring-zoom-blue"
        />
        <button
          onClick={send}
          className="rounded-md bg-zoom-blue p-2 hover:bg-zoom-blue-hover"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
