import { useState } from 'react';
import { Sparkles, ArrowRight, Laptop, Check } from 'lucide-react';
import { motion } from 'motion/react';
import MeetingStagePreview from './MeetingStagePreview';

interface HeroSectionProps {
  onOpenDemo: () => void;
  onOpenSignup: () => void;
}

export default function HeroSection({ onOpenDemo, onOpenSignup }: HeroSectionProps) {
  const [activeTab, setActiveTab] = useState<'meetings' | 'bookings' | 'webinars' | 'agendas' | 'transcripts' | 'storage'>('meetings');

  return (
    <section className="relative pt-24 md:pt-32 pb-16 md:pb-24 bg-[#FFF0BD] overflow-hidden">
      
      {/* Subtle Warm Amber Gradient Wash */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#FFF0BD] via-[#FFF3CA] to-white pointer-events-none" />

      {/* Decorative Warm Ambient Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-amber-200/40 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Top Feature Pill Badge */}
        <motion.div 
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex justify-center mb-6"
        >
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/80 border border-[#d4a017]/40 shadow-xs backdrop-blur-xs text-[#795900] text-xs font-semibold cursor-pointer hover:bg-white transition-all">
            <Sparkles className="w-3.5 h-3.5 text-[#d4a017]" />
            <span>Now with the power of Talk AI</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#d4a017]" />
          </div>
        </motion.div>

        {/* Hero Main Headline */}
        <motion.div 
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-center max-w-4xl mx-auto mb-6"
        >
          <h1 className="font-display font-extrabold text-4xl sm:text-5xl md:text-6xl lg:text-[68px] leading-[1.1] tracking-tight text-[#1b1c1c]">
            Run online meetings and webinars{' '}
            <span className="relative inline-block font-handwriting text-5xl sm:text-6xl md:text-7xl lg:text-[76px] text-[#795900] font-bold">
              like a pro
            </span>
          </h1>

          <p className="mt-6 text-base sm:text-lg md:text-xl text-[#4f4634] max-w-2xl mx-auto font-normal leading-relaxed">
            The platform for stand-out customer-facing sessions: webinars, workshops and demos.
          </p>
        </motion.div>

        {/* Hero CTAs */}
        <motion.div 
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-3.5 mb-6"
        >
          <button
            onClick={onOpenSignup}
            className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-[#171717] hover:bg-black text-white font-bold text-sm md:text-base flex items-center justify-center gap-2.5 shadow-lg shadow-black/10 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
          >
            <Laptop className="w-4 h-4" />
            <span>Get started — it's free</span>
          </button>

          <button
            onClick={onOpenDemo}
            className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-white hover:bg-neutral-50 text-[#1b1c1c] font-semibold text-sm md:text-base border border-[#e4e2e2] hover:border-[#795900] flex items-center justify-center gap-2 shadow-sm transition-all hover:scale-[1.01] active:scale-[0.98] cursor-pointer"
          >
            <span>Get a live demo</span>
            <ArrowRight className="w-4 h-4 text-[#795900]" />
          </button>
        </motion.div>

        {/* Trust Micro-Copy */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="flex items-center justify-center gap-2 sm:gap-3 text-xs text-[#5f5e5e] mb-12 flex-wrap"
        >
          <span>Free 14-day trial</span>
          <span className="text-[#d3c5ae]">•</span>
          <span>No credit card required</span>
          <span className="text-[#d3c5ae]">•</span>
          <span>99.99% uptime</span>
        </motion.div>

        {/* Product Showcase Window with 6 Features */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.35 }}
        >
          <MeetingStagePreview 
            activeTab={activeTab} 
            onSelectTab={setActiveTab}
            onOpenDemo={onOpenDemo}
          />
        </motion.div>

      </div>
    </section>
  );
}
