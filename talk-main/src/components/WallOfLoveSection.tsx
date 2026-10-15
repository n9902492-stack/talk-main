import { useState } from 'react';
import { Star, CheckCircle, MessageSquare } from 'lucide-react';
import { TESTIMONIALS } from '../data/mockData';

export default function WallOfLoveSection() {
  const [filter, setFilter] = useState<'All' | 'Agencies' | 'Workshops' | 'Webinars'>('All');

  const filteredTestimonials = filter === 'All' 
    ? TESTIMONIALS 
    : TESTIMONIALS.filter(t => t.tag === filter);

  return (
    <section id="wall-of-love" className="py-20 md:py-28 bg-[#fbf9f8] border-b border-[#efeded]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <span className="text-xs font-bold uppercase tracking-widest text-[#795900]">
            Community Voice
          </span>
          <h2 className="font-display font-extrabold text-3xl sm:text-4xl md:text-5xl text-[#1b1c1c] tracking-tight mt-2 mb-4">
            Wall of Love
          </h2>
          <p className="text-base sm:text-lg text-[#5f5e5e] leading-relaxed">
            Here's what teams have to say after moving their meetings to Talk.
          </p>

          {/* Interactive Filter Pills */}
          <div className="flex items-center justify-center gap-1.5 mt-6 flex-wrap">
            {(['All', 'Agencies', 'Workshops', 'Webinars'] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  filter === cat
                    ? 'bg-[#171717] text-white shadow-xs'
                    : 'bg-white text-[#5f5e5e] border border-[#efeded] hover:bg-neutral-50'
                }`}
              >
                {cat === 'All' ? 'All Stories' : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Testimonials 3 Cards Grid */}
        <div className="grid md:grid-cols-3 gap-6">
          {filteredTestimonials.map((t) => (
            <div 
              key={t.id}
              className="p-6 sm:p-8 rounded-3xl bg-white border border-[#efeded] shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div>
                {/* Author Info & Verified Badge */}
                <div className="flex items-center justify-between pb-4 border-b border-[#efeded]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#FFF0BD] text-[#795900] font-display font-black text-sm flex items-center justify-center">
                      {t.author.charAt(0)}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-[#1b1c1c] leading-snug">
                        {t.author}
                      </h4>
                      <div className="flex items-center gap-1 text-[11px] text-emerald-700">
                        <CheckCircle className="w-3 h-3" />
                        <span>{t.verifiedBadge}</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-[#817662] bg-[#f5f3f3] px-2 py-0.5 rounded-md">
                    {t.platform}
                  </span>
                </div>

                {/* 5 Stars */}
                <div className="flex items-center text-amber-500 text-sm mt-4 mb-2">
                  {'★★★★★'}
                </div>

                {/* Headline Title */}
                <h5 className="font-display font-bold text-base text-[#1b1c1c] mb-2 leading-snug">
                  {t.title}
                </h5>

                {/* Body Quote */}
                <p className="text-xs sm:text-sm text-[#5f5e5e] leading-relaxed">
                  "{t.content}"
                </p>
              </div>

              {/* Author Role */}
              <div className="mt-6 pt-4 border-t border-[#efeded] text-xs font-semibold text-[#817662]">
                {t.role}
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
