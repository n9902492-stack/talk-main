import { useState } from 'react';
import { 
  Rocket, 
  Radio, 
  Calendar, 
  PenTool, 
  Building2, 
  Search, 
  Sparkles, 
  ArrowRight,
  MousePointer,
  Check,
  TrendingUp,
  Tag
} from 'lucide-react';
import { motion } from 'motion/react';

interface IdealForSectionProps {
  onOpenDemo: () => void;
  onOpenWebinarModal: () => void;
}

export default function IdealForSection({ onOpenDemo, onOpenWebinarModal }: IdealForSectionProps) {
  const [activeSandboxControl, setActiveSandboxControl] = useState(true);
  const [metricTab, setMetricTab] = useState<'leads' | 'conversions'>('conversions');

  return (
    <section id="ideal-for" className="py-20 md:py-28 bg-[#ffffff]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-xs font-bold uppercase tracking-widest text-[#795900]">
            Create remarkable experiences.
          </span>
          <h2 className="font-display font-extrabold text-3xl sm:text-4xl md:text-5xl text-[#1b1c1c] tracking-tight mt-2 mb-4">
            Talk is ideal for:
          </h2>
          <p className="text-base sm:text-lg text-[#5f5e5e] leading-relaxed">
            Replace disjointed tools. Run engaging onboarding, immersive webinars, and collaborative workshops directly in the browser.
          </p>
        </div>

        {/* 2 Primary Showcase Bento Cards */}
        <div className="grid lg:grid-cols-2 gap-8 mb-10">
          
          {/* Card 1: Product Onboarding */}
          <div className="p-6 sm:p-8 rounded-3xl bg-[#fbf9f8] border border-[#efeded] shadow-sm hover:shadow-md transition-all flex flex-col justify-between group">
            <div className="mb-6">
              <div className="w-12 h-12 rounded-2xl bg-[#FFF0BD] text-[#795900] flex items-center justify-center mb-4 shadow-xs">
                <Rocket className="w-6 h-6" />
              </div>
              <h3 className="font-display font-bold text-2xl text-[#1b1c1c] tracking-tight mb-2">
                Product Onboarding
              </h3>
              <p className="text-sm text-[#5f5e5e] leading-relaxed">
                Create a unique tool for your digital product and let your participants try it live.
              </p>
            </div>

            {/* Simulated Live Product Sandbox */}
            <div className="rounded-2xl bg-[#ffffff] border border-[#e4e2e2] p-4 shadow-xs overflow-hidden">
              <div className="flex items-center justify-between pb-3 border-b border-[#efeded] text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="font-bold text-[#1b1c1c]">Interactive Sandbox Session</span>
                </div>
                <button
                  onClick={() => setActiveSandboxControl(!activeSandboxControl)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all cursor-pointer ${
                    activeSandboxControl
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : 'bg-neutral-100 text-neutral-600'
                  }`}
                >
                  {activeSandboxControl ? 'Active Control Granted' : 'Request Control'}
                </button>
              </div>

              {/* Interactive In-Session Dashboard Screen */}
              <div className="mt-4 p-4 rounded-xl bg-[#fbf9f8] border border-[#efeded] relative">
                
                {/* Participant Cursor */}
                <motion.div 
                  animate={{ x: [0, 60, 20, 0], y: [0, 20, 45, 0] }}
                  transition={{ repeat: Infinity, duration: 5, ease: 'easeInOut' }}
                  className="absolute top-6 left-12 flex items-center gap-1 z-20 pointer-events-none"
                >
                  <MousePointer className="w-4 h-4 text-[#795900] fill-[#d4a017]" />
                  <span className="bg-[#171717] text-white text-[10px] font-medium px-2 py-0.5 rounded-full shadow-xs">
                    Participant: Jordyn is interacting live
                  </span>
                </motion.div>

                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="text-[11px] uppercase font-bold text-[#817662]">Live SaaS Demo</span>
                    <h5 className="font-bold text-sm text-[#1b1c1c]">Customer Conversion Engine</h5>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setMetricTab('conversions')}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold ${
                        metricTab === 'conversions' ? 'bg-[#171717] text-white' : 'text-[#5f5e5e] hover:bg-black/5'
                      }`}
                    >
                      Conversions
                    </button>
                    <button
                      onClick={() => setMetricTab('leads')}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold ${
                        metricTab === 'leads' ? 'bg-[#171717] text-white' : 'text-[#5f5e5e] hover:bg-black/5'
                      }`}
                    >
                      Leads
                    </button>
                  </div>
                </div>

                {/* Simulated Chart Bars */}
                <div className="grid grid-cols-5 gap-2 items-end h-24 pt-4">
                  {[
                    { h: '60%', v: '$2.4k' },
                    { h: '85%', v: '$4.1k' },
                    { h: '45%', v: '$1.8k' },
                    { h: '95%', v: '$5.6k' },
                    { h: '75%', v: '$3.7k' }
                  ].map((bar, i) => (
                    <div key={i} className="flex flex-col items-center gap-1.5 h-full justify-end">
                      <div 
                        className="w-full bg-[#d4a017] rounded-t-md hover:bg-[#f6be39] transition-all cursor-pointer"
                        style={{ height: bar.h }}
                      />
                      <span className="text-[9px] font-mono text-[#817662]">{bar.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Interactive Webinars */}
          <div className="p-6 sm:p-8 rounded-3xl bg-[#fbf9f8] border border-[#efeded] shadow-sm hover:shadow-md transition-all flex flex-col justify-between group">
            <div className="mb-6">
              <div className="w-12 h-12 rounded-2xl bg-[#FFF0BD] text-[#795900] flex items-center justify-center mb-4 shadow-xs">
                <Radio className="w-6 h-6" />
              </div>
              <h3 className="font-display font-bold text-2xl text-[#1b1c1c] tracking-tight mb-2">
                Interactive Webinars
              </h3>
              <p className="text-sm text-[#5f5e5e] leading-relaxed">
                Create professional online events with custom landing and registration pages. Plus, showcase special offers live on screen.
              </p>
            </div>

            {/* Simulated Live Broadcast Stage */}
            <div className="rounded-2xl bg-[#ffffff] border border-[#e4e2e2] p-4 shadow-xs overflow-hidden">
              <div className="flex items-center justify-between pb-3 border-b border-[#efeded] text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                  <span className="font-bold text-[#1b1c1c]">Studio Broadcast Stage</span>
                </div>
                <span className="px-2.5 py-0.5 rounded-full bg-black/5 text-[#5f5e5e] font-mono text-[11px]">
                  1,240 Attendees
                </span>
              </div>

              {/* Webinar Screen Presentation */}
              <div className="mt-4 rounded-xl bg-gradient-to-br from-neutral-900 to-black text-white p-5 relative overflow-hidden">
                <div className="relative z-10 space-y-2">
                  <span className="text-[10px] uppercase font-bold text-[#f6be39] tracking-wider">
                    KEYNOTE BROADCAST
                  </span>
                  <h5 className="font-display font-bold text-base md:text-lg text-white">
                    THE FUTURE OF DIGITAL COLLABORATION
                  </h5>
                  <p className="text-xs text-neutral-400 max-w-sm">
                    Interactive webinars with embedded slide decks, real-time upvoting, and instant in-stream checkouts.
                  </p>
                </div>

                {/* Floating Flash Offer Badge */}
                <div className="mt-4 pt-3 border-t border-neutral-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-base">🏷️</span>
                    <span className="text-neutral-200 font-semibold text-[11px]">
                      Flash Offer: $99 Pass
                    </span>
                  </div>
                  <button
                    onClick={onOpenWebinarModal}
                    className="px-3 py-1.5 rounded-lg bg-[#d4a017] hover:bg-[#f6be39] text-black font-bold text-xs transition-all shadow-xs cursor-pointer"
                  >
                    View Offer
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* 4 Secondary Use Cases Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          
          {/* Use Case 1: Demos */}
          <div className="p-6 rounded-2xl bg-white border border-[#efeded] hover:border-[#d4a017]/50 hover:shadow-md transition-all group">
            <div className="w-10 h-10 rounded-xl bg-[#fbf9f8] text-[#795900] group-hover:bg-[#FFF0BD] flex items-center justify-center mb-4 transition-colors">
              <Calendar className="w-5 h-5" />
            </div>
            <h4 className="font-display font-bold text-lg text-[#1b1c1c] mb-2">
              Demos
            </h4>
            <p className="text-xs text-[#5f5e5e] leading-relaxed">
              Share your availability and let others book a time with you. Pre-load customer agendas in seconds.
            </p>
          </div>

          {/* Use Case 2: Workshops */}
          <div className="p-6 rounded-2xl bg-white border border-[#efeded] hover:border-[#d4a017]/50 hover:shadow-md transition-all group">
            <div className="w-10 h-10 rounded-xl bg-[#fbf9f8] text-[#795900] group-hover:bg-[#FFF0BD] flex items-center justify-center mb-4 transition-colors">
              <PenTool className="w-5 h-5" />
            </div>
            <h4 className="font-display font-bold text-lg text-[#1b1c1c] mb-2">
              Workshops
            </h4>
            <p className="text-xs text-[#5f5e5e] leading-relaxed">
              Keep your participants engaged by adding interactive whiteboards, polls, and breakout rooms. Plus, stay on track with an agenda.
            </p>
          </div>

          {/* Use Case 3: Town halls */}
          <div className="p-6 rounded-2xl bg-white border border-[#efeded] hover:border-[#d4a017]/50 hover:shadow-md transition-all group">
            <div className="w-10 h-10 rounded-xl bg-[#fbf9f8] text-[#795900] group-hover:bg-[#FFF0BD] flex items-center justify-center mb-4 transition-colors">
              <Building2 className="w-5 h-5" />
            </div>
            <h4 className="font-display font-bold text-lg text-[#1b1c1c] mb-2">
              Town halls
            </h4>
            <p className="text-xs text-[#5f5e5e] leading-relaxed">
              Talk's interactive agenda, live transcriptions, and clutter-free Q&A will keep everyone on track.
            </p>
          </div>

          {/* Use Case 4: Discovery calls */}
          <div className="p-6 rounded-2xl bg-white border border-[#efeded] hover:border-[#d4a017]/50 hover:shadow-md transition-all group">
            <div className="w-10 h-10 rounded-xl bg-[#fbf9f8] text-[#795900] group-hover:bg-[#FFF0BD] flex items-center justify-center mb-4 transition-colors">
              <Search className="w-5 h-5" />
            </div>
            <h4 className="font-display font-bold text-lg text-[#1b1c1c] mb-2">
              Discovery calls
            </h4>
            <p className="text-xs text-[#5f5e5e] leading-relaxed">
              Frictionless browser-based rooms. No account required for clients, zero downloads, zero waiting.
            </p>
          </div>

        </div>

      </div>
    </section>
  );
}
