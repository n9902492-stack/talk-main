/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import Navbar from './components/Navbar';
import HeroSection from './components/HeroSection';
import TrustSection from './components/TrustSection';
import IdealForSection from './components/IdealForSection';
import InteractivitySection from './components/InteractivitySection';
import WorkspacesSection from './components/WorkspacesSection';
import IntegrationsSection from './components/IntegrationsSection';
import SecuritySection from './components/SecuritySection';
import WallOfLoveSection from './components/WallOfLoveSection';
import CommunitySection from './components/CommunitySection';
import PreFooterCTA from './components/PreFooterCTA';
import Footer from './components/Footer';
import DemoModal from './components/DemoModal';
import WebinarRegisterModal from './components/WebinarRegisterModal';

export default function App() {
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [isWebinarModalOpen, setIsWebinarModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white text-[#1b1c1c] flex flex-col font-sans selection:bg-[#FFF0BD] selection:text-[#795900]">
      {/* Navigation Bar */}
      <Navbar 
        onOpenDemo={() => setIsDemoModalOpen(true)}
        onOpenSignup={() => setIsDemoModalOpen(true)}
      />

      {/* Main Page Flow */}
      <main className="flex-1">
        {/* 1. Hero Section (Warm Pastel Yellow #FFF0BD) with Interactive Product Stage */}
        <HeroSection 
          onOpenDemo={() => setIsDemoModalOpen(true)}
          onOpenSignup={() => setIsDemoModalOpen(true)}
        />

        {/* 2. Investors & Trust Accolades */}
        <TrustSection />

        {/* 3. Talk is Ideal For */}
        <IdealForSection 
          onOpenDemo={() => setIsDemoModalOpen(true)}
          onOpenWebinarModal={() => setIsWebinarModalOpen(true)}
        />

        {/* 4. Interactivity: Bring Meetings & Webinars to Life */}
        <InteractivitySection />

        {/* 5. Workspaces: Maximise Engagement & Efficiency */}
        <WorkspacesSection />

        {/* 6. Integrations: Connect Talk with Other Systems */}
        <IntegrationsSection />

        {/* 7. Privacy & Security */}
        <SecuritySection />

        {/* 8. Wall of Love: Community Voice */}
        <WallOfLoveSection />

        {/* 9. Community: Let's Build the World's Best Platform Together */}
        <CommunitySection />

        {/* 10. Pre-Footer Call to Action */}
        <PreFooterCTA 
          onSuccessSignup={(email) => {
            console.log('User signed up for Talk:', email);
          }}
        />
      </main>

      {/* Footer */}
      <Footer />

      {/* Interactive Modals */}
      <DemoModal 
        isOpen={isDemoModalOpen}
        onClose={() => setIsDemoModalOpen(false)}
      />

      <WebinarRegisterModal 
        isOpen={isWebinarModalOpen}
        onClose={() => setIsWebinarModalOpen(false)}
      />
    </div>
  );
}
