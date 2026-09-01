import React, { useState } from 'react';
import { 
  Users, 
  Building2, 
  ShieldCheck, 
  Key, 
  History, 
  Plus, 
  Trash2, 
  Edit2, 
  Check, 
  Lock, 
  Clock, 
  Database, 
  Cpu, 
  AlertCircle,
  FileCheck,
  Search,
  Settings,
  DollarSign,
  Activity
} from 'lucide-react';
import { Doctor, PolyclinicSpecialty } from '../types';

interface AdminPanelProps {
  doctors: Doctor[];
  onAddDoctor: (doc: Doctor) => void;
  onUpdateDoctor: (doc: Doctor) => void;
}

interface StaffMember {
  id: string;
  name: string;
  role: 'Nurse' | 'Receptionist' | 'Pharmacist' | 'Admin' | 'Lab Tech';
  department: string;
  phone: string;
  email: string;
  status: 'Active' | 'On Leave' | 'Inactive';
  shift: 'Morning' | 'Evening' | 'Night' | 'Full Day';
}

const INITIAL_STAFF: StaffMember[] = [
  { id: 's-1', name: 'Sunita Sharma', role: 'Nurse', department: 'Triage & OPD', phone: '+91 98200 11223', email: 'sunita.s@lumera.me', status: 'Active', shift: 'Morning' },
  { id: 's-2', name: 'Ramesh Patel', role: 'Receptionist', department: 'Front Desk & Billing', phone: '+91 98200 44556', email: 'ramesh.p@lumera.me', status: 'Active', shift: 'Full Day' },
  { id: 's-3', name: 'Deepa Nair', role: 'Pharmacist', department: 'In-House Pharmacy', phone: '+91 98200 77889', email: 'deepa.n@lumera.me', status: 'Active', shift: 'Evening' },
  { id: 's-4', name: 'Amit Verma', role: 'Lab Tech', department: 'Pathology & Diagnostic', phone: '+91 98200 99001', email: 'amit.v@lumera.me', status: 'Active', shift: 'Morning' },
];

const INITIAL_BRANCHES = [
  { id: 'b-1', name: 'Lumera Central Polyclinic & Diagnostics', address: 'Indiranagar 100ft Road, Bengaluru', phone: '+91 80 4123 4567', opdHours: '08:00 AM - 09:00 PM', activeDoctors: 8, status: 'Operating' },
  { id: 'b-2', name: 'Lumera Specialty Care & Rehab Center', address: 'Bandra West, Mumbai', phone: '+91 22 2640 1234', opdHours: '09:00 AM - 08:00 PM', activeDoctors: 5, status: 'Operating' },
  { id: 'b-3', name: 'Lumera Day Surgery & Eye Clinic', address: 'Koramangala 4th Block, Bengaluru', phone: '+91 80 4987 6543', opdHours: '08:30 AM - 07:00 PM', activeDoctors: 4, status: 'Operating' },
];

const AUDIT_LOGS = [
  { id: 'log-1', timestamp: '2026-09-01 05:12:18', user: 'Dr. Priya Sharma', action: 'Prescription Created', details: 'Prescription issued for Patient UHID-2026-8841 (Tab Metformin, Dolo 650)' },
  { id: 'log-2', timestamp: '2026-09-01 04:58:30', user: 'Ramesh Patel', action: 'Token Generated', details: 'Walk-in OPD Token #12 created for Cardiology consultation' },
  { id: 'log-3', timestamp: '2026-09-01 04:45:12', user: 'Dr. Arjun Mehta', action: 'AI SOAP Finalized', details: 'Ambient audio session processed and synchronized to EMR' },
  { id: 'log-4', timestamp: '2026-09-01 03:30:00', user: 'System Admin', action: 'ABDM Sync', details: 'Routine sync with National Health Authority ABHA Gateway verified' },
  { id: 'log-5', timestamp: '2026-09-01 02:15:44', user: 'Deepa Nair', action: 'Pharmacy Dispense', details: 'Dispensed Rx-9042 from In-House Pharmacy inventory' },
];

