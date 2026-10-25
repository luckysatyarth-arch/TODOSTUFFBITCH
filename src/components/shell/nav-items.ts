import {
  Home, CheckSquare, Inbox, Calendar, FolderKanban, Users,
  Search, FileText, BarChart3, Plug, Settings,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  /** Team-only entries are hidden while a personal workspace is active. */
  teamOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/home', label: 'Home', icon: Home },
  { href: '/tasks', label: 'My Tasks', icon: CheckSquare },
  { href: '/inbox', label: 'Inbox / AI Capture', icon: Inbox },
  { href: '/calendar', label: 'Calendar', icon: Calendar },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/team', label: 'Team', icon: Users, teamOnly: true },
  { href: '/search', label: 'AI Search', icon: Search },
  { href: '/notes', label: 'Documents & Notes', icon: FileText },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/settings', label: 'Settings', icon: Settings },
];
