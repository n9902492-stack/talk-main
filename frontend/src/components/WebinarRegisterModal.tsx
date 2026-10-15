import { useState } from 'react';
import { X, CheckCircle2, Radio, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface WebinarRegisterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WebinarRegisterModal({ isOpen, onClose }: WebinarRegisterModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [agreed, setAgreed] = useState(true);
  const [submitted, setSubmitted] = useState(false);

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
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#efeded] bg-emerald-50">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-display font-bold text-sm text-emerald-950">
                Webinar Broadcast Registration
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
            {!submitted ? (
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  if (firstName && email) setSubmitted(true);
                }}
                className="space-y-4"
              >
                <div>
                  <h3 className="font-display font-bold text-2xl text-[#1b1c1c]">
                    Let's get you registered!
                  </h3>
                  <p className="text-xs text-[#5f5e5e] mt-1">
                    Please fill in your details below and get ready to learn how top teams scale webinars with Talk.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-[#1b1c1c] block mb-1">First Name *</label>
                    <input
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Jane"
                      className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-[#e4e2e2] bg-[#fbf9f8] focus:bg-white focus:border-[#d4a017] outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[#1b1c1c] block mb-1">Last Name *</label>
                    <input
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Doe"
                      className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-[#e4e2e2] bg-[#fbf9f8] focus:bg-white focus:border-[#d4a017] outline-hidden"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-[#1b1c1c] block mb-1">Work Email *</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="janedoe@email.com"
                    className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-[#e4e2e2] bg-[#fbf9f8] focus:bg-white focus:border-[#d4a017] outline-hidden"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-[#5f5e5e] cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="rounded text-[#d4a017] focus:ring-[#d4a017]"
                  />
                  <span>I understand that this webinar will be recorded.</span>
                </label>

                <button
                  type="submit"
                  className="w-full mt-4 py-3 rounded-xl bg-[#d4a017] hover:bg-[#f6be39] text-black text-xs sm:text-sm font-bold shadow-md transition-all cursor-pointer"
                >
                  Register now
                </button>
              </form>
            ) : (
              <div className="text-center py-6 space-y-4">
                <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto text-2xl">
                  👍
                </div>
                <h3 className="font-display font-bold text-2xl text-[#1b1c1c]">
                  See you at the event!
                </h3>
                <p className="text-xs sm:text-sm text-[#5f5e5e] max-w-sm mx-auto">
                  We've just sent you a confirmation email with calendar attachments and access credentials for <strong>{email}</strong>.
                </p>

                <div className="p-3 rounded-xl bg-[#fbf9f8] border border-[#efeded] text-xs text-left max-w-sm mx-auto">
                  <div className="text-[#1b1c1c] font-bold">Event: Scaling to $1M in Digital Workshops</div>
                  <div className="text-[#795900]">Live broadcast with Talk interactive stage</div>
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
