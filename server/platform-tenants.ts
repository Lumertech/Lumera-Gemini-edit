/**
 * Platform-wide tenant registry used by the admin console and the public
 * /api/platform/tenants directory. Distinct from the in-memory `clinics`
 * map in db.ts (which only holds tenants created during this process's
 * lifetime).
 *
 * HFR / HPR values here are catalog placeholders for the demo directory —
 * not NHA-verified Health Facility Registry or Healthcare Professional
 * Registry IDs. See abdmRegistryLabel.ts.
 */

export type TenantStatus = 'active' | 'onboarding' | 'suspended';
export type TenantPlan = 'starter' | 'growth' | 'enterprise';

export interface PlatformTenant {
  id: string;
  name: string;
  city: string;
  state: string;
  type: string;
  plan: TenantPlan;
  status: TenantStatus;
  doctors: number;
  patients: number;
  hfrId: string;
  hprId: string;
  joinedAt: string;
  owner: string;
}

const TENANTS: PlatformTenant[] = [
  { id: 'T-001', name: 'Aarogya Multispeciality Hospital', city: 'Bengaluru', state: 'KA', type: 'Hospital', plan: 'enterprise', status: 'active', doctors: 42, patients: 12800, hfrId: 'IN-HFR-88421', hprId: 'IN-HPR-12004', joinedAt: '2024-03-12', owner: 'Dr. Meera Iyer' },
  { id: 'T-002', name: 'Sahara Dental Clinic', city: 'Hyderabad', state: 'TS', type: 'Dental', plan: 'growth', status: 'active', doctors: 6, patients: 2100, hfrId: 'IN-HFR-55102', hprId: 'IN-HPR-88301', joinedAt: '2024-06-01', owner: 'Dr. Farhan Qureshi' },
  { id: 'T-003', name: 'Lotus Women & Child Hospital', city: 'Pune', state: 'MH', type: 'Hospital', plan: 'enterprise', status: 'active', doctors: 28, patients: 9400, hfrId: 'IN-HFR-22910', hprId: 'IN-HPR-44120', joinedAt: '2024-08-18', owner: 'Dr. Anjali Deshmukh' },
  { id: 'T-004', name: 'Greenleaf Family Clinic', city: 'Kochi', state: 'KL', type: 'GP Clinic', plan: 'starter', status: 'onboarding', doctors: 3, patients: 420, hfrId: 'IN-HFR-10233', hprId: 'IN-HPR-33011', joinedAt: '2025-01-09', owner: 'Dr. Thomas Varghese' },
  { id: 'T-005', name: 'Niramaya Eye Care', city: 'Jaipur', state: 'RJ', type: 'Specialty', plan: 'growth', status: 'active', doctors: 8, patients: 3600, hfrId: 'IN-HFR-77401', hprId: 'IN-HPR-91022', joinedAt: '2024-11-22', owner: 'Dr. Kavita Sharma' },
  { id: 'T-006', name: 'Sankalp Diagnostics', city: 'Ahmedabad', state: 'GJ', type: 'Diagnostics', plan: 'starter', status: 'suspended', doctors: 4, patients: 1800, hfrId: 'IN-HFR-39012', hprId: 'IN-HPR-22089', joinedAt: '2024-09-04', owner: 'Dr. Rajesh Patel' },
  { id: 'T-007', name: 'Veda Ayurveda Centre', city: 'Mysuru', state: 'KA', type: 'AYUSH', plan: 'growth', status: 'active', doctors: 11, patients: 5200, hfrId: 'IN-HFR-66120', hprId: 'IN-HPR-55033', joinedAt: '2024-05-30', owner: 'Dr. Lakshmi Rao' },
  { id: 'T-008', name: 'Pulse Cardiac Institute', city: 'Chennai', state: 'TN', type: 'Hospital', plan: 'enterprise', status: 'active', doctors: 35, patients: 7600, hfrId: 'IN-HFR-44891', hprId: 'IN-HPR-77144', joinedAt: '2024-02-14', owner: 'Dr. Suresh Krishnan' },
];

export function listPlatformTenants(): PlatformTenant[] {
  return TENANTS;
}

export function getPlatformTenant(id: string): PlatformTenant | undefined {
  return TENANTS.find(t => t.id === id);
}

export function platformTenantStats() {
  return {
    total: TENANTS.length,
    active: TENANTS.filter(t => t.status === 'active').length,
    onboarding: TENANTS.filter(t => t.status === 'onboarding').length,
    suspended: TENANTS.filter(t => t.status === 'suspended').length,
    doctors: TENANTS.reduce((s, t) => s + t.doctors, 0),
    patients: TENANTS.reduce((s, t) => s + t.patients, 0),
  };
}
