const mockJudge: jest.Mock<any, any> = jest.fn();
const mockSave: jest.Mock<any, any> = jest.fn(async () => ({
  textBytes: 1,
  jsonBytes: 1,
}));
const mockGetJob: jest.Mock<any, any> = jest.fn();

jest.mock("uuid", () => ({ v7: () => "test-uuid" }));
jest.mock("./judgeChange", () => ({
  judgeChange: (args: any) => mockJudge(args),
}));
jest.mock("../../lib/gcs-jobs", () => ({
  getJobFromGCS: (id: any) => mockGetJob(id),
}));
jest.mock("../../lib/gcs-monitoring", () => ({
  saveMonitorDiffArtifact: (key: any, artifact: any) => mockSave(key, artifact),
  monitorDiffGcsKey: () => "fake-gcs-key",
}));

import { computeAndPersistPageDiff } from "./diff-orchestrator";
import { derivePageWebhookEvents } from "./page-events";
import { judgeChange } from "./judgeChange";
import { logger as winstonLogger } from "../../lib/logger";

const FAKE_JUDGMENT = {
  meaningful: true as const,
  confidence: "high" as const,
  reason: "test",
  fields: [],
};

const FRESH_PAGE = {
  teamId: "team-1",
  monitorId: "monitor-1",
  checkId: "check-1",
  url: "https://example.com",
  scrapeId: "scrape-2",
};

beforeEach(() => {
  mockJudge.mockReset();
  mockSave.mockClear();
  mockGetJob.mockReset();
});

describe("computeAndPersistPageDiff — judge gating", () => {
  it("skips judge when previous is null", async () => {
    const result = await computeAndPersistPageDiff({
      ...FRESH_PAGE,
      doc: { markdown: "hello world" },
      previous: null,
      formats: ["markdown"],
      goal: "track anything",
    });
    expect(result.status).toBe("new");
    expect(result.judgment).toBeUndefined();
    expect(mockJudge).not.toHaveBeenCalled();
  });

  it("skips judge when goal is null", async () => {
    mockGetJob.mockResolvedValue([{ markdown: "previous content here" }]);
    const result = await computeAndPersistPageDiff({
      ...FRESH_PAGE,
      doc: { markdown: "current content here — totally different" },
      previous: { last_scrape_id: "scrape-1", is_removed: false },
      formats: ["markdown"],
      goal: null,
    });
    expect(result.status).toBe("changed");
    expect(result.judgment).toBeUndefined();
    expect(mockJudge).not.toHaveBeenCalled();
  });

  it("skips judge when content is unchanged", async () => {
    const identical = "identical text";
    mockGetJob.mockResolvedValue([{ markdown: identical }]);
    const result = await computeAndPersistPageDiff({
      ...FRESH_PAGE,
      doc: { markdown: identical },
      previous: { last_scrape_id: "scrape-1", is_removed: false },
      formats: ["markdown"],
      goal: "track anything",
    });
    expect(result.status).toBe("same");
    expect(result.judgment).toBeUndefined();
    expect(mockJudge).not.toHaveBeenCalled();
  });

  it("calls judge with markdown diff when goal is set and page changed", async () => {
    mockGetJob.mockResolvedValue([{ markdown: "old content" }]);
    mockJudge.mockResolvedValue(FAKE_JUDGMENT);
    const result = await computeAndPersistPageDiff({
      ...FRESH_PAGE,
      doc: { markdown: "new content totally different" },
      previous: { last_scrape_id: "scrape-1", is_removed: false },
      formats: ["markdown"],
      goal: "tell me when the content changes",
      extractionPrompt: "extract the heading",
    });
    expect(result.judgment).toEqual(FAKE_JUDGMENT);
    const callArgs = mockJudge.mock.calls[0][0];
    expect(callArgs.goal).toBe("tell me when the content changes");
    expect(callArgs.extractionPrompt).toBe("extract the heading");
    expect(callArgs.markdownDiff.previous).toBe("old content");
    expect(callArgs.markdownDiff.current).toBe("new content totally different");
  });

  it("returns no judgment if judge throws", async () => {
    mockGetJob.mockResolvedValue([{ markdown: "old content" }]);
    mockJudge.mockRejectedValue(new Error("gemini down"));
    const result = await computeAndPersistPageDiff({
      ...FRESH_PAGE,
      doc: { markdown: "new content" },
      previous: { last_scrape_id: "scrape-1", is_removed: false },
      formats: ["markdown"],
      goal: "track anything",
    });
    expect(result.status).toBe("changed");
    expect(result.judgment).toBeUndefined();
  });
});