export const AdminPanel: React.FC<AdminPanelProps> = ({
  doctors,
  onAddDoctor,
  onUpdateDoctor,
}) => {
  const [activeTab, setActiveTab] = useState<'staff' | 'branches' | 'api_llm' | 'audit'>('staff');
  const [staffList, setStaffList] = useState<StaffMember[]>(INITIAL_STAFF);
  const [branches, setBranches] = useState(INITIAL_BRANCHES);
  
  // API & LLM Settings State
  const [geminiModel, setGeminiModel] = useState('models/gemini-3.7-flash');
  const [tempApiKey, setTempApiKey] = useState('AIzaSyD_••••••••••••••••••••••••••••');
  const [ambientSensitivity, setAmbientSensitivity] = useState('High (Medical Grade 16kHz)');
  const [autoSoapGeneration, setAutoSoapGeneration] = useState(true);
  const [abdmEnabled, setAbdmEnabled] = useState(true);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // New Staff Modal State
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<StaffMember['role']>('Nurse');
  const [newStaffDept, setNewStaffDept] = useState('OPD & Triage');
  const [newStaffPhone, setNewStaffPhone] = useState('');

  const handleCreateStaff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStaffName) return;
    const newMember: StaffMember = {
      id: 's-' + Date.now(),
      name: newStaffName,
      role: newStaffRole,
      department: newStaffDept,
      phone: newStaffPhone || '+91 98000 00000',
      email: `${newStaffName.toLowerCase().replace(/\s+/g, '.')}@lumera.me`,
      status: 'Active',
      shift: 'Morning',
    };
    setStaffList([...staffList, newMember]);
    setNewStaffName('');
    setNewStaffPhone('');
    setIsAddingStaff(false);
  };

  const handleSaveSettings = () => {
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="w-11 h-11 rounded-xl bg-blue-600/30 border border-blue-500/40 text-blue-400 flex items-center justify-center">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-extrabold tracking-tight">Lumera Practice Admin Console</h1>
              <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-mono uppercase font-bold">
                Master Admin
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Manage clinical staff, branch locations, LLM engines, and ABDM compliance credentials.
            </p>
          </div>
        </div>

        {/* Global Tab Navigation */}
        <div className="flex items-center space-x-1 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
          {[
            { id: 'staff', label: 'Staff & Doctors', icon: Users },
            { id: 'branches', label: 'Clinic Branches', icon: Building2 },
            { id: 'api_llm', label: 'AI & LLM Engines', icon: Cpu },
            { id: 'audit', label: 'System Audit Logs', icon: History },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  isActive 
                    ? 'bg-blue-600 text-white shadow-sm' 
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: Staff & Doctor Management */}
      {activeTab === 'staff' && (
        <div className="space-y-6">
          {/* Clinicians & Specialists List */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-600" />
                  <span>Licensed Medical Practitioners & Specialists ({doctors.length})</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Doctors registered with Medical Council of India (MCI) / State Councils.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {doctors.map((doc) => (
                <div key={doc.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:shadow-xs transition-all space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">{doc.name}</h4>
                      <p className="text-xs text-blue-700 font-semibold">{doc.specialty}</p>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                      {doc.availability}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Reg No:</span>
                      <span className="font-mono font-medium">{doc.regNumber}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Consultation Fee:</span>
                      <span className="font-bold text-slate-900">₹{doc.consultationFee}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Room:</span>
                      <span className="font-medium text-slate-800">{doc.room}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Allied Staff & Receptionists List */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Clinical Support, Nursing & Frontdesk Staff ({staffList.length})</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Manage staff roles, operational shifts, and department assignments.
                </p>
              </div>

              <button
                onClick={() => setIsAddingStaff(true)}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-xs transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Staff Member</span>
              </button>
            </div>

            {/* Add Staff Form Modal */}
            {isAddingStaff && (
              <form onSubmit={handleCreateStaff} className="p-4 bg-blue-50/60 rounded-xl border border-blue-200 space-y-3">
                <h4 className="font-bold text-xs text-blue-900 uppercase tracking-wider">New Staff Member Registration</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-700">Full Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Kavita Roy"
                      value={newStaffName}
                      onChange={(e) => setNewStaffName(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-600 text-slate-800"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-700">Role</label>
                    <select
                      value={newStaffRole}
                      onChange={(e) => setNewStaffRole(e.target.value as any)}
                      className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-600 text-slate-800"
                    >
                      <option value="Nurse">Nurse</option>
                      <option value="Receptionist">Receptionist</option>
                      <option value="Pharmacist">Pharmacist</option>
                      <option value="Lab Tech">Lab Tech</option>
                      <option value="Admin">Admin</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-700">Contact Number</label>
                    <input
                      type="text"
                      placeholder="+91 98..."
                      value={newStaffPhone}
                      onChange={(e) => setNewStaffPhone(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-600 text-slate-800"
                    />
                  </div>
                </div>
                <div className="flex justify-end space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsAddingStaff(false)}
                    className="px-3 py-1 text-xs text-slate-600 hover:text-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-500"
                  >
                    Save Member
                  </button>
                </div>
              </form>
            )}

            {/* Staff Table */}
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5 font-bold uppercase text-[10px]">Staff Name</th>
                    <th className="px-4 py-2.5 font-bold uppercase text-[10px]">Role</th>
                    <th className="px-4 py-2.5 font-bold uppercase text-[10px]">Department</th>
                    <th className="px-4 py-2.5 font-bold uppercase text-[10px]">Contact</th>
                    <th className="px-4 py-2.5 font-bold uppercase text-[10px]">Shift</th>
                    <th className="px-4 py-2.5 font-bold uppercase text-[10px]">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {staffList.map((st) => (
                    <tr key={st.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-semibold text-slate-900">{st.name}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold text-[10px]">
                          {st.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{st.department}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-600">{st.phone}</td>
                      <td className="px-4 py-3 text-slate-600">{st.shift}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold text-[11px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          {st.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Clinic Branches & Facility Management */}
      {activeTab === 'branches' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-600" />
                <span>Polyclinic Branch Locations & Operating Timings</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure multispecialty branches, OPD operational hours, and emergency desk contacts.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {branches.map((b) => (
              <div key={b.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                <div className="flex items-start justify-between">
                  <h4 className="font-bold text-slate-900 text-sm">{b.name}</h4>
                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                    {b.status}
                  </span>
                </div>

                <div className="text-xs text-slate-600 space-y-1.5">
                  <p className="text-slate-500">{b.address}</p>
                  <div className="flex justify-between pt-1">
                    <span className="text-slate-400">Phone:</span>
                    <span className="font-mono text-slate-700">{b.phone}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">OPD Timings:</span>
                    <span className="font-medium text-slate-800">{b.opdHours}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Active Doctors:</span>
                    <span className="font-bold text-blue-700">{b.activeDoctors} Specialists</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: AI & LLM Engine Settings */}
      {activeTab === 'api_llm' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-6">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Cpu className="w-4 h-4 text-blue-600" />
              <span>AI Core & Gemini 3.7 Flash Engine Configuration</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Fine-tune the ambient scribe speech-to-text accuracy, medical NER extractor, and ABDM gateway keys.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <h4 className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-blue-600" />
                Model & Inference Parameters
              </h4>

              <div>
                <label className="text-xs font-semibold text-slate-700">Primary Clinical Reasoning Model</label>
                <select
                  value={geminiModel}
                  onChange={(e) => setGeminiModel(e.target.value)}
                  className="mt-1 w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono text-slate-800 focus:ring-1 focus:ring-blue-600"
                >
                  <option value="models/gemini-3.7-flash">models/gemini-3.7-flash (Ultra-low latency ~300ms)</option>
                  <option value="models/gemini-3.7-pro">models/gemini-3.7-pro (Deep clinical differential reasoning)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Ambient Acoustic Sensitivity</label>
                <select
                  value={ambientSensitivity}
                  onChange={(e) => setAmbientSensitivity(e.target.value)}
                  className="mt-1 w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 focus:ring-1 focus:ring-blue-600"
                >
                  <option value="High (Medical Grade 16kHz)">High (Medical Grade 16kHz) - Recommended for OPD</option>
                  <option value="Standard Noise Filtered">Standard Noise Filtered</option>
                  <option value="Maximum Beamforming">Maximum Beamforming for High-Noise Polyclinics</option>
                </select>
              </div>
            </div>

            <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <h4 className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-emerald-600" />
                Compliance & Security Flags
              </h4>

              <div className="space-y-3">
                <label className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-200 cursor-pointer">
                  <div className="text-xs">
                    <div className="font-bold text-slate-800">Auto-Generate SOAP Note</div>
                    <div className="text-slate-500 text-[11px]">Instant extraction of Subjective, Objective, Assessment, Plan</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoSoapGeneration}
                    onChange={(e) => setAutoSoapGeneration(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                </label>

                <label className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-slate-200 cursor-pointer">
                  <div className="text-xs">
                    <div className="font-bold text-slate-800">ABDM / ABHA Digital Gateway Active</div>
                    <div className="text-slate-500 text-[11px]">Enforce NDHM Health Data Interoperability standards</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={abdmEnabled}
                    onChange={(e) => setAbdmEnabled(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            {saveSuccess ? (
              <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                <Check className="w-4 h-4" /> Parameters synchronized successfully!
              </span>
            ) : <span />}

            <button
              onClick={handleSaveSettings}
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-xs transition-all"
            >
              Save Configuration
            </button>
          </div>
        </div>
      )}

      {/* TAB 4: System Audits & Activity Log */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <History className="w-4 h-4 text-slate-700" />
                <span>Immutable EMR Clinical Audit Logs & Compliance Trails</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Real-time tracking of prescription writes, token generation, and AI inference sessions.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 font-bold uppercase text-[10px]">Timestamp (UTC+5:30)</th>
                  <th className="px-4 py-2.5 font-bold uppercase text-[10px]">Staff / Practitioner</th>
                  <th className="px-4 py-2.5 font-bold uppercase text-[10px]">Action Performed</th>
                  <th className="px-4 py-2.5 font-bold uppercase text-[10px]">Audit Event Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                {AUDIT_LOGS.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{log.timestamp}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{log.user}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200 font-semibold text-[10px]">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-sans text-xs text-slate-700">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
