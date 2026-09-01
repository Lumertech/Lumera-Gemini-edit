import React, { useState } from 'react';
import { 
  Building2, 
  Stethoscope, 
  Users, 
  Clock, 
  DollarSign, 
  CheckCircle2, 
  Plus, 
  TrendingUp, 
  Phone, 
  Mail, 
  DoorOpen,
  Activity,
  Award
} from 'lucide-react';
import { Doctor, PolyclinicSpecialty } from '../types';

interface PolyclinicManagerProps {
  doctors: Doctor[];
  selectedSpecialty: PolyclinicSpecialty | 'All';
  onSelectSpecialty: (specialty: PolyclinicSpecialty | 'All') => void;
  onSelectDoctor: (doctor: Doctor) => void;
}

export const PolyclinicManager: React.FC<PolyclinicManagerProps> = ({
  doctors,
  selectedSpecialty,
  onSelectSpecialty,
  onSelectDoctor,
}) => {
  const departments = [
    { name: 'General Medicine', icon: '🩺', head: 'Dr. Vikram Malhotra', rooms: '101, 102', patientsToday: 24, revenueToday: 14400 },
    { name: 'Pediatrics', icon: '👶', head: 'Dr. Ananya Sen', rooms: '104, 105', patientsToday: 18, revenueToday: 12600 },
    { name: 'Cardiology', icon: '❤️', head: 'Dr. Rajesh Sharma', rooms: '201, 202', patientsToday: 12, revenueToday: 12000 },
    { name: 'Dermatology', icon: '✨', head: 'Dr. Meera Vasudevan', rooms: '108', patientsToday: 15, revenueToday: 11250 },
    { name: 'Orthopedics', icon: '🦴', head: 'Dr. Harshvardhan Patel', rooms: '106, 107', patientsToday: 14, revenueToday: 11200 },
  ];

  const filteredDoctors = doctors.filter((d) => {
    if (selectedSpecialty !== 'All' && d.specialty !== selectedSpecialty) return false;
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
              Multi-Specialty Operations
            </span>
            <span className="text-xs text-slate-500 font-medium">
              5 Active Clinical Departments
            </span>
          </div>
          <h1 className="text-lg font-bold tracking-tight text-slate-900 mt-1">
            Polyclinic Department & Clinician Roster
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-50 px-3.5 py-1.5 rounded-lg border border-slate-200 text-right">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-medium">Today's OPD Revenue</span>
            <strong className="text-sm font-mono font-bold text-blue-700">₹61,450</strong>
          </div>
          <div className="bg-slate-50 px-3.5 py-1.5 rounded-lg border border-slate-200 text-right">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-medium">Total Footfall</span>
            <strong className="text-sm font-mono font-bold text-slate-900">83 Patients</strong>
          </div>
        </div>
      </div>

      {/* Departments Overview Cards */}
      <div>
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">
          Clinical Departments & Specialties:
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {departments.map((dept) => (
            <button
              key={dept.name}
              onClick={() => onSelectSpecialty(dept.name as any)}
              className={`text-left p-3.5 rounded-xl border transition-all ${
                selectedSpecialty === dept.name
                  ? 'bg-blue-50/90 border-blue-300 ring-2 ring-blue-100 shadow-sm'
                  : 'bg-white hover:bg-slate-50 border-slate-200 shadow-xs'
              }`}
            >
              <div className="text-2xl mb-1.5">{dept.icon}</div>
              <h4 className="font-bold text-slate-900 text-xs">{dept.name}</h4>
              <p className="text-[11px] text-slate-500 mt-0.5 truncate">{dept.head}</p>
              
              <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-mono">
                <span className="text-slate-500">{dept.patientsToday} pts</span>
                <span className="font-bold text-blue-700">₹{dept.revenueToday}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Doctors Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Active Clinicians ({filteredDoctors.length}):
          </h3>
          {selectedSpecialty !== 'All' && (
            <button
              onClick={() => onSelectSpecialty('All')}
              className="text-xs text-blue-600 font-bold hover:underline"
            >
              Show All Departments
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDoctors.map((doc) => (
            <div
              key={doc.id}
              className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3.5 hover:shadow-md transition-all"
            >
              {/* Doctor Card Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="w-10 h-10 rounded-md bg-slate-900 text-blue-300 font-bold text-sm flex items-center justify-center shadow-xs">
                    {doc.name.split(' ')[1]?.charAt(0) || 'D'}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 text-xs">{doc.name}</h4>
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                      {doc.specialty}
                    </span>
                  </div>
                </div>

                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                  Active
                </span>
              </div>

              {/* Qualification & Registration */}
              <div className="space-y-0.5 text-xs text-slate-600">
                <p className="font-medium text-slate-800 text-[11px]">{doc.qualification}</p>
                <p className="text-[10px] text-slate-400 font-mono">Reg: {doc.regNumber} • {doc.experienceYears} Years Exp</p>
              </div>

              {/* Schedule & Consultation Fee */}
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 flex items-center gap-1 text-[11px]">
                    <DoorOpen className="w-3 h-3 text-blue-600" /> OPD Suite:
                  </span>
                  <strong className="text-slate-900 text-[11px]">{doc.opdRoom}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 flex items-center gap-1 text-[11px]">
                    <Clock className="w-3 h-3 text-blue-600" /> Timing:
                  </span>
                  <span className="text-slate-700 font-medium text-[11px]">{doc.opdTiming}</span>
                </div>
                <div className="flex items-center justify-between font-mono">
                  <span className="text-slate-500 text-[11px]">Consultation Fee:</span>
                  <strong className="text-blue-800 font-bold text-xs">₹{doc.consultationFee}</strong>
                </div>
              </div>

              {/* Available Days */}
              <div className="flex items-center gap-1 text-[10px]">
                <span className="text-slate-400 font-medium mr-1">Days:</span>
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <span
                    key={d}
                    className={`px-1.5 py-0.5 rounded font-semibold ${
                      doc.availableDays.includes(d)
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {d}
                  </span>
                ))}
              </div>

              {/* Select Action */}
              <button
                onClick={() => onSelectDoctor(doc)}
                className="w-full py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-xs transition-all flex items-center justify-center gap-1.5"
              >
                <Stethoscope className="w-3.5 h-3.5 text-blue-400" />
                <span>Select as Active Doctor</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
