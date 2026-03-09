export interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: string;
}

export const navItems: NavItem[] = [
  { label: 'Overview', href: '/', icon: 'grid' },
  { label: 'Leads', href: '/leads', icon: 'users' },
  { label: 'Outreach', href: '/outreach', icon: 'send' },
  { label: 'Keywords', href: '/keywords', icon: 'hash' },
  { label: 'Sources', href: '/sources', icon: 'radio' },
  { label: 'Scans', href: '/scans', icon: 'search' },
  { label: 'Jobs', href: '/jobs', icon: 'activity' },
  { label: 'Analytics', href: '/analytics', icon: 'bar-chart' },
  { label: 'Settings', href: '/settings', icon: 'settings' },
];
