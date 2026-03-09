import type { VerticalTemplateEntry } from './index';

export const realEstateTemplate: VerticalTemplateEntry = {
  name: 'real_estate',
  displayName: 'Real Estate Agent',
  industry: 'Real Estate',
  description: 'For real estate agents and brokers finding buyers, sellers, and investors through public signals.',
  config: {
    leadTypes: [
      { name: 'buyer_lead', displayName: 'Home Buyer', description: 'Person looking to buy a home', priority: 10, color: '#3B82F6' },
      { name: 'seller_lead', displayName: 'Home Seller', description: 'Person looking to sell their home', priority: 10, color: '#10B981' },
      { name: 'investor_lead', displayName: 'Real Estate Investor', description: 'Person looking to invest in property', priority: 8, color: '#F59E0B' },
      { name: 'relocation_lead', displayName: 'Relocation', description: 'Person relocating and needing an agent', priority: 9, color: '#8B5CF6' },
      { name: 'first_time_buyer', displayName: 'First-Time Buyer', description: 'First-time homebuyer needing guidance', priority: 9, color: '#EC4899' },
    ],
    keywordCategories: [
      {
        name: 'Buying',
        keywords: [
          { keyword: 'looking to buy a house', type: 'phrase' },
          { keyword: 'first time home buyer', type: 'phrase' },
          { keyword: 'house hunting', type: 'phrase' },
          { keyword: 'need a realtor', type: 'phrase' },
          { keyword: 'moving to', type: 'phrase' },
        ],
      },
      {
        name: 'Selling',
        keywords: [
          { keyword: 'thinking of selling my house', type: 'phrase' },
          { keyword: 'how to sell my home', type: 'phrase' },
          { keyword: 'listing agent', type: 'phrase' },
        ],
      },
    ],
    scoringSignals: [
      { signalKey: 'active_search', signalPattern: 'looking to buy|house hunting|searching for|shopping for', weight: 30, description: 'Actively searching for property' },
      { signalKey: 'relocation', signalPattern: 'moving to|relocating|transferred to|new job in', weight: 25, description: 'Relocating to area' },
      { signalKey: 'timeline', signalPattern: 'this year|this month|soon|within', weight: 20, description: 'Has a timeline' },
      { signalKey: 'general_discussion', signalPattern: 'housing market|real estate trends|property values', weight: -15, description: 'General market discussion' },
    ],
    outreachTemplates: [
      {
        name: 'Buyer First Contact',
        leadTypeName: 'buyer_lead',
        channel: 'dm',
        subject: null,
        body: 'Hi — I saw your post about looking for a home. I\'m a local agent and would love to help you navigate the process. I can send you some listings that match what you\'re looking for, no obligation. Would that be helpful?',
        tone: 'warm',
      },
    ],
    aiConfig: {
      industryContext: 'We are a real estate team helping buyers find homes, sellers list properties, and investors identify opportunities in the local market.',
      classificationInstructions: 'Focus on whether the person has a real intent to buy, sell, or invest vs just discussing the market generally.',
      exampleSignals: ['We\'re moving to Austin this summer and need to find a house', 'Thinking about selling — is now a good time?'],
      irrelevantSignals: ['real estate exam', 'real estate course', 'REIT investing'],
    },
  },
};
