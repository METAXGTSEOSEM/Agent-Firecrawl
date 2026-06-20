import { calculateCreditsToBeBilled } from "./scrape-billing";
import { config } from "../config";

const originalConfig = {
  FIRE_ENGINE_BETA_URL: config.FIRE_ENGINE_BETA_URL,
  ENRICH_URL_HOSTS: config.ENRICH_URL_HOSTS,
};

describe("calculateCreditsToBeBilled", () => {
  afterEach(() => {
    config.FIRE_ENGINE_BETA_URL = originalConfig.FIRE_ENGINE_BETA_URL;
    config.ENRICH_URL_HOSTS = originalConfig.ENRICH_URL_HOSTS;
  });

  it("bills enabled configured-host successes at 15 credits", async () => {
    config.FIRE_ENGINE_BETA_URL = "https://fire-engine.example";
    config.ENRICH_URL_HOSTS = ["profiles.example"];

    const credits = await calculateCreditsToBeBilled(
      {
        formats: [{ type: "markdown" }],
      } as any,
      {
        teamId: "team-id",
      },
      {
        metadata: {
          statusCode: 200,
          url: "https://profiles.example/in/example-person",
          proxyUsed: "basic",
        },
      } as any,
      {
        totalCost: 0,
      } as any,
      { enrichBeta: true } as any,
    );

    expect(credits).toBe(15);
  });

  it("bills X/Twitter scrapes at 30 credits", async () => {
    const credits = await calculateCreditsToBeBilled(
      {
        formats: [{ type: "markdown" }],
      } as any,
      {
        teamId: "team-id",
      },
      {
        metadata: {
          statusCode: 200,
          proxyUsed: "basic",
          postprocessorsUsed: ["x-twitter"],
        },
      } as any,
      {
        totalCost: 0,
      } as any,
      {} as any,
    );

    expect(credits).toBe(30);
  });

  it("bills deterministic JSON at 10 credits when the script was generated", async () => {
    const credits = await calculateCreditsToBeBilled(
      {
        formats: [{ type: "deterministicJson", schema: {} }],
      } as any,
      {
        teamId: "team-id",
      },
      {
        metadata: {
          statusCode: 200,
          proxyUsed: "basic",
        },
      } as any,
      {
        totalCost: 0.01,
        calls: [
          {
            type: "other",
            model: "vertex/gemini",
            cost: 0.01,
            metadata: { module: "deterministic-json", role: "codegen" },
          },
        ],
      } as any,
      {} as any,
    );

    expect(credits).toBe(10);
  });

  it("bills deterministic JSON at 3 credits when a cached script was reused", async () => {
    const credits = await calculateCreditsToBeBilled(
      {
        formats: [{ type: "deterministicJson", schema: {} }],
      } as any,
      {
        teamId: "team-id",
      },
      {
        metadata: {
          statusCode: 200,
          proxyUsed: "basic",
        },
      } as any,
      {
        totalCost: 0.001,
        calls: [
          {
            type: "other",
            model: "groq/llama",
            cost: 0.001,
            metadata: { module: "deterministic-json", role: "askLlm" },
          },
        ],
      } as any,
      {} as any,
    );

    expect(credits).toBe(3);
  });
});
