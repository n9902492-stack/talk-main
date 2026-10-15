import { useState } from 'react';
import { Check, Zap, Share2, Code2, ArrowUpRight } from 'lucide-react';
import { INTEGRATIONS } from '../data/mockData';

export default function IntegrationsSection() {
  const [connectedApps, setConnectedApps] = useState<{ [key: string]: boolean }>({
    zapier: true,
    hubspot: false,
    webhooks: true,
    'talk-api': true
  });

  const toggleApp = (id: string) => {
    setConnectedApps(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <section id="integrations" className="py-20 md:py-28 bg-[#fbf9f8] border-y border-[#efeded]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Column: Narrative */}
          <div className="lg:col-span-6 space-y-6">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-[#795900]">
                Connections
              </span>
              <h2 className="font-display font-extrabold text-3xl sm:text-4xl lg:text-[42px] leading-tight text-[#1b1c1c] tracking-tight mt-2">
                Connect Talk with other systems
              </h2>
              <p className="mt-3 text-base text-[#5f5e5e] leading-relaxed">
                We'll handle the virtual connections, so you can focus on making human connections.
              </p>
            </div>

            <div className="space-y-3.5 pt-2">
              {[
                'Integrate with Zapier, Pabbly and HubSpot.',
                'Set up webhooks and automations.',
                'Use UTM codes to track your webinar\'s traffic.',
                'Use APIs to automate flows and build capabilities that suit your needs.'
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

          {/* Right Column: 2x2 Grid of Integration Cards */}
          <div className="lg:col-span-6">
            <div className="grid sm:grid-cols-2 gap-4">
              
              {/* Zapier */}
              <div className="p-6 rounded-2xl bg-white border border-[#efeded] hover:border-[#d4a017] hover:shadow-md transition-all flex flex-col justify-between">
                <div>
                  <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center mb-3 font-bold text-lg">
                    ⚡
                  </div>
                  <h4 className="font-display font-bold text-lg text-[#1b1c1c]">Zapier</h4>
                  <p className="text-xs text-[#5f5e5e] mt-1">
                    Connect Talk to 5,000+ business tools and automate follow-ups.
                  </p>
                </div>
                <div className="mt-5 pt-3 border-t border-[#efeded] flex items-center justify-between">
                  <span className="text-[11px] text-[#817662]">5,000+ Triggers</span>
                  <button
                    onClick={() => toggleApp('zapier')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      connectedApps['zapier'] ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-100 text-neutral-600'
                    }`}
                  >
                    {connectedApps['zapier'] ? 'Connected ✓' : 'Connect'}
                  </button>
                </div>
              </div>

              {/* HubSpot */}
              <div className="p-6 rounded-2xl bg-white border border-[#efeded] hover:border-[#d4a017] hover:shadow-md transition-all flex flex-col justify-between">
                <div>
                  <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center mb-3 font-bold text-lg">
                    🟠
                  </div>
                  <h4 className="font-display font-bold text-lg text-[#1b1c1c]">HubSpot</h4>
                  <p className="text-xs text-[#5f5e5e] mt-1">
                    Sync attendee leads, attendance duration, and engagement scores.
                  </p>
                </div>
                <div className="mt-5 pt-3 border-t border-[#efeded] flex items-center justify-between">
                  <span className="text-[11px] text-[#817662]">CRM Pipeline</span>
                  <button
                    onClick={() => toggleApp('hubspot')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      connectedApps['hubspot'] ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-100 text-neutral-600'
                    }`}
                  >
                    {connectedApps['hubspot'] ? 'Connected ✓' : 'Connect'}
                  </button>
                </div>
              </div>

              {/* Webhooks */}
              <div className="p-6 rounded-2xl bg-white border border-[#efeded] hover:border-[#d4a017] hover:shadow-md transition-all flex flex-col justify-between">
                <div>
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3 font-bold text-lg">
                    🔗
                  </div>
                  <h4 className="font-display font-bold text-lg text-[#1b1c1c]">Webhooks</h4>
                  <p className="text-xs text-[#5f5e5e] mt-1">
                    Instant payloads for participant joins, session recordings, and chat logs.
                  </p>
                </div>
                <div className="mt-5 pt-3 border-t border-[#efeded] flex items-center justify-between">
                  <span className="text-[11px] text-[#817662]">REST Callbacks</span>
                  <button
                    onClick={() => toggleApp('webhooks')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      connectedApps['webhooks'] ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-100 text-neutral-600'
                    }`}
                  >
                    {connectedApps['webhooks'] ? 'Active ✓' : 'Enable'}
                  </button>
                </div>
              </div>

              {/* Talk API */}
              <div className="p-6 rounded-2xl bg-white border border-[#efeded] hover:border-[#d4a017] hover:shadow-md transition-all flex flex-col justify-between">
                <div>
                  <div className="w-10 h-10 rounded-xl bg-[#FFF0BD] text-[#795900] flex items-center justify-center mb-3 font-bold text-lg">
                    ⚙️
                  </div>
                  <h4 className="font-display font-bold text-lg text-[#1b1c1c]">Talk API</h4>
                  <p className="text-xs text-[#5f5e5e] mt-1">
                    Generate white-label video rooms on demand inside your existing SaaS portal.
                  </p>
                </div>
                <div className="mt-5 pt-3 border-t border-[#efeded] flex items-center justify-between">
                  <span className="text-[11px] text-[#817662]">SDK & GraphQL</span>
                  <button
                    onClick={() => toggleApp('talk-api')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      connectedApps['talk-api'] ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-100 text-neutral-600'
                    }`}
                  >
                    {connectedApps['talk-api'] ? 'API Key ✓' : 'Generate Key'}
                  </button>
                </div>
              </div>

            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
