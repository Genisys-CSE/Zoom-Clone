"use client";

// Guests only see "Leave Meeting" — End-for-All is host-only (401 otherwise).
export default function LeaveModal({
  open,
  isHost,
  onEndAll,
  onLeave,
  onCancel,
}: {
  open: boolean;
  isHost: boolean;
  onEndAll: () => void;
  onLeave: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onCancel}
    >
      <div
        className="mx-4 w-full max-w-[360px] rounded-lg bg-white p-6 text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[16px] font-semibold">Leave meeting?</h2>
        <p className="mt-1 text-[13px] text-ink-secondary">
          {isHost
            ? "As host you can end it for everyone or just leave."
            : "You'll leave while the meeting continues for others."}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          {isHost && (
            <button
              onClick={onEndAll}
              className="rounded-md bg-zoom-red py-2 text-[14px] font-semibold text-white hover:brightness-110"
            >
              End Meeting for All
            </button>
          )}
          <button
            onClick={onLeave}
            className="rounded-md bg-black/5 py-2 text-[14px] font-medium hover:bg-black/10"
          >
            Leave Meeting
          </button>
          <button
            onClick={onCancel}
            className="py-1 text-[13px] text-ink-secondary hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
