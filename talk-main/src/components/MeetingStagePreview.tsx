import { useState, useEffect } from 'react';
import { 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  Share2, 
  Smile, 
  PhoneOff, 
  CheckCircle2, 
  Sparkles, 
  Clock, 
  Users, 
  Layers, 
  ChevronRight, 
  Maximize2,
  Calendar,
  MessageSquare,
  Volume2,
  ExternalLink,
  Tag,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { INITIAL_AGENDA, INITIAL_PARTICIPANTS, AgendaItem } from '../data/mockData';

interface FloatingReaction {
  id: number;
  emoji: string;
  x: number;
}

interface MeetingStagePreviewProps {
  activeTab: 'meetings' | 'bookings' | 'webinars' | 'agendas' | 'transcripts' | 'storage';
  onSelectTab: (tab: 'meetings' | 'bookings' | 'webinars' | 'agendas' | 'transcripts' | 'storage') => void;
  onOpenDemo: () => void;
}

export default function MeetingStagePreview({
  activeTab,
  onSelectTab,
  onOpenDemo
}: MeetingStagePreviewProps) {
  // State for Meetings view
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [viewMode, setViewMode] = useState<'gallery' | 'spotlight' | 'audience'>('gallery');
  const [agenda, setAgenda] = useState<AgendaItem[]>(INITIAL_AGENDA);
  const [activeAgendaId, setActiveAgendaId] = useState('03');
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [offerClaimed, setOfferClaimed] = useState(false);
  const [showViewDropdown, setShowViewDropdown] = useState(false);

  // State for Bookings view
  const [selectedDate, setSelectedDate] = useState(27);
  const [selectedSlot, setSelectedSlot] = useState('09:45 AM - 10:15 AM');
  const [bookingConfirmed, setBookingConfirmed] = useState(false);

  // State for Webinars view
  const [registered, setRegistered] = useState(false);
  const [countdown, setCountdown] = useState({ hours: 2, minutes: 46, seconds: 38 });

  // State for Transcripts view
  const [transcriptLang, setTranscriptLang] = useState<'English' | 'German' | 'Spanish'>('English');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  // State for Agendas view
  const [generatingAgenda, setGeneratingAgenda] = useState(false);
  const [customAgendaReady, setCustomAgendaReady] = useState(false);

  // Ticking countdown for webinar mode
  useEffect(() => {
    if (activeTab === 'webinars') {
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev.seconds > 0) return { ...prev, seconds: prev.seconds - 1 };
          if (prev.minutes > 0) return { ...prev, minutes: prev.minutes - 1, seconds: 59 };
          return { hours: Math.max(0, prev.hours - 1), minutes: 59, seconds: 59 };
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [activeTab]);

  // Handle floating emoji reactions
  const triggerReaction = (emoji: string) => {
    const id = Date.now();
    const x = 30 + Math.random() * 40; // percentage
    setReactions(prev => [...prev, { id, emoji, x }]);
    setTimeout(() => {
      setReactions(prev => prev.filter(r => r.id !== id));
    }, 2200);
  };

  return (
    <div className="w-full">
      {/* The 6 Feature Ribbon Tabs */}
      <div className="max-w-4xl mx-auto mb-8">
        <div className="text-center mb-4">
          <span className="text-[11px] sm:text-xs font-bold tracking-widest text-[#795900] uppercase">
            One subscription gives your entire team access to
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 sm:gap-3 p-1.5 bg-black/5 rounded-2xl sm:rounded-full backdrop-blur-xs border border-[#e4e2e2]">
          {[
            { id: 'bookings', label: 'Bookings', icon: '📅' },
            { id: 'meetings', label: 'Meetings', icon: '👥' },
            { id: 'webinars', label: 'Webinars', icon: '🎙️' },
            { id: 'agendas', label: 'Agendas', icon: '📝' },
            { id: 'transcripts', label: 'Transcripts', icon: '📄' },
            { id: 'storage', label: 'Cloud Storage', icon: '☁️' }
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onSelectTab(tab.id as any)}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl sm:rounded-full text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'bg-white text-[#1b1c1c] shadow-md scale-[1.02] border border-[#d4a017]/30'
                    : 'text-[#4f4634] hover:text-[#1b1c1c] hover:bg-white/50'
                }`}
              >
                <span>{tab.icon}</span>
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Product Window Showcase */}
      <div className="relative mx-auto max-w-6xl rounded-2xl md:rounded-3xl bg-[#171717] text-white shadow-2xl border border-neutral-700/60 overflow-hidden">
        
        {/* Window Top Chrome */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#1e1e1e] border-b border-neutral-800 text-xs">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
              <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
              <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
            </div>
            <div className="hidden sm:flex items-center gap-2 text-neutral-300 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Talk Enterprise Studio: Q4 Launch & Onboarding</span>
              <span className="text-neutral-500">|</span>
              <span className="font-mono text-neutral-400">00:42:15</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-800 text-[11px] font-mono">
              ● HD 1080p
            </span>

            {/* View Mode Switcher Dropdown */}
            <div className="relative">
              <button 
                onClick={() => setShowViewDropdown(!showViewDropdown)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs transition-colors"
              >
                <span className="capitalize">{viewMode} View</span>
                <span className="text-neutral-400">▾</span>
              </button>

              {showViewDropdown && (
                <div className="absolute right-0 top-full mt-1 w-36 bg-[#252525] rounded-xl shadow-xl border border-neutral-700 py-1 z-30">
                  {(['gallery', 'spotlight', 'audience'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => { setViewMode(mode); setShowViewDropdown(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs capitalize hover:bg-neutral-700 ${
                        viewMode === mode ? 'text-[#f6be39] font-bold' : 'text-neutral-300'
                      }`}
                    >
                      {mode} View
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tab 1: Meetings Mode (The Core Studio Stage) */}
        {activeTab === 'meetings' && (
          <div className="relative p-3 sm:p-5 grid lg:grid-cols-12 gap-4 min-h-[460px] md:min-h-[540px]">
            
            {/* Center Stage: Interactive Whiteboard / Collaboration Screen */}
            <div className="lg:col-span-8 flex flex-col justify-between rounded-2xl bg-[#232323] p-4 sm:p-6 border border-neutral-800 relative overflow-hidden">
              
              {/* Floating Emojis Container */}
              <div className="absolute inset-0 pointer-events-none z-40 overflow-hidden">
                {reactions.map(r => (
                  <motion.div
                    key={r.id}
                    initial={{ y: 350, opacity: 1, scale: 0.6 }}
                    animate={{ y: -50, opacity: 0, scale: 1.5 }}
                    transition={{ duration: 2, ease: 'easeOut' }}
                    style={{ left: `${r.x}%` }}
                    className="absolute text-4xl"
                  >
                    {r.emoji}
                  </motion.div>
                ))}
              </div>

              {/* Whiteboard Header */}
              <div className="flex items-center justify-between pb-3 border-b border-neutral-800/80">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-lg bg-[#d4a017]/20 text-[#f6be39] font-medium text-xs flex items-center gap-1.5">
                    <span>✏️</span> Interactive Whiteboard
                  </span>
                  <span className="text-xs text-neutral-400 hidden sm:inline">
                    4 live collaborators active
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-neutral-400">
                  <span className="text-[11px] px-2 py-0.5 rounded bg-neutral-800">Figma Bridge Active</span>
                </div>
              </div>

              {/* Whiteboard Interactive Canvas Area */}
              <div className="my-4 relative rounded-xl bg-gradient-to-br from-neutral-900 to-neutral-950 p-6 border border-neutral-800/80 flex-1 flex flex-col justify-center items-center text-center">
                
                {/* Floating Participant Cursors */}
                <motion.div 
                  animate={{ x: [0, 40, -20, 0], y: [0, -30, 20, 0] }}
                  transition={{ repeat: Infinity, duration: 6, ease: 'easeInOut' }}
                  className="absolute top-12 left-16 flex items-center gap-1 pointer-events-none"
                >
                  <span className="text-[#f6be39] text-sm">↖</span>
                  <span className="bg-[#d4a017] text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-xs">
                    Mateo V.
                  </span>
                </motion.div>

                <motion.div 
                  animate={{ x: [0, -35, 15, 0], y: [0, 25, -15, 0] }}
                  transition={{ repeat: Infinity, duration: 7, ease: 'easeInOut' }}
                  className="absolute bottom-16 right-20 flex items-center gap-1 pointer-events-none"
                >
                  <span className="text-cyan-400 text-sm">↖</span>
                  <span className="bg-cyan-500 text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-xs">
                    Lin Chen
                  </span>
                </motion.div>

                {/* Central Diagram Mockup */}
                <div className="max-w-md w-full space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    Product Architecture Sandbox
                  </div>
                  <h4 className="text-lg md:text-xl font-bold text-neutral-100">
                    Seamless Zero-Download Interactive Studio
                  </h4>
                  <p className="text-xs text-neutral-400">
                    Participants can interact directly with your slides, whiteboards, and product demos without installing plugins.
                  </p>

                  {/* Interactive In-Session Flash Offer Banner */}
                  <div className="mt-4 p-3 rounded-xl bg-gradient-to-r from-amber-950/60 via-amber-900/40 to-neutral-900 border border-amber-500/40 flex items-center justify-between gap-3 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">🎁</span>
                      <div>
                        <div className="text-xs font-bold text-amber-200">
                          20% Off Growth Workshop Pass
                        </div>
                        <div className="text-[10px] text-amber-400/80">
                          Claim in live session • 4 spots left
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setOfferClaimed(!offerClaimed)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        offerClaimed
                          ? 'bg-emerald-600 text-white'
                          : 'bg-[#d4a017] hover:bg-[#f6be39] text-black shadow-sm'
                      }`}
                    >
                      {offerClaimed ? 'Claimed ✓' : 'Claim Offer'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Bottom Webcams Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                {INITIAL_PARTICIPANTS.map((p) => (
                  <div 
                    key={p.id}
                    className={`relative rounded-xl overflow-hidden bg-neutral-900 border transition-all ${
                      p.isSpeaking 
                        ? 'border-[#d4a017] ring-2 ring-[#d4a017]/30' 
                        : 'border-neutral-800'
                    }`}
                  >
                    <div className="aspect-4/3 relative">
                      <img 
                        src={p.avatar} 
                        alt={p.name}
                        className="w-full h-full object-cover" 
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                      
                      {/* Name & Mic tag */}
                      <div className="absolute bottom-1.5 left-2 right-2 flex items-center justify-between text-[11px]">
                        <span className="truncate font-medium text-neutral-200">
                          {p.name} {p.isHost && '(Host)'}
                        </span>
                        <span className={`p-1 rounded-full ${p.isMuted ? 'bg-red-500/80 text-white' : 'bg-black/50 text-emerald-400'}`}>
                          {p.isMuted ? <MicOff className="w-2.5 h-2.5" /> : <Mic className="w-2.5 h-2.5" />}
                        </span>
                      </div>

                      {/* Speaking indicator audio bars */}
                      {p.isSpeaking && (
                        <div className="absolute top-2 right-2 flex items-end gap-0.5 h-3">
                          <span className="w-1 bg-[#f6be39] rounded-full animate-bounce h-2" />
                          <span className="w-1 bg-[#f6be39] rounded-full animate-bounce h-3 delay-75" />
                          <span className="w-1 bg-[#f6be39] rounded-full animate-bounce h-1.5 delay-150" />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

            </div>

            {/* Right Panel: Live Interactive Agenda */}
            <div className="lg:col-span-4 flex flex-col justify-between rounded-2xl bg-[#1f1f1f] border border-neutral-800 p-4">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-neutral-200">
                      Live Agenda
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-neutral-400">
                    Step {agenda.findIndex(i => i.id === activeAgendaId) + 1} of {agenda.length}
                  </span>
                </div>

                {/* Agenda Items list */}
                <div className="space-y-2.5 mt-3">
                  {agenda.map((item) => {
                    const isActive = item.id === activeAgendaId;
                    return (
                      <div
                        key={item.id}
                        onClick={() => setActiveAgendaId(item.id)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer ${
                          isActive
                            ? 'bg-[#2a271c] border-[#d4a017] shadow-sm'
                            : 'bg-neutral-900/60 border-neutral-800 hover:border-neutral-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-neutral-200 flex items-center gap-1.5">
                            <span className="text-[#f6be39] font-mono">{item.step}.</span>
                            <span>{item.title}</span>
                          </span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            item.status === 'completed' 
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' 
                              : isActive 
                              ? 'bg-amber-500/20 text-[#f6be39] border border-amber-500/40' 
                              : 'bg-neutral-800 text-neutral-400'
                          }`}>
                            {item.status === 'completed' ? 'Completed' : isActive ? 'In Progress' : 'Upcoming'}
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-400 line-clamp-1">
                          {item.description}
                        </p>
                        {isActive && (
                          <div className="mt-2 pt-2 border-t border-amber-900/40 flex items-center justify-between text-[10px] text-[#f6be39]">
                            <span>⏱ {item.duration} allocated</span>
                            <span className="font-semibold underline">Auto-transition on</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* AI Transcript Action Bar */}
              <div className="mt-4 p-3 rounded-xl bg-neutral-900 border border-neutral-800">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#f6be39] mb-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Talk AI Live Copilot</span>
                </div>
                <p className="text-[11px] text-neutral-400">
                  Summarizing action items & translating speaker streams in real time.
                </p>
              </div>

            </div>

          </div>
        )}

        {/* Tab 2: Bookings Mode (Calendar Booking Schedule) */}
        {activeTab === 'bookings' && (
          <div className="p-4 sm:p-8 bg-neutral-900 min-h-[460px] flex items-center justify-center">
            <div className="max-w-2xl w-full bg-[#1e1e1e] rounded-2xl border border-neutral-800 p-6 shadow-xl">
              <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
                <div>
                  <h3 className="text-lg font-bold text-neutral-100">See Talk in action</h3>
                  <p className="text-xs text-neutral-400">
                    Schedule a live 30-min walkthrough with a Talk product specialist.
                  </p>
                </div>
                <span className="px-3 py-1 rounded-full bg-[#FFF0BD]/10 text-[#f6be39] border border-[#d4a017]/30 text-xs font-medium">
                  ⏱ 30 min session
                </span>
              </div>

              <div className="grid sm:grid-cols-2 gap-6 mt-6">
                {/* Calendar Grid */}
                <div>
                  <div className="text-xs font-bold text-neutral-300 mb-3 flex items-center justify-between">
                    <span>October 2026</span>
                    <span className="text-[11px] text-neutral-500">UTC+01:00</span>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center text-xs">
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                      <span key={i} className="text-neutral-500 py-1 text-[10px] font-semibold">{d}</span>
                    ))}
                    {[...Array(31)].map((_, i) => {
                      const day = i + 1;
                      const isSelected = selectedDate === day;
                      const isAvailable = day >= 25 && day <= 31;
                      return (
                        <button
                          key={day}
                          disabled={!isAvailable}
                          onClick={() => { setSelectedDate(day); setBookingConfirmed(false); }}
                          className={`py-2 rounded-lg text-xs font-medium transition-all ${
                            isSelected
                              ? 'bg-[#d4a017] text-black font-bold shadow-sm'
                              : isAvailable
                              ? 'text-neutral-200 hover:bg-neutral-800 cursor-pointer'
                              : 'text-neutral-600 cursor-not-allowed'
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Time Slots */}
                <div>
                  <div className="text-xs font-bold text-neutral-300 mb-3">
                    Available times for Oct {selectedDate}
                  </div>
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {[
                      '09:00 AM - 09:30 AM',
                      '09:45 AM - 10:15 AM',
                      '10:30 AM - 11:00 AM',
                      '02:15 PM - 02:45 PM',
                      '04:00 PM - 04:30 PM'
                    ].map((slot) => {
                      const isSlotSelected = selectedSlot === slot;
                      return (
                        <button
                          key={slot}
                          onClick={() => setSelectedSlot(slot)}
                          className={`w-full py-2 px-3 rounded-xl text-left text-xs transition-all border ${
                            isSlotSelected
                              ? 'bg-amber-950/60 border-[#d4a017] text-[#f6be39] font-bold'
                              : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                          }`}
                        >
                          {slot}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => setBookingConfirmed(true)}
                    className="w-full mt-4 py-2.5 px-4 bg-[#d4a017] hover:bg-[#f6be39] text-black font-bold rounded-xl text-xs shadow-md transition-all cursor-pointer"
                  >
                    {bookingConfirmed ? '✓ Booking Reserved!' : 'Confirm Selected Time'}
                  </button>
                </div>
              </div>

              {bookingConfirmed && (
                <div className="mt-4 p-3 rounded-xl bg-emerald-950/70 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    You're all set for Oct {selectedDate} at {selectedSlot}! Calendar invitation sent.
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Webinars Mode (Webinar Registration Stage) */}
        {activeTab === 'webinars' && (
          <div className="p-4 sm:p-8 bg-neutral-900 min-h-[460px] flex items-center justify-center">
            <div className="max-w-2xl w-full bg-[#1e1e1e] rounded-2xl border border-neutral-800 p-6 shadow-xl">
              
              {/* Webinar Hero Banner */}
              <div className="p-6 rounded-2xl bg-gradient-to-r from-emerald-900 via-teal-900 to-neutral-900 border border-emerald-700/40 text-white mb-6">
                <span className="text-[11px] font-bold uppercase tracking-wider bg-black/40 px-2.5 py-1 rounded-full text-emerald-300">
                  Live Global Broadcast
                </span>
                <h3 className="text-xl md:text-2xl font-black mt-2">
                  Scaling to $1M in Digital Workshops with Talk
                </h3>
                <p className="text-xs text-neutral-300 mt-1">
                  How modern agencies run 1,000+ attendee interactive masterclasses without drop-offs.
                </p>

                {/* Countdown Timer */}
                <div className="flex items-center gap-3 mt-4">
                  {[
                    { label: 'Days', val: '00' },
                    { label: 'Hrs', val: String(countdown.hours).padStart(2, '0') },
                    { label: 'Min', val: String(countdown.minutes).padStart(2, '0') },
                    { label: 'Sec', val: String(countdown.seconds).padStart(2, '0') }
                  ].map((c, i) => (
                    <div key={i} className="text-center px-3 py-1.5 rounded-lg bg-black/60 border border-neutral-700">
                      <div className="font-mono text-base font-bold text-emerald-300">{c.val}</div>
                      <div className="text-[9px] uppercase text-neutral-400">{c.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Registration Form */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-xl bg-neutral-900 border border-neutral-800">
                <div>
                  <div className="text-xs font-bold text-neutral-200">
                    {registered ? 'You are registered! Check your email.' : 'Reserve your free seat'}
                  </div>
                  <div className="text-[11px] text-neutral-400">
                    1,240 attendees registered • Replay recording included
                  </div>
                </div>
                <button
                  onClick={() => setRegistered(!registered)}
                  className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    registered 
                      ? 'bg-emerald-600 text-white' 
                      : 'bg-[#d4a017] hover:bg-[#f6be39] text-black shadow-sm'
                  }`}
                >
                  {registered ? 'Registered ✓' : 'Register Now (Free)'}
                </button>
              </div>

            </div>
          </div>
        )}

        {/* Tab 4: Agendas Mode (AI Copilot Agenda Generation) */}
        {activeTab === 'agendas' && (
          <div className="p-4 sm:p-8 bg-neutral-900 min-h-[460px] flex items-center justify-center">
            <div className="max-w-2xl w-full bg-[#1e1e1e] rounded-2xl border border-neutral-800 p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-[#d4a017]/20 text-[#f6be39]">
                    <Sparkles className="w-4 h-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-neutral-100">Talk AI Agenda Generator</h3>
                    <p className="text-[11px] text-neutral-400">Auto-structure workshops, presentations, and breakout drills.</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setGeneratingAgenda(true);
                    setTimeout(() => {
                      setGeneratingAgenda(false);
                      setCustomAgendaReady(true);
                    }, 1200);
                  }}
                  disabled={generatingAgenda}
                  className="px-3 py-1.5 rounded-xl bg-[#d4a017] hover:bg-[#f6be39] text-black text-xs font-bold cursor-pointer transition-all"
                >
                  {generatingAgenda ? 'Generating...' : 'Regenerate Agenda'}
                </button>
              </div>

              {/* Agenda Preview Items */}
              <div className="space-y-2">
                {[
                  { step: '01', title: 'Introduction & Warmup Poll', time: '5m', tool: 'Interactive Poll' },
                  { step: '02', title: 'Deep-Dive Architecture Demo', time: '15m', tool: 'Live Whiteboard' },
                  { step: '03', title: 'Hands-On Breakout Session', time: '20m', tool: 'Breakout Rooms' },
                  { step: '04', title: 'Team Recap & Action Items', time: '10m', tool: 'AI Summary' }
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-neutral-900 border border-neutral-800">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-lg bg-neutral-800 text-[#f6be39] font-mono text-xs flex items-center justify-center font-bold">
                        {item.step}
                      </span>
                      <div>
                        <div className="text-xs font-semibold text-neutral-200">{item.title}</div>
                        <div className="text-[10px] text-neutral-400">Tool: {item.tool}</div>
                      </div>
                    </div>
                    <span className="text-xs font-mono text-neutral-400 bg-neutral-800 px-2 py-0.5 rounded">
                      {item.time}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab 5: Transcripts Mode (Live Translation & AI Summary) */}
        {activeTab === 'transcripts' && (
          <div className="p-4 sm:p-8 bg-neutral-900 min-h-[460px] flex items-center justify-center">
            <div className="max-w-2xl w-full bg-[#1e1e1e] rounded-2xl border border-neutral-800 p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
                <div>
                  <h3 className="text-sm font-bold text-neutral-100">Live AI Transcript & Translation</h3>
                  <p className="text-[11px] text-neutral-400">99.4% accuracy with speaker attribution and 42 languages.</p>
                </div>
                <div className="flex items-center gap-2">
                  {(['English', 'German', 'Spanish'] as const).map(l => (
                    <button
                      key={l}
                      onClick={() => setTranscriptLang(l)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                        transcriptLang === l
                          ? 'bg-[#d4a017] text-black font-bold'
                          : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Transcript Dialogue */}
              <div className="space-y-3 bg-neutral-950 p-4 rounded-xl border border-neutral-800/80 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-neutral-400 text-[10px]">
                    <span className="font-bold text-neutral-300">Sarah Jenkins (Host)</span>
                    <span>10:42:12</span>
                  </div>
                  <p className="text-neutral-200">
                    {transcriptLang === 'German'
                      ? 'In diesem Marketing-Workshop geht es darum, wie man die richtigen Plattformen auswählt und Inhalte erstellt.'
                      : transcriptLang === 'Spanish'
                      ? 'En este taller de marketing, nos enfocamos en cómo seleccionar las plataformas adecuadas y crear contenido atractivo.'
                      : 'In this marketing workshop, we focus on selecting the right platforms and creating engaging collaborative content.'}
                  </p>
                </div>

                <div className="space-y-1 pt-2 border-t border-neutral-900">
                  <div className="flex items-center justify-between text-neutral-400 text-[10px]">
                    <span className="font-bold text-neutral-300">Mateo Vance</span>
                    <span>10:42:35</span>
                  </div>
                  <p className="text-neutral-200">
                    {transcriptLang === 'German'
                      ? 'Absolut, und die Teilnehmer können direkt auf dem Whiteboard mitarbeiten, ohne die App zu verlassen.'
                      : transcriptLang === 'Spanish'
                      ? 'Totalmente de acuerdo, y los asistentes pueden interactuar directamente en la pizarra sin salir de la sala.'
                      : 'Agreed, and attendees can interact directly on the collaborative canvas without leaving the room.'}
                  </p>
                </div>
              </div>

              {/* AI Summary Button */}
              <div className="pt-2 flex items-center justify-between">
                <button
                  onClick={() => {
                    setIsSummarizing(true);
                    setTimeout(() => {
                      setIsSummarizing(false);
                      setShowSummary(true);
                    }, 800);
                  }}
                  className="px-4 py-2 rounded-xl bg-amber-500/20 text-[#f6be39] hover:bg-amber-500/30 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isSummarizing ? 'Synthesizing...' : 'Summarize Takeaways'}</span>
                </button>
                {showSummary && (
                  <span className="text-xs text-emerald-400">
                    ✓ 3 Key action items extracted to workspace
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 6: Storage Mode (Cloud Recordings Vault) */}
        {activeTab === 'storage' && (
          <div className="p-4 sm:p-8 bg-neutral-900 min-h-[460px] flex items-center justify-center">
            <div className="max-w-2xl w-full bg-[#1e1e1e] rounded-2xl border border-neutral-800 p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
                <div>
                  <h3 className="text-sm font-bold text-neutral-100">Post-Session Cloud Archive</h3>
                  <p className="text-[11px] text-neutral-400">All recordings, shared slides, chat logs, and transcripts stored in Europe.</p>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 text-xs">
                  GDPR Verified
                </span>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="p-4 rounded-xl bg-neutral-900 border border-neutral-800">
                  <div className="text-xs text-neutral-400">Total Attendees Logged</div>
                  <div className="text-2xl font-bold font-mono text-neutral-100 mt-1">1,240</div>
                  <div className="text-[10px] text-emerald-400 mt-1">98.2% retention rate</div>
                </div>
                <div className="p-4 rounded-xl bg-neutral-900 border border-neutral-800">
                  <div className="text-xs text-neutral-400">Cloud Recording Quality</div>
                  <div className="text-2xl font-bold font-mono text-neutral-100 mt-1">1080p 60fps</div>
                  <div className="text-[10px] text-neutral-400 mt-1">Stored indefinitely</div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🎬</span>
                  <div>
                    <div className="text-xs font-semibold text-neutral-200">Talk_Launch_Recording_Oct26.mp4</div>
                    <div className="text-[10px] text-neutral-500">1.8 GB • Ready for one-click sharing</div>
                  </div>
                </div>
                <button 
                  onClick={onOpenDemo}
                  className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 transition-colors"
                >
                  Share Link
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Floating Meeting Control Bar (Dock) */}
        <div className="px-4 py-3 bg-[#1e1e1e] border-t border-neutral-800 flex flex-wrap items-center justify-between gap-3">
          
          {/* Reaction Emojis Dock */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-neutral-400 mr-1 hidden sm:inline">React:</span>
            {['👍', '❤️', '👏', '🎉', '🔥'].map((emoji) => (
              <button
                key={emoji}
                onClick={() => triggerReaction(emoji)}
                className="w-8 h-8 rounded-full bg-neutral-800 hover:bg-neutral-700 active:scale-90 flex items-center justify-center text-sm transition-all cursor-pointer"
                title={`Send ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>

          {/* Core Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsMicOn(!isMicOn)}
              className={`p-2.5 rounded-full text-xs font-medium transition-all ${
                isMicOn ? 'bg-neutral-800 hover:bg-neutral-700 text-white' : 'bg-red-500/80 text-white'
              }`}
            >
              {isMicOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </button>

            <button
              onClick={() => setIsVideoOn(!isVideoOn)}
              className={`p-2.5 rounded-full text-xs font-medium transition-all ${
                isVideoOn ? 'bg-neutral-800 hover:bg-neutral-700 text-white' : 'bg-red-500/80 text-white'
              }`}
            >
              {isVideoOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            </button>

            <button
              onClick={() => triggerReaction('🎉')}
              className="p-2.5 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-200"
            >
              <Share2 className="w-4 h-4" />
            </button>

            <button
              onClick={onOpenDemo}
              className="px-4 py-2 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all shadow-md"
            >
              End Session
            </button>
          </div>

        </div>

      </div>
    </div>
  );
}
