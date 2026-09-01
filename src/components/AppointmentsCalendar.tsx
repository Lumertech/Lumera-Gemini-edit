import React, { useState } from 'react';
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
  X
} from 'lucide-react';
import { Appointment, Doctor, Patient } from '../types';

interface AppointmentsCalendarProps {
  appointments: Appointment[];
  doctors: Doctor[];
  patients: Patient[];
  onBookAppointment: (apt: Partial<Appointment>) => void;
}

export const AppointmentsCalendar: React.FC<AppointmentsCalendarProps> = ({
  appointments,
  doctors,
  patients,
  onBookAppointment,
}) => {
  const [viewMode, setViewMode] = useState<'Day' | 'Week' | 'Month'>('Day');
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('All');
  const [showBookModal, setShowBookModal] = useState(false);

  // New Booking form state
  const [patientId, setPatientId] = useState(patients[0]?.id || '');
  const [doctorId, setDoctorId] = useState(doctors[0]?.id || '');
  const [bookingDate, setBookingDate] = useState(new Date().toISOString().split('T')[0]);
  const [timeSlot, setTimeSlot] = useState('10:00 AM');
  const [consultType, setConsultType] = useState<Appointment['type']>('New Consultation');
  const [source, setSource] = useState<Appointment['source']>('Walk-in');

  const filteredAppointments = appointments.filter((a) => {
    if (selectedDoctorId !== 'All' && a.doctorId !== selectedDoctorId) return false;
    return true;
  });

  const handleApplyFollowUpPreset = (days: number) => {
    const target = new Date(Date.now() + days * 86400000);
    setBookingDate(target.toISOString().split('T')[0]);
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
            {(['Day', 'Week', 'Month'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 rounded font-medium transition-all ${
                  viewMode === mode
                    ? 'bg-white text-slate-900 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowBookModal(true)}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm shadow-blue-100 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Book Appointment</span>
          </button>
        </div>
      </div>

      {/* Appointments List / Grid */}
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

        <div className="overflow-x-auto">
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
                      <span className="font-semibold text-slate-900 font-mono text-xs">₹{apt.consultationFee}</span>
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
                      {d.name} ({d.specialty} • ₹{d.consultationFee})
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
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">Time Slot:</label>
                  <select
                    value={timeSlot}
                    onChange={(e) => setTimeSlot(e.target.value)}
                    className="w-full border border-slate-200 rounded-md p-2 bg-white font-semibold text-slate-800 focus:outline-none"
                  >
                    <option value="09:00 AM">09:00 AM</option>
                    <option value="09:30 AM">09:30 AM</option>
                    <option value="10:00 AM">10:00 AM</option>
                    <option value="10:30 AM">10:30 AM</option>
                    <option value="11:00 AM">11:00 AM</option>
                    <option value="11:30 AM">11:30 AM</option>
                    <option value="02:00 PM">02:00 PM</option>
                    <option value="02:30 PM">02:30 PM</option>
                    <option value="03:00 PM">03:00 PM</option>
                    <option value="04:00 PM">04:00 PM</option>
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
