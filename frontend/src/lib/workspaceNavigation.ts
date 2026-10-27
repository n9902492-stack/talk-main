import { BarChart3, CalendarDays, Cloud, FileText, History, LayoutDashboard, ListChecks, Pencil, Play, Radio, Video, type LucideIcon } from 'lucide-react';

type WorkspaceNavigationItem = {
  label: string;
  href: string;
  Icon: LucideIcon;
  visibleInSidebar: boolean;
};

// Menu visibility only: routes, features and data remain available.
// Enable each entry here when its feature is ready for the workspace sidebar.
export const workspaceNavigation: readonly WorkspaceNavigationItem[] = [
  { label: 'Overview', href: '/dashboard', Icon: LayoutDashboard, visibleInSidebar: true },
  { label: 'Bookings', href: '/bookings', Icon: CalendarDays, visibleInSidebar: true },
  { label: 'Meetings', href: '/meetings', Icon: Video, visibleInSidebar: true },
  { label: 'Analytics', href: '/analytics', Icon: BarChart3, visibleInSidebar: true },
  { label: 'Recordings', href: '/recordings', Icon: Play, visibleInSidebar: true },
  { label: 'Whiteboard', href: '/whiteboard', Icon: Pencil, visibleInSidebar: true },
  { label: 'Meeting History', href: '/meeting-history', Icon: History, visibleInSidebar: true },
  { label: 'Webinars', href: '/webinars', Icon: Radio, visibleInSidebar: false },
  { label: 'Agendas', href: '/meeting', Icon: ListChecks, visibleInSidebar: false },
  { label: 'Transcripts', href: '/meeting?panel=transcript', Icon: FileText, visibleInSidebar: false },
  { label: 'Cloud storage', href: '/dashboard#library', Icon: Cloud, visibleInSidebar: false },
];
