import {useId,useState} from 'react';
import {Pause,Play} from 'lucide-react';
import '../styles/dashboard-orbital-art.css';

export default function DashboardOrbitalArt(){
 const [paused,setPaused]=useState(false),illustrationId=useId();
 return <div className="dashboard-welcome-art dashboard-orbital-art" data-paused={paused}>
  <div id={illustrationId} className="orbital-illustration" aria-hidden="true">
   <svg viewBox="0 0 340 176" fill="none" focusable="false">
    <g className="orbital-sway orbital-animated">
     <circle className="orbital-hub-ring" cx="175" cy="88" r="46" stroke="#FDE68A" strokeOpacity="0.5" strokeWidth="1.1"/>
     <circle className="orbital-hub-fill" cx="175" cy="88" r="35" stroke="#FFFFFF" strokeOpacity="0.45" strokeWidth="1.2"/>
     {[34,42,50].map((radius,index)=><circle key={radius} className={`orbital-ripple orbital-ripple-${index+1} orbital-animated`} cx="175" cy="88" r={radius} stroke="#FFFFFF" strokeWidth="1"/>)}
     <ellipse className="orbital-path orbital-path-one" cx="175" cy="88" rx="132" ry="52" transform="rotate(-8 175 88)" stroke="#FDE68A" strokeOpacity="0.55" strokeWidth="1.15"/>
     <ellipse className="orbital-path orbital-path-two" cx="175" cy="88" rx="124" ry="48" transform="rotate(11 175 88)" stroke="#FDE68A" strokeOpacity="0.45" strokeWidth="1.15"/>
     <ellipse className="orbital-path orbital-path-three" cx="175" cy="88" rx="95" ry="62" transform="rotate(-3 175 88)" stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="1"/>
     <ellipse className="orbital-flow orbital-flow-gold orbital-animated" cx="175" cy="88" rx="132" ry="52" transform="rotate(-8 175 88)" stroke="#FFF2B2" strokeWidth="1.6" strokeLinecap="round"/>
     <ellipse className="orbital-flow orbital-flow-white orbital-animated" cx="175" cy="88" rx="124" ry="48" transform="rotate(11 175 88)" stroke="#FFFFFF" strokeWidth="1.3" strokeLinecap="round"/>
     <g className="orbital-beams" stroke="#FFE082" strokeWidth="1.4" strokeLinecap="round">
      <line className="orbital-beam-one" x1="175" y1="88" x2="46" y2="80"/>
      <line className="orbital-beam-two" x1="175" y1="88" x2="282" y2="38"/>
      <line className="orbital-beam-three" x1="175" y1="88" x2="292" y2="138"/>
     </g>
    </g>
   </svg>
   <img src="/assets/light-reference/workspace-1.jpg" alt="" className="dashboard-art-person person-one orbital-animated"/>
   <img src="/assets/light-reference/workspace-2.jpg" alt="" className="dashboard-art-person person-two orbital-animated"/>
   <img src="/assets/light-reference/workspace-3.jpg" alt="" className="dashboard-art-person person-three orbital-animated"/>
   <div className="dashboard-art-logo">Talk</div>
  </div>
  <button type="button" className="orbital-motion-toggle" aria-controls={illustrationId} aria-label={paused?'Play banner animation':'Pause banner animation'} title={paused?'Play animation':'Pause animation'} onClick={()=>setPaused(value=>!value)}>{paused?<Play size={14} aria-hidden="true"/>:<Pause size={14} aria-hidden="true"/>}</button>
 </div>;
}
