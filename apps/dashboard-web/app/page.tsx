'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect } from 'react';

const industries = [
  'Credit Repair',
  'Real Estate',
  'Roofing',
  'Marketing Agencies',
  'Law Firms',
  'Insurance',
  'Coaching',
  'Local Services',
  'SaaS',
  'Recruiting',
  'Home Services',
  'Financial Services',
];

const features = [
  { title: 'Continuous Lead Discovery', desc: 'Always-on scanning finds leads while you sleep.' },
  { title: 'AI Lead Qualification & Scoring', desc: 'Every lead scored and ranked by buying intent.' },
  { title: 'Multi-Source Intelligence', desc: 'Google, Reddit, forums, social media, and more.' },
  { title: 'Duplicate Scrubbing & Canonical Identity', desc: 'One profile per person, no matter how many sources.' },
  { title: 'AI Outreach Draft Generation', desc: 'Personalized messages drafted and ready for review.' },
  { title: 'Lead Inventory Management', desc: 'Organize, tag, and manage your entire lead database.' },
  { title: 'Campaign Pipeline Tracking', desc: 'Track every lead from discovery to closed deal.' },
  { title: 'Conversation Inbox', desc: 'Manage all outreach and replies in one place.' },
  { title: 'Custom Keyword Targeting', desc: 'Define exactly what signals matter to your business.' },
  { title: 'Industry-Specific Templates', desc: 'Pre-built configurations for your vertical.' },
  { title: 'Full Analytics Dashboard', desc: 'Insights into discovery rate, conversion, and ROI.' },
  { title: 'Multi-Tenant SaaS Ready', desc: 'Built for teams and agencies from day one.' },
];

const plans = [
  {
    name: 'Starter',
    price: '$97',
    period: '/mo',
    leads: '500 leads/mo',
    sources: '3 sources',
    users: '2 users',
    highlight: false,
  },
  {
    name: 'Growth',
    price: '$297',
    period: '/mo',
    leads: '2,000 leads/mo',
    sources: '8 sources',
    users: '5 users',
    highlight: true,
  },
  {
    name: 'Pro',
    price: '$597',
    period: '/mo',
    leads: '10,000 leads/mo',
    sources: 'Unlimited sources',
    users: '15 users',
    highlight: false,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    leads: 'Unlimited leads',
    sources: 'Unlimited sources',
    users: 'Unlimited users',
    highlight: false,
  },
];

function smoothScroll(id: string) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth' });
  }
}

