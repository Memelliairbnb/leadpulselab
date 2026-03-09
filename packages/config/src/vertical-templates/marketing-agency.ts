import type { VerticalTemplateEntry } from './index';

export const marketingAgencyTemplate: VerticalTemplateEntry = {
  name: 'marketing_agency',
  displayName: 'Marketing & Digital Agency',
  industry: 'Marketing',
  description: 'For marketing agencies and consultants finding businesses that need marketing, social media, SEO, or advertising help.',
  config: {
    leadTypes: [
      { name: 'seo_lead', displayName: 'SEO Lead', description: 'Business needing search engine optimization', priority: 9, color: '#3B82F6' },
      { name: 'social_media_lead', displayName: 'Social Media Lead', description: 'Business needing social media management', priority: 8, color: '#EC4899' },
      { name: 'ppc_lead', displayName: 'PPC / Ads Lead', description: 'Business needing paid advertising help', priority: 8, color: '#F59E0B' },
      { name: 'web_design_lead', displayName: 'Web Design Lead', description: 'Business needing a website built or redesigned', priority: 7, color: '#8B5CF6' },
      { name: 'general_marketing', displayName: 'General Marketing', description: 'Business needing overall marketing strategy help', priority: 10, color: '#10B981' },
    ],
    keywordCategories: [
      {
        name: 'Marketing Help',
        keywords: [
          { keyword: 'need marketing help', type: 'phrase' },
          { keyword: 'looking for marketing agency', type: 'phrase' },
          { keyword: 'struggling with leads', type: 'phrase' },
          { keyword: 'no one can find my website', type: 'phrase' },
          { keyword: 'how to get more customers', type: 'phrase' },
        ],
      },
      {
        name: 'Social Media',
        keywords: [
          { keyword: 'looking for social media manager', type: 'phrase' },
          { keyword: 'need help with Instagram', type: 'phrase' },
          { keyword: 'social media not working', type: 'phrase' },
        ],
      },
      {
        name: 'SEO & Ads',
        keywords: [
          { keyword: 'need SEO help', type: 'phrase' },
          { keyword: 'Google ads not working', type: 'phrase' },
          { keyword: 'how to rank on Google', type: 'phrase' },
          { keyword: 'website no traffic', type: 'phrase' },
        ],
      },
    ],
    scoringSignals: [
      { signalKey: 'actively_hiring', signalPattern: 'looking for|need help|hiring|recommend', weight: 30, description: 'Actively looking to hire marketing help' },
      { signalKey: 'business_pain', signalPattern: 'no leads|no customers|struggling|not working|wasting money', weight: 25, description: 'Business pain from marketing failure' },
      { signalKey: 'budget_signal', signalPattern: 'budget|invest|spend|afford|pricing', weight: 15, description: 'Has budget conversation' },
      { signalKey: 'diy_frustration', signalPattern: 'tried everything|give up|too complicated|not my thing', weight: 20, description: 'Frustrated with DIY marketing' },
      { signalKey: 'student_content', signalPattern: 'homework|assignment|class project|learning', weight: -25, description: 'Student or educational content' },
    ],
    outreachTemplates: [
      {
        name: 'Marketing Agency First Contact',
        leadTypeName: null,
        channel: 'dm',
        subject: null,
        body: 'Hey — I noticed your post about marketing challenges. That\'s a really common struggle for businesses at your stage. We help companies like yours build a steady flow of leads through targeted marketing. If you\'re interested, I can share some ideas specific to your situation. No pitch, just useful info.',
        tone: 'casual',
      },
    ],
    aiConfig: {
      industryContext: 'We are a digital marketing agency that helps businesses with SEO, social media management, paid advertising, web design, and overall marketing strategy.',
      classificationInstructions: 'Distinguish between business owners seeking marketing help (valid leads) and marketing professionals discussing their own work (not leads). Focus on buying signals.',
      exampleSignals: [
        'My business has zero online presence and I need help',
        'Can anyone recommend a good marketing agency?',
        'I\'ve been running Google ads but getting no results',
      ],
      irrelevantSignals: ['marketing job posting', 'marketing degree', 'marketing textbook', 'affiliate marketing scheme'],
    },
  },
};
