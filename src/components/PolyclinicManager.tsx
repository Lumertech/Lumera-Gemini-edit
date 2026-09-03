import React, { useState } from 'react';
import { 
  Building2, 
  Stethoscope, 
  Users, 
  Clock, 
  CheckCircle2, 
  DoorOpen,
  Award,
  ShieldCheck,
  Edit3,
  Camera,
  Calendar,
  IndianRupee,
} from 'lucide-react';
import { Doctor, PolyclinicSpecialty } from '../types';
import { DoctorProfileModal } from './DoctorProfileModal';

interface PolyclinicManagerProps {
  doctors: Doctor[];
  selectedSpecialty: PolyclinicSpecialty | 'All';
  onSelectSpecialty: (specialty: PolyclinicSpecialty | 'All') => void;
  onSelectDoctor: (doctor: Doctor) => void;
  onDoctorUpdated?: (doctor: Doctor) => void;
}

export const PolyclinicManager: React.FC<PolyclinicManagerProps> = ({
  doctors,
  selectedSpecialty,
  onSelectSpecialty,
  onSelectDoctor,
  onDoctorUpdated,
}) => {
  const [editingDoctor, setEditingDoctor] = useState<Doctor | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

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

  const handleEditProfile = (doc: Doctor, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingDoctor(doc);
    setIsModalOpen(true);
  };

  const handleSaveDoctor = (updated: Doctor) => {
    onDoctorUpdated?.(updated);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
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
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-medium">Today&apos;s OPD Revenue</span>
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
              onClick={() => onSelectSpecialty(dept.name as PolyclinicSpecialty)}
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
            Active Clinicians & Specialists ({filteredDoctors.length}):
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
              className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-3"
            >
              <div>
                {/* Doctor Card Header with Profile Picture */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    {/* Headshot Avatar with Hover Camera */}
                    <div className="relative group shrink-0">
                      <div className="w-14 h-14 rounded-2xl overflow-hidden bg-gradient-to-br from-blue-700 to-indigo-900 border-2 border-slate-200 shadow-sm flex items-center justify-center">
                        {doc.avatarUrl ? (
                          <img
                            src={doc.avatarUrl}
                            alt={doc.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-lg font-bold text-white">
                            {doc.name.split(' ')[1]?.charAt(0) || 'D'}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleEditProfile(doc, e)}
                        className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 rounded-2xl flex items-center justify-center text-white transition-opacity"
                        title="Edit Doctor Profile & Picture"
                      >
                        <Camera className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <h4 className="font-bold text-slate-900 text-xs truncate">{doc.name}</h4>
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      </div>
                      <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                        {doc.specialty}
                      </span>
                    </div>
                  </div>

                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 flex items-center gap-1 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                    Active
                  </span>
                </div>

                {/* Qualification & Registration */}
                <div className="space-y-0.5 text-xs text-slate-600 mt-2.5">
                  <p className="font-medium text-slate-800 text-[11px] truncate">{doc.qualification}</p>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                    <span>Reg: {doc.regNumber}</span>
                    {doc.experienceYears > 0 && <span>• {doc.experienceYears}y exp</span>}
                  </div>
                </div>

                {/* ABDM HPR ID Badge if present */}
                {doc.hprId && (
                  <div className="mt-1.5">
                    <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-mono border border-blue-200/50 flex items-center gap-1 w-fit">
                      <Award className="w-3 h-3 text-blue-600" />
                      {doc.hprId}
                    </span>
                  </div>
                )}

                {/* Schedule & Consultation Fee */}
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 text-xs space-y-1 mt-2.5">
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
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 text-[11px]">Consultation Fee:</span>
                    <strong className="text-blue-800 font-bold text-xs flex items-center">
                      <IndianRupee className="w-3 h-3" />
                      {doc.consultationFee}
                    </strong>
                  </div>
                </div>

                {/* Available Days */}
                <div className="flex items-center gap-1 text-[10px] mt-2.5">
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
              </div>

              {/* Actions: Select & Edit Profile */}
              <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => onSelectDoctor(doc)}
                  className="flex-1 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-xs transition-all flex items-center justify-center gap-1.5"
                >
                  <Stethoscope className="w-3.5 h-3.5 text-blue-400" />
                  <span>Select Active</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => handleEditProfile(doc, e)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200/80 text-slate-700 font-semibold text-xs transition-colors flex items-center gap-1"
                  title="Edit Doctor Profile & Picture"
                >
                  <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                  <span>Profile</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Doctor Profile Modal */}
      {isModalOpen && editingDoctor && (
        <DoctorProfileModal
          doctor={editingDoctor}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setEditingDoctor(null);
          }}
          onSave={handleSaveDoctor}
        />
      )}
    </div>
  );
};
