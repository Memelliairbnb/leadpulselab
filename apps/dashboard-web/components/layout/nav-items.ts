export interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: string;
}

export const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/overview', icon: 'grid' },
  { label: 'Opportunities', href: '/leads', icon: 'users' },
  { label: 'Discovery', href: '/discovery', icon: 'search' },
  { label: 'Campaigns', href: '/campaigns', icon: 'send' },
  { label: 'Inbox', href: '/inbox', icon: 'inbox' },
  { label: 'Pipelines', href: '/pipelines', icon: 'columns' },
  { label: 'Keywords', href: '/keywords', icon: 'hash' },
  { label: 'Sources', href: '/sources', icon: 'radio' },
  { label: 'Inventory', href: '/inventory', icon: 'package' },
  { label: 'Analytics', href: '/analytics', icon: 'bar-chart' },
  { label: 'Settings', href: '/settings', icon: 'settings' },
];
