import React from 'react';
import { 
  Stethoscope, 
  Activity, 
  Heart, 
  Sparkles, 
  Baby, 
  Bone, 
  Eye, 
  Smile, 
  Brain,
  Zap,
  BookmarkPlus
} from 'lucide-react';
import { PolyclinicSpecialty } from '../../types';
import { RX_PRESETS } from '../../data/clinicalData';

interface SpecialtyToolbarProps {
  currentSpecialty: PolyclinicSpecialty;
  doctorSpecialty: string;
  onSelectSpecialty: (specialty: PolyclinicSpecialty) => void;
  onApplyPreset: (preset: any) => void;
}

const SPECIALTY_CONFIGS: Array<{
  id: PolyclinicSpecialty;
  name: string;
  shortName: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  badgeBg: string;
}> = [
  {
    id: 'Physiotherapy & Rehabilitation',
    name: 'Physiotherapy & Rehabilitation',
    shortName: 'Physiotherapy',
    icon: Activity,
    color: 'text-teal-700 border-teal-500 bg-teal-50',
    badgeBg: 'bg-teal-700 text-white'
  },
  {
    id: 'General Medicine',
    name: 'General Medicine',
    shortName: 'General Med',
    icon: Stethoscope,
    color: 'text-blue-700 border-blue-500 bg-blue-50',
    badgeBg: 'bg-blue-700 text-white'
  },
  {
    id: 'Orthopedics',
    name: 'Orthopedics',
    shortName: 'Orthopedics',
    icon: Bone,
    color: 'text-indigo-700 border-indigo-500 bg-indigo-50',
    badgeBg: 'bg-indigo-700 text-white'
  },
  {
    id: 'Cardiology',
    name: 'Cardiology',
    shortName: 'Cardiology',
    icon: Heart,
    color: 'text-rose-700 border-rose-500 bg-rose-50',
    badgeBg: 'bg-rose-700 text-white'
  },
  {
    id: 'Dermatology',
    name: 'Dermatology',
    shortName: 'Dermatology',
    icon: Sparkles,
    color: 'text-purple-700 border-purple-500 bg-purple-50',
    badgeBg: 'bg-purple-700 text-white'
  },
  {
    id: 'Pediatrics',
    name: 'Pediatrics',
    shortName: 'Pediatrics',
    icon: Baby,
    color: 'text-emerald-700 border-emerald-500 bg-emerald-50',
    badgeBg: 'bg-emerald-700 text-white'
  },
  {
    id: 'Ophthalmology',
    name: 'Ophthalmology',
    shortName: 'Ophthalmology',
    icon: Eye,
    color: 'text-cyan-700 border-cyan-500 bg-cyan-50',
    badgeBg: 'bg-cyan-700 text-white'
  },
  {
    id: 'Dental Surgery',
    name: 'Dental Surgery',
    shortName: 'Dental',
    icon: Smile,
    color: 'text-amber-700 border-amber-500 bg-amber-50',
    badgeBg: 'bg-amber-700 text-white'
  },
  {
    id: 'Gynecology',
    name: 'Obstetrics & Gynecology',
    shortName: 'Gynae / OB',
    icon: Sparkles,
    color: 'text-pink-700 border-pink-500 bg-pink-50',
    badgeBg: 'bg-pink-700 text-white'
  }
];

export const SpecialtyToolbar: React.FC<SpecialtyToolbarProps> = ({
  currentSpecialty,
  doctorSpecialty,
  onSelectSpecialty,
  onApplyPreset
}) => {
  // Filter presets for the active specialty or show top ones
  const relevantPresets = RX_PRESETS.filter(
    p => p.specialty === currentSpecialty || (!p.specialty && currentSpecialty === 'General Medicine')
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs mb-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Specialty Selector Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0 scrollbar-none">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap mr-1 flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            Specialty Workflow:
          </span>
          {SPECIALTY_CONFIGS.map((spec) => {
            const Icon = spec.icon;
            const isSelected = currentSpecialty === spec.id;
            const isDoctorDefault = doctorSpecialty.toLowerCase().includes(spec.shortName.toLowerCase());

            return (
              <button
                key={spec.id}
                type="button"
                onClick={() => onSelectSpecialty(spec.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 border ${
                  isSelected
                    ? `${spec.badgeBg} border-transparent shadow-xs scale-[1.02]`
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-slate-500'}`} />
                <span>{spec.shortName}</span>
                {isDoctorDefault && (
                  <span className={`text-[9px] px-1 py-0.2 rounded font-bold uppercase ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-teal-100 text-teal-800'
                  }`}>
                    Doctor
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Quick Clinical Protocol / Presets */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap flex items-center gap-1">
            <BookmarkPlus className="w-3.5 h-3.5 text-teal-600" />
            Quick Presets:
          </span>
          <div className="flex items-center gap-1.5">
            {relevantPresets.length > 0 ? (
              relevantPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onApplyPreset(preset)}
                  className="px-2.5 py-1 text-xs font-medium bg-slate-100 hover:bg-teal-50 hover:text-teal-800 hover:border-teal-300 text-slate-700 border border-slate-200 rounded-md transition-all whitespace-nowrap shadow-2xs"
                  title={`Apply ${preset.name} clinical template`}
                >
                  ⚡ {preset.name.split(' (')[0]}
                </button>
              ))
            ) : (
              <span className="text-xs text-slate-400 italic">Standard protocol</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
