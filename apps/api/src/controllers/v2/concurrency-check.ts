import {
  ConcurrencyCheckParams,
  ConcurrencyCheckResponse,
  RequestWithAuth,
} from "./types";
import { AuthCreditUsageChunkFromTeam } from "../v1/types";
import { Response } from "express";
import { getRedisConnection } from "../../../src/services/queue-service";
import { getACUCTeam } from "../auth";
import { RateLimiterMode } from "../../types";
import { fdbQueueEnabled } from "../../services/worker/nuq-router";
import { scrapeQueueFdb } from "../../services/worker/nuq-fdb";
import { logger } from "../../lib/logger";

// Basically just middleware and error wrapping
export async function concurrencyCheckController(
  req: RequestWithAuth<ConcurrencyCheckParams, undefined, undefined>,
  res: Response<ConcurrencyCheckResponse>,
) {
  if (!req.acuc) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized",
    });
  }

  let otherACUC: AuthCreditUsageChunkFromTeam | null = null;
  if (!req.acuc.is_extract) {
    otherACUC = await getACUCTeam(
      req.auth.team_id,
      false,
      true,
      RateLimiterMode.Extract,
    );
  } else {
    otherACUC = await getACUCTeam(
      req.auth.team_id,
      false,
      true,
      RateLimiterMode.Crawl,
    );
  }

  const concurrencyLimiterKey = "concurrency-limiter:" + req.auth.team_id;
  const now = Date.now();
  const activeJobsOfTeam = await getRedisConnection().zrangebyscore(
    concurrencyLimiterKey,
    now,
    Infinity,
  );

  // during the FDB migration a team can have load on both ledgers
  let fdbActive = 0;
  if (fdbQueueEnabled()) {
    try {
      fdbActive = await scrapeQueueFdb.getTeamActiveCount(req.auth.team_id);
    } catch (error) {
      logger.warn("Failed to read FDB active count, falling back to Redis", {
        module: "concurrency-check",
        version: "v2",
        error,
      });
    }
  }

  return res.status(200).json({
    success: true,
    concurrency: activeJobsOfTeam.length + fdbActive,
    maxConcurrency: Math.max(req.acuc.concurrency, otherACUC?.concurrency ?? 0),
  });
}
