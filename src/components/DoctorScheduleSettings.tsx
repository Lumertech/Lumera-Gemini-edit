import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CalendarOff,
  CheckCircle2,
  ChevronDown,
  Link2,
  Loader2,
  Plus,
  Save,
  Trash2,
  Unlink,
} from "lucide-react";
import { apiFetch } from "../api/http";

const WEEKDAYS = [
  { dayOfWeek: 1, label: "Monday" },
  { dayOfWeek: 2, label: "Tuesday" },
  { dayOfWeek: 3, label: "Wednesday" },
  { dayOfWeek: 4, label: "Thursday" },
  { dayOfWeek: 5, label: "Friday" },
  { dayOfWeek: 6, label: "Saturday" },
  { dayOfWeek: 0, label: "Sunday" },
] as const;

const SLOT_OPTIONS = [10, 15, 20, 30] as const;

type Shift = { startTime: string; endTime: string };
type DayState = { dayOfWeek: number; isActive: boolean; shifts: Shift[] };
type OverrideRow = {
  id: string;
  overrideDate: string;
  overrideType: "BLOCKED" | "CUSTOM_HOURS";
  customStartTime: string | null;
  customEndTime: string | null;
  reason: string | null;
};
type GoogleStatus = {
  connected: boolean;
  connectedEmail: string | null;
  calendarId: string;
  syncEnabled: boolean;
  blockOpdSlots: boolean;
  pushAppointments: boolean;
};
type ScheduleResponse = {
  doctorId: string;
  slotDurationMinutes: number;
  days: Array<{ dayOfWeek: number; isActive: boolean; shifts: Shift[]; slotDurationMinutes: number }>;
  overrides: OverrideRow[];
  googleCalendar: GoogleStatus;
};

function emptyDays(): DayState[] {
  return WEEKDAYS.map((d) => ({
    dayOfWeek: d.dayOfWeek,
    isActive: d.dayOfWeek !== 0,
    shifts: d.dayOfWeek === 0 ? [] : [{ startTime: "09:00", endTime: "13:00" }],
  }));
}

function applyDays(payload: ScheduleResponse["days"] | undefined): DayState[] {
  const base = emptyDays();
  if (!payload?.length) return base;
  return base.map((day) => {
    const found = payload.find((p) => p.dayOfWeek === day.dayOfWeek);
    if (!found) return { ...day, isActive: false, shifts: [] };
    return {
      dayOfWeek: day.dayOfWeek,
      isActive: found.isActive && found.shifts.length > 0,
      shifts: found.shifts.length ? found.shifts.map((s) => ({ startTime: s.startTime, endTime: s.endTime })) : [],
    };
  });
}

