import { useState, useEffect } from 'react';
import { 
  ChevronDown, 
  Menu, 
  X, 
  Sparkles, 
  MonitorPlay, 
  Users, 
  Compass, 
  Calendar, 
  FileText, 
  Palette, 
  Layers, 
  ArrowRight,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface NavbarProps {
  onOpenDemo: () => void;
  onOpenSignup: () => void;
}

export default function Navbar({ onOpenDemo, onOpenSignup }: NavbarProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled 
          ? 'bg-white/95 backdrop-blur-md shadow-sm border-b border-[#e4e2e2]' 
          : 'bg-[#FFF0BD]/80 backdrop-blur-sm'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 md:h-20 gap-4">
          
          {/* Brand Wordmark & Version Pill */}
          <div className="flex items-center gap-3 shrink-0">
            <a href="#" className="flex items-center gap-2 group">
              <span className="font-display font-black text-2xl md:text-3xl tracking-tight text-[#1b1c1c] group-hover:text-[#795900] transition-colors">
                talk
              </span>
              <span className="bg-[#FFF0BD] border border-[#d4a017]/40 text-[#795900] text-[11px] font-bold px-2 py-0.5 rounded-full shadow-2xs tracking-wider">
                V2.4
              </span>
            </a>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden lg:flex items-center gap-1 xl:gap-2">
            
            {/* Features Dropdown */}
            <div 
              className="relative"
              onMouseEnter={() => setActiveDropdown('features')}
              onMouseLeave={() => setActiveDropdown(null)}
            >
              <button 
                onClick={() => setActiveDropdown(activeDropdown === 'features' ? null : 'features')}
                className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-[#1b1c1c] hover:text-[#795900] transition-colors rounded-lg hover:bg-black/5"
              >
                Features
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${activeDropdown === 'features' ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {activeDropdown === 'features' && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 w-80 bg-white rounded-2xl shadow-xl border border-[#e4e2e2] p-3 grid gap-1.5 z-50"
                  >
                    <a href="#interactivity" className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-[#FFF0BD]/40 transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-[#FFF0BD] text-[#795900] flex items-center justify-center shrink-0">
                        <MonitorPlay className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-[#1b1c1c]">Studio Stage</div>
                        <div className="text-xs text-[#5f5e5e]">Live HD video with interactive presenter view.</div>
                      </div>
                    </a>
                    <a href="#interactivity" className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-[#FFF0BD]/40 transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-[#FFF0BD] text-[#795900] flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-[#1b1c1c]">Interactive Agendas</div>
                        <div className="text-xs text-[#5f5e5e]">Auto-advancing agendas with tool embeds.</div>
                      </div>
                    </a>
                    <a href="#workspaces" className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-[#FFF0BD]/40 transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-[#FFF0BD] text-[#795900] flex items-center justify-center shrink-0">
                        <Palette className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-[#1b1c1c]">Custom Branding</div>
                        <div className="text-xs text-[#5f5e5e]">Your domain, custom themes and stage styles.</div>
                      </div>
                    </a>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Use Cases Dropdown */}
            <div 
              className="relative"
              onMouseEnter={() => setActiveDropdown('use-cases')}
              onMouseLeave={() => setActiveDropdown(null)}
            >
              <button 
                onClick={() => setActiveDropdown(activeDropdown === 'use-cases' ? null : 'use-cases')}
                className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-[#1b1c1c] hover:text-[#795900] transition-colors rounded-lg hover:bg-black/5"
              >
                Use Cases
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${activeDropdown === 'use-cases' ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {activeDropdown === 'use-cases' && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 w-80 bg-white rounded-2xl shadow-xl border border-[#e4e2e2] p-3 grid gap-1.5 z-50"
                  >
                    <a href="#ideal-for" className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-[#FFF0BD]/40 transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-[#FFF0BD] text-[#795900] flex items-center justify-center shrink-0">
                        <Zap className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-[#1b1c1c]">Product Onboarding</div>
                        <div className="text-xs text-[#5f5e5e]">Give live software control directly to users.</div>
                      </div>
                    </a>
                    <a href="#ideal-for" className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-[#FFF0BD]/40 transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-[#FFF0BD] text-[#795900] flex items-center justify-center shrink-0">
                        <Users className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-[#1b1c1c]">Webinars & Workshops</div>
                        <div className="text-xs text-[#5f5e5e]">Broadcast to 1,000+ viewers with live offers.</div>
                      </div>
                    </a>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Resources Dropdown */}
            <div 
              className="relative"
              onMouseEnter={() => setActiveDropdown('resources')}
              onMouseLeave={() => setActiveDropdown(null)}
            >
              <button 
                onClick={() => setActiveDropdown(activeDropdown === 'resources' ? null : 'resources')}
                className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-[#1b1c1c] hover:text-[#795900] transition-colors rounded-lg hover:bg-black/5"
              >
                Resources
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${activeDropdown === 'resources' ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {activeDropdown === 'resources' && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 w-80 bg-white rounded-2xl shadow-xl border border-[#e4e2e2] p-3 grid gap-1.5 z-50"
                  >
                    <a href="#wall-of-love" className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-[#FFF0BD]/40 transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-[#FFF0BD] text-[#795900] flex items-center justify-center shrink-0">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-[#1b1c1c]">Customer Wall of Love</div>
                        <div className="text-xs text-[#5f5e5e]">Read verified testimonials from 27,000+ teams.</div>
                      </div>
                    </a>
                    <a href="#security" className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-[#FFF0BD]/40 transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-[#FFF0BD] text-[#795900] flex items-center justify-center shrink-0">
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-[#1b1c1c]">Security & Compliance</div>
                        <div className="text-xs text-[#5f5e5e]">EU GDPR storage, Google Cloud, no AI training.</div>
                      </div>
                    </a>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Direct Links */}
            <a 
              href="#pricing" 
              className="px-3 py-2 text-sm font-medium text-[#1b1c1c] hover:text-[#795900] transition-colors rounded-lg hover:bg-black/5"
            >
              Pricing
            </a>

            <a 
              href="#community" 
              className="px-3 py-2 text-sm font-medium text-[#1b1c1c] hover:text-[#795900] transition-colors rounded-lg hover:bg-black/5"
            >
              Referral Program
            </a>
          </nav>

          {/* Right Action Buttons */}
          <div className="hidden sm:flex items-center gap-3 shrink-0">
            <button 
              onClick={onOpenSignup}
              className="px-3 py-2 text-sm font-medium text-[#1b1c1c] hover:text-[#795900] transition-colors"
            >
              Log in
            </button>
            
            <button 
              onClick={onOpenDemo}
              className="px-4 py-2 text-sm font-medium text-[#1b1c1c] bg-white border border-[#e4e2e2] hover:border-[#795900] rounded-xl transition-all hover:shadow-2xs active:scale-[0.98]"
            >
              Get a live demo
            </button>

            <button 
              onClick={onOpenSignup}
              className="px-4 py-2 text-sm font-bold text-[#1b1c1c] bg-[#d4a017] hover:bg-[#f6be39] rounded-xl shadow-xs transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center gap-1.5"
            >
              <span>Sign up for free</span>
              <span className="w-5 h-5 rounded-full bg-black/10 flex items-center justify-center text-xs">
                👤
              </span>
            </button>
          </div>

          {/* Mobile menu button */}
          <div className="lg:hidden flex items-center">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-xl text-[#1b1c1c] hover:bg-black/5 transition-colors"
              aria-label="Toggle Navigation Menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

        </div>
      </div>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="lg:hidden bg-white border-b border-[#e4e2e2] px-6 py-6 space-y-4 shadow-xl overflow-hidden"
          >
            <div className="grid gap-2">
              <a 
                href="#interactivity" 
                onClick={() => setMobileMenuOpen(false)}
                className="py-2 text-base font-semibold text-[#1b1c1c]"
              >
                Features
              </a>
              <a 
                href="#ideal-for" 
                onClick={() => setMobileMenuOpen(false)}
                className="py-2 text-base font-semibold text-[#1b1c1c]"
              >
                Use Cases
              </a>
              <a 
                href="#workspaces" 
                onClick={() => setMobileMenuOpen(false)}
                className="py-2 text-base font-semibold text-[#1b1c1c]"
              >
                Workspaces
              </a>
              <a 
                href="#wall-of-love" 
                onClick={() => setMobileMenuOpen(false)}
                className="py-2 text-base font-semibold text-[#1b1c1c]"
              >
                Wall of Love
              </a>
              <a 
                href="#community" 
                onClick={() => setMobileMenuOpen(false)}
                className="py-2 text-base font-semibold text-[#1b1c1c]"
              >
                Referral Program
              </a>
            </div>

            <div className="pt-4 border-t border-[#e4e2e2] grid gap-2">
              <button 
                onClick={() => { setMobileMenuOpen(false); onOpenDemo(); }}
                className="w-full py-2.5 px-4 text-center text-sm font-semibold text-[#1b1c1c] bg-white border border-[#e4e2e2] rounded-xl"
              >
                Get a live demo
              </button>
              <button 
                onClick={() => { setMobileMenuOpen(false); onOpenSignup(); }}
                className="w-full py-2.5 px-4 text-center text-sm font-bold text-[#1b1c1c] bg-[#d4a017] rounded-xl"
              >
                Sign up for free
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
