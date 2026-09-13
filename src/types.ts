export type UserRole = 'doctor' | 'receptionist' | 'polyclinic_admin' | 'CLINIC_ADMIN' | 'super_admin' | 'patient';
export type UserStatus = 'active' | 'invited' | 'disabled';

export interface AppUser {
  id: string;
  tenantId?: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  phone: string;
  lastLogin: string | null;
  createdAt: string;
  clinicName?: string;
  avatarUrl?: string;
  whatsappVerified?: boolean;
  hprId?: string;
  hfrId?: string;
  onboardingCompleted?: boolean;
  specialty?: string;
  packId?: string;
  roleHome?: 'admin' | 'app' | 'portal' | 'login';
  homeView?: string;
  practiceType?: 'individual' | 'polyclinic';
  isDemoWorkspace?: boolean;
  gstin?: string;
  upiId?: string;
}

export interface TenantLetterhead {
  clinicName: string;
  address: string;
  city?: string;
  phone?: string;
  email?: string;
  gstin: string;
  upiId: string;
  sealText: string;
  signatureUrl: string;
  tagline?: string;
  footerDisclaimer?: string;
  website?: string;
  regId?: string;
  whatsappNumber?: string;
}

export interface Tenant {
  id: string;
  name: string;
  specialty: string;
  country: string;
  timezone: string;
  phone: string;
  trialEndsAt: string;
  aiScribeMinutesLimit: number;
  aiScribeMinutesUsed: number;
  activeStatus: boolean;
  hfrId: string;
  wabaId?: string;
  phoneNumberId?: string;
  metaAccessToken?: string;
  metaTokenExpiresAt?: string;
  metaWabaName?: string;
  metaQualityRating?: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
  metaOnboardingStatus?: 'connected' | 'pending' | 'disconnected';
  createdAt: string;
  updatedAt: string;
}

export interface MetaTemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO';
  text?: string;
  example?: {
    header_text?: string[];
    body_text?: string[][];
  };
  buttons?: Array<{
    type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
    text: string;
    url?: string;
    phone_number?: string;
  }>;
}

export interface MetaWhatsAppTemplate {
  id: string;
  tenantId: string;
  tenantName?: string;
  wabaId: string;
  name: string;
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  language: string;
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED';
  components: MetaTemplateComponent[];
  metaTemplateId?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DhisTransactionSummary {
  id: string;
  tenantId: string;
  claimsCount: number;
  claimsThreshold: number;
  monthYear: string;
  status: string;
  createdAt: string;
}

export type PolyclinicSpecialty = 
  | 'General Medicine'
  | 'Cardiology'
  | 'Pediatrics'
  | 'Dermatology'
  | 'Orthopedics'
  | 'Physiotherapy & Rehabilitation'
  | 'Gynecology'
  | 'ENT'
  | 'Neurology'
  | 'Ophthalmology'
  | 'Dental Surgery'
  | 'Psychiatry & Mental Health'
  | 'Wellness & Spas'
  | 'Consulting';

export interface Doctor {
  id: string;
  userId?: string | null;
  name: string;
  qualification: string;
  regNumber: string;
  specialty: PolyclinicSpecialty;
  experienceYears: number;
  consultationFee: number;
  opdRoom: string;
  availableDays: string[];
  opdTiming: string;
  avatarUrl?: string;
  bio?: string;
  hprId?: string;
  phone: string;
  email: string;
  active: boolean;
  signatureUrl?: string;
  slotDurationMinutes?: number;
  rxTemplate?: 'classic' | 'compact' | 'detailed';
  practitionerId?: string;
}
