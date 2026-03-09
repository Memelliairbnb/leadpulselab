import { Job } from "bullmq";
import { db } from "@alh/db";
import {
  scanJobs,
  platformSources,
  rawSources,
  rawLeads,
} from "@alh/db/schema";
import { eq } from "@alh/db/orm";
import { logger } from "@alh/observability";
import { getQueue, QUEUE_NAMES } from "@alh/queues";
import { loadAdapter } from "@alh/source-adapters";
import type { SourceScanJobData } from "@alh/types";

const log = logger.child({ module: "ingestion-processor" });

export async function processSourceScan(job: Job<SourceScanJobData>) {
  const { scanJobId, platformSourceId, tenantId } = job.data;

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
      .where(eq(platformSources.id, platformSourceId))
      .limit(1);

    if (!source) {
      throw new Error(`Platform source not found: ${platformSourceId}`);
    }

    log.info(
      { adapterKey: source.adapterKey, platformSourceId },
      "Loading source adapter"
    );

    // Load the adapter for this platform source
    const adapter = loadAdapter(source.adapterKey);

    // Fetch raw data from the source
    const fetchResult = await adapter.fetch({
      keywords: source.keywords ?? [],
      config: source.config ?? {},
      credentials: source.credentials ?? {},
      lastCursor: source.lastCursor ?? undefined,
    });

    log.info(
      { resultCount: fetchResult.items.length, adapterKey: source.adapterKey },
      "Fetched raw items from source"
    );

    // Save raw source record
    const [rawSource] = await db
      .insert(rawSources)
      .values({
        tenantId,
        platformSourceId,
        scanJobId,
        fetchedAt: new Date(),
        rawPayload: fetchResult.rawPayload,
        itemCount: fetchResult.items.length,
        cursor: fetchResult.nextCursor ?? null,
      })
      .returning();

    // Update platform source cursor for next scan
    if (fetchResult.nextCursor) {
      await db
        .update(platformSources)
        .set({ lastCursor: fetchResult.nextCursor })
        .where(eq(platformSources.id, platformSourceId));
    }

    // Extract and save raw leads
    const leadAnalysisQueue = getQueue(QUEUE_NAMES.LEAD_ANALYSIS);
    let extractedCount = 0;

    for (const item of fetchResult.items) {
      try {
        const [lead] = await db
          .insert(rawLeads)
          .values({
            tenantId,
            rawSourceId: rawSource.id,
            platformSourceId,
            platformName: source.platformName,
            externalId: item.externalId ?? null,
            profileUrl: item.profileUrl ?? null,
            authorName: item.authorName ?? null,
            authorHandle: item.authorHandle ?? null,
            contentText: item.contentText ?? null,
            contentUrl: item.contentUrl ?? null,
            postedAt: item.postedAt ? new Date(item.postedAt) : null,
            rawData: item.rawData,
            status: "pending",
          })
          .returning();

        // Push each lead to the analysis queue
        await leadAnalysisQueue.add(
          "analyze-lead",
          {
            rawLeadId: lead.id,
            tenantId,
            platformSourceId,
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
          { error: (err as Error).message, externalId: item.externalId },
          "Failed to save raw lead"
        );
      }
    }

    // Update scan job status to completed
    await db
      .update(scanJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        itemsFound: fetchResult.items.length,
        leadsExtracted: extractedCount,
      })
      .where(eq(scanJobs.id, scanJobId));

    log.info(
      { scanJobId, extractedCount, totalItems: fetchResult.items.length },
      "Source scan completed"
    );

    return { extractedCount, totalItems: fetchResult.items.length };
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
