import React, { useEffect, useState } from "react";
import {
  UserPlus,
  Stethoscope,
  Headset,
  ShieldAlert,
  Search,
  Camera,
  Edit3,
  CheckCircle2,
  Clock,
  MapPin,
  IndianRupee,
  Phone,
  Mail,
  Award,
  ShieldCheck,
  Calendar,
  Sparkles,
  Users,
} from "lucide-react";
import { apiFetch } from "../api/http";
import { AppUser, Doctor, PolyclinicSpecialty } from "../types";
import { DoctorProfileModal, PRESET_DOCTOR_AVATARS } from "./DoctorProfileModal";

interface StaffRow {
  id: string;
  name: string;
  role: string;
  department: string;
  phone: string;
  email: string;
  status: string;
  shift: string;
}

const SPECIALTIES: PolyclinicSpecialty[] = [
  "General Medicine",
  "Cardiology",
  "Pediatrics",
  "Dermatology",
  "Orthopedics",
  "Physiotherapy & Rehabilitation",
  "Gynecology",
  "ENT",
  "Neurology",
  "Ophthalmology",
  "Dental Surgery",
  "Psychiatry & Mental Health",
];

interface ClinicTeamManagerProps {
  canManage: boolean;
  currentUserId?: string;
  onDoctorsChanged?: (doctors: Doctor[]) => void;
}

