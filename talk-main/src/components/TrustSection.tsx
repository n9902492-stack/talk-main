import { Star, Award, Heart, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';

export default function TrustSection() {
  return (
    <section className="bg-white py-12 border-b border-[#efeded]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Investor Logos Row */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 pb-10 border-b border-[#efeded]">
          <div className="text-center md:text-left">
            <span className="text-[11px] font-bold uppercase tracking-widest text-[#817662]">
              Meet The Investors
            </span>
            <h3 className="text-base font-semibold text-[#1b1c1c] mt-0.5">
              Trusted by industry titans worldwide
            </h3>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-8 md:gap-14 opacity-85">
            <div className="font-display font-extrabold text-lg sm:text-xl tracking-wider text-[#1b1c1c] hover:opacity-100 transition-opacity">
              EARLYBIRD
            </div>
            <div className="font-display font-black text-lg sm:text-xl tracking-widest text-[#1b1c1c] hover:opacity-100 transition-opacity">
              STRIDE.VC
            </div>
            <div className="font-display font-bold text-base sm:text-lg tracking-wider text-[#1b1c1c] hover:opacity-100 transition-opacity">
              LAUNCHUB VENTURES
            </div>
          </div>
        </div>

        {/* User Stats & Industry Accolades */}
        <div className="pt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-6 items-center">
          
          {/* Avatar stack & Star Rating */}
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              <img 
                src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80" 
                alt="Professional user" 
                className="w-9 h-9 rounded-full border-2 border-white object-cover" 
                referrerPolicy="no-referrer"
              />
              <img 
                src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80" 
                alt="Professional user" 
                className="w-9 h-9 rounded-full border-2 border-white object-cover" 
                referrerPolicy="no-referrer"
              />
              <img 
                src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=120&q=80" 
                alt="Professional user" 
                className="w-9 h-9 rounded-full border-2 border-white object-cover" 
                referrerPolicy="no-referrer"
              />
              <div className="w-9 h-9 rounded-full bg-[#171717] text-[#f6be39] border-2 border-white font-bold text-[10px] flex items-center justify-center">
                +27k
              </div>
            </div>
            <div>
              <div className="flex items-center text-amber-500 text-xs">
                {'★★★★★'}
              </div>
              <div className="text-xs font-semibold text-[#1b1c1c]">
                Over 27,000 professionals moved to Talk
              </div>
            </div>
          </div>

          {/* Badge 1 */}
          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-[#fbf9f8] border border-[#efeded]">
            <div className="w-8 h-8 rounded-lg bg-[#FFF0BD] text-[#795900] flex items-center justify-center shrink-0">
              <Award className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#1b1c1c]">Product of the Year</div>
              <div className="text-[11px] text-[#5f5e5e]">Remote Collaboration Winner</div>
            </div>
          </div>

          {/* Badge 2 */}
          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-[#fbf9f8] border border-[#efeded]">
            <div className="w-8 h-8 rounded-lg bg-[#ffdad6] text-[#ba1a1a] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#1b1c1c]">High Performer</div>
              <div className="text-[11px] text-[#5f5e5e]">G2 Summer Leader</div>
            </div>
          </div>

          {/* Badge 3 */}
          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-[#fbf9f8] border border-[#efeded]">
            <div className="w-8 h-8 rounded-lg bg-[#d4a017]/20 text-[#795900] flex items-center justify-center shrink-0">
              <Heart className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#1b1c1c]">Users Love Us</div>
              <div className="text-[11px] text-[#5f5e5e]">98% Verified Satisfaction</div>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
