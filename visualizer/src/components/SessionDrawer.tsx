import React, { useCallback, useEffect, useRef, useState } from "react";
import { X, Clock, Circle, Trash2, ChevronRight, Search } from "lucide-react";
import { useTelemetryStore } from "../telemetry/store";
import {
  listSessions,
  deleteSession,
  searchSessions,
  getCurrentSession,
  getGlobalStats,
  type SessionInfo,
} from "../telemetry/sessions";
import {
  formatDataSize,
  formatDuration,
  formatTimestamp,
  formatRelativeTime,
  formatNumber,
  safeSum,
} from "../lib/utils";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

/** Group sessions by relative date: Today, Yesterday, This Week, Older */
function groupSessionsByDate(
  sessions: SessionInfo[],
): { label: string; sessions: SessionInfo[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const weekAgo = new Date(today.getTime() - 7 * 86_400_000);

  const groups: Record<string, SessionInfo[]> = {
    Today: [],
    Yesterday: [],
    "This Week": [],
    Older: [],
  };

  for (const s of sessions) {
    const d = new Date(s.startedAt);
    if (d >= today) groups.Today.push(s);
    else if (d >= yesterday) groups.Yesterday.push(s);
    else if (d >= weekAgo) groups["This Week"].push(s);
    else groups.Older.push(s);
  }

  return Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, sessions: list }));
}
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import { ScrollArea } from "./ui/scroll-area";
import { Badge } from "./ui/badge";

