import type { VerticalTemplateConfig } from '@alh/types';
import { creditRepairTemplate } from './credit-repair';
import { roofingTemplate } from './roofing';
import { marketingAgencyTemplate } from './marketing-agency';
import { realEstateTemplate } from './real-estate';
import { localServicesTemplate } from './local-services';

export interface VerticalTemplateEntry {
  name: string;
  displayName: string;
  industry: string;
  description: string;
  config: VerticalTemplateConfig;
}

export const VERTICAL_TEMPLATES: VerticalTemplateEntry[] = [
  creditRepairTemplate,
  roofingTemplate,
  marketingAgencyTemplate,
  realEstateTemplate,
  localServicesTemplate,
];
