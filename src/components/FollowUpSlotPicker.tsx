import React, { useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, Clock, Lock } from "lucide-react";
import type { Appointment, Doctor } from "../types";
import {
  addCalendarDays,
  generateFollowUpSlots,
  isoDate,
  isDoctorAvailableOn,
  monthCells,
} from "../lib/followUpSlots";

export type ReservedFollowUp = {
  date: string;
  timeSlot: string;
  appointmentId: string;
  bookingRef: string;
};

type FollowUpSlotPickerProps = {
  doctor: Doctor;
  appointments: Appointment[];
  followUpDays: number;
  onFollowUpDaysChange: (days: number) => void;
  reserved: ReservedFollowUp | null;
  onReserve: (payload: {
    date: string;
    timeSlot: string;
  }) => Promise<{ id: string } | void>;
};

const CHIPS = [3, 5, 7, 14, 21, 30];

export const FollowUpSlotPicker: React.FC<FollowUpSlotPickerProps> = ({
  doctor,
  appointments,
  followUpDays,
  onFollowUpDaysChange,
  reserved,
  onReserve,
}) => {
  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);
  const suggested = addCalendarDays(today, followUpDays);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => new Date(suggested.getFullYear(), suggested.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date>(suggested);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [customDays, setCustomDays] = useState(String(followUpDays));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cells = monthCells(viewMonth.getFullYear(), viewMonth.getMonth());
  const slots = generateFollowUpSlots({
    date: selectedDate,
    doctor,
    appointments,
  });
  const availableCount = slots.filter((s) => s.available).length;
  const clinicOpen = isDoctorAvailableOn(selectedDate, doctor.availableDays);

  const jumpToDays = (days: number) => {
    const next = addCalendarDays(today, days);
    onFollowUpDaysChange(days);
    setCustomDays(String(days));
    setSelectedDate(next);
    setViewMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    setSelectedSlot(null);
    setOpen(true);
    setError(null);
  };

  const pickDate = (date: Date) => {
    const diff = Math.round((date.getTime() - today.getTime()) / 86400000);
    if (diff < 0) return;
    setSelectedDate(date);
    onFollowUpDaysChange(Math.max(0, diff));
    setCustomDays(String(Math.max(0, diff)));
    setSelectedSlot(null);
    setError(null);
  };

  const handleReserve = async () => {
    if (!selectedSlot) return;
    setBusy(true);
    setError(null);
    try {
      const date = isoDate(selectedDate);
      await onReserve({ date, timeSlot: selectedSlot });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reserve this slot.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-blue-50/60 p-3 rounded-lg border border-blue-200 text-xs space-y-2">
      <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">
        Next Clinical Review
      </span>
      <div className="flex items-center gap-2">
        <strong className="text-slate-900 text-xs">
          In {followUpDays} Days (
          {addCalendarDays(today, followUpDays).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}
          )
        </strong>
      </div>

      {reserved ? (
        <div className="bg-white border border-emerald-200 rounded-md p-2 space-y-1">
          <p className="text-[11px] font-bold text-emerald-800 flex items-center gap-1">
            <Lock className="w-3 h-3" />
            Slot locked in appointment queue
          </p>
          <p className="text-[11px] text-slate-700">
            {reserved.date} · {reserved.timeSlot} · {doctor.name}
          </p>
          <p className="font-mono text-[10px] text-slate-500">Ref {reserved.bookingRef}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 no-print">
            {CHIPS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => jumpToDays(d)}
                className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                  followUpDays === d ? "bg-blue-600 text-white" : "bg-white border border-blue-200 text-blue-800"
                }`}
              >
                {d}d
              </button>
            ))}
            <input
              type="number"
              min={0}
              value={customDays}
              onChange={(e) => setCustomDays(e.target.value)}
              onBlur={() => {
                const days = Math.max(0, Number(customDays) || 0);
                jumpToDays(days);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const days = Math.max(0, Number(customDays) || 0);
                  jumpToDays(days);
                }
              }}
              aria-label="Custom follow-up days"
              className="w-14 px-1.5 py-0.5 rounded border border-blue-200 text-[11px] font-bold text-blue-900"
            />
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="px-2 py-0.5 rounded bg-white border border-blue-300 text-blue-800 text-[11px] font-bold inline-flex items-center gap-1"
            >
              <CalendarDays className="w-3 h-3" />
              {open ? "Hide calendar" : "Calendar"}
            </button>
          </div>

          {open && (
            <div className="no-print bg-white rounded-lg border border-blue-200 p-2 space-y-2">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="px-1.5 py-0.5 text-slate-600"
                  onClick={() =>
                    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))
                  }
                >
                  ‹
                </button>
                <span className="text-[11px] font-bold text-slate-800">
                  {viewMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
                </span>
                <button
                  type="button"
                  className="px-1.5 py-0.5 text-slate-600"
                  onClick={() =>
                    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))
                  }
                >
                  ›
                </button>
              </div>
              <div className="grid grid-cols-7 gap-0.5 text-center text-[9px] font-bold text-slate-400 uppercase">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                  <span key={`${d}-${i}`}>{d}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {cells.map((cell, idx) => {
                  if (!cell) return <span key={`empty-${idx}`} />;
                  const past = cell < today;
                  const selected = isoDate(cell) === isoDate(selectedDate);
                  const openDay = isDoctorAvailableOn(cell, doctor.availableDays);
                  return (
                    <button
                      key={isoDate(cell)}
                      type="button"
                      disabled={past}
                      onClick={() => pickDate(cell)}
                      className={`h-7 rounded text-[10px] font-bold ${
                        selected
                          ? "bg-blue-600 text-white"
                          : past
                            ? "text-slate-300"
                            : openDay
                              ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                              : "text-slate-400"
                      }`}
                      title={openDay ? "Clinic open — slots available" : "Clinic closed"}
                    >
                      {cell.getDate()}
                    </button>
                  );
                })}
              </div>

              <p className="text-[10px] text-slate-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {clinicOpen
                  ? `${availableCount} open slots · ${doctor.name} · ${doctor.opdTiming || "OPD hours"}`
                  : `${doctor.name} is not rostered on this day`}
              </p>

              {clinicOpen && (
                <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                  {slots.map((slot) => (
                    <button
                      key={slot.timeSlot}
                      type="button"
                      disabled={!slot.available}
                      onClick={() => setSelectedSlot(slot.timeSlot)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                        !slot.available
                          ? "bg-slate-100 text-slate-400 border-slate-200 line-through"
                          : selectedSlot === slot.timeSlot
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-blue-800 border-blue-200 hover:bg-blue-50"
                      }`}
                    >
                      {slot.timeSlot}
                    </button>
                  ))}
                </div>
              )}

              {error && <p className="text-[11px] text-rose-700">{error}</p>}

              <button
                type="button"
                disabled={!selectedSlot || busy}
                onClick={() => void handleReserve()}
                className="w-full py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-[11px] font-bold flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {busy ? "Reserving…" : "Reserve Follow-up Slot"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
