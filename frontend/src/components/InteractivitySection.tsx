import { useState } from 'react';
import { 
  Check, 
  MousePointer, 
  PenTool, 
  StickyNote, 
  Square, 
  Sparkles, 
  Users, 
  Maximize2,
  Play
} from 'lucide-react';
import { motion } from 'motion/react';

export default function InteractivitySection() {
  const [activeTool, setActiveTool] = useState<'pointer' | 'pen' | 'note' | 'shape'>('pointer');
  const [notes, setNotes] = useState([
    { id: 1, text: 'Brainstorm: Q4 Strategy', color: 'bg-amber-100 border-amber-300 text-amber-900', x: 20, y: 30 },
    { id: 2, text: 'Live Q&A Poll on screen', color: 'bg-emerald-100 border-emerald-300 text-emerald-900', x: 55, y: 50 }
  ]);

  const addNote = () => {
    const newNote = {
      id: Date.now(),
      text: 'Interactive participant note ✨',
      color: 'bg-blue-100 border-blue-300 text-blue-900',
      x: 35 + Math.random() * 20,
      y: 35 + Math.random() * 20
    };
    setNotes([...notes, newNote]);
  };

  return (
    <section id="interactivity" className="py-20 md:py-28 bg-[#fbf9f8] border-y border-[#efeded]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Column: Feature Narrative */}
          <div className="lg:col-span-5 space-y-6">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-[#795900]">
                Interactivity
              </span>
              <h2 className="font-display font-extrabold text-3xl sm:text-4xl lg:text-[42px] leading-tight text-[#1b1c1c] tracking-tight mt-2">
                Bring your meetings and webinars to life
              </h2>
              <p className="mt-3 text-base text-[#5f5e5e] leading-relaxed">
                Capture people's attention and keep it. Turn passive listeners into active collaborators.
              </p>
            </div>

            {/* Checklist with Golden Checks */}
            <div className="space-y-3.5 pt-2">
              {[
                'Stay on track with an interactive agenda that automatically loads your presentations.',
                'Add Google docs, videos, slideshows, whiteboards, polls, breakout rooms, and work together live.',
                'Create your own unique tool. Give participants control of the mouse and keyboard and let them try it out.',
                'The original meeting link leads to a full recap of the session: recording, slides, transcripts and more.',
                'Feature your special offers on screen during coaching sessions, workshops and webinars.'
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

          {/* Right Column: Live Interactive Whiteboard Stage */}
          <div className="lg:col-span-7">
            <div className="rounded-3xl bg-white border border-[#e4e2e2] shadow-xl overflow-hidden">
              
              {/* Stage Top Bar */}
              <div className="flex items-center justify-between px-4 py-3 bg-[#fbf9f8] border-b border-[#efeded] text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="font-bold text-[#1b1c1c]">Interactive Canvas</span>
                  <span className="text-[#817662]">• Figma & Miro Live Bridge</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-[#5f5e5e] text-[11px] font-mono">
                    Audience (24)
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-[#FFF0BD] text-[#795900] text-[11px] font-bold">
                    Presenter Mode
                  </span>
                </div>
              </div>

              {/* Whiteboard Workspace with Sidebar Tools */}
              <div className="relative h-[360px] sm:h-[420px] bg-[#faf8f6] p-4 flex">
                
                {/* Floating Toolbar on Left */}
                <div className="w-10 rounded-xl bg-white shadow-md border border-[#e4e2e2] p-1.5 flex flex-col gap-2 z-20 self-start">
                  <button
                    onClick={() => setActiveTool('pointer')}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                      activeTool === 'pointer' ? 'bg-[#171717] text-white' : 'text-[#5f5e5e] hover:bg-neutral-100'
                    }`}
                    title="Pointer"
                  >
                    <MousePointer className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setActiveTool('pen')}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                      activeTool === 'pen' ? 'bg-[#171717] text-white' : 'text-[#5f5e5e] hover:bg-neutral-100'
                    }`}
                    title="Pencil / Draw"
                  >
                    <PenTool className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={addNote}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                      activeTool === 'note' ? 'bg-[#171717] text-white' : 'text-[#5f5e5e] hover:bg-neutral-100'
                    }`}
                    title="Add Sticky Note"
                  >
                    <StickyNote className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setActiveTool('shape')}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                      activeTool === 'shape' ? 'bg-[#171717] text-white' : 'text-[#5f5e5e] hover:bg-neutral-100'
                    }`}
                    title="Add Shape"
                  >
                    <Square className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Canvas Area with Collaborative Elements */}
                <div className="flex-1 relative ml-3">
                  
                  {/* Sticky Notes */}
                  {notes.map((n) => (
                    <motion.div
                      key={n.id}
                      drag
                      dragConstraints={{ left: 0, right: 280, top: 0, bottom: 200 }}
                      style={{ left: `${n.x}%`, top: `${n.y}%` }}
                      className={`absolute p-3 rounded-xl border shadow-sm cursor-grab active:cursor-grabbing text-xs font-semibold max-w-[170px] ${n.color}`}
                    >
                      <div className="text-[10px] opacity-60 mb-0.5">Note #0{n.id % 10}</div>
                      {n.text}
                    </motion.div>
                  ))}

                  {/* Collaborative Cursors */}
                  <motion.div
                    animate={{ x: [0, 50, -20, 0], y: [0, -30, 25, 0] }}
                    transition={{ repeat: Infinity, duration: 6, ease: 'easeInOut' }}
                    className="absolute top-10 left-24 flex items-center gap-1 z-30 pointer-events-none"
                  >
                    <span className="text-amber-500 text-sm">↖</span>
                    <span className="bg-[#d4a017] text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-xs">
                      Mateo Vance
                    </span>
                  </motion.div>

                  <motion.div
                    animate={{ x: [0, -40, 15, 0], y: [0, 30, -10, 0] }}
                    transition={{ repeat: Infinity, duration: 8, ease: 'easeInOut' }}
                    className="absolute bottom-16 right-36 flex items-center gap-1 z-30 pointer-events-none"
                  >
                    <span className="text-emerald-500 text-sm">↖</span>
                    <span className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-xs">
                      Lin Chen
                    </span>
                  </motion.div>

                  {/* Picture-in-picture Presenter Video Tile in Corner */}
                  <div className="absolute bottom-3 right-3 w-40 rounded-xl overflow-hidden shadow-lg border-2 border-white bg-neutral-900 z-30">
                    <div className="aspect-4/3 relative">
                      <img
                        src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=300&q=80"
                        alt="You (Speaking)"
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                      <div className="absolute bottom-1.5 left-2 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[10px] font-bold text-white">You (Speaking)</span>
                      </div>
                    </div>
                  </div>

                </div>

              </div>

            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
