"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Home as HouseIcon,
  MessageSquare as ChatBubbleIcon,
  Search as MagnifyingGlassIcon,
  Settings as GearIcon,
  Video as VideoCameraIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import ProfileMenu from "./ProfileMenu";
import {
  createInstant,
  inviteUser,
  saveHostToken,
  searchUsers,
  type SearchedUser,
} from "@/lib/api";
import { getSessionName } from "@/lib/session";

const NAV = [
  { href: "/", label: "Home", Icon: HouseIcon },
  { href: "/meetings", label: "Meetings", Icon: VideoCameraIcon },
  { href: "/chat", label: "Chat", Icon: ChatBubbleIcon },
] as const;

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [results, setResults] = useState<SearchedUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState("");
  const [invitingId, setInvitingId] = useState<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3000);
  }

  // Live username search as you type (debounced by keystroke rhythm:
  // only fires when the query actually changed and isn't an ID).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || /^\d+$/.test(q)) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      searchUsers(q)
        .then((users) => {
          // Don't invite yourself
          const me = getSessionName();
          setResults(users.filter((u) => u.name !== me));
        })
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // Invite = spin up a live meeting as me, then send the invitation.
  // Guest sees it in their inbox and joins as guest.
  async function invite(target: SearchedUser) {
    const me = getSessionName();
    if (!me) {
      showToast("Sign in to send invitations");
      return;
    }
    setInvitingId(target.id);
    try {
      const m = await createInstant(me);
      saveHostToken(m.meeting_id, m.host_token);
      const res = await inviteUser(m.meeting_id, target.id);
      showToast(
        res.duplicate
          ? `${target.name} is already invited`
          : `Invitation sent to ${target.name}`,
      );
      setQuery("");
      setResults([]);
      // Take the host straight into their room
      router.push(`/meeting/${m.meeting_id}?name=${encodeURIComponent(me)}`);
    } catch {
      showToast("Couldn't send invite — is the backend running?");
    } finally {
      setInvitingId(null);
    }
  }

  // Ctrl+K focuses search, like real Zoom
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Enter: digits -> join form prefilled; anything else -> join form anyway
  function submitSearch() {
    const digits = query.replace(/\D/g, "");
    router.push(digits.length >= 9 ? `/join?id=${digits}` : "/join");
    setQuery("");
    searchRef.current?.blur();
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#e4e6ea] text-ink">
      <header className="flex h-[52px] shrink-0 items-center px-3">
        <Link href="/" className="w-[88px] shrink-0 leading-none sm:w-[108px]">
          <div className="text-[11px] font-extrabold tracking-tight text-ink">
            zoom
          </div>
          <div className="text-[15px] font-semibold text-ink">Workplace</div>
        </Link>

        <div className="ml-2 hidden shrink-0 items-center gap-2 text-[#6b7180] min-[400px]:flex">
          <button onClick={() => router.back()} title="Back" className="p-0.5 hover:text-ink">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => router.forward()} title="Forward" className="p-0.5 opacity-40 hover:opacity-100">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-w-0 flex-1 justify-center">
          <div className="relative w-full min-w-0 max-w-[380px]">
            <div className="flex h-8 w-full items-center gap-2 rounded-md bg-[#cfd3d9] px-3 text-[13px] text-[#6b7180] focus-within:bg-white focus-within:ring-2 focus-within:ring-zoom-blue/40">
              <MagnifyingGlassIcon className="h-4 w-4 shrink-0" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setResults([]);
                    submitSearch();
                  }
                  if (e.key === "Escape") setResults([]);
                }}
                placeholder="Search people — Ctrl+K"
                className="w-full min-w-0 bg-transparent outline-none placeholder:text-[#6b7180]"
              />
            </div>
            {(searching || results.length > 0) && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => {
                    setResults([]);
                    searchRef.current?.blur();
                  }}
                />
              <div className="absolute left-0 right-0 top-9 z-30 overflow-hidden rounded-lg border border-line bg-white shadow-xl">
                {searching && (
                  <p className="px-4 py-2.5 text-[13px] text-ink-secondary">Searching…</p>
                )}
                {!searching && results.length === 0 && (
                  <p className="px-4 py-2.5 text-[13px] text-ink-secondary">No people found</p>
                )}
                {results.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-black/[.03]"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zoom-blue text-xs font-bold text-white">
                      {u.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold">{u.name}</p>
                      <p className="truncate text-[12px] text-ink-secondary">{u.email}</p>
                    </div>
                    <button
                      onClick={() => invite(u)}
                      disabled={invitingId === u.id}
                      className="shrink-0 rounded-md bg-zoom-blue px-3 py-1 text-[12px] font-semibold text-white hover:bg-zoom-blue-hover disabled:opacity-50"
                    >
                      {invitingId === u.id ? "Sending…" : "Invite"}
                    </button>
                  </div>
                ))}
              </div>
              </>
            )}
          </div>
        </div>

        {/* Profile */}
        <ProfileMenu />
      </header>

      {/* Toast (invites, errors) */}
      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-[13px] text-white shadow-xl">
          {toast}
        </div>
      )}

      <div className="flex min-h-0 flex-1 px-2 pb-2 pt-0.5">
        <nav className="flex w-[72px] shrink-0 flex-col items-center gap-0.5 pt-1">
          {NAV.map(({ href, label, Icon }) => {
            const active = pathname === href;
            const className = `flex w-[64px] flex-col items-center gap-0.5 rounded-xl py-2 text-[10px] font-medium ${
              active
                ? "bg-white text-ink shadow-sm"
                : "text-[#5c6370] hover:text-ink"
            }`;
            return (
              <Link key={label} href={href} className={className}>
                <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.7} />
                {label}
              </Link>
            );
          })}
          <div className="flex-1" />
          <span title="Coming soon" className="mb-1 flex w-[64px] cursor-default items-center justify-center rounded-xl py-2 text-[#5c6370] opacity-80">
            <GearIcon className="h-5 w-5" strokeWidth={1.7} />
          </span>
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto rounded-xl bg-white">
          {children}
        </div>
      </div>
    </div>
  );
}
