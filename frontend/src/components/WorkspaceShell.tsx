import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowLeft,ArrowRight,CircleCheck,LogOut,Menu,PanelLeftClose,PanelLeftOpen,X} from 'lucide-react';
import AvatarPicker from './AvatarPicker';
import {useAuth} from '../lib/auth';
import {workspaceNavigation} from '../lib/workspaceNavigation';
export default function WorkspaceShell({children,path}:{children:ReactNode;path:string}) {
 useEffect(()=>{document.body.classList.add('talk-application');},[]);
 const {user,signOut}=useAuth(),name=user?.name||'',email=user?.email||user?.phoneNumber||'';
 const isGoogle=user?.provider==='google',isPhone=user?.provider==='phone';
 const [mobileOpen,setMobileOpen]=useState(false),[accountOpen,setAccountOpen]=useState(false),[signingOut,setSigningOut]=useState(false),[accountError,setAccountError]=useState('');
 const [sidebarCollapsed,setSidebarCollapsed]=useState(()=>{try{return localStorage.getItem('talk-workspace-sidebar-collapsed')==='true';}catch{return false;}});
 const profileDialog=useRef<HTMLDialogElement>(null),sidebar=useRef<HTMLElement>(null),menuButton=useRef<HTMLButtonElement>(null),account=useRef<HTMLDivElement>(null);
 const visuallyCollapsed=sidebarCollapsed&&!mobileOpen;
 const closeMobile=()=>{setMobileOpen(false);menuButton.current?.focus();};
 const toggleSidebar=()=>{if(window.matchMedia('(max-width: 767px)').matches){closeMobile();return;}setAccountOpen(false);setSidebarCollapsed(previous=>{const next=!previous;try{localStorage.setItem('talk-workspace-sidebar-collapsed',String(next));}catch{}return next;});};
 const leaveWorkspace=async()=>{setSigningOut(true);setAccountError('');try{await signOut();}catch{setAccountError('Could not sign out. Please try again.');setAccountOpen(true);}finally{setSigningOut(false);}};
 const exitLabel=signingOut?'Signing out\u2026':'Sign out';
 useEffect(()=>{setMobileOpen(false);setAccountOpen(false);},[path]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!account.current?.contains(event.target as Node)) setAccountOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setAccountOpen(false); if (account.current?.contains(document.activeElement)) account.current.querySelector<HTMLButtonElement>('.dashboard-account-button')?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const changed = () => { if (!media.matches) setMobileOpen(false); };
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileOpen(false); menuButton.current?.focus(); }
      if (event.key !== 'Tab') return;
      const items = Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a[href], button') || []).filter(element => element.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keyboard); };
  }, [mobileOpen]);

  return <div className={`dashboard-app workspace-reference has-workspace-sidebar${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}><dialog ref={profileDialog} className="talk-profile-modal" aria-labelledby="talk-profile-heading" onClick={event => { if (event.target === event.currentTarget) profileDialog.current?.close(); }}><header><h2 id="talk-profile-heading">Profile settings</h2><button aria-label="Close profile settings" onClick={() => profileDialog.current?.close()}><X size={20} /></button></header><AvatarPicker /></dialog>
    {mobileOpen && <button className="dashboard-scrim" aria-label="Close workspace navigation" onClick={closeMobile} />}
    <aside ref={sidebar} id="workspace-navigation" className={`dashboard-sidebar ${mobileOpen ? 'is-open' : ''}`}>
      <div className="dashboard-sidebar-brand"><a href="/dashboard" aria-label="Talk overview"><span className="sidebar-brand-full">Talk</span><span className="sidebar-brand-short" aria-hidden="true">T</span></a><button className="dashboard-mobile-close" aria-label="Close navigation" onClick={closeMobile}><X size={20} /></button></div>
      <div className="dashboard-workspace-account" ref={account}><button className="dashboard-workspace dashboard-account-button" aria-label="Open account menu" aria-expanded={accountOpen} onClick={() => { if (sidebarCollapsed && !window.matchMedia('(max-width: 767px)').matches) toggleSidebar(); else setAccountOpen(!accountOpen); }}><span aria-hidden="true">T</span><div><strong>My workspace</strong><small><CircleCheck size={15}/>{isPhone ? 'Verified phone' : 'Verified email'}</small></div></button>{accountOpen && <div className="dashboard-account-menu"><strong>{name || 'Your workspace'}</strong><p>{email}</p><button className="dashboard-account-link" onClick={() => { setAccountOpen(false); setMobileOpen(false); profileDialog.current?.showModal(); }}>Profile settings</button><a className="dashboard-account-link" href="/choose-account">Switch account<ArrowRight size={14} /></a>{isGoogle && !user?.hasPassword && <a className="dashboard-account-link" href="/sign-up?mode=link">Add email sign-in<ArrowRight size={14} /></a>}{!user?.hasPhone && <a className="dashboard-account-link" href="/phone-sign-in?mode=link">Add phone sign-in<ArrowRight size={14} /></a>}{accountError && <p role="alert" className="dashboard-account-error">{accountError}</p>}<a className="dashboard-account-link" href="/"><ArrowLeft size={14}/>Back to website</a><button disabled={signingOut} onClick={() => void leaveWorkspace()}><LogOut size={15} />{exitLabel}</button></div>}</div>
      <p className="dashboard-nav-label">WORKSPACE</p>
      <nav aria-label="Workspace navigation">{workspaceNavigation.filter(item => item.visibleInSidebar).map(({ label, href, Icon }) => <a key={label} href={href} aria-label={label} title={sidebarCollapsed ? label : undefined} className={href === (path.startsWith('/meeting-history') ? '/meeting-history' : path) ? 'is-active' : ''} aria-current={href === (path.startsWith('/meeting-history') ? '/meeting-history' : path) ? 'page' : undefined} onClick={() => setMobileOpen(false)}><Icon size={18} /><span>{label}</span></a>)}</nav>
      <div className="dashboard-sidebar-bottom"><button className="dashboard-collapse-button" onClick={toggleSidebar} aria-label={visuallyCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!visuallyCollapsed} aria-controls="workspace-navigation" title={visuallyCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{visuallyCollapsed ? <PanelLeftOpen size={20}/> : <PanelLeftClose size={20}/>}<span>{visuallyCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span></button></div>
    </aside>

    <div className="dashboard-main">
      <div className="dashboard-mobile-navigation"><button ref={menuButton} className="dashboard-menu-button" aria-label="Open navigation" aria-controls="workspace-navigation" aria-expanded={mobileOpen} onClick={() => { setAccountOpen(false); setMobileOpen(true); }}><Menu size={21}/><span>Workspace</span></button></div>

{children}</div></div>;
}
