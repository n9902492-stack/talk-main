import { Lock, Cloud, Globe2, DoorClosed, ShieldCheck } from 'lucide-react';

export default function SecuritySection() {
  const securityItems = [
    {
      icon: Lock,
      title: 'No AI Training',
      description: "We'll never share your data with 3rd parties or use your content to train AI models.",
      badge: 'Strict Zero-Retention'
    },
    {
      icon: Cloud,
      title: 'Google Cloud',
      description: "Backed by Google's trusted cloud storage infrastructure and worldwide low-latency edge nodes.",
      badge: 'Enterprise Grade'
    },
    {
      icon: Globe2,
      title: 'EU Data Storage',
      description: 'All our storage systems and servers are located exclusively in Europe.',
      badge: 'GDPR Compliant'
    },
    {
      icon: DoorClosed,
      title: 'Session Lockdown',
      description: 'Lock your sessions with granular controls to keep unwanted participants out.',
      badge: 'Granular Access Control'
    }
  ];

  return (
    <section id="security" className="py-20 md:py-28 bg-[#ffffff]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-xs font-bold uppercase tracking-widest text-[#795900]">
            Privacy
          </span>
          <h2 className="font-display font-extrabold text-3xl sm:text-4xl md:text-5xl text-[#1b1c1c] tracking-tight mt-2 mb-4">
            Privacy and Security you can trust
          </h2>
          <p className="text-base sm:text-lg text-[#5f5e5e] leading-relaxed">
            We follow a no-compromize approach when it comes to your data and security.
          </p>
        </div>

        {/* 4 Cards Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {securityItems.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div 
                key={idx}
                className="p-6 rounded-3xl bg-[#fbf9f8] border border-[#efeded] hover:border-[#d4a017]/40 hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="w-12 h-12 rounded-2xl bg-[#FFF0BD] text-[#795900] flex items-center justify-center mb-5 shadow-2xs">
                    <Icon className="w-6 h-6" />
                  </div>
                  <h4 className="font-display font-bold text-xl text-[#1b1c1c] mb-2">
                    {item.title}
                  </h4>
                  <p className="text-xs sm:text-sm text-[#5f5e5e] leading-relaxed">
                    {item.description}
                  </p>
                </div>

                <div className="mt-8 pt-4 border-t border-[#efeded]">
                  <span className="text-[11px] font-semibold text-[#795900]">
                    {item.badge}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
}
