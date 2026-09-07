"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  Check,
  Clock,
  Copy,
  Download,
  Globe,
  MinusCircle,
  Settings,
  XCircle,
} from "lucide-react";
import { authMe, formatMeetingId, login, logout, API_URL, type ApiUser } from "@/lib/api";
import { clearSession, setSessionName } from "@/lib/session";

type Presence = "available" | "busy" | "dnd" | "away" | "ooo";

const PRESENCE_KEY = "zoom-clone-presence";
export const DEF_MIC_KEY = "zoom-clone-def-mic";
export const DEF_CAM_KEY = "zoom-clone-def-cam";

const PRESENCE: { id: Presence; label: string; dot: string }[] = [
  { id: "available", label: "Available", dot: "bg-zoom-green" },
  { id: "busy", label: "Busy", dot: "bg-zoom-red" },
  { id: "dnd", label: "Do Not Disturb", dot: "bg-zoom-red" },
  { id: "away", label: "Away", dot: "bg-gray-400" },
  { id: "ooo", label: "Out of Office", dot: "bg-gray-400" },
];

function presenceIcon(id: Presence) {
  switch (id) {
    case "available":
      return <span className="h-3.5 w-3.5 rounded-full bg-zoom-green" />;
    case "busy":
      return <XCircle className="h-3.5 w-3.5 text-zoom-red" />;
    case "dnd":
      return <MinusCircle className="h-3.5 w-3.5 text-zoom-red" />;
    case "away":
      return <Clock className="h-3.5 w-3.5 text-gray-400" />;
    case "ooo":
      return <Calendar className="h-3.5 w-3.5 text-gray-400" />;
  }
}

