import React, { useState, useEffect, useCallback } from 'react';
import { formatINR } from '../lib/currency.ts';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  Plus, 
  Filter, 
  CheckCircle, 
  User, 
  Phone, 
  Building2, 
  ChevronLeft, 
  ChevronRight, 
  CalendarDays,
  X,
  SlidersHorizontal,
  Layers,
  ShieldCheck,
  Lock,
  Sparkles,
  Users
} from 'lucide-react';
import { Appointment, Doctor, Patient } from '../types';
import { clinicCalendarDate, shiftIsoDate } from '../lib/clinicDay';
import { apiFetch } from '../api/http';

interface AppointmentsCalendarProps {
  appointments: Appointment[];
  doctors: Doctor[];
  patients: Patient[];
  onBookAppointment: (apt: Partial<Appointment>) => void;
  onCheckIn?: (apt: Appointment) => void;
}

interface SlotOccupancyItem {
  timeSlot: string;
  bookedCount: number;
  maxOverlap: number;
  isAvailable: boolean;
  appointments: Array<{
    id: string;
    tokenNumber: number;
    patientName: string;
    patientPhone?: string;
    uhid?: string;
    status: string;
    type?: string;
    doctorName?: string;
  }>;
}

interface ScheduleSettings {
  slotDurationMinutes: number;
  slotOverlapMax: number;
  opdStartTime: string;
  opdEndTime: string;
}

