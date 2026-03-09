import Link from 'next/link';

const settingsSections = [
  {
    title: 'Lead Types',
    description: 'Configure lead types and their priority for your vertical',
    href: '/settings/lead-types',
  },
  {
    title: 'Scoring Model',
    description: 'Adjust scoring weights, thresholds, and signals',
    href: '/settings/scoring',
  },
  {
    title: 'Outreach Templates',
    description: 'Manage AI outreach message templates by channel',
    href: '/settings/outreach-templates',
  },
  {
    title: 'AI Configuration',
    description: 'Set industry context and classification instructions',
    href: '/settings/ai-config',
  },
  {
    title: 'Automation',
    description: 'Control auto-generation, approval workflows, and scheduling',
    href: '/settings/automation',
  },
  {
    title: 'Team',
    description: 'Manage team members and their roles',
    href: '/settings/team',
  },
  {
    title: 'Billing',
    description: 'View plan details, usage, and manage subscription',
    href: '/settings/billing',
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Settings</h1>
        <p className="text-sm text-text-muted mt-0.5">Configure your lead hunting pipeline</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {settingsSections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="bg-surface-raised border border-border rounded-lg p-5 hover:border-accent/30 hover:bg-surface-overlay transition-colors group"
          >
            <h3 className="text-sm font-medium text-text-primary group-hover:text-accent transition-colors">
              {section.title}
            </h3>
            <p className="text-xs text-text-muted mt-1.5 leading-relaxed">
              {section.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