export const ClinicTeamManager: React.FC<ClinicTeamManagerProps> = ({
  canManage,
  currentUserId,
  onDoctorsChanged,
}) => {
  const [members, setMembers] = useState<AppUser[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSpecialty, setSelectedSpecialty] = useState<string>("all");
  const [editingDoctor, setEditingDoctor] = useState<Doctor | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "doctor" as "doctor" | "receptionist",
    specialty: "General Medicine" as PolyclinicSpecialty,
    qualification: "",
    regNumber: "",
    consultationFee: 600,
    opdRoom: "OPD Room 101",
    avatarUrl: PRESET_DOCTOR_AVATARS[0].url,
    department: "Front Desk",
  });

  const load = () => {
    apiFetch<{ members: AppUser[]; doctors: Doctor[]; staff: StaffRow[] }>("/api/clinic/team")
      .then((d) => {
        setMembers(d.members || []);
        setDoctors(d.doctors || []);
        setStaff(d.staff || []);
        onDoctorsChanged?.(d.doctors || []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load team"));
  };

  useEffect(load, []);

  const handleEditDoctor = (doc: Doctor) => {
    setEditingDoctor(doc);
    setIsModalOpen(true);
  };

  const handleSaveDoctor = (updated: Doctor) => {
    setDoctors((prev) => {
      const next = prev.map((d) => (d.id === updated.id ? updated : d));
      onDoctorsChanged?.(next);
      return next;
    });
    setNotice(`Updated profile for ${updated.name}`);
    setTimeout(() => setNotice(""), 4000);
  };

  const toggleDoctorActive = async (doc: Doctor) => {
    try {
      const res = await apiFetch<{ doctor: Doctor }>(`/api/doctors/${doc.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !doc.active }),
      });
      const updated = res.doctor || { ...doc, active: !doc.active };
      handleSaveDoctor(updated);
    } catch {
      // optimistic
      const updated = { ...doc, active: !doc.active };
      handleSaveDoctor(updated);
    }
  };

  const addMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    try {
      const res = await apiFetch<{ user: AppUser; temporaryPassword?: string }>("/api/clinic/members", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({
        name: "",
        email: "",
        phone: "",
        role: "doctor",
        specialty: "General Medicine",
        qualification: "",
        regNumber: "",
        consultationFee: 600,
        opdRoom: "OPD Room 101",
        avatarUrl: PRESET_DOCTOR_AVATARS[0].url,
        department: "Front Desk",
      });
      setShowAddForm(false);
      if (res.temporaryPassword) {
        setNotice(`Created account for ${res.user.email}. Temporary password: ${res.temporaryPassword}`);
      } else {
        setNotice(`Created account for ${res.user.email}`);
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add team member");
    }
  };

  const filteredDoctors = doctors.filter((doc) => {
    const matchesSearch =
      doc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.specialty.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (doc.qualification && doc.qualification.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (doc.regNumber && doc.regNumber.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesSpecialty = selectedSpecialty === "all" || doc.specialty === selectedSpecialty;
    return matchesSearch && matchesSpecialty;
  });

  const activeDoctorsCount = doctors.filter((d) => d.active).length;

  return (
    <div className="max-w-6xl space-y-6">
      {/* Top Banner & Stats */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="font-manrope text-2xl font-bold text-slate-900 flex items-center gap-2">
            Clinical Faculty & Doctor Profile Management
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage verified doctor credentials, high-definition portraits, OPD consulting suites, and sign-in credentials.
          </p>
        </div>

        {canManage && (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="self-start md:self-auto px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm shadow-blue-600/20 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            {showAddForm ? "Close Form" : "Add New Clinician / Login"}
          </button>
        )}
      </div>

      {/* Roster Metric Pills */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200/80 rounded-xl p-3.5 shadow-sm">
          <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
            <Stethoscope className="w-3.5 h-3.5 text-blue-600" /> Total Doctors
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">{doctors.length}</div>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-xl p-3.5 shadow-sm">
          <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Active on OPD
          </div>
          <div className="text-xl font-bold text-emerald-600 mt-1">{activeDoctorsCount}</div>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-xl p-3.5 shadow-sm">
          <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
            <Headset className="w-3.5 h-3.5 text-indigo-600" /> Staff & Reception
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">{staff.length}</div>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-xl p-3.5 shadow-sm">
          <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-purple-600" /> Sign-in Accounts
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">{members.length}</div>
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} className="text-xs font-bold text-emerald-900 ml-4">
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-xs font-bold text-rose-900 ml-4">
            Dismiss
          </button>
        </div>
      )}

      {/* Add Login / Clinician Form Accordion */}
      {canManage && showAddForm && (
        <form onSubmit={addMember} className="bg-white border border-blue-200 rounded-2xl p-5 space-y-4 shadow-md shadow-blue-500/5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="font-manrope font-bold text-sm text-slate-900 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-blue-600" /> Add Clinician or Staff Sign-in Account
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Creates an authenticated login and automatically creates an OPD roster profile for doctors.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Cancel
            </button>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Full Name *</label>
              <input
                required
                placeholder="e.g. Dr. Kavita Raman"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Email Address *</label>
              <input
                required
                type="email"
                placeholder="doctor@lumera.health"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Contact Phone</label>
              <input
                placeholder="+91 98765 43210"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Account Role *</label>
              <select
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as "doctor" | "receptionist" })}
              >
                <option value="doctor">Doctor (OPD Faculty)</option>
                <option value="receptionist">Receptionist / Front Desk</option>
              </select>
            </div>

            {form.role === "doctor" && (
              <>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Specialty *</label>
                  <select
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                    value={form.specialty}
                    onChange={(e) => setForm({ ...form, specialty: e.target.value as PolyclinicSpecialty })}
                  >
                    {SPECIALTIES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Qualifications *</label>
                  <input
                    placeholder="e.g. MBBS, MD, DNB"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                    value={form.qualification}
                    onChange={(e) => setForm({ ...form, qualification: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Council Reg #</label>
                  <input
                    placeholder="e.g. MCI-2018-9281"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                    value={form.regNumber}
                    onChange={(e) => setForm({ ...form, regNumber: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Consultation Fee (₹)</label>
                  <input
                    type="number"
                    step="50"
                    placeholder="600"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                    value={form.consultationFee}
                    onChange={(e) => setForm({ ...form, consultationFee: Number(e.target.value) })}
                  />
                </div>
              </>
            )}

            {form.role === "receptionist" && (
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Department</label>
                <input
                  placeholder="Front Desk & Triage"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                />
              </div>
            )}
          </div>

          {/* Profile Picture Preset Selector for New Doctor */}
          {form.role === "doctor" && (
            <div className="pt-2 border-t border-slate-100">
              <label className="block text-[11px] font-semibold text-slate-600 mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                Select Initial Doctor Profile Picture
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {PRESET_DOCTOR_AVATARS.slice(0, 8).map((preset, idx) => {
                  const isSelected = form.avatarUrl === preset.url;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setForm({ ...form, avatarUrl: preset.url })}
                      className={`w-11 h-11 rounded-xl overflow-hidden border-2 transition-transform ${
                        isSelected ? "border-blue-600 ring-2 ring-blue-400/40 scale-105" : "border-slate-200 opacity-70 hover:opacity-100"
                      }`}
                      title={preset.label}
                    >
                      <img src={preset.url} alt={preset.label} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition-colors"
            >
              Create Account & Profile
            </button>
          </div>
        </form>
      )}

      {/* SECTION 1: DOCTOR ROSTER WITH PROFESSIONAL PROFILE CARDS */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200/60 flex items-center justify-center text-blue-600">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-manrope font-bold text-base text-slate-900">
                Doctor Faculty Directory ({filteredDoctors.length})
              </h2>
              <p className="text-xs text-slate-500">
                Click any profile picture or &ldquo;Edit Profile&rdquo; to update headshot, qualifications, or consultation hours
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search doctor or specialty..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 w-48 sm:w-56"
              />
            </div>

            {/* Specialty Filter */}
            <select
              value={selectedSpecialty}
              onChange={(e) => setSelectedSpecialty(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 font-medium focus:outline-none focus:border-blue-500"
            >
              <option value="all">All Specialties</option>
              {SPECIALTIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Doctor Grid Cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDoctors.map((d) => (
            <div
              key={d.id}
              className={`bg-white border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all flex flex-col justify-between ${
                d.active ? "border-slate-200/90" : "border-slate-200 bg-slate-50/60 opacity-85"
              }`}
            >
              <div>
                {/* Card Top: Avatar & Basic Info */}
                <div className="flex items-start gap-3.5">
                  {/* Portrait Avatar with Camera overlay */}
                  <div className="relative group shrink-0">
                    <div className="w-16 h-16 rounded-2xl overflow-hidden bg-gradient-to-br from-blue-700 to-indigo-900 border-2 border-slate-200 shadow-sm flex items-center justify-center">
                      {d.avatarUrl ? (
                        <img
                          src={d.avatarUrl}
                          alt={d.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-xl font-bold text-white">
                          {d.name.split(" ")[1]?.charAt(0) || "D"}
                        </span>
                      )}
                    </div>
                    {/* Active Status Pulse */}
                    <span
                      className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white ${
                        d.active ? "bg-emerald-500 ring-2 ring-emerald-500/20" : "bg-slate-400"
                      }`}
                      title={d.active ? "Active on OPD Roster" : "Inactive / On Leave"}
                    />
                    {/* Hover Camera icon to edit photo */}
                    <button
                      type="button"
                      onClick={() => handleEditDoctor(d)}
                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 rounded-2xl flex items-center justify-center text-white transition-opacity"
                      title="Update profile picture"
                    >
                      <Camera className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Doctor Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="font-manrope font-bold text-sm text-slate-900 truncate">
                        {d.name}
                      </h3>
                      <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" title="Verified Medical Practitioner" />
                    </div>

                    <div className="text-[11px] font-semibold text-blue-700 mt-0.5 flex items-center gap-1">
                      <span>{d.specialty}</span>
                      {d.experienceYears > 0 && (
                        <span className="text-slate-400 font-normal">· {d.experienceYears}y exp</span>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-500 truncate mt-0.5" title={d.qualification}>
                      {d.qualification || "Registered Medical Practitioner"}
                    </div>
                  </div>
                </div>

                {/* Badges / Credentials Row */}
                <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-slate-100 text-[10px]">
                  {d.regNumber && (
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-mono flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-emerald-600" />
                      {d.regNumber}
                    </span>
                  )}
                  {d.hprId && (
                    <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-mono flex items-center gap-1 border border-blue-200/50">
                      <Award className="w-3 h-3 text-blue-600" />
                      {d.hprId}
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-semibold flex items-center gap-0.5">
                    <IndianRupee className="w-3 h-3" />
                    {d.consultationFee} OPD
                  </span>
                </div>

                {/* Consultation Details */}
                <div className="space-y-1.5 text-xs text-slate-600 mt-2.5 bg-slate-50/70 p-2.5 rounded-xl border border-slate-100">
                  {d.opdRoom && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-medium text-slate-800">{d.opdRoom}</span>
                    </div>
                  )}
                  {d.opdTiming && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate text-slate-700">{d.opdTiming}</span>
                    </div>
                  )}
                  {d.availableDays && d.availableDays.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px] pt-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <div className="flex flex-wrap gap-1">
                        {d.availableDays.map((day) => (
                          <span
                            key={day}
                            className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-white border border-slate-200 text-slate-600"
                          >
                            {day}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Bio snippet if available */}
                {d.bio && (
                  <p className="text-[11px] text-slate-500 line-clamp-2 mt-2 italic">
                    &ldquo;{d.bio}&rdquo;
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => handleEditDoctor(d)}
                  className="flex-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200/80 text-slate-800 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                  Edit Profile & Photo
                </button>

                {canManage && (
                  <button
                    type="button"
                    onClick={() => toggleDoctorActive(d)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      d.active
                        ? "text-rose-600 hover:bg-rose-50 border border-rose-200/60"
                        : "text-emerald-600 hover:bg-emerald-50 border border-emerald-200/60"
                    }`}
                  >
                    {d.active ? "Deactivate" : "Activate"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 2: SIGN-IN ACCOUNTS & SECURITY */}
      <section className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Headset className="w-4 h-4 text-blue-600" />
            <h2 className="font-manrope font-bold text-sm text-slate-900">Sign-in Accounts ({members.length})</h2>
          </div>
          <span className="text-xs text-slate-400">Authenticated EMR access</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-slate-500 border-b border-slate-100 bg-slate-50/60">
                <th className="px-5 py-2.5">User</th>
                <th className="px-3 py-2.5">Role</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Phone</th>
                {canManage && <th className="px-3 py-2.5 text-right pr-5">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50/40">
                  <td className="px-5 py-3">
                    <div className="font-semibold text-slate-900">{m.name}</div>
                    <div className="text-xs text-slate-500 font-mono">{m.email}</div>
                  </td>
                  <td className="px-3 py-3 capitalize text-xs font-medium text-slate-700">
                    {m.role.replace("_", " ")}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        m.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {m.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-600">{m.phone || "—"}</td>
                  {canManage && (
                    <td className="px-3 py-3 text-xs text-right pr-5 space-x-3">
                      {m.id !== currentUserId && (
                        <button
                          type="button"
                          className="text-blue-600 hover:text-blue-700 font-semibold"
                          onClick={async () => {
                            await apiFetch(`/api/clinic/members/${m.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ status: m.status === "active" ? "disabled" : "active" }),
                            });
                            load();
                          }}
                        >
                          {m.status === "active" ? "Disable" : "Enable"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-slate-600 hover:text-slate-900 font-medium"
                        onClick={async () => {
                          const res = await apiFetch<{ temporaryPassword?: string }>(
                            `/api/clinic/members/${m.id}/password`,
                            {
                              method: "POST",
                              body: JSON.stringify({}),
                            }
                          );
                          setNotice(`New temporary password for ${m.email}: ${res.temporaryPassword}`);
                        }}
                      >
                        Reset password
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* SECTION 3: FRONT DESK & SUPPORT STAFF */}
      <section className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-purple-600" />
            <h2 className="font-manrope font-bold text-sm text-slate-900">Front Desk & Clinical Support Staff ({staff.length})</h2>
          </div>
          <span className="text-xs text-slate-400">Nursing, Triage & Pharmacy</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-slate-500 border-b border-slate-100 bg-slate-50/60">
                <th className="px-5 py-2.5">Staff Name</th>
                <th className="px-3 py-2.5">Clinical Role</th>
                <th className="px-3 py-2.5">Department</th>
                <th className="px-3 py-2.5">Duty Shift</th>
                <th className="px-3 py-2.5">Contact</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50/40">
                  <td className="px-5 py-3 font-semibold text-slate-900">{s.name}</td>
                  <td className="px-3 py-3 text-xs font-medium text-slate-700">{s.role}</td>
                  <td className="px-3 py-3 text-xs text-slate-500">{s.department}</td>
                  <td className="px-3 py-3 text-xs text-slate-600">
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 font-medium">
                      {s.shift}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-600">{s.email || s.phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Doctor Profile Management Modal */}
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
