import { Queue } from 'bullmq';
import { redisConnection } from './connection';

export const QUEUE_NAMES = {
  SOURCE_SCAN: 'source_scan_queue',
  LEAD_INGESTION: 'lead_ingestion_queue',
  LEAD_ANALYSIS: 'lead_analysis_queue',
  LEAD_DEDUPE: 'lead_dedupe_queue',
  LEAD_ENRICHMENT: 'lead_enrichment_queue',
  OUTREACH_GENERATION: 'outreach_generation_queue',
  RESCORE: 'rescore_queue',
  STALE_ARCHIVE: 'stale_archive_queue',
  INSTAGRAM_DISCOVERY: 'instagram_discovery_queue',
  INSTAGRAM_SCRUB: 'instagram_scrub_queue',
  INSTAGRAM_ENRICHMENT: 'instagram_enrichment_queue',
  VIDEO_PROCESSING: 'video_processing_queue',
} as const;

const queues = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  if (!queues.has(name)) {
    queues.set(
      name,
      new Queue(name, {
        connection: redisConnection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 86400, count: 1000 },
          removeOnFail: false,
        },
      }),
    );
  }
  return queues.get(name)!;
}
