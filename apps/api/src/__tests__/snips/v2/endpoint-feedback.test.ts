import { describeIf, TEST_PRODUCTION, TEST_SUITE_WEBSITE } from "../lib";
import {
  endpointFeedback,
  endpointFeedbackRaw,
  endpointFeedbackWithFailure,
  expectMapToSucceed,
  idmux,
  Identity,
  map,
  scrapeTimeout,
  searchRawFull,
} from "./lib";

let identity: Identity;
let secondaryIdentity: Identity;

beforeAll(async () => {
  identity = await idmux({
    name: "endpoint-feedback",
    concurrency: 100,
    credits: 1000000,
  });
  secondaryIdentity = await idmux({
    name: "endpoint-feedback-other",
    concurrency: 100,
    credits: 1000000,
  });
}, 20000);

// Skipped in self-hosted mode: depends on the production job log tables,
// Autumn refunds, and the per-team daily refund cap.
describeIf(TEST_PRODUCTION)("Generic endpoint feedback tests", () => {
  it("records map feedback, exposes the map job id, and makes duplicate submissions idempotent", async () => {
    const raw = await map(
      { url: TEST_SUITE_WEBSITE, limit: 1, timeout: scrapeTimeout },
      identity,
    );
    expectMapToSucceed(raw);
    expect(typeof raw.body.id).toBe("string");

    const first = await endpointFeedback(
      {
        endpoint: "map",
        jobId: raw.body.id,
        rating: "bad",
        issues: ["missing_expected_url"],
        note: "The map result did not include the canonical page I expected.",
      },
      identity,
    );

    expect(first.success).toBe(true);
    expect(first.creditsRefunded).toBe(1);
    expect(first.alreadySubmitted).toBeFalsy();

    const second = await endpointFeedback(
      {
        endpoint: "map",
        jobId: raw.body.id,
        rating: "partial",
        issues: ["still_missing_expected_url"],
        note: "Submitting twice should not refund twice.",
      },
      identity,
    );

    expect(second.success).toBe(true);
    expect(second.creditsRefunded).toBe(0);
    expect(second.alreadySubmitted).toBe(true);
  }, 120000);

  it("rejects endpoint feedback for a job owned by another team", async () => {
    const raw = await map(
      { url: TEST_SUITE_WEBSITE, limit: 1, timeout: scrapeTimeout },
      identity,
    );
    expectMapToSucceed(raw);

    const failed = await endpointFeedbackWithFailure(
      {
        endpoint: "map",
        jobId: raw.body.id,
        rating: "bad",
        note: "This team should not be able to see the job.",
      },
      secondaryIdentity,
    );

    expect(failed.error.toLowerCase()).toContain("not found");
    expect((failed as any).feedbackErrorCode).toBe("JOB_NOT_FOUND");
  }, 120000);

  it("applies search feedback validation on the generic endpoint", async () => {
    const raw = await searchRawFull(
      { query: "firecrawl generic feedback", limit: 3 },
      identity,
    );
    expect(raw.statusCode).toBe(200);
    expect(typeof raw.body.id).toBe("string");

    const failed = await endpointFeedbackRaw(
      {
        endpoint: "search",
        jobId: raw.body.id,
        rating: "good",
        note: "A good search rating must name a valuable source.",
      },
      identity,
    );

    expect(failed.statusCode).toBe(400);
    expect(failed.body.success).toBe(false);
    expect(String(failed.body.error).toLowerCase()).toContain("invalid");
  }, 90000);
});
