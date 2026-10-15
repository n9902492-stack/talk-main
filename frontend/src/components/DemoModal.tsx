import { useState } from 'react';
import { X, Calendar, Clock, CheckCircle2, Video } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface DemoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DemoModal({ isOpen, onClose }: DemoModalProps) {
  const [step, setStep] = useState<'schedule' | 'details' | 'success'>('schedule');
  const [selectedSlot, setSelectedSlot] = useState('10:00 AM - 10:30 AM');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-[#e4e2e2] overflow-hidden z-10"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#efeded] bg-[#FFF0BD]/40">
            <div className="flex items-center gap-2">
              <span className="font-display font-black text-xl text-[#1b1c1c]">talk</span>
              <span className="text-xs font-semibold text-[#795900] bg-white px-2 py-0.5 rounded-full border border-[#d4a017]/30">
                VIP Live Demo
              </span>
            </div>
            <button 
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white hover:bg-black/5 flex items-center justify-center text-[#5f5e5e] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-6">
            {step === 'schedule' && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-display font-bold text-xl text-[#1b1c1c]">
                    Schedule your 1-on-1 Talk Tour
                  </h3>
                  <p className="text-xs text-[#5f5e5e] mt-1">
                    See how Talk runs interactive workshops, embeds Figma/Miro live, and boosts webinar conversions.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#1b1c1c]">Choose a convenient time slot:</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      '09:30 AM - 10:00 AM',
                      '10:00 AM - 10:30 AM',
                      '01:15 PM - 01:45 PM',
                      '03:30 PM - 04:00 PM'
                    ].map(slot => (
                      <button
                        key={slot}
                        onClick={() => setSelectedSlot(slot)}
                        className={`p-2.5 rounded-xl text-xs font-semibold border transition-all text-left ${
                          selectedSlot === slot
                            ? 'bg-[#FFF0BD] border-[#d4a017] text-[#795900]'
                            : 'bg-[#fbf9f8] border-[#efeded] text-[#1b1c1c] hover:bg-neutral-100'
                        }`}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => setStep('details')}
                  className="w-full mt-4 py-3 rounded-xl bg-[#171717] hover:bg-black text-white text-xs sm:text-sm font-bold shadow-md transition-all cursor-pointer"
                >
                  Continue to Contact Details →
                </button>
              </div>
            )}

            {step === 'details' && (
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name && email) setStep('success');
                }}
                className="space-y-4"
              >
                <div>
                  <h3 className="font-display font-bold text-xl text-[#1b1c1c]">
                    Where should we send your invite?
                  </h3>
                  <p className="text-xs text-[#5f5e5e] mt-1">
                    Selected time: <strong className="text-[#1b1c1c]">{selectedSlot} (Tomorrow)</strong>
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold text-[#1b1c1c] block mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Jane Doe"
                      className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-[#e4e2e2] bg-[#fbf9f8] focus:bg-white focus:border-[#d4a017] outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[#1b1c1c] block mb-1">Work Email</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="jane@company.com"
                      className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-[#e4e2e2] bg-[#fbf9f8] focus:bg-white focus:border-[#d4a017] outline-hidden"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setStep('schedule')}
                    className="px-4 py-2.5 rounded-xl border border-[#e4e2e2] text-xs font-semibold text-[#5f5e5e] hover:bg-neutral-50"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-[#d4a017] hover:bg-[#f6be39] text-black text-xs font-bold shadow-sm transition-all"
                  >
                    Confirm My Demo Booking
                  </button>
                </div>
              </form>
            )}

            {step === 'success' && (
              <div className="text-center py-4 space-y-4">
                <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h3 className="font-display font-bold text-2xl text-[#1b1c1c]">
                  You're Booked!
                </h3>
                <p className="text-xs sm:text-sm text-[#5f5e5e] max-w-sm mx-auto">
                  A calendar invite and private Talk room link have been sent to <strong>{email}</strong>.
                </p>

                <div className="p-3 rounded-xl bg-[#fbf9f8] border border-[#efeded] text-xs text-left max-w-sm mx-auto space-y-1">
                  <div className="font-semibold text-[#1b1c1c]">Session Details:</div>
                  <div className="text-[#5f5e5e]">Host: Talk Product Lead</div>
                  <div className="text-[#5f5e5e]">Time: {selectedSlot}</div>
                  <div className="text-[#795900] font-mono text-[11px] truncate">
                    Room: https://meet.talk.us/demo-{Math.floor(1000 + Math.random() * 9000)}
                  </div>
                </div>

                <button
                  onClick={onClose}
                  className="w-full py-2.5 rounded-xl bg-[#171717] text-white text-xs font-bold hover:bg-black transition-all"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