// Avatar button + full profile dropdown (matches app.zoom.us menu).
// Presence + mic/cam defaults persist in localStorage and actually apply.
export default function ProfileMenu() {
  const router = useRouter();
  const [user, setUser] = useState<ApiUser | null>(null);
  const [open, setOpen] = useState(false);
  const [presence, setPresence] = useState<Presence>("available");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [defMic, setDefMic] = useState(true);
  const [defCam, setDefCam] = useState(true);
  // Sign-in form state (shown when logged out)
  const [loginName, setLoginName] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  // Identity comes from the session cookie (server truth), not storage.
  // localStorage only remembers the name for display defaults elsewhere.
  function loadUser() {
    authMe().then(setUser).catch(() => setUser(null));
  }

  useEffect(() => {
    loadUser();
    const p = localStorage.getItem(PRESENCE_KEY) as Presence | null;
    if (p) setPresence(p);
    setDefMic(localStorage.getItem(DEF_MIC_KEY) !== "off");
    setDefCam(localStorage.getItem(DEF_CAM_KEY) !== "off");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickPresence(p: Presence) {
    setPresence(p);
    localStorage.setItem(PRESENCE_KEY, p);
  }

  function toggleDefMic() {
    const next = !defMic;
    setDefMic(next);
    localStorage.setItem(DEF_MIC_KEY, next ? "on" : "off");
  }

  function toggleDefCam() {
    const next = !defCam;
    setDefCam(next);
    localStorage.setItem(DEF_CAM_KEY, next ? "on" : "off");
  }

  function copyInvite() {
    if (!user) return;
    navigator.clipboard
      .writeText(`${window.location.origin}/prejoin?meetingId=${user.pmi}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  async function handleSignIn() {
    if (!loginName.trim() || signingIn) return;
    setSigningIn(true);
    setLoginError("");
    try {
      const u = await login(loginName, loginPass);
      if (!u) {
        setLoginError("Wrong name or password");
        return;
      }
      setSessionName(u.name);
      setUser(u);
      setLoginName("");
      setLoginPass("");
    } catch {
      setLoginError("Couldn't reach the server");
    } finally {
      setSigningIn(false);
    }
  }

  async function signOut() {
    try {
      await logout(); // kills the server session + cookie
    } catch { /* local state clears regardless */ }
    clearSession();
    localStorage.removeItem("zoom-clone-name");
    setUser(null);
    setOpen(false);
    router.push("/");
  }

  const loggedIn = user !== null;

  const initials = user
    ? user.name.split(" ").map((w) => w.charAt(0)).join("").slice(0, 2).toUpperCase()
    : "?";
  const dot =
    PRESENCE.find((p) => p.id === presence)?.dot ?? "bg-zoom-green";

  const row =
    "flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px] hover:bg-black/5";

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Profile"
        className="block cursor-pointer touch-manipulation select-none rounded-md p-1"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-zoom-blue text-xs font-bold text-white">
          {initials}
        </div>
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#e4e6ea] ${dot}`}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-white shadow-xl">
            {!loggedIn ? (
              /* Signed out — demo login. Seed users: user1/user1, user2/user2 */
              <div className="p-4">
                <p className="text-[14px] font-semibold">Sign in</p>
                <p className="mt-0.5 text-[12px] text-ink-secondary">
                  user1 / user1 or user2 / user2
                </p>
                <input
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
                  placeholder="Name"
                  className="mt-3 w-full rounded-md border border-line px-3 py-1.5 text-[13px] outline-none focus:border-zoom-blue"
                />
                <input
                  value={loginPass}
                  onChange={(e) => setLoginPass(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
                  placeholder="Password"
                  type="password"
                  className="mt-2 w-full rounded-md border border-line px-3 py-1.5 text-[13px] outline-none focus:border-zoom-blue"
                />
                {loginError && (
                  <p className="mt-1 text-[12px] text-zoom-red">{loginError}</p>
                )}
                <button
                  onClick={handleSignIn}
                  disabled={!loginName.trim() || signingIn}
                  className="mt-3 w-full rounded-md bg-zoom-blue py-1.5 text-[13px] font-semibold text-white hover:bg-zoom-blue-hover disabled:opacity-40"
                >
                  {signingIn ? "Signing in…" : "Sign In"}
                </button>
              </div>
            ) : (
              <>
            {/* Header — no dummy identity when logged out */}
            <div className="px-4 pb-2 pt-3">
              <p className="truncate text-[14px] font-semibold">
                {user?.name ?? "Not signed in"}
              </p>
              <p className="truncate text-[12px] text-ink-secondary">
                {user?.email ?? "Sign in to see your meetings"}
              </p>
            </div>

            {/* Settings */}
            <div className="border-t border-line">
              <button onClick={() => setSettingsOpen((v) => !v)} className={row}>
                <Settings className="h-4 w-4 text-ink-secondary" />
                Settings
              </button>
              {settingsOpen && (
                <div className="bg-app-bg px-4 py-2 text-[13px]">
                  <label className="flex cursor-pointer items-center gap-2 py-1">
                    <input
                      type="checkbox"
                      checked={!defMic}
                      onChange={toggleDefMic}
                      className="h-4 w-4 accent-zoom-blue"
                    />
                    Mute microphone on entry
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 py-1">
                    <input
                      type="checkbox"
                      checked={!defCam}
                      onChange={toggleDefCam}
                      className="h-4 w-4 accent-zoom-blue"
                    />
                    Turn off camera on entry
                  </label>
                </div>
              )}
            </div>

            {/* Presence */}
            <div className="border-t border-line py-1">
              {PRESENCE.map((p) => (
                <button key={p.id} onClick={() => pickPresence(p.id)} className={row}>
                  {presenceIcon(p.id)}
                  <span className="flex-1">{p.label}</span>
                  {presence === p.id && <Check className="h-4 w-4 text-zoom-blue" />}
                </button>
              ))}
            </div>

            {/* Profile / About / Help / Language */}
            <div className="border-t border-line py-1">
              <button onClick={() => setProfileOpen((v) => !v)} className={row}>
                My Profile
              </button>
              {profileOpen && (
                <div className="bg-app-bg px-4 py-2 text-[13px]">
                  <p className="text-ink-secondary">My PMI</p>
                  <p className="font-semibold">
                    {user ? formatMeetingId(user.pmi) : "—"}
                  </p>
                  <button
                    onClick={copyInvite}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-zoom-blue py-1.5 font-semibold text-white hover:bg-zoom-blue-hover"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copied ? "Copied!" : "Copy Invite Link"}
                  </button>
                </div>
              )}
              <button onClick={() => setAboutOpen((v) => !v)} className={row}>
                About
              </button>
              {aboutOpen && (
                <p className="bg-app-bg px-4 py-2 text-[12px] text-ink-secondary">
                  Zoom Clone v1.0 — Next.js + FastAPI + SQLite + WebRTC.
                  <br />
                  API: {API_URL}
                </p>
              )}
              <a
                href="https://support.zoom.com"
                target="_blank"
                rel="noreferrer"
                className={row}
              >
                Help
              </a>
              <div className={`${row} cursor-default hover:bg-transparent`}>
                <Globe className="h-4 w-4 text-ink-secondary" />
                Language
                <span className="ml-auto text-ink-secondary">English</span>
              </div>
            </div>

            {/* Sign out + download */}
            <div className="border-t border-line py-1">
              <button onClick={signOut} className={row}>
                Sign Out ({user?.name})
              </button>
              <a
                href="https://zoom.us/download"
                target="_blank"
                rel="noreferrer"
                className={`${row} text-zoom-blue`}
              >
                <Download className="h-4 w-4" />
                Download the Zoom app
              </a>
            </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
