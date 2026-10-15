import { Globe, Twitter, Linkedin, Youtube, Github } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-white border-t border-[#efeded] text-[#5f5e5e] text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        
        {/* Main 5 Columns Grid */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-8 mb-12">
          
          {/* Brand Col */}
          <div className="col-span-2 space-y-4">
            <div className="flex items-center gap-2">
              <span className="font-display font-black text-2xl tracking-tight text-[#1b1c1c]">
                talk
              </span>
              <span className="bg-[#FFF0BD] text-[#795900] text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#d4a017]/30">
                HQ
              </span>
            </div>
            <p className="text-xs text-[#5f5e5e] max-w-xs leading-relaxed">
              Next-generation studio platform for collaborative meetings, webinars, and immersive interactive workshops.
            </p>
            <div className="flex items-center gap-3 pt-2 text-[#817662]">
              <a href="#" className="w-8 h-8 rounded-lg bg-[#fbf9f8] hover:bg-[#FFF0BD] hover:text-[#795900] flex items-center justify-center transition-colors">
                <Globe className="w-4 h-4" />
              </a>
              <a href="#" className="w-8 h-8 rounded-lg bg-[#fbf9f8] hover:bg-[#FFF0BD] hover:text-[#795900] flex items-center justify-center transition-colors">
                <Twitter className="w-4 h-4" />
              </a>
              <a href="#" className="w-8 h-8 rounded-lg bg-[#fbf9f8] hover:bg-[#FFF0BD] hover:text-[#795900] flex items-center justify-center transition-colors">
                <Linkedin className="w-4 h-4" />
              </a>
              <a href="#" className="w-8 h-8 rounded-lg bg-[#fbf9f8] hover:bg-[#FFF0BD] hover:text-[#795900] flex items-center justify-center transition-colors">
                <Youtube className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Product Links */}
          <div className="space-y-3">
            <h5 className="font-bold text-sm text-[#1b1c1c] tracking-tight">Product</h5>
            <ul className="space-y-2">
              <li><a href="#interactivity" className="hover:text-[#795900] transition-colors">Video Meetings</a></li>
              <li><a href="#ideal-for" className="hover:text-[#795900] transition-colors">Webinars Studio</a></li>
              <li><a href="#interactivity" className="hover:text-[#795900] transition-colors">Interactive Agendas</a></li>
              <li><a href="#pricing" className="hover:text-[#795900] transition-colors">Pricing Plans</a></li>
              <li><a href="#integrations" className="hover:text-[#795900] transition-colors">Integrations Ecosystem</a></li>
            </ul>
          </div>

          {/* Solutions Links */}
          <div className="space-y-3">
            <h5 className="font-bold text-sm text-[#1b1c1c] tracking-tight">Solutions</h5>
            <ul className="space-y-2">
              <li><a href="#ideal-for" className="hover:text-[#795900] transition-colors">Sales Demos & Pitches</a></li>
              <li><a href="#ideal-for" className="hover:text-[#795900] transition-colors">Customer Workshops</a></li>
              <li><a href="#ideal-for" className="hover:text-[#795900] transition-colors">Virtual Events</a></li>
              <li><a href="#community" className="hover:text-[#795900] transition-colors">Affiliate & Referrals</a></li>
              <li><a href="#security" className="hover:text-[#795900] transition-colors">Enterprise Solutions</a></li>
            </ul>
          </div>

          {/* Resources Links */}
          <div className="space-y-3">
            <h5 className="font-bold text-sm text-[#1b1c1c] tracking-tight">Resources</h5>
            <ul className="space-y-2">
              <li><a href="#" className="hover:text-[#795900] transition-colors">Guides & Playbooks</a></li>
              <li><a href="#" className="hover:text-[#795900] transition-colors">Product Changelog</a></li>
              <li><a href="#" className="hover:text-[#795900] transition-colors">System Status</a></li>
              <li><a href="#integrations" className="hover:text-[#795900] transition-colors">API & Developer Hub</a></li>
              <li><a href="#" className="hover:text-[#795900] transition-colors">Help Center</a></li>
            </ul>
          </div>

          {/* Company Links */}
          <div className="space-y-3">
            <h5 className="font-bold text-sm text-[#1b1c1c] tracking-tight">Company</h5>
            <ul className="space-y-2">
              <li><a href="#" className="hover:text-[#795900] transition-colors">About Talk</a></li>
              <li><a href="#" className="hover:text-[#795900] transition-colors">Careers</a></li>
              <li><a href="#security" className="hover:text-[#795900] transition-colors">Privacy Policy</a></li>
              <li><a href="#" className="hover:text-[#795900] transition-colors">Terms of Service</a></li>
              <li><a href="#" className="hover:text-[#795900] transition-colors">Contact Us</a></li>
            </ul>
          </div>

        </div>

        {/* Bottom Legal Bar */}
        <div className="pt-8 border-t border-[#efeded] flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-[#817662]">
          <div>
            © 2026 Talk Inc. All rights reserved. Precision-engineered for live engagement.
          </div>
          <div className="flex items-center gap-6">
            <a href="#security" className="hover:text-[#1b1c1c] transition-colors">Privacy</a>
            <a href="#security" className="hover:text-[#1b1c1c] transition-colors">Security & Compliance</a>
            <a href="#" className="hover:text-[#1b1c1c] transition-colors">Cookie Settings</a>
          </div>
        </div>

      </div>
    </footer>
  );
}