describe("derivePageWebhookEvents", () => {
  it("always emits monitor.page; gates monitor.page.meaningful on changed+meaningful", () => {
    expect(derivePageWebhookEvents("changed", { meaningful: true })).toEqual([
      "monitor.page",
      "monitor.page.meaningful",
    ]);
    expect(derivePageWebhookEvents("changed", { meaningful: false })).toEqual([
      "monitor.page",
    ]);
    expect(derivePageWebhookEvents("changed", null)).toEqual(["monitor.page"]);
    for (const status of ["new", "same", "removed", "error"]) {
      expect(derivePageWebhookEvents(status, { meaningful: true })).toEqual([
        "monitor.page",
      ]);
    }
  });
});

const HAS_GEMINI = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const describeIfGemini = HAS_GEMINI ? describe : describe.skip;
const TEST_TIMEOUT = 30000;
const buildLogger = () => winstonLogger.child({ test: "judgeChange" });

describe("judgeChange — input validation (no LLM call)", () => {
  it("returns low-confidence meaningful when no diff payload is provided", async () => {
    const result = await judgeChange({
      logger: buildLogger(),
      goal: "anything",
    });
    expect(result.meaningful).toBe(true);
    expect(result.confidence).toBe("low");
    expect(result.fields).toEqual([]);
  });
});

describeIfGemini("judgeChange — live Gemini", () => {
  it(
    "classifies whitespace-only field change as noise",
    async () => {
      const result = await judgeChange({
        logger: buildLogger(),
        goal: "Track the page heading verbatim",
        jsonDiff: {
          headline: {
            previous: "Power AI agents with clean web data",
            current: "Power AI agents with  clean web data",
          },
        },
      });
      expect(result.meaningful).toBe(false);
    },
    TEST_TIMEOUT,
  );

  it(
    "named-field rule: sub-1% price change is meaningful when goal names 'price'",
    async () => {
      const result = await judgeChange({
        logger: buildLogger(),
        goal: "Track the Pro tier price. Tell me about ANY price change.",
        jsonDiff: {
          pro_price: { previous: "$19.00", current: "$19.01" },
        },
      });
      expect(result.meaningful).toBe(true);
    },
    TEST_TIMEOUT,
  );

  it(
    "named-field rule does NOT apply to unmentioned fields",
    async () => {
      const result = await judgeChange({
        logger: buildLogger(),
        goal: "Track the Pro tier price.",
        jsonDiff: {
          view_count: { previous: "12402", current: "12418" },
        },
      });
      expect(result.meaningful).toBe(false);
    },
    TEST_TIMEOUT,
  );

  it(
    "markdown: new list item matching the goal is meaningful",
    async () => {
      const result = await judgeChange({
        logger: buildLogger(),
        goal: "tell me when a new MacBook is announced",
        markdownDiff: {
          previous:
            "# MacBook lineup\n- MacBook Air M2\n- MacBook Pro M3\n\nUpdated 2026-05-19T18:42:00Z",
          current:
            "# MacBook lineup\n- MacBook Air M4 — NEW\n- MacBook Air M2\n- MacBook Pro M3\n\nUpdated 2026-05-19T18:43:01Z",
          diffText:
            "@@ -1,4 +1,5 @@\n # MacBook lineup\n+- MacBook Air M4 — NEW\n - MacBook Air M2\n - MacBook Pro M3\n \n-Updated 2026-05-19T18:42:00Z\n+Updated 2026-05-19T18:43:01Z",
        },
      });
      expect(result.meaningful).toBe(true);
      expect(result.reason.toLowerCase()).toMatch(/macbook|m4|new/);
    },
    TEST_TIMEOUT,
  );
});