export const SessionDrawer: React.FC = () => {
  const drawerOpen = useTelemetryStore((s) => s.drawerOpen);
  const setDrawerOpen = useTelemetryStore((s) => s.setDrawerOpen);
  const selectSession = useTelemetryStore((s) => s.selectSession);
  const recording = useTelemetryStore((s) => s.recording);
  const setRecording = useTelemetryStore((s) => s.setRecording);

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const [dbSizeMb, setDbSizeMb] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const fetchSessions = useCallback(
    async (query?: string) => {
      setLoading(true);
      setError(null);
      try {
        const q = query ?? searchQuery;
        const list = q.trim()
          ? await searchSessions(q.trim(), 50)
          : await listSessions(50, 0);
        setSessions(list);

        // Sync recording state with backend
        const currentId = await getCurrentSession();
        if (currentId) {
          setRecording(true, currentId);
        }
      } catch (e) {
        console.error("[SessionDrawer] Failed to fetch sessions:", e);
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [setRecording, searchQuery],
  );

  // Fetch sessions when drawer opens
  useEffect(() => {
    if (drawerOpen) {
      fetchSessions();
      getGlobalStats()
        .then((s) => setDbSizeMb(s.databaseSizeMb))
        .catch(() => {});
    }
  }, [drawerOpen, fetchSessions]);

  // Refresh periodically while drawer is open (pick up new totals)
  useEffect(() => {
    if (!drawerOpen) return;
    const id = setInterval(() => fetchSessions(), 10_000);
    return () => clearInterval(id);
  }, [drawerOpen, fetchSessions]);

  // Debounced search
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSessions(value);
    }, 300);
  };

  // Clear search when drawer closes + cleanup debounce on unmount
  useEffect(() => {
    if (!drawerOpen) {
      setSearchQuery("");
      if (debounceRef.current) clearTimeout(debounceRef.current);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [drawerOpen]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      const msg = String(err);
      if (msg.includes("active recording")) {
        setError("Stop recording before deleting this session");
      } else {
        setError(`Delete failed: ${msg}`);
      }
      console.error("[SessionDrawer] Delete failed:", err);
      // Clear error after 3 seconds
      setTimeout(() => setError(null), 3000);
    }
  };

  const handleSelectSession = (session: SessionInfo) => {
    selectSession(session.id, session);
    setDrawerOpen(false);
  };

  // Keyboard navigation for session list
  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!sessions.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIdx((prev) => Math.min(prev + 1, sessions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIdx((prev) => Math.max(prev - 1, 0));
      } else if (
        e.key === "Enter" &&
        focusedIdx >= 0 &&
        focusedIdx < sessions.length
      ) {
        e.preventDefault();
        handleSelectSession(sessions[focusedIdx]);
      } else if (e.key === "Home") {
        e.preventDefault();
        setFocusedIdx(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setFocusedIdx(sessions.length - 1);
      }
    },
    [sessions, focusedIdx],
  );

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIdx < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${focusedIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [focusedIdx]);

  // Reset focus when sessions change
  useEffect(() => {
    setFocusedIdx(-1);
  }, [sessions]);

  return (
    <>
      {/* Backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity duration-200"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-label="Sessions"
        aria-modal="true"
        className={`fixed top-0 right-0 z-50 h-full w-108 max-w-[96vw] max-[640px]:w-[calc(100vw-8px)] max-[640px]:max-w-[calc(100vw-8px)] flex flex-col overflow-x-hidden
          bg-[rgba(var(--ui-bg),0.82)] backdrop-blur-2xl border-l border-[rgba(var(--ui-fg),0.08)]
          shadow-[-8px_0_32px_rgba(0,0,0,0.3)]
          transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
          ${drawerOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div
          style={{ padding: "20px 24px 16px 20px" }}
          className="flex items-center justify-between border-b border-[rgba(var(--ui-fg),0.05)] shrink-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Clock
              size={15}
              className="text-[rgba(var(--ui-fg),0.4)] shrink-0"
            />
            <span className="text-[14px] font-semibold tracking-[0.2px] text-[rgba(var(--ui-fg),0.85)] shrink-0">
              Sessions
            </span>
            {sessions.length > 0 && (
              <span
                className="font-mono text-[10px] font-semibold text-[rgba(var(--ui-fg),0.35)] bg-[rgba(var(--ui-fg),0.04)] rounded-md shrink-0"
                style={{ padding: "2px 6px" }}
              >
                {sessions.length}
              </span>
            )}
            {recording && (
              <span className="flex items-center gap-1 shrink-0">
                <Circle
                  size={6}
                  fill="var(--accent-red)"
                  className="text-(--accent-red) animate-pulse"
                />
                <span className="text-[10px] font-medium text-(--accent-red) tracking-wide uppercase">
                  REC
                </span>
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 rounded-lg shrink-0 text-[rgba(var(--ui-fg),0.35)] hover:text-[rgba(var(--ui-fg),0.8)] hover:bg-[rgba(var(--ui-fg),0.06)]"
            onClick={() => setDrawerOpen(false)}
          >
            <X size={14} />
          </Button>
        </div>

        {/* Search */}
        <div style={{ padding: "12px 20px 8px 16px" }}>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(var(--ui-fg),0.25)] pointer-events-none"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search sessions..."
              aria-label="Search sessions"
              className="w-full rounded-xl bg-[rgba(var(--ui-fg),0.03)] border border-[rgba(var(--ui-fg),0.05)] text-[13px] text-[rgba(var(--ui-fg),0.7)] placeholder:text-[rgba(var(--ui-fg),0.2)] outline-none focus:border-[rgba(var(--accent-cyan),0.3)] focus:bg-[rgba(var(--ui-fg),0.04)] transition-all duration-200"
              style={{ padding: "9px 12px 9px 34px" }}
            />
            {searchQuery && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[rgba(var(--ui-fg),0.3)] hover:text-[rgba(var(--ui-fg),0.6)] transition-colors"
                onClick={() => {
                  setSearchQuery("");
                  fetchSessions("");
                }}
              >
                <X size={10} />
              </button>
            )}
          </div>
        </div>

        {/* Session list */}
        <ScrollArea
          className="flex-1 overflow-x-hidden"
          style={{ padding: "8px 20px 8px 14px" }}
        >
          {error && (
            <div
              className="flex items-center gap-2 rounded-lg bg-[rgba(255,77,106,0.08)] border border-[rgba(255,77,106,0.2)] mb-2"
              style={{ padding: "8px 12px" }}
            >
              <span className="text-[11px] text-(--accent-red)">{error}</span>
            </div>
          )}

          {loading && sessions.length === 0 ? (
            <div className="flex flex-col gap-2 p-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-2.5 rounded-lg"
                >
                  <Skeleton className="h-7 w-7 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2">
              <Clock size={20} className="text-[rgba(var(--ui-fg),0.15)]" />
              <span className="text-[11px] text-[rgba(var(--ui-fg),0.3)]">
                {searchQuery
                  ? "No matching sessions"
                  : "No sessions recorded yet"}
              </span>
            </div>
          ) : (
            <div
              ref={listRef}
              role="listbox"
              aria-label="Session list"
              tabIndex={0}
              onKeyDown={handleListKeyDown}
              className="flex flex-col gap-1.5 outline-none"
            >
              {groupSessionsByDate(sessions).map((group) => {
                // compute flat index offset for this group
                const groupStartIdx = sessions.indexOf(group.sessions[0]);
                return (
                  <div key={group.label} role="group" aria-label={group.label}>
                    <div className="px-2 pt-3 pb-1.5">
                      <span className="text-[10px] font-semibold tracking-[1.5px] uppercase text-[rgba(var(--ui-fg),0.2)]">
                        {group.label}
                      </span>
                    </div>
                    {group.sessions.map((session, i) => {
                      const flatIdx = groupStartIdx + i;
                      return (
                        <SessionCard
                          key={session.id}
                          session={session}
                          isActive={recording && session.status === "recording"}
                          isFocused={flatIdx === focusedIdx}
                          dataIdx={flatIdx}
                          onSelect={() => handleSelectSession(session)}
                          onDelete={(e) => handleDelete(e, session.id)}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Storage stats footer */}
        {(sessions.length > 0 || dbSizeMb !== null) && (
          <div className="border-t border-[rgba(var(--ui-fg),0.05)] pl-5 pr-6 py-3.5 flex items-center justify-between">
            <span className="text-[11px] text-[rgba(var(--ui-fg),0.3)] font-mono tabular-nums">
              {formatNumber(sessions.length)} session
              {sessions.length !== 1 ? "s" : ""}
            </span>
            {dbSizeMb !== null && (
              <span className="text-[11px] text-[rgba(var(--ui-fg),0.3)] font-mono tabular-nums">
                {dbSizeMb < 1
                  ? `${Math.round(dbSizeMb * 1024)} KB`
                  : `${dbSizeMb.toFixed(1)} MB`}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
};

// ─── Session card ─────────────────────────────────────────────────────────

interface SessionCardProps {
  session: SessionInfo;
  isActive: boolean;
  isFocused: boolean;
  dataIdx: number;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

const SessionCard: React.FC<SessionCardProps> = ({
  session,
  isActive,
  isFocused,
  dataIdx,
  onSelect,
  onDelete,
}) => {
  const totalBytes = safeSum(session.totalBytesUp, session.totalBytesDown);

  return (
    <button
      role="option"
      aria-selected={isFocused}
      data-idx={dataIdx}
      className={`group w-full text-left rounded-2xl border transition-all duration-150 card-hover
        ${
          isActive
            ? "bg-[rgba(var(--ui-fg),0.04)] border-[rgba(255,77,106,0.15)] recording-pulse"
            : isFocused
              ? "bg-[rgba(var(--ui-fg),0.05)] border-[rgba(var(--ui-fg),0.08)] ring-1 ring-[rgba(0,212,245,0.25)]"
              : "bg-transparent border-transparent hover:bg-[rgba(var(--ui-fg),0.025)] hover:border-[rgba(var(--ui-fg),0.05)]"
        }`}
      style={{ padding: "16px 18px" }}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          {/* Name + status badge */}
          <div className="flex items-center gap-1.5">
            {isActive ? (
              <Badge variant="recording" className="text-[9px] px-1.5 py-0">
                REC
              </Badge>
            ) : session.status === "crashed" ? (
              <Badge variant="warning" className="text-[9px] px-1.5 py-0">
                Crashed
              </Badge>
            ) : (
              <Badge
                variant="success"
                className="text-[9px] px-1.5 py-0 opacity-60"
              >
                Done
              </Badge>
            )}
            <span className="text-[13px] font-medium text-[rgba(var(--ui-fg),0.8)] truncate">
              {session.name}
            </span>
          </div>

          {/* Date */}
          <span className="text-[11px] text-[rgba(var(--ui-fg),0.35)] font-mono tabular-nums">
            {formatTimestamp(session.startedAt)}
            {" · "}
            <span className="text-[rgba(var(--ui-fg),0.25)]">
              {formatRelativeTime(session.startedAt)}
            </span>
          </span>

          {/* Stats row */}
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-[rgba(var(--ui-fg),0.3)]">
              {formatDuration(session.durationSecs)}
            </span>
            <span className="text-[11px] text-[rgba(var(--ui-fg),0.15)]">
              ·
            </span>
            <span className="text-[11px] text-[rgba(var(--ui-fg),0.3)]">
              {formatDataSize(totalBytes)}
            </span>
            <span className="text-[11px] text-[rgba(var(--ui-fg),0.15)]">
              ·
            </span>
            <span className="text-[11px] text-[rgba(var(--ui-fg),0.3)]">
              {formatNumber(session.totalFlows)} flows
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {!isActive && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-7 h-7 rounded-lg text-[rgba(var(--ui-fg),0.25)] hover:text-(--accent-red) hover:bg-[rgba(255,77,106,0.06)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Trash2 size={13} />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete session?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Delete &quot;{session.name}&quot;? This will permanently
                    remove this session and all its recorded data.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onDelete}
                    className="bg-(--accent-red) text-white hover:bg-(--accent-red)/80"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <ChevronRight size={13} className="text-[rgba(var(--ui-fg),0.15)]" />
        </div>
      </div>
    </button>
  );
};
