import type { VerticalTemplateEntry } from './index';

export const localServicesTemplate: VerticalTemplateEntry = {
  name: 'local_services',
  displayName: 'Local Services (General)',
  industry: 'Local Services',
  description: 'A general template for any local service business — plumbers, electricians, landscapers, cleaners, contractors, etc.',
  config: {
    leadTypes: [
      { name: 'service_request', displayName: 'Service Request', description: 'Person actively needing a service performed', priority: 10, color: '#EF4444' },
      { name: 'quote_request', displayName: 'Quote Request', description: 'Person shopping for quotes or estimates', priority: 8, color: '#F59E0B' },
      { name: 'recommendation_seeker', displayName: 'Recommendation Seeker', description: 'Person asking for provider recommendations', priority: 9, color: '#3B82F6' },
      { name: 'emergency', displayName: 'Emergency Service', description: 'Urgent service need', priority: 10, color: '#DC2626' },
    ],
    keywordCategories: [
      {
        name: 'Service Needs',
        keywords: [
          { keyword: 'looking for contractor', type: 'phrase' },
          { keyword: 'need a plumber', type: 'phrase' },
          { keyword: 'recommend a handyman', type: 'phrase' },
          { keyword: 'who do you use for', type: 'phrase' },
          { keyword: 'best electrician near me', type: 'phrase' },
        ],
      },
    ],
    scoringSignals: [
      { signalKey: 'active_need', signalPattern: 'need|looking for|searching|help with|broken', weight: 30, description: 'Active service need' },
      { signalKey: 'asking_recommendation', signalPattern: 'recommend|anyone know|who do you use|suggestions', weight: 25, description: 'Asking for provider recommendations' },
      { signalKey: 'emergency', signalPattern: 'emergency|urgent|asap|flooding|broken|no heat|no AC', weight: 35, description: 'Emergency situation' },
      { signalKey: 'diy_content', signalPattern: 'how to fix|DIY|do it myself|tutorial', weight: -20, description: 'DIY content, not hiring' },
    ],
    outreachTemplates: [
      {
        name: 'Local Service First Contact',
        leadTypeName: null,
        channel: 'dm',
        subject: null,
        body: 'Hi — I saw your post about needing {{service_name}} help. We\'re a local team that handles exactly that. Happy to provide a free estimate if you\'re still looking. Just let me know and I can get something set up quickly.',
        tone: 'warm',
      },
    ],
    aiConfig: {
      industryContext: 'We are a local service provider. Customize this context with your specific service type and area.',
      classificationInstructions: 'Focus on whether the person is actively looking to hire a service provider vs just discussing home improvement generally.',
      exampleSignals: ['Can anyone recommend a good plumber in the area?', 'My AC broke and I need someone today'],
      irrelevantSignals: ['job posting', 'career advice', 'training program'],
    },
  },
};