export const AppointmentsCalendar: React.FC<AppointmentsCalendarProps> = ({
  appointments,
  doctors,
  patients,
  onBookAppointment,
  onCheckIn,
}) => {
  const [viewMode, setViewMode] = useState<'Day' | 'Week' | 'Month' | 'Slots'>('Day');
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('All');
  const [showBookModal, setShowBookModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Schedule settings state (defaults: 15 min duration, 1 appointment overlap)
  const [slotDuration, setSlotDuration] = useState<number>(15);
  const [slotOverlap, setSlotOverlap] = useState<number>(1);
  const [opdStartTime, setOpdStartTime] = useState<string>('09:00 AM');
  const [opdEndTime, setOpdEndTime] = useState<string>('05:00 PM');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  // Slot occupancy state
  const [slotOccupancy, setSlotOccupancy] = useState<SlotOccupancyItem[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);

  // New Booking form state
  const [patientId, setPatientId] = useState(patients[0]?.id || '');
  const [doctorId, setDoctorId] = useState(doctors[0]?.id || '');
  const [bookingDate, setBookingDate] = useState(() => clinicCalendarDate());
  const [timeSlot, setTimeSlot] = useState('09:00 AM');
  const [consultType, setConsultType] = useState<Appointment['type']>('New Consultation');
  const [source, setSource] = useState<Appointment['source']>('Walk-in');

  const filteredAppointments = appointments.filter((a) => {
    if (selectedDoctorId !== 'All' && a.doctorId !== selectedDoctorId) return false;
    return true;
  });

  // Load schedule settings from API
  const loadScheduleSettings = useCallback(async () => {
    try {
      const docParam = selectedDoctorId !== 'All' ? `?doctorId=${encodeURIComponent(selectedDoctorId)}` : '';
      const res = await apiFetch<{ ok: boolean; settings?: ScheduleSettings }>(`/api/calendar/schedule-settings${docParam}`);
      if (res?.ok && res.settings) {
        setSlotDuration(res.settings.slotDurationMinutes || 15);
        setSlotOverlap(res.settings.slotOverlapMax || 1);
        setOpdStartTime(res.settings.opdStartTime || '09:00 AM');
        setOpdEndTime(res.settings.opdEndTime || '05:00 PM');
      }
    } catch {
      // Fallback to defaults
    }
  }, [selectedDoctorId]);

  // Load slot occupancy from API
  const loadSlotOccupancy = useCallback(async () => {
    setIsLoadingSlots(true);
    try {
      const params = new URLSearchParams({
        date: bookingDate,
        ...(selectedDoctorId !== 'All' ? { doctorId: selectedDoctorId } : {}),
      });
      const res = await apiFetch<{ ok: boolean; slots?: SlotOccupancyItem[] }>(`/api/calendar/slot-occupancy?${params.toString()}`);
      if (res?.ok && Array.isArray(res.slots)) {
        setSlotOccupancy(res.slots);
      }
    } catch {
      // Ignore
    } finally {
      setIsLoadingSlots(false);
    }
  }, [bookingDate, selectedDoctorId]);

  useEffect(() => {
    void loadScheduleSettings();
  }, [loadScheduleSettings]);

  useEffect(() => {
    void loadSlotOccupancy();
  }, [loadSlotOccupancy, appointments]);

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setSaveSuccessMessage(null);
    try {
      await apiFetch('/api/calendar/schedule-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctorId: selectedDoctorId !== 'All' ? selectedDoctorId : '',
          slotDurationMinutes: Number(slotDuration) || 15,
          slotOverlapMax: Number(slotOverlap) || 1,
          opdStartTime,
          opdEndTime,
        }),
      });
      setSaveSuccessMessage('Schedule duration & overlap preferences updated successfully!');
      setTimeout(() => setSaveSuccessMessage(null), 3500);
      void loadSlotOccupancy();
      setShowSettingsModal(false);
    } catch (err: any) {
      alert('Failed to save schedule settings: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleApplyFollowUpPreset = (days: number) => {
    setBookingDate(shiftIsoDate(clinicCalendarDate(), days));
  };

  const handleQuickBookSlot = (slot: string) => {
    setTimeSlot(slot);
    setShowBookModal(true);
  };

  const handleSaveBooking = () => {
    const pat = patients.find((p) => p.id === patientId) || patients[0];
    const doc = doctors.find((d) => d.id === doctorId) || doctors[0];
    const maxToken = appointments.reduce((max, a) => Math.max(max, a.tokenNumber), 0);

    const newApt: Partial<Appointment> = {
      id: 'apt-' + Date.now(),
      tokenNumber: maxToken + 1,
      patientId: pat.id,
      patientName: pat.name,
      patientPhone: pat.phone,
      uhid: pat.uhid,
      doctorId: doc.id,
      doctorName: doc.name,
      specialty: doc.specialty,
      date: bookingDate,
      timeSlot: timeSlot,
      type: consultType,
      status: 'Waiting',
      source: source,
      consultationFee: doc.consultationFee,
      isPaid: false,
    };

    onBookAppointment(newApt);
    setShowBookModal(false);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header & View Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
              Scheduling & OPD Roster
            </span>
            <span className="text-xs text-slate-500 font-medium">
              {filteredAppointments.length} Active Slots
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
              <Clock className="w-3 h-3" /> {slotDuration}m slots · Max {slotOverlap} {slotOverlap === 1 ? 'patient' : 'patients'}/slot
            </span>
          </div>
          <h1 className="text-lg font-bold text-slate-900 mt-1">Appointments & Follow-up Scheduler</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Doctor Filter */}
          <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-md text-xs">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              aria-label="Doctor Filter"
              value={selectedDoctorId}
              onChange={(e) => setSelectedDoctorId(e.target.value)}
              className="bg-transparent text-slate-800 font-medium focus:outline-none cursor-pointer"
            >
              <option value="All">All Clinicians</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.specialty})
                </option>
              ))}
            </select>
          </div>

          {/* View Mode Buttons */}
          <div className="flex bg-slate-100 p-1 rounded-md text-xs">
            {(['Day', 'Week', 'Month', 'Slots'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 rounded font-medium transition-all ${
                  viewMode === mode
                    ? 'bg-white text-slate-900 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {mode === 'Slots' ? 'Slot Occupancy' : mode}
              </button>
            ))}
          </div>

          {/* Schedule Settings Button */}
          <button
            onClick={() => setShowSettingsModal(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-all border border-slate-200"
            title="Configure Slot Duration & Appointment Overlap"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-600" />
            <span>Schedule Settings</span>
          </button>

          <button
            onClick={() => setShowBookModal(true)}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm shadow-blue-100 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Book Appointment</span>
          </button>
        </div>
      </div>

      {saveSuccessMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-4 py-2.5 rounded-lg flex items-center justify-between shadow-xs">
          <span className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600" />
            {saveSuccessMessage}
          </span>
          <button onClick={() => setSaveSuccessMessage(null)} className="text-emerald-600 hover:text-emerald-800">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {viewMode === 'Slots' ? (
        /* Slot Occupancy & Overlap View */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                <h3 className="font-bold text-slate-900 text-sm">Slot Overlap & Occupancy Roster</h3>
                <span className="text-[10px] bg-slate-100 text-slate-600 font-mono px-2 py-0.5 rounded">
                  {bookingDate}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Clinic Staff View: Booked patient names & tokens are private to your clinic. WhatsApp patients are only offered slot times.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
                className="text-xs border border-slate-200 rounded px-2.5 py-1.5 font-mono font-medium text-slate-800 focus:outline-none"
              />
              <button
                onClick={() => void loadSlotOccupancy()}
                className="text-xs font-semibold px-2.5 py-1.5 rounded bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700"
              >
                Refresh
              </button>
            </div>
          </div>

          {isLoadingSlots ? (
            <div className="text-center py-12 text-slate-400 text-xs">
              Loading slot occupancy...
            </div>
          ) : slotOccupancy.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">
              No slots generated for this time window. Verify OPD start and end times in Schedule Settings.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {slotOccupancy.map((slot) => {
                const isFull = slot.bookedCount >= slot.maxOverlap;
                const isPartial = slot.bookedCount > 0 && !isFull;
                return (
                  <div
                    key={slot.timeSlot}
                    className={`rounded-lg border p-3.5 transition-all flex flex-col justify-between ${
                      isFull
                        ? 'bg-slate-50/80 border-slate-200 opacity-90'
                        : isPartial
                        ? 'bg-amber-50/40 border-amber-200'
                        : 'bg-white border-slate-200 hover:border-blue-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5 font-mono font-bold text-xs text-slate-900">
                          <Clock className="w-3.5 h-3.5 text-blue-600" />
                          {slot.timeSlot}
                        </div>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isFull
                              ? 'bg-slate-200 text-slate-700'
                              : isPartial
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {slot.bookedCount} / {slot.maxOverlap} {isFull ? 'Full' : 'Booked'}
                        </span>
                      </div>

                      {/* Booked Patients List (Private to Clinic Staff) */}
                      {slot.appointments.length > 0 ? (
                        <div className="space-y-1.5 my-2">
                          {slot.appointments.map((apt) => (
                            <div
                              key={apt.id}
                              className="bg-white border border-slate-200/80 rounded p-2 text-[11px] space-y-0.5"
                            >
                              <div className="flex items-center justify-between font-semibold text-slate-800">
                                <span className="flex items-center gap-1">
                                  <span className="w-4 h-4 rounded bg-slate-800 text-white font-mono text-[9px] flex items-center justify-center">
                                    #{apt.tokenNumber}
                                  </span>
                                  {apt.patientName}
                                </span>
                                <span className="text-[10px] text-blue-600 font-normal">
                                  {apt.status}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-500 flex items-center justify-between">
                                <span>{apt.uhid || 'UHID -'}</span>
                                {apt.patientPhone && <span>{apt.patientPhone}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-400 italic py-2">
                          Slot open · {slot.maxOverlap} available {slot.maxOverlap === 1 ? 'capacity' : 'capacities'}
                        </p>
                      )}
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between mt-2">
                      <span className="text-[10px] text-slate-400">
                        {slot.isAvailable ? 'Available for booking' : 'Capacity reached'}
                      </span>
                      {slot.isAvailable && (
                        <button
                          type="button"
                          onClick={() => handleQuickBookSlot(slot.timeSlot)}
                          className="px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-semibold transition-colors"
                        >
                          + Book Slot
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Regular Appointments List / Grid */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4 text-blue-600" />
              Scheduled OPD Sessions for {bookingDate}
            </h3>
            <span className="text-xs text-slate-500 font-medium font-mono">
              {filteredAppointments.length} Bookings
            </span>
          </div>

          <div className="md:hidden divide-y divide-slate-100">
            {filteredAppointments.map((apt) => (
              <div key={apt.id} className="px-4 py-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 text-sm truncate">{apt.patientName}</p>
                    <p className="text-xs text-slate-500">{apt.timeSlot} · {apt.type}</p>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 shrink-0">{formatINR(apt.consultationFee || 0)}</p>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">{apt.status}</span>
                  {onCheckIn && apt.status !== 'Triage / Vitals' && apt.status !== 'In Consultation' && apt.status !== 'Completed' && apt.status !== 'Cancelled' && (
                    <button type="button" onClick={() => onCheckIn(apt)} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold">
                      Check in
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="hidden md:block">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-700 border-b border-slate-200">
                  <th className="py-2.5 px-4 font-bold">Token & Time</th>
                  <th className="py-2.5 px-4 font-bold">Patient Details</th>
                  <th className="py-2.5 px-4 font-bold">Doctor & Specialty</th>
                  <th className="py-2.5 px-4 font-bold">Visit Type</th>
                  <th className="py-2.5 px-4 font-bold">Booking Source</th>
                  <th className="py-2.5 px-4 font-bold">Fee & Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAppointments.map((apt) => (
                  <tr key={apt.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-2">
                        <span className="w-6 h-6 rounded bg-slate-900 text-blue-300 font-bold text-xs flex items-center justify-center">
                          #{apt.tokenNumber}
                        </span>
                        <div>
                          <strong className="text-slate-900 font-mono block text-xs">{apt.timeSlot}</strong>
                          <span className="text-[10px] text-slate-400">{apt.date}</span>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-bold text-slate-900 text-xs block">{apt.patientName}</span>
                      <span className="text-[11px] text-slate-500 font-mono">{apt.uhid} • {apt.patientPhone}</span>
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-semibold text-slate-900 block text-xs">{apt.doctorName}</span>
                      <span className="text-[11px] text-blue-700 font-medium">{apt.specialty}</span>
                    </td>

                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium text-[11px]">
                        {apt.type}
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      <span className="text-slate-600 font-medium text-xs">{apt.source}</span>
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-slate-900 font-mono text-xs">{formatINR(apt.consultationFee)}</span>
                        {onCheckIn && apt.status !== 'Triage / Vitals' && apt.status !== 'In Consultation' && apt.status !== 'Completed' && apt.status !== 'Cancelled' && (
                          <button type="button" onClick={() => onCheckIn(apt)} className="px-2 py-1 rounded-md bg-blue-600 text-white text-[11px] font-semibold">
                            Check in
                          </button>
                        )}
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          apt.isPaid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {apt.isPaid ? 'Paid' : 'Unpaid'}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Schedule Settings Modal (Appointment Duration & Overlap) */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-5 space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                <SlidersHorizontal className="w-4 h-4 text-blue-600" /> Schedule Duration & Overlap Settings
              </h3>
              <button onClick={() => setShowSettingsModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Doctor Scope Notice */}
              <div className="bg-blue-50/70 border border-blue-200 p-2.5 rounded-lg flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                <div className="text-[11px] text-blue-900">
                  <span className="font-bold">Active Scope: </span>
                  {selectedDoctorId === 'All' ? 'Clinic-Wide Default' : `Doctor Override: ${doctors.find(d => d.id === selectedDoctorId)?.name || selectedDoctorId}`}
                  <p className="text-blue-700 text-[10px] mt-0.5">
                    Settings apply to calendar time increments, Maya voicebot, and WhatsApp booking rosters.
                  </p>
                </div>
              </div>

              {/* Slot Duration */}
              <div>
                <label className="text-[11px] font-bold text-slate-800 block mb-1">
                  Appointment Duration (Minutes):
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[10, 15, 20, 30, 45, 60].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => setSlotDuration(mins)}
                      className={`px-2.5 py-1 rounded text-xs font-semibold transition-all border ${
                        slotDuration === mins
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {mins} min {mins === 15 && <span className="text-[9px] opacity-80">(Default)</span>}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 text-[11px]">Custom Duration:</span>
                  <input
                    type="number"
                    min="1"
                    max="240"
                    value={slotDuration}
                    onChange={(e) => setSlotDuration(Math.max(1, parseInt(e.target.value, 10) || 15))}
                    className="w-24 border border-slate-200 rounded p-1.5 font-mono text-center font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                  />
                  <span className="text-slate-500 text-[11px]">minutes per slot</span>
                </div>
              </div>

              {/* Slot Overlap (Max Appointments per Slot) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold text-slate-800">
                    Appointment Overlap (Max Appointments per Slot):
                  </label>
                  <span className="text-[10px] text-slate-500">Default: 1 appointment</span>
                </div>
                <p className="text-[10px] text-slate-500 mb-2">
                  How many concurrent patient bookings are permitted for the exact same slot. WhatsApp enquiries are offered the slot until this overlap capacity is reached.
                </p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[
                    { count: 1, label: '1 (Default: Exclusive)' },
                    { count: 2, label: '2 (Double-book)' },
                    { count: 3, label: '3 (High Volume)' },
                    { count: 4, label: '4 (Emergency/Group)' },
                  ].map((preset) => (
                    <button
                      key={preset.count}
                      type="button"
                      onClick={() => setSlotOverlap(preset.count)}
                      className={`px-2.5 py-1 rounded text-xs font-semibold transition-all border ${
                        slotOverlap === preset.count
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 text-[11px]">Custom Overlap:</span>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={slotOverlap}
                    onChange={(e) => setSlotOverlap(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-24 border border-slate-200 rounded p-1.5 font-mono text-center font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                  />
                  <span className="text-slate-500 text-[11px]">appointments allowed per slot</span>
                </div>
              </div>

              {/* OPD Operating Hours */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">OPD Start Time:</label>
                  <input
                    type="text"
                    value={opdStartTime}
                    onChange={(e) => setOpdStartTime(e.target.value)}
                    placeholder="09:00 AM"
                    className="w-full border border-slate-200 rounded p-1.5 font-mono text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">OPD End Time:</label>
                  <input
                    type="text"
                    value={opdEndTime}
                    onChange={(e) => setOpdEndTime(e.target.value)}
                    placeholder="05:00 PM"
                    className="w-full border border-slate-200 rounded p-1.5 font-mono text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Data Privacy Notice */}
              <div className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg flex items-start gap-2">
                <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-slate-600">
                  <span className="font-semibold">Privacy Guarantee: </span>
                  Existing booked appointments and patient details are strictly private to each clinic/tenant. WhatsApp users only receive available slot times without revealing other booked patients.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-3.5 py-1.5 rounded-md text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingSettings}
                onClick={handleSaveSettings}
                className="px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm disabled:opacity-50"
              >
                {isSavingSettings ? 'Saving...' : 'Save Schedule Settings'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Book Appointment Modal */}
      {showBookModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-5 space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                <CalendarIcon className="w-4 h-4 text-blue-600" /> Book Clinical Appointment
              </h3>
              <button onClick={() => setShowBookModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Patient Selection */}
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">Patient:</label>
                <select
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  className="w-full border border-slate-200 rounded-md p-2 bg-white font-semibold text-slate-800 focus:outline-none"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.uhid}) - {p.phone}
                    </option>
                  ))}
                </select>
              </div>

              {/* Doctor Selection */}
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">Doctor & Specialty:</label>
                <select
                  value={doctorId}
                  onChange={(e) => setDoctorId(e.target.value)}
                  className="w-full border border-slate-200 rounded-md p-2 bg-white font-semibold text-slate-800 focus:outline-none"
                >
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.specialty} • {formatINR(d.consultationFee)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Date & Follow-up Presets */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold text-slate-700">Appointment Date:</label>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-400">Quick Follow-up:</span>
                    {[3, 7, 14, 30].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => handleApplyFollowUpPreset(d)}
                        className="px-1.5 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-800 font-semibold text-[10px]"
                      >
                        +{d}d
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="date"
                  value={bookingDate}
                  onChange={(e) => setBookingDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-md p-2 font-mono font-bold text-slate-800 focus:outline-none"
                />
              </div>

              {/* Time Slot & Visit Type */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">Time Slot ({slotDuration}m):</label>
                  <select
                    value={timeSlot}
                    onChange={(e) => setTimeSlot(e.target.value)}
                    className="w-full border border-slate-200 rounded-md p-2 bg-white font-semibold text-slate-800 focus:outline-none"
                  >
                    {slotOccupancy.length > 0 ? (
                      slotOccupancy.map((s) => (
                        <option key={s.timeSlot} value={s.timeSlot}>
                          {s.timeSlot} ({s.bookedCount}/{s.maxOverlap} {s.isAvailable ? 'available' : 'full'})
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="09:00 AM">09:00 AM</option>
                        <option value="09:15 AM">09:15 AM</option>
                        <option value="09:30 AM">09:30 AM</option>
                        <option value="09:45 AM">09:45 AM</option>
                        <option value="10:00 AM">10:00 AM</option>
                        <option value="10:15 AM">10:15 AM</option>
                        <option value="10:30 AM">10:30 AM</option>
                        <option value="11:00 AM">11:00 AM</option>
                        <option value="02:00 PM">02:00 PM</option>
                        <option value="03:00 PM">03:00 PM</option>
                        <option value="04:00 PM">04:00 PM</option>
                      </>
                    )}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">Visit Type:</label>
                  <select
                    value={consultType}
                    onChange={(e) => setConsultType(e.target.value as any)}
                    className="w-full border border-slate-200 rounded-md p-2 bg-white font-semibold text-slate-800 focus:outline-none"
                  >
                    <option value="New Consultation">New Consultation</option>
                    <option value="Follow-up">Follow-up Review</option>
                    <option value="Report Review">Report Review</option>
                    <option value="Emergency">Emergency</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">Booking Source:</label>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as any)}
                  className="w-full border border-slate-200 rounded-md p-2 bg-white font-semibold text-slate-800 focus:outline-none"
                >
                  <option value="Walk-in">Walk-in at Reception Desk</option>
                  <option value="WhatsApp Bot">WhatsApp Bot</option>
                  <option value="Online Portal">Patient Online Portal</option>
                  <option value="Call Desk">Call Desk</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setShowBookModal(false)}
                className="px-3.5 py-1.5 rounded-md text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveBooking}
                className="px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm"
              >
                Confirm Booking & Notify
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
