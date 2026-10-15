import { useState } from 'react';
import { Check, Globe, Shield, Users, Palette, UploadCloud, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';

const THEME_PRESETS = [
  { id: 'charcoal', label: 'Dark Obsidian', hex: '#1b1c1c', bg: 'bg-[#1b1c1c]' },
  { id: 'honey', label: 'Warm Pastel Studio (Default)', hex: '#d4a017', bg: 'bg-[#d4a017]' },
  { id: 'sky', label: 'Cobalt Pro', hex: '#2563eb', bg: 'bg-[#2563eb]' },
  { id: 'coral', label: 'Sunset Coral', hex: '#f43f5e', bg: 'bg-[#f43f5e]' },
  { id: 'violet', label: 'Royal Violet', hex: '#8b5cf6', bg: 'bg-[#8b5cf6]' },
  { id: 'emerald', label: 'Nordic Forest', hex: '#059669', bg: 'bg-[#059669]' }
];

export default function WorkspacesSection() {
  const [selectedTheme, setSelectedTheme] = useState(THEME_PRESETS[1]);
  const [subdomain, setSubdomain] = useState('yourcompany');
  const [customSaved, setCustomSaved] = useState(false);

  return (
    <section id="workspaces" className="py-20 md:py-28 bg-[#ffffff]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Column: Interactive Workspace Settings Card */}
          <div className="lg:col-span-6 order-2 lg:order-1">
            <div className="rounded-3xl bg-[#fbf9f8] border border-[#efeded] shadow-lg p-6 sm:p-8 space-y-6">
              
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-[#efeded]">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#171717] text-[#f6be39] font-black font-display text-sm flex items-center justify-center">
                    T
                  </div>
                  <div>
                    <h4 className="font-display font-bold text-base text-[#1b1c1c]">
                      Talk Workspace Settings
                    </h4>
                    <span className="text-[11px] text-[#5f5e5e]">
                      Custom White-Labeling & Brand Kit
                    </span>
                  </div>
                </div>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold border border-emerald-200">
                  Active Studio
                </span>
              </div>

              {/* Setting 1: Custom Domain */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#1b1c1c] flex items-center justify-between">
                  <span>Custom Domain & Room URL</span>
                  <span className="text-[11px] text-emerald-600 font-normal">SSL Active ✓</span>
                </label>
                <div className="flex items-center rounded-xl bg-white border border-[#e4e2e2] overflow-hidden focus-within:border-[#d4a017] focus-within:ring-2 focus-within:ring-[#d4a017]/20 transition-all">
                  <span className="px-3 text-xs text-[#817662] bg-[#f5f3f3] py-2.5 border-r border-[#e4e2e2] font-mono select-none">
                    https://meet.
                  </span>
                  <input
                    type="text"
                    value={subdomain}
                    onChange={(e) => setSubdomain(e.target.value)}
                    placeholder="yourcompany"
                    className="flex-1 px-3 py-2 text-xs font-mono text-[#1b1c1c] outline-hidden"
                  />
                  <span className="pr-3 text-xs text-[#817662] font-mono select-none">
                    .com
                  </span>
                </div>
              </div>

              {/* Setting 2: Brand Stage Theme Swatches */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-[#1b1c1c]">
                  <span>Brand Stage Theme</span>
                  <span className="text-[11px] font-medium text-[#795900]">
                    {selectedTheme.label}
                  </span>
                </div>
                <div className="flex items-center gap-2.5 p-2 rounded-xl bg-white border border-[#e4e2e2]">
                  {THEME_PRESETS.map((t) => {
                    const isSelected = selectedTheme.id === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setSelectedTheme(t)}
                        className={`w-7 h-7 rounded-full ${t.bg} transition-all relative flex items-center justify-center cursor-pointer ${
                          isSelected ? 'ring-2 ring-offset-2 ring-[#795900] scale-110 shadow-xs' : 'hover:scale-105 opacity-80 hover:opacity-100'
                        }`}
                        title={t.label}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Setting 3: Session Wallpaper Gradient Preview */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#1b1c1c]">
                  Session Wallpaper Gradient
                </label>
                <div 
                  className="h-20 rounded-xl p-3 border border-black/10 flex items-end justify-between transition-all"
                  style={{
                    background: `linear-gradient(135deg, ${selectedTheme.hex}22 0%, #FFF0BD 100%)`
                  }}
                >
                  <span className="text-[10px] font-mono font-medium text-[#795900] bg-white/80 px-2 py-0.5 rounded-md backdrop-blur-xs">
                    talk.brand/room-preview
                  </span>
                  <button
                    onClick={() => {
                      setCustomSaved(true);
                      setTimeout(() => setCustomSaved(false), 2000);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-white/90 hover:bg-white text-xs font-semibold text-[#1b1c1c] shadow-xs transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    <span>{customSaved ? 'Applied ✓' : 'Upload Custom Backing'}</span>
                  </button>
                </div>
              </div>

            </div>
          </div>

          {/* Right Column: Narrative & Value Propositions */}
          <div className="lg:col-span-6 space-y-6 order-1 lg:order-2">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-[#795900]">
                Talk is your ultimate meeting ally.
              </span>
              <h2 className="font-display font-extrabold text-3xl sm:text-4xl lg:text-[42px] leading-tight text-[#1b1c1c] tracking-tight mt-2">
                Maximise engagement and efficiency
              </h2>
              <div className="mt-2.5 inline-block px-2.5 py-0.5 rounded-md bg-[#FFF0BD] text-[#795900] text-xs font-bold uppercase tracking-wider">
                Workspaces
              </div>
              <h4 className="text-base sm:text-lg font-bold text-[#1b1c1c] mt-4">
                Create as many workspaces as you need — with custom branding.
              </h4>
            </div>

            {/* Checklist with Golden Checks */}
            <div className="space-y-3.5 pt-2">
              {[
                'Add your branding, set up a custom domain, and create your own tool for showcasing your digital product.',
                'Each team member will get their own Talk account and can host as many meetings as they like.',
                'Create custom roles and stay in control of what each team member can do inside Talk.',
                'Invite team members to work together: take turns to host booked meetings, create webinars as a team.',
                'Share agendas and presentation materials with each other.'
              ].map((item, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-[#FFF0BD] text-[#795900] flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                    <Check className="w-3 h-3 stroke-[3]" />
                  </div>
                  <span className="text-xs sm:text-sm text-[#1b1c1c] leading-snug">
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