export default function HomePage() {
  useEffect(() => {
    // Enable smooth scrolling for the whole page
    document.documentElement.style.scrollBehavior = 'smooth';
    return () => {
      document.documentElement.style.scrollBehavior = '';
    };
  }, []);

  return (
    <div className="min-h-screen bg-surface text-text-primary">
      {/* ── Navigation ── */}
      <nav className="fixed top-0 z-50 w-full border-b border-border bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <span className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Image src="/logo.png" alt="LeadPulseLab" width={32} height={32} />
            Lead<span className="text-accent">Pulse</span>Lab
          </span>
          <div className="hidden items-center gap-8 md:flex">
            <button
              onClick={() => smoothScroll('how-it-works')}
              className="text-sm text-text-secondary transition-colors hover:text-text-primary"
            >
              How It Works
            </button>
            <button
              onClick={() => smoothScroll('features')}
              className="text-sm text-text-secondary transition-colors hover:text-text-primary"
            >
              Features
            </button>
            <button
              onClick={() => smoothScroll('pricing')}
              className="text-sm text-text-secondary transition-colors hover:text-text-primary"
            >
              Pricing
            </button>
            <Link
              href="/login"
              className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Sign In
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative flex min-h-screen items-center justify-center overflow-hidden pt-20">
        {/* Gradient orbs */}
        <div className="pointer-events-none absolute -top-40 left-1/4 h-[600px] w-[600px] rounded-full bg-accent/10 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-40 right-1/4 h-[400px] w-[400px] rounded-full bg-accent/5 blur-[100px]" />

        <div className="relative z-10 mx-auto max-w-4xl px-6 text-center">
          <div className="mb-6 inline-block rounded-full border border-border bg-surface-raised px-4 py-1.5 text-xs font-medium text-text-secondary">
            AI-Powered Lead Discovery Platform
          </div>
          <h1 className="mb-6 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
            Discover Leads Before
            <br />
            <span className="text-accent">Your Competitors Do</span>
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-text-secondary sm:text-xl">
            LeadPulseLab uses AI to continuously find buying signals across the internet, qualify
            leads automatically, and help you close more deals.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/login"
              className="rounded-lg bg-accent px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-accent/25 transition-all hover:bg-accent-hover hover:shadow-accent/40"
            >
              Start Finding Leads
            </Link>
            <button
              onClick={() => smoothScroll('how-it-works')}
              className="rounded-lg border border-border px-8 py-3.5 text-base font-semibold text-text-secondary transition-colors hover:border-text-muted hover:text-text-primary"
            >
              See How It Works
            </button>
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" className="border-t border-border-subtle py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">How It Works</h2>
            <p className="text-lg text-text-secondary">Three steps from zero to qualified pipeline.</p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {/* Step 1 */}
            <div className="rounded-xl border border-border bg-surface-raised p-8 transition-colors hover:border-accent/40">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10 text-xl font-bold text-accent">
                1
              </div>
              <h3 className="mb-3 text-xl font-semibold">We Scan the Internet 24/7</h3>
              <p className="leading-relaxed text-text-secondary">
                Our AI discovery swarm searches public signals across Google, Reddit, forums, and
                social platforms for people actively looking for your services.
              </p>
            </div>

            {/* Step 2 */}
            <div className="rounded-xl border border-border bg-surface-raised p-8 transition-colors hover:border-accent/40">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10 text-xl font-bold text-accent">
                2
              </div>
              <h3 className="mb-3 text-xl font-semibold">AI Qualifies & Scores Every Lead</h3>
              <p className="leading-relaxed text-text-secondary">
                Each lead is analyzed by specialized AI agents that determine intent, score
                relevance, and classify the opportunity.
              </p>
            </div>

            {/* Step 3 */}
            <div className="rounded-xl border border-border bg-surface-raised p-8 transition-colors hover:border-accent/40">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10 text-xl font-bold text-accent">
                3
              </div>
              <h3 className="mb-3 text-xl font-semibold">You Review & Take Action</h3>
              <p className="leading-relaxed text-text-secondary">
                Qualified leads land in your pipeline with AI-drafted outreach ready for your
                approval. No spam — human-in-the-loop always.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Industries ── */}
      <section className="border-t border-border-subtle py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">Works for Any Industry</h2>
            <p className="text-lg text-text-secondary">
              Configure your discovery agents for the vertical you serve.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {industries.map((industry) => (
              <div
                key={industry}
                className="rounded-lg border border-border bg-surface-raised px-4 py-5 text-center text-sm font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary"
              >
                {industry}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="border-t border-border-subtle py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">Everything You Need to Fill Your Pipeline</h2>
            <p className="text-lg text-text-secondary">
              A complete lead intelligence and outreach platform.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-border bg-surface-raised p-6 transition-colors hover:border-accent/40"
              >
                <h3 className="mb-2 font-semibold">{f.title}</h3>
                <p className="text-sm leading-relaxed text-text-secondary">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Social Proof ── */}
      <section className="border-t border-border-subtle py-20">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <p className="mb-8 text-lg font-medium text-text-muted">
            Trusted by businesses finding leads smarter
          </p>
          <div className="flex flex-wrap items-center justify-center gap-10">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-8 w-28 rounded bg-surface-overlay"
                title="Logo placeholder"
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="border-t border-border-subtle py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">Simple, Transparent Pricing</h2>
            <p className="text-lg text-text-secondary">
              Start small, scale as you grow. No hidden fees.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-xl border p-8 transition-colors ${
                  plan.highlight
                    ? 'border-accent bg-surface-raised shadow-lg shadow-accent/10'
                    : 'border-border bg-surface-raised hover:border-accent/40'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-0.5 text-xs font-semibold text-white">
                    Most Popular
                  </div>
                )}
                <h3 className="mb-1 text-lg font-semibold">{plan.name}</h3>
                <div className="mb-6">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  <span className="text-text-muted">{plan.period}</span>
                </div>
                <ul className="mb-8 space-y-3 text-sm text-text-secondary">
                  <li className="flex items-center gap-2">
                    <span className="text-success">&#10003;</span> {plan.leads}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-success">&#10003;</span> {plan.sources}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-success">&#10003;</span> {plan.users}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-success">&#10003;</span> AI qualification & scoring
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-success">&#10003;</span> AI outreach drafts
                  </li>
                </ul>
                <Link
                  href="/login"
                  className={`block w-full rounded-lg py-2.5 text-center text-sm font-semibold transition-colors ${
                    plan.highlight
                      ? 'bg-accent text-white hover:bg-accent-hover'
                      : 'border border-border text-text-primary hover:border-accent hover:text-accent'
                  }`}
                >
                  {plan.name === 'Enterprise' ? 'Contact Us' : 'Get Started'}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="border-t border-border-subtle py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="mb-4 text-3xl font-bold sm:text-4xl">
            Stop Chasing Leads. Let Them Come to You.
          </h2>
          <p className="mb-10 text-lg text-text-secondary">
            Set up your first discovery campaign in under 5 minutes and start receiving qualified
            leads today.
          </p>
          <Link
            href="/login"
            className="inline-block rounded-lg bg-accent px-10 py-4 text-base font-semibold text-white shadow-lg shadow-accent/25 transition-all hover:bg-accent-hover hover:shadow-accent/40"
          >
            Start Finding Leads
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border-subtle py-12">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <span className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <Image src="/logo.png" alt="LeadPulseLab" width={32} height={32} />
              Lead<span className="text-accent">Pulse</span>Lab
            </span>
            <div className="flex gap-8 text-sm text-text-muted">
              <button
                onClick={() => smoothScroll('how-it-works')}
                className="transition-colors hover:text-text-secondary"
              >
                How It Works
              </button>
              <button
                onClick={() => smoothScroll('features')}
                className="transition-colors hover:text-text-secondary"
              >
                Features
              </button>
              <button
                onClick={() => smoothScroll('pricing')}
                className="transition-colors hover:text-text-secondary"
              >
                Pricing
              </button>
              <Link href="/login" className="transition-colors hover:text-text-secondary">
                Sign In
              </Link>
            </div>
            <p className="text-sm text-text-muted">
              &copy; {new Date().getFullYear()} LeadPulseLab. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
