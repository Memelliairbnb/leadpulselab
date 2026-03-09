import { Job } from "bullmq";
import { db } from "@alh/db";
import {
  scanJobs,
  platformSources,
  rawSources,
  rawLeads,
} from "@alh/db";
import { eq } from "drizzle-orm";
import { logger } from "@alh/observability";
import { getQueue, QUEUE_NAMES } from "@alh/queues";
import type { SourceScanJobData } from "@alh/queues";
import { getAdapter } from "@alh/source-adapters";
import crypto from "crypto";

const log = logger.child({ module: "ingestion-processor" });

export async function processSourceScan(job: Job<SourceScanJobData>) {
  const { scanJobId, sourceId, tenantId, keywords } = job.data;

  // Update scan job status to running
  await db
    .update(scanJobs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(scanJobs.id, scanJobId));

  try {
    // Load the platform source configuration
    const [source] = await db
      .select()
      .from(platformSources)
      .where(eq(platformSources.id, sourceId))
      .limit(1);

    if (!source) {
      throw new Error(`Platform source not found: ${sourceId}`);
    }

    log.info(
      { adapterKey: source.adapterKey, sourceId },
      "Loading source adapter"
    );

    // Load the adapter for this platform source
    const adapter = getAdapter(source.adapterKey);
    if (!adapter) {
      throw new Error(`No adapter found for key: ${source.adapterKey}`);
    }

    // Fetch raw data from the source
    const rawPayloads = await adapter.fetch({
      keywords: keywords ?? [],
      config: (source.configJson as Record<string, unknown>) ?? {},
    });

    log.info(
      { resultCount: rawPayloads.length, adapterKey: source.adapterKey },
      "Fetched raw payloads from source"
    );

    // Process each raw payload
    const leadAnalysisQueue = getQueue(QUEUE_NAMES.LEAD_ANALYSIS);
    let extractedCount = 0;

    for (const payload of rawPayloads) {
      try {
        const payloadStr = JSON.stringify(payload.payload);
        const checksumHash = crypto
          .createHash("sha256")
          .update(payloadStr)
          .digest("hex");

        // Save raw source record
        const [rawSource] = await db
          .insert(rawSources)
          .values({
            tenantId,
            scanJobId,
            sourceName: source.name,
            sourceType: source.sourceType,
            sourceUrl: payload.sourceUrl,
            fetchMethod: payload.fetchMethod,
            sourcePayloadJson: payload.payload,
            checksumHash,
            fetchedAt: payload.fetchedAt,
          })
          .returning();

        // Extract leads from this payload
        const candidates = adapter.extractLeads(payload);

        for (const candidate of candidates) {
          try {
            const textHash = crypto
              .createHash("sha256")
              .update(candidate.rawText)
              .digest("hex");

            const [lead] = await db
              .insert(rawLeads)
              .values({
                tenantId,
                rawSourceId: rawSource.id,
                platform: candidate.platform,
                profileName: candidate.profileName ?? null,
                profileUrl: candidate.profileUrl ?? null,
                sourceUrl: candidate.sourceUrl,
                matchedKeywords: candidate.matchedKeywords,
                rawText: candidate.rawText,
                rawMetadataJson: candidate.rawMetadata,
                locationText: candidate.locationText ?? null,
                contactHint: candidate.contactHint ?? null,
                contentDate: candidate.contentDate,
                textHash,
                processingStatus: "pending",
              })
              .returning();

            // Push each lead to the analysis queue
            await leadAnalysisQueue.add(
              "analyze-lead",
              {
                rawLeadId: lead.id,
                tenantId,
              },
              {
                jobId: `analyze-${lead.id}`,
                attempts: 3,
                backoff: { type: "exponential", delay: 5000 },
              }
            );

            extractedCount++;
          } catch (err) {
            log.error(
              {
                error: (err as Error).message,
                profileName: candidate.profileName,
              },
              "Failed to save raw lead"
            );
          }
        }
      } catch (err) {
        log.error(
          { error: (err as Error).message, sourceUrl: payload.sourceUrl },
          "Failed to process raw payload"
        );
      }
    }

    // Update scan job status to completed
    await db
      .update(scanJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        resultsCount: rawPayloads.length,
        leadsFound: extractedCount,
      })
      .where(eq(scanJobs.id, scanJobId));

    log.info(
      { scanJobId, extractedCount, totalPayloads: rawPayloads.length },
      "Source scan completed"
    );

    return { extractedCount, totalPayloads: rawPayloads.length };
  } catch (err) {
    const error = err as Error;
    log.error({ scanJobId, error: error.message }, "Source scan failed");

    // Update scan job status to failed
    await db
      .update(scanJobs)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: error.message,
      })
      .where(eq(scanJobs.id, scanJobId));

    throw error;
  }
}
