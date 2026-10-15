import { useState } from 'react';
import { Check, ArrowRight, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';

interface PreFooterCTAProps {
  onSuccessSignup?: (email: string) => void;
}

export default function PreFooterCTA({ onSuccessSignup }: PreFooterCTAProps) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email && email.includes('@')) {
      setSubmitted(true);
      if (onSuccessSignup) onSuccessSignup(email);
    }
  };

  return (
    <section id="pricing" className="py-20 md:py-28 bg-[#FFF0BD]/50 border-t border-[#efeded]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        
        {/* Kicker */}
        <span className="text-xs font-bold uppercase tracking-widest text-[#795900]">
          Start Hosting Better Sessions
        </span>

        {/* Headline */}
        <h2 className="font-display font-extrabold text-3xl sm:text-4xl md:text-5xl text-[#1b1c1c] tracking-tight mt-2 mb-4">
          Ready to transform your meetings?
        </h2>

        {/* Subtitle */}
        <p className="text-base sm:text-lg text-[#5f5e5e] max-w-2xl mx-auto mb-8 leading-relaxed">
          Join forward-thinking product teams, agencies, and webinar hosts who have upgraded to Talk. Set up your first room in less than 60 seconds.
        </p>

        {/* Email Signup Form */}
        <div className="max-w-md mx-auto mb-6">
          {submitted ? (
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="p-4 rounded-2xl bg-emerald-100 border border-emerald-300 text-emerald-900 text-sm font-semibold flex items-center justify-center gap-2"
            >
              <Check className="w-5 h-5 text-emerald-700" />
              <span>Welcome to Talk! Check {email} for instant room access.</span>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your work email"
                className="flex-1 px-4 py-3 rounded-xl bg-white border border-[#e4e2e2] text-sm text-[#1b1c1c] placeholder-[#817662] outline-hidden focus:border-[#d4a017] focus:ring-2 focus:ring-[#d4a017]/20 shadow-xs"
              />
              <button
                type="submit"
                className="px-6 py-3 rounded-xl bg-[#d4a017] hover:bg-[#f6be39] text-black font-bold text-sm shadow-md transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer whitespace-nowrap"
              >
                Get started for free
              </button>
            </form>
          )}
        </div>

        {/* Micro Guarantees */}
        <div className="flex items-center justify-center gap-4 text-xs text-[#5f5e5e] flex-wrap">
          <span className="flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-[#795900]" />
            <span>No credit card required</span>
          </span>
          <span className="text-[#d3c5ae]">•</span>
          <span className="flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-[#795900]" />
            <span>14-day full feature trial</span>
          </span>
          <span className="text-[#d3c5ae]">•</span>
          <span className="flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-[#795900]" />
            <span>Instant browser launch</span>
          </span>
        </div>

      </div>
    </section>
  );
}
