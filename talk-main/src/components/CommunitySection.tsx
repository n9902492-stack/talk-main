import { useState } from 'react';
import { Check, MessageSquare, ArrowRight, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';

export default function CommunitySection() {
  const [slackJoined, setSlackJoined] = useState(false);

  return (
    <section id="community" className="py-20 md:py-28 bg-[#ffffff]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Column: Community Narrative & Links */}
          <div className="lg:col-span-6 space-y-6">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-[#795900]">
                Community
              </span>
              <h2 className="font-display font-extrabold text-3xl sm:text-4xl lg:text-[42px] leading-tight text-[#1b1c1c] tracking-tight mt-2">
                Let's build the world's best meeting platform together.
              </h2>
              <p className="mt-3 text-base text-[#5f5e5e] leading-relaxed">
                Talk is community-first. We release updates every two weeks based directly on feedback from over 27,000 community members.
              </p>
            </div>

            {/* Checklist */}
            <div className="space-y-3.5 pt-2">
              {[
                'Share feature requests and directly guide the product roadmap',
                'Join 5,000+ members in our active Slack community channel',
                'Browse video walkthroughs, tips, and interactive tutorials',
                'Referral Program — spread Talk and earn generous monthly revenue share'
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

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-3">
              <button
                onClick={() => setSlackJoined(true)}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#171717] hover:bg-black text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
              >
                <MessageSquare className="w-4 h-4 text-[#d4a017]" />
                <span>{slackJoined ? 'Invite Sent to Slack!' : 'Join our Slack Community'}</span>
              </button>

              <a
                href="#pricing"
                className="w-full sm:w-auto px-5 py-3 rounded-xl bg-white hover:bg-neutral-50 text-[#1b1c1c] text-xs sm:text-sm font-semibold border border-[#e4e2e2] hover:border-[#795900] flex items-center justify-center gap-2 transition-all"
              >
                <span>Go to Referral Program</span>
                <ArrowRight className="w-3.5 h-3.5 text-[#795900]" />
              </a>
            </div>
          </div>

          {/* Right Column: Orbiting Community Wheel */}
          <div className="lg:col-span-6 flex justify-center">
            <div className="relative w-[320px] h-[320px] sm:w-[400px] sm:h-[400px] flex items-center justify-center">
              
              {/* Outer Orbit Rings */}
              <div className="absolute inset-0 rounded-full border border-dashed border-[#d3c5ae]/40" />
              <div className="absolute inset-8 rounded-full border border-[#efeded]" />
              <div className="absolute inset-16 rounded-full border border-dashed border-[#FFF0BD]" />

              {/* Central Core: Talk Community */}
              <div className="relative z-20 w-32 h-32 rounded-full bg-white shadow-xl border-4 border-[#FFF0BD] flex flex-col items-center justify-center p-3 text-center">
                <span className="font-display font-black text-xl text-[#1b1c1c] tracking-tight">
                  talk
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#795900]">
                  COMMUNITY
                </span>
              </div>

              {/* Orbiting Emojis & Avatars */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 25, ease: 'linear' }}
                className="absolute inset-0 z-10 pointer-events-none"
              >
                {/* 6 Reaction nodes on orbit */}
                {[
                  { emoji: '👋', angle: 0, bg: 'bg-amber-100' },
                  { emoji: '🚀', angle: 60, bg: 'bg-purple-100' },
                  { emoji: '💡', angle: 120, bg: 'bg-yellow-100' },
                  { emoji: '❤️', angle: 180, bg: 'bg-rose-100' },
                  { emoji: '👏', angle: 240, bg: 'bg-emerald-100' },
                  { emoji: '🎉', angle: 300, bg: 'bg-cyan-100' }
                ].map((node, i) => {
                  const rad = (node.angle * Math.PI) / 180;
                  const radius = 150; // px
                  const x = Math.cos(rad) * radius;
                  const y = Math.sin(rad) * radius;

                  return (
                    <div
                      key={i}
                      style={{
                        transform: `translate(${x}px, ${y}px)`
                      }}
                      className="absolute top-1/2 left-1/2 -ml-5 -mt-5 w-10 h-10 rounded-full bg-white shadow-md border border-[#e4e2e2] flex items-center justify-center text-lg pointer-events-auto hover:scale-125 transition-transform"
                    >
                      {node.emoji}
                    </div>
                  );
                })}
              </motion.div>

            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
