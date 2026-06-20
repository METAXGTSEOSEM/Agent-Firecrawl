import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../../config";
import {
  canBypassProfessionalNetworkBlocklist,
  getProfessionalNetworkSuccessCredits,
  isConfiguredProfessionalNetworkHost,
  isSupportedProfessionalNetworkFormatRequest,
} from "./professional-network";

const originalConfig = {
  FIRE_ENGINE_BETA_URL: config.FIRE_ENGINE_BETA_URL,
  ENRICH_URL_HOSTS: config.ENRICH_URL_HOSTS,
};

describe("professional network blocklist bypass", () => {
  beforeEach(() => {
    config.FIRE_ENGINE_BETA_URL = "https://fire-engine.example";
    config.ENRICH_URL_HOSTS = ["profiles.example"];
  });

  afterEach(() => {
    config.FIRE_ENGINE_BETA_URL = originalConfig.FIRE_ENGINE_BETA_URL;
    config.ENRICH_URL_HOSTS = originalConfig.ENRICH_URL_HOSTS;
  });

  it("detects configured hosts and leaves path handling to Fire Engine", () => {
    expect(
      isConfiguredProfessionalNetworkHost(
        "https://profiles.example/person/example-person/details/experience/?trk=foo",
      ),
    ).toBe(true);
    expect(
      isConfiguredProfessionalNetworkHost("https://profiles.example/any/path"),
    ).toBe(true);

    expect(
      isConfiguredProfessionalNetworkHost(
        "https://other.example/person/example-person",
      ),
    ).toBe(false);
    expect(isConfiguredProfessionalNetworkHost("not a url")).toBe(false);
  });

  it("accepts only formats that Fire Engine can return directly", () => {
    expect(isSupportedProfessionalNetworkFormatRequest(undefined)).toBe(true);
    expect(
      isSupportedProfessionalNetworkFormatRequest([{ type: "markdown" }]),
    ).toBe(true);
    expect(isSupportedProfessionalNetworkFormatRequest(["json"])).toBe(true);
    expect(
      isSupportedProfessionalNetworkFormatRequest([
        { type: "markdown" },
        { type: "json" },
      ]),
    ).toBe(true);
    expect(
      isSupportedProfessionalNetworkFormatRequest([{ type: "html" }]),
    ).toBe(false);
    expect(isSupportedProfessionalNetworkFormatRequest([])).toBe(false);
  });

  it("allows eligible requests through the blocklist when the team flag is enabled", () => {
    expect(
      canBypassProfessionalNetworkBlocklist({
        url: "https://profiles.example/person/example-person",
        formats: [{ type: "markdown" }],
        flags: { enrichBeta: true },
      }),
    ).toBe(true);

    expect(
      canBypassProfessionalNetworkBlocklist({
        url: "https://profiles.example/person/example-person",
        formats: [{ type: "json" }],
        actions: [{ type: "wait" }],
        flags: { enrichBeta: true },
      }),
    ).toBe(false);

    expect(
      canBypassProfessionalNetworkBlocklist({
        url: "https://profiles.example/person/example-person",
        formats: [{ type: "json" }],
        zeroDataRetention: true,
        flags: { enrichBeta: true },
      }),
    ).toBe(false);
  });

  it("does not bypass the blocklist unless the team flag is enabled", () => {
    expect(
      canBypassProfessionalNetworkBlocklist({
        url: "https://profiles.example/person/example-person",
        formats: [{ type: "markdown" }],
      }),
    ).toBe(false);

    expect(
      canBypassProfessionalNetworkBlocklist({
        url: "https://profiles.example/person/example-person",
        formats: [{ type: "markdown" }],
        flags: { enrichBeta: false },
      }),
    ).toBe(false);
  });

  it("does not bypass the blocklist unless Fire Engine is configured", () => {
    config.FIRE_ENGINE_BETA_URL = undefined;

    expect(
      canBypassProfessionalNetworkBlocklist({
        url: "https://profiles.example/person/example-person",
        formats: [{ type: "markdown" }],
        flags: { enrichBeta: true },
      }),
    ).toBe(false);
  });

  it("returns 15 credits only for successful enabled configured-host responses", () => {
    expect(
      getProfessionalNetworkSuccessCredits({
        url: "https://profiles.example/person/example-person",
        formats: [{ type: "markdown" }],
        flags: { enrichBeta: true },
        statusCode: 200,
      }),
    ).toBe(15);

    expect(
      getProfessionalNetworkSuccessCredits({
        url: "https://profiles.example/person/example-person",
        formats: [{ type: "markdown" }],
        flags: { enrichBeta: true },
        statusCode: 404,
      }),
    ).toBeNull();
  });
});