export const DoctorScheduleSettings: React.FC<{ doctorId?: string }> = ({ doctorId }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [openDay, setOpenDay] = useState<number | null>(1);
  const [days, setDays] = useState<DayState[]>(emptyDays);
  const [slotDuration, setSlotDuration] = useState(15);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [google, setGoogle] = useState<GoogleStatus>({
    connected: false,
    connectedEmail: null,
    calendarId: "primary",
    syncEnabled: false,
    blockOpdSlots: true,
    pushAppointments: true,
  });
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [leaveType, setLeaveType] = useState<"BLOCKED" | "CUSTOM_HOURS">("BLOCKED");
  const [leaveReason, setLeaveReason] = useState("");
  const [customStart, setCustomStart] = useState("09:00");
  const [customEnd, setCustomEnd] = useState("13:00");
  const [addingLeave, setAddingLeave] = useState(false);

  const query = doctorId ? `?doctorId=${encodeURIComponent(doctorId)}` : "";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<ScheduleResponse>(`/api/tenant/doctor/schedule${query}`);
      setDays(applyDays(data.days));
      setSlotDuration(data.slotDurationMinutes || 15);
      setOverrides(data.overrides || []);
      if (data.googleCalendar) setGoogle(data.googleCalendar);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load schedule");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gcal = params.get("gcal");
    if (gcal === "connected") setMessage("Google Calendar connected. Personal busy times will block OPD slots.");
    if (gcal === "not_configured") setError("Google Calendar is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
    if (gcal === "error") setError(params.get("reason") || "Google Calendar connection failed.");
  }, []);

  const activeDayCount = useMemo(() => days.filter((d) => d.isActive).length, [days]);

  const patchDay = (dayOfWeek: number, patch: Partial<DayState>) => {
    setDays((prev) => prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)));
  };

  const saveSchedule = async (nextGoogle?: Partial<GoogleStatus>) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const mergedGoogle = { ...google, ...nextGoogle };
      const data = await apiFetch<ScheduleResponse>(`/api/tenant/doctor/schedule${query}`, {
        method: "PUT",
        body: JSON.stringify({
          doctorId,
          slotDurationMinutes: slotDuration,
          days,
          googleCalendar: {
            blockOpdSlots: mergedGoogle.blockOpdSlots,
            pushAppointments: mergedGoogle.pushAppointments,
            syncEnabled: mergedGoogle.connected,
          },
        }),
      });
      setDays(applyDays(data.days));
      setOverrides(data.overrides || []);
      if (data.googleCalendar) setGoogle(data.googleCalendar);
      setMessage("Weekly schedule saved. OPD slots now follow these shifts.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setSaving(false);
    }
  };

  const addLeave = async () => {
    if (!leaveStart) {
      setError("Choose a start date for the leave or custom hours.");
      return;
    }
    setAddingLeave(true);
    setError("");
    setMessage("");
    try {
      const data = await apiFetch<{ overrides: OverrideRow[] }>(`/api/tenant/doctor/overrides`, {
        method: "POST",
        body: JSON.stringify({
          doctorId,
          action: "add",
          startDate: leaveStart,
          endDate: leaveEnd || leaveStart,
          overrideType: leaveType,
          customStartTime: leaveType === "CUSTOM_HOURS" ? customStart : undefined,
          customEndTime: leaveType === "CUSTOM_HOURS" ? customEnd : undefined,
          reason: leaveReason,
        }),
      });
      setOverrides(data.overrides || []);
      setLeaveReason("");
      setMessage(leaveType === "BLOCKED" ? "Leave blocked on the selected dates." : "Custom hours saved for those dates.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save leave");
    } finally {
      setAddingLeave(false);
    }
  };

  const removeLeave = async (id: string) => {
    try {
      const data = await apiFetch<{ overrides: OverrideRow[] }>(`/api/tenant/doctor/overrides`, {
        method: "POST",
        body: JSON.stringify({ doctorId, action: "remove", id }),
      });
      setOverrides(data.overrides || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove leave");
    }
  };

  const disconnect = async () => {
    try {
      const data = await apiFetch<{ googleCalendar: GoogleStatus }>(`/api/tenant/doctor/google-calendar/disconnect`, {
        method: "POST",
        body: JSON.stringify({ doctorId }),
      });
      if (data.googleCalendar) setGoogle(data.googleCalendar);
      setMessage("Google Calendar disconnected.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Google Calendar");
    }
  };

  const connectHref = `/api/tenant/doctor/google-calendar/auth${query}`;

  if (loading) {
    return (
      <div className="mt-6 pt-5 border-t border-slate-200 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading weekly schedule…
      </div>
    );
  }

  return (
    <div className="mt-6 pt-5 border-t border-slate-200 space-y-6">
      <div>
        <h3 className="text-sm font-bold text-slate-900 mb-1">OPD schedule &amp; availability</h3>
        <p className="text-[11px] text-slate-500">
          Weekly shifts generate bookable slots. Leaves, custom hours, and Google Calendar busy time are subtracted before a patient can book.
        </p>
      </div>

      {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}
      {message && <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2">{message}</div>}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <label className="text-xs font-semibold text-slate-600">
          Slot duration
          <select
            className="mt-1 ml-2 px-3 py-2 rounded-lg border border-slate-300 text-sm"
            value={slotDuration}
            onChange={(e) => setSlotDuration(Number(e.target.value))}
          >
            {SLOT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} minutes
              </option>
            ))}
          </select>
        </label>
        <p className="text-[11px] text-slate-400 sm:ml-auto">{activeDayCount} day{activeDayCount === 1 ? "" : "s"} with OPD hours</p>
      </div>

      <div className="space-y-2">
        {WEEKDAYS.map((meta) => {
          const day = days.find((d) => d.dayOfWeek === meta.dayOfWeek)!;
          const open = openDay === meta.dayOfWeek;
          return (
            <div key={meta.dayOfWeek} className="border border-slate-200 rounded-xl overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left bg-slate-50 hover:bg-slate-100"
                onClick={() => setOpenDay(open ? null : meta.dayOfWeek)}
              >
                <span className="text-sm font-semibold text-slate-800 w-28">{meta.label}</span>
                <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${day.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
                  {day.isActive ? "On" : "Off"}
                </span>
                <span className="text-[11px] text-slate-500 flex-1 truncate">
                  {day.isActive && day.shifts.length
                    ? day.shifts.map((s) => `${s.startTime}–${s.endTime}`).join(" · ")
                    : "Closed"}
                </span>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
              </button>
              {open && (
                <div className="p-3 space-y-3 bg-white">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300"
                      checked={day.isActive}
                      onChange={(e) => {
                        const on = e.target.checked;
                        patchDay(meta.dayOfWeek, {
                          isActive: on,
                          shifts: on && !day.shifts.length ? [{ startTime: "09:00", endTime: "13:00" }] : day.shifts,
                        });
                      }}
                    />
                    Open for OPD
                  </label>
                  {day.isActive &&
                    day.shifts.map((shift, idx) => (
                      <div key={`${meta.dayOfWeek}-${idx}`} className="flex flex-wrap items-end gap-2">
                        <label className="text-[11px] font-semibold text-slate-600">
                          {idx === 0 ? "Morning / shift" : `Shift ${idx + 1}`}
                          <input
                            type="time"
                            className="mt-1 block px-2 py-1.5 rounded-lg border border-slate-300 text-sm"
                            value={shift.startTime}
                            onChange={(e) => {
                              const next = day.shifts.map((s, i) => (i === idx ? { ...s, startTime: e.target.value } : s));
                              patchDay(meta.dayOfWeek, { shifts: next });
                            }}
                          />
                        </label>
                        <span className="text-slate-400 pb-2">to</span>
                        <label className="text-[11px] font-semibold text-slate-600">
                          End
                          <input
                            type="time"
                            className="mt-1 block px-2 py-1.5 rounded-lg border border-slate-300 text-sm"
                            value={shift.endTime}
                            onChange={(e) => {
                              const next = day.shifts.map((s, i) => (i === idx ? { ...s, endTime: e.target.value } : s));
                              patchDay(meta.dayOfWeek, { shifts: next });
                            }}
                          />
                        </label>
                        {day.shifts.length > 1 && (
                          <button
                            type="button"
                            className="mb-0.5 p-2 text-slate-400 hover:text-red-600"
                            onClick={() => patchDay(meta.dayOfWeek, { shifts: day.shifts.filter((_, i) => i !== idx) })}
                            aria-label="Remove shift"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  {day.isActive && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700"
                      onClick={() =>
                        patchDay(meta.dayOfWeek, {
                          shifts: [...day.shifts, { startTime: "17:00", endTime: "20:00" }],
                        })
                      }
                    >
                      <Plus className="w-3.5 h-3.5" /> Add evening / extra shift
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => void saveSchedule()}
        disabled={saving}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-50"
      >
        {saving ? "Saving…" : <><Save className="w-4 h-4" /> Save weekly schedule</>}
      </button>

      <div className="border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <CalendarClock className="w-5 h-5 text-blue-600 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-bold text-slate-900">Google Calendar</h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Two-way sync: Lumera OPD appointments are pushed to Google, and personal busy events block bookable slots.
            </p>
          </div>
        </div>
        {google.connected ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 inline-flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Connected as <span className="font-semibold">{google.connectedEmail || "Google account"}</span>
            </p>
            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={google.blockOpdSlots}
                onChange={(e) => {
                  const next = { ...google, blockOpdSlots: e.target.checked };
                  setGoogle(next);
                  void saveSchedule(next);
                }}
              />
              Block OPD slots for personal Google Calendar events
            </label>
            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={google.pushAppointments}
                onChange={(e) => {
                  const next = { ...google, pushAppointments: e.target.checked };
                  setGoogle(next);
                  void saveSchedule(next);
                }}
              />
              Push Lumera appointments to Google Calendar
            </label>
            <button
              type="button"
              onClick={() => void disconnect()}
              className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-red-700"
            >
              <Unlink className="w-3.5 h-3.5" /> Disconnect
            </button>
          </div>
        ) : (
          <a
            href={connectHref}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            <Link2 className="w-4 h-4" /> Connect Google Calendar
          </a>
        )}
      </div>

      <div className="border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <CalendarOff className="w-5 h-5 text-amber-600 mt-0.5" />
          <div>
            <h4 className="text-sm font-bold text-slate-900">Leaves &amp; date-specific hours</h4>
            <p className="text-[11px] text-slate-500 mt-0.5">Mark holidays, personal leave, or a one-off custom shift without changing the weekly template.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-[11px] font-semibold text-slate-600">
            From
            <input type="date" className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)} />
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            To
            <input type="date" className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)} />
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            Type
            <select className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" value={leaveType} onChange={(e) => setLeaveType(e.target.value as "BLOCKED" | "CUSTOM_HOURS")}>
              <option value="BLOCKED">Blocked / leave</option>
              <option value="CUSTOM_HOURS">Custom hours</option>
            </select>
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            Reason
            <input className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} placeholder="Festival holiday, CME, …" />
          </label>
          {leaveType === "CUSTOM_HOURS" && (
            <>
              <label className="text-[11px] font-semibold text-slate-600">
                Custom start
                <input type="time" className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              </label>
              <label className="text-[11px] font-semibold text-slate-600">
                Custom end
                <input type="time" className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
              </label>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => void addLeave()}
          disabled={addingLeave}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" /> {addingLeave ? "Saving…" : "Add override"}
        </button>
        {overrides.length === 0 ? (
          <p className="text-[11px] text-slate-400">No leaves or custom days yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
            {overrides.map((row) => (
              <li key={row.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className="font-mono text-slate-700">{row.overrideDate}</span>
                <span className="text-slate-500">
                  {row.overrideType === "BLOCKED"
                    ? row.customStartTime
                      ? `Blocked ${row.customStartTime}–${row.customEndTime}`
                      : "Full-day leave"
                    : `Custom ${row.customStartTime}–${row.customEndTime}`}
                </span>
                {row.reason && <span className="text-slate-400 truncate">· {row.reason}</span>}
                <button type="button" className="ml-auto text-slate-400 hover:text-red-600" onClick={() => void removeLeave(row.id)} aria-label="Remove override">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
