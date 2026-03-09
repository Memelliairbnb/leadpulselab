import { Job } from "bullmq";
import { createHash } from "node:crypto";
import { logger } from "@alh/observability";
import { getQueue, SWARM_QUEUE_NAMES } from "@alh/queues";
import type { SourceFetchJobData } from "@alh/queues";
import { sourcingRepo } from "@alh/db/src/repositories/sourcing-repo";
import { getAdapter } from "@alh/source-adapters";

const log = logger.child({ module: "source-fetcher" });

export async function processSourceFetch(job: Job<SourceFetchJobData>) {
  const { tenantId, sourceId, url, fetchStrategy, payload } = job.data;
  const queryRunId = payload.queryRunId as number;
  const adapterKey = payload.adapterKey as string;
  const keywordId = payload.keywordId as number | undefined;
  const rawPayloadData = payload.rawPayload as unknown;
  const sourceUrl = (payload.sourceUrl as string) ?? url;
  const fetchMethod = (payload.fetchMethod as string) ?? fetchStrategy;

  try {
    // Create source_fetch_run record
    const fetchRun = await sourcingRepo.createSourceFetchRun({
      tenantId,
      queryRunId,
      sourceId,
      fetchUrl: sourceUrl,
      fetchMethod,
      fetchedAt: new Date(),
      success: true,
      itemsFound: 0,
    });

    // Compute checksum for the raw blob
    const blobString = typeof rawPayloadData === "string"
      ? rawPayloadData
      : JSON.stringify(rawPayloadData);
    const checksumHash = createHash("sha256").update(blobString).digest("hex");

    // Store raw blob (dedup by checksum)
    const blob = await sourcingRepo.storeRawBlob({
      sourceFetchRunId: fetchRun.id,
      contentType: typeof rawPayloadData === "string" ? "text" : "json",
      blobData: blobString,
      checksumHash,
      byteSize: Buffer.byteLength(blobString, "utf-8"),
      compressed: false,
    });

    if (!blob) {
      log.warn(
        { tenantId, sourceId, checksumHash },
        "Raw blob already exists (duplicate checksum), skipping extraction"
      );
      await sourcingRepo.updateSourceFetchRun(fetchRun.id, {
        itemsFound: 0,
        success: true,
      });
      return { itemsFound: 0, duplicate: true };
    }

    // Load adapter and extract leads from the raw payload
    const adapter = getAdapter(adapterKey);
    if (!adapter) {
      log.warn({ adapterKey, sourceId }, "No adapter registered for key, skipping extraction");
      return { itemsFound: 0 };
    }

    const rawSourcePayload = {
      sourceUrl,
      fetchMethod,
      payload: rawPayloadData,
      fetchedAt: new Date(payload.fetchedAt as string),
    };

    const candidates = adapter.extractLeads(rawSourcePayload);

    const rawCaptureQueue = getQueue(SWARM_QUEUE_NAMES.RAW_CAPTURE);
    let itemsFound = 0;

    for (const candidate of candidates) {
      await rawCaptureQueue.add(
        "raw_capture",
        {
          tenantId,
          agentType: "raw_capturer" as const,
          sourceId,
          rawData: {
            platform: candidate.platform,
            profileName: candidate.profileName,
            profileUrl: candidate.profileUrl,
            sourceUrl: candidate.sourceUrl,
            matchedKeywords: candidate.matchedKeywords,
            rawText: candidate.rawText,
            rawMetadata: candidate.rawMetadata,
            locationText: candidate.locationText,
            contactHint: candidate.contactHint,
            contentDate: candidate.contentDate?.toISOString() ?? null,
          },
          sourceType: candidate.platform,
          payload: {
            queryRunId,
            sourceId,
            sourceFetchRunId: fetchRun.id,
            keywordId,
          },
        },
        {
          jobId: `capture-${tenantId}-${sourceId}-${Date.now()}-${itemsFound}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        }
      );

      itemsFound++;
    }

    // Update fetch run with items found
    await sourcingRepo.updateSourceFetchRun(fetchRun.id, {
      itemsFound,
      success: true,
    });

    log.info(
      { tenantId, sourceId, fetchRunId: fetchRun.id, itemsFound },
      "Source fetch completed"
    );

    return { itemsFound, fetchRunId: fetchRun.id };
  } catch (err) {
    const error = err as Error;
    log.error(
      { tenantId, sourceId, url, error: error.message },
      "Source fetch failed"
    );
    throw error;
  }
}
