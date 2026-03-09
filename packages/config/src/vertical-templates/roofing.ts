import type { VerticalTemplateEntry } from './index';

export const roofingTemplate: VerticalTemplateEntry = {
  name: 'roofing',
  displayName: 'Roofing & Storm Damage',
  industry: 'Home Services',
  description: 'For roofing contractors and storm damage repair companies finding homeowners who need roof work.',
  config: {
    leadTypes: [
      { name: 'roof_repair', displayName: 'Roof Repair', description: 'Homeowner with a damaged or leaking roof', priority: 10, color: '#EF4444' },
      { name: 'roof_replacement', displayName: 'Roof Replacement', description: 'Homeowner needing full roof replacement', priority: 9, color: '#F59E0B' },
      { name: 'storm_damage', displayName: 'Storm Damage', description: 'Property with storm, hail, or wind damage', priority: 10, color: '#7C3AED' },
      { name: 'insurance_claim', displayName: 'Insurance Claim', description: 'Homeowner navigating roof insurance claim', priority: 8, color: '#3B82F6' },
      { name: 'commercial_roofing', displayName: 'Commercial Roofing', description: 'Business owner needing commercial roof work', priority: 7, color: '#10B981' },
    ],
    keywordCategories: [
      {
        name: 'Roof Damage',
        keywords: [
          { keyword: 'roof leak', type: 'phrase' },
          { keyword: 'roof damage', type: 'phrase' },
          { keyword: 'need roof repair', type: 'phrase' },
          { keyword: 'roof is leaking', type: 'phrase' },
          { keyword: 'missing shingles', type: 'phrase' },
        ],
      },
      {
        name: 'Storm Related',
        keywords: [
          { keyword: 'hail damage roof', type: 'phrase' },
          { keyword: 'storm damage house', type: 'phrase' },
          { keyword: 'wind damage roof', type: 'phrase' },
          { keyword: 'roof insurance claim', type: 'phrase' },
        ],
      },
      {
        name: 'Replacement',
        keywords: [
          { keyword: 'need new roof', type: 'phrase' },
          { keyword: 'roof estimate', type: 'phrase' },
          { keyword: 'roof replacement cost', type: 'phrase' },
          { keyword: 'recommend roofer', type: 'phrase' },
        ],
      },
    ],
    scoringSignals: [
      { signalKey: 'active_damage', signalPattern: 'leaking|water damage|emergency|flooding|buckets', weight: 35, description: 'Active roof damage or leak' },
      { signalKey: 'asking_for_roofer', signalPattern: 'recommend|looking for roofer|need contractor|who should I call', weight: 25, description: 'Actively seeking a roofer' },
      { signalKey: 'storm_event', signalPattern: 'hail|storm|wind|tornado|hurricane', weight: 20, description: 'Storm-related damage' },
      { signalKey: 'insurance', signalPattern: 'insurance claim|adjuster|deductible', weight: 15, description: 'Insurance claim related' },
      { signalKey: 'diy_discussion', signalPattern: 'DIY roof|fix it myself|patch the roof', weight: -15, description: 'DIY discussion, not hiring' },
    ],
    outreachTemplates: [
      {
        name: 'Roof Damage First Contact',
        leadTypeName: 'roof_repair',
        channel: 'dm',
        subject: null,
        body: 'Hi — I saw your post about roof issues. We specialize in roof repair and can usually get out for a free inspection within 24-48 hours. If you\'d like, I can have someone take a look and give you an honest assessment of what needs to be done. No pressure at all.',
        tone: 'warm',
      },
    ],
    aiConfig: {
      industryContext: 'We are a roofing contractor that handles roof repair, replacement, storm damage restoration, and insurance claim assistance for residential and commercial properties.',
      classificationInstructions: 'Focus on urgency of damage, whether the person is actively seeking help vs just discussing, and whether this is residential or commercial.',
      exampleSignals: [
        'My roof started leaking after the storm last night',
        'Can anyone recommend a good roofer?',
        'Insurance adjuster said I need a new roof',
      ],
      irrelevantSignals: ['rooftop bar', 'roof rack', 'sunroof', 'roof of mouth'],
    },
  },
};
