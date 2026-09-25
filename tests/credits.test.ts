import { describe, expect, it } from "vitest";
import { normalizeLegacyCreditSummary, normalizeNewCreditSummary } from "../src/credits";
import type { FetchResult } from "../src/workbuddy";

const NOW = Date.UTC(2026, 8, 21, 0, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function result(body: FetchResult["body"]): FetchResult {
  return { httpStatus: 200, body };
}

describe("WorkBuddy credit normalization", () => {
  it("merges paid/free details with the summary without double counting package codes", () => {
    const summary = result({
      code: 0,
      data: {
        Packages: [
          {
            PackageCode: "shared",
            CycleTotalCapacity: "100",
            CycleRemainCapacity: "70",
          },
          {
            PackageCode: "summary-only",
            CycleCapacitySizePrecise: "20",
            CycleCapacityRemainPrecise: "10",
            CycleEndTime: NOW + 10 * 24 * 60 * 60 * 1000,
          },
        ],
      },
    });
    const paid = result({
      code: 0,
      data: {
        Accounts: [
          {
            PackageCode: "shared",
            CycleCapacitySizePrecise: "200",
            CycleCapacityRemainPrecise: "150",
            DeductionEndTime: NOW + 2 * 24 * 60 * 60 * 1000,
          },
        ],
      },
    });
    const free = result({
      code: 0,
      data: {
        Response: {
          Data: {
            Accounts: [
              {
                PackageCode: "free",
                SlicePeriodUsageDetails: [
                  { SlicePeriodCapacitySizePrecise: "50", SlicePeriodCapacityRemainPrecise: "40" },
                ],
                DeductionEndTime: "2049-12-31 23:59:59",
                CycleEndTime: NOW + 5 * 24 * 60 * 60 * 1000,
              },
            ],
          },
        },
      },
    });

    expect(normalizeNewCreditSummary({ summary, paid, free }, NOW)).toEqual({
      totalCapacity: 270,
      totalRemaining: 200,
      soonestExpireAt: NOW + 2 * 24 * 60 * 60 * 1000,
      expiryBuckets: [
        { remaining: 150, expiresAt: NOW + 2 * 24 * 60 * 60 * 1000 },
        { remaining: 40, expiresAt: NOW + 5 * 24 * 60 * 60 * 1000 },
        { remaining: 10, expiresAt: NOW + 10 * 24 * 60 * 60 * 1000 },
      ],
    });
  });

  it("parses legacy nested accounts and Beijing local expiry timestamps", () => {
    const legacy = result({
      code: "200",
      data: {
        data: {
          Accounts: [
            {
              PackageCode: "legacy",
              CapacitySize: "88.5",
              CapacityRemain: "61.25",
              ExpiredTime: "2026-09-23 00:00:00",
            },
          ],
        },
      },
    });

    expect(normalizeLegacyCreditSummary(legacy, NOW)).toEqual({
      totalCapacity: 88.5,
      totalRemaining: 61.25,
      soonestExpireAt: Date.UTC(2026, 8, 22, 16, 0, 0),
      expiryBuckets: [{ remaining: 61.25, expiresAt: Date.UTC(2026, 8, 22, 16, 0, 0) }],
    });
  });

  it("splits slice periods, combines the same expiry, and keeps unknown expiry separate", () => {
    const legacy = result({
      code: 0,
      data: {
        Accounts: [
          {
            PackageCode: "gift",
            CycleCapacitySizePrecise: 900,
            CycleCapacityRemainPrecise: 600,
            SlicePeriodUsageDetails: [
              { SlicePeriodCapacitySizePrecise: 100, SlicePeriodCapacityRemainPrecise: 80, SlicePeriodEndTime: NOW + DAY },
              { SlicePeriodCapacitySizePrecise: 200, SlicePeriodCapacityRemainPrecise: 120, SlicePeriodEndTime: NOW + 2 * DAY },
            ],
          },
          { CycleCapacitySizePrecise: 50, CycleCapacityRemainPrecise: 40, CycleEndTime: NOW + DAY },
          { CycleCapacitySizePrecise: 10, CycleCapacityRemainPrecise: 8 },
          { CycleCapacitySizePrecise: 30, CycleCapacityRemainPrecise: 0, CycleEndTime: NOW + DAY },
        ],
      },
    });
    expect(normalizeLegacyCreditSummary(legacy, NOW)).toEqual({
      totalCapacity: 390,
      totalRemaining: 248,
      soonestExpireAt: NOW + DAY,
      expiryBuckets: [
        { remaining: 120, expiresAt: NOW + DAY },
        { remaining: 120, expiresAt: NOW + 2 * DAY },
        { remaining: 8, expiresAt: null },
      ],
    });
  });

  it("returns null instead of displaying zero when no supported resource shape is present", () => {
    const missing = result({ code: 0, data: {} });
    expect(normalizeNewCreditSummary({ summary: missing, paid: missing, free: missing }, NOW)).toBeNull();
    expect(normalizeLegacyCreditSummary(missing, NOW)).toBeNull();
  });
});
