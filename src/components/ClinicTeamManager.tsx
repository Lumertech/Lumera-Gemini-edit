import React, { useEffect, useState } from "react";
import { UserPlus, Stethoscope, Headset, ShieldAlert } from "lucide-react";
import { apiFetch } from "../api/http";
import { AppUser, Doctor, PolyclinicSpecialty } from "../types";

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
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "receptionist" as "doctor" | "receptionist",
    specialty: "General Medicine" as PolyclinicSpecialty,
    qualification: "",
    department: "Front Desk",
  });

  const load = () => {
    apiFetch<{ members: AppUser[]; doctors: Doctor[]; staff: StaffRow[] }>("/api/clinic/team")
      .then((d) => {
        setMembers(d.members);
        setDoctors(d.doctors);
        setStaff(d.staff);
        onDoctorsChanged?.(d.doctors);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load team"));
  };

  useEffect(load, []);

  const addMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    try {
      const res = await apiFetch<{ user: AppUser; temporaryPassword?: string }>("/api/clinic/members", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({ ...form, name: "", email: "", phone: "", qualification: "" });
      if (res.temporaryPassword) {
        setNotice(`Created ${res.user.email}. Temporary password: ${res.temporaryPassword}`);
      } else {
        setNotice(`Created ${res.user.email}`);
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add team member");
    }
  };

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="font-manrope text-2xl font-bold text-slate-900">Clinic team</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage polyclinic logins for doctors and receptionists. This is separate from Lumera platform admin.
        </p>
      </div>

      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}

      {canManage ? (
        <form onSubmit={addMember} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <h2 className="font-manrope font-bold text-sm flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-indigo-600" /> Add a clinic login
          </h2>
          <p className="text-xs text-slate-500">Creates a sign-in account. Doctors also get a roster profile; receptionists get a front-desk staff record.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
            <input
              required
              placeholder="Full name"
              className="border rounded-lg px-3 py-2"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              required
              type="email"
              placeholder="Email"
              className="border rounded-lg px-3 py-2"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <input
              placeholder="Phone"
              className="border rounded-lg px-3 py-2"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <select
              className="border rounded-lg px-3 py-2"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as "doctor" | "receptionist" })}
            >
              <option value="receptionist">Receptionist</option>
              <option value="doctor">Doctor</option>
            </select>
            {form.role === "doctor" && (
              <>
                <select
                  className="border rounded-lg px-3 py-2"
                  value={form.specialty}
                  onChange={(e) => setForm({ ...form, specialty: e.target.value as PolyclinicSpecialty })}
                >
                  {SPECIALTIES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <input
                  placeholder="Qualification"
                  className="border rounded-lg px-3 py-2"
                  value={form.qualification}
                  onChange={(e) => setForm({ ...form, qualification: e.target.value })}
                />
              </>
            )}
            {form.role === "receptionist" && (
              <input
                placeholder="Department"
                className="border rounded-lg px-3 py-2"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              />
            )}
            <button className="sm:col-span-2 lg:col-span-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold">
              Create login
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
          You can view the clinic roster. Only doctors and polyclinic admins can add or disable logins.
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center gap-2">
          <Headset className="w-4 h-4 text-indigo-600" />
          <h2 className="font-manrope font-bold text-sm">Sign-in accounts ({members.length})</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase text-slate-500 border-b">
              <th className="px-5 py-2">Name</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Phone</th>
              {canManage && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="px-5 py-2.5">
                  <div className="font-semibold">{m.name}</div>
                  <div className="text-xs text-slate-500">{m.email}</div>
                </td>
                <td className="px-3 py-2 capitalize">{m.role.replace("_", " ")}</td>
                <td className="px-3 py-2">
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      m.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {m.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">{m.phone || "—"}</td>
                {canManage && (
                  <td className="px-3 py-2 text-xs space-x-3">
                    {m.id !== currentUserId && (
                      <button
                        type="button"
                        className="text-indigo-600 font-semibold"
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
                      className="text-slate-600"
                      onClick={async () => {
                        const res = await apiFetch<{ temporaryPassword?: string }>(`/api/clinic/members/${m.id}/password`, {
                          method: "POST",
                          body: JSON.stringify({}),
                        });
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
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <h2 className="font-manrope font-bold text-sm flex items-center gap-2">
          <Stethoscope className="w-4 h-4 text-indigo-600" /> Doctor roster ({doctors.length})
        </h2>
        <div className="grid md:grid-cols-2 gap-3">
          {doctors.map((d) => (
            <div key={d.id} className="border border-slate-200 rounded-xl p-3 text-sm">
              <div className="font-semibold">{d.name}</div>
              <div className="text-indigo-700 text-xs">{d.specialty}</div>
              <div className="text-xs text-slate-500 mt-1">
                {d.email || "No login email"} · Fee ₹{d.consultationFee}
              </div>
              {canManage && (
                <button
                  type="button"
                  className="text-xs text-indigo-600 font-semibold mt-2"
                  onClick={async () => {
                    await apiFetch(`/api/doctors/${d.id}`, { method: "PATCH", body: JSON.stringify({ active: !d.active }) });
                    load();
                  }}
                >
                  {d.active ? "Deactivate on roster" : "Activate on roster"}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b">
          <h2 className="font-manrope font-bold text-sm">Front desk & support staff ({staff.length})</h2>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="px-5 py-2 font-semibold">{s.name}</td>
                <td className="px-3 py-2">{s.role}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{s.department}</td>
                <td className="px-3 py-2 text-xs">{s.shift}</td>
                <td className="px-3 py-2 text-xs">{s.email || s.phone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
};
