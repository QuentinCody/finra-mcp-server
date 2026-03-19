import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

interface FinraShortInterestRecord {
    symbolCode: string;
    currentShortPositionQuantity?: number;
    previousShortPositionQuantity?: number;
    settlementDate?: string;
    marketClassCode?: string;
}

interface FinraShortVolumeRecord {
    symbolCode: string;
    shortVolume?: number;
    totalVolume?: number;
    shortExemptVolume?: number;
    tradeReportDate?: string;
    marketCode?: string;
}

interface FinraThresholdRecord {
    symbolCode: string;
    thresholdListFlag?: boolean;
    regSHOThresholdFlag?: boolean;
    effectiveDate?: string;
}

interface FinraBaseRecord {
    symbolCode: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFinraShortInterest(sample: Record<string, unknown>): sample is FinraShortInterestRecord & Record<string, unknown> {
    return "symbolCode" in sample && ("currentShortPositionQuantity" in sample || "previousShortPositionQuantity" in sample);
}

function isFinraShortVolume(sample: Record<string, unknown>): sample is FinraShortVolumeRecord & Record<string, unknown> {
    return "symbolCode" in sample && ("shortVolume" in sample || "totalVolume" in sample || "shortExemptVolume" in sample);
}

function isFinraThreshold(sample: Record<string, unknown>): sample is FinraThresholdRecord & Record<string, unknown> {
    return "symbolCode" in sample && ("thresholdListFlag" in sample || "regSHOThresholdFlag" in sample);
}

function hasSymbolCode(sample: Record<string, unknown>): sample is FinraBaseRecord & Record<string, unknown> {
    return "symbolCode" in sample;
}

export class FinraDataDO extends RestStagingDO {
    protected getSchemaHints(data: unknown): SchemaHints | undefined {
        if (!data || typeof data !== "object") return undefined;

        if (Array.isArray(data)) {
            const sample = data[0];
            if (!isRecord(sample)) return undefined;

            // Consolidated Short Interest data
            if (isFinraShortInterest(sample)) {
                return {
                    tableName: "short_interest",
                    indexes: ["symbolCode", "settlementDate", "marketClassCode"],
                };
            }
            // Reg SHO Daily Short Sale Volume
            if (isFinraShortVolume(sample)) {
                return {
                    tableName: "short_volume",
                    indexes: ["symbolCode", "tradeReportDate", "marketCode"],
                };
            }
            // Threshold securities list
            if (isFinraThreshold(sample)) {
                return {
                    tableName: "threshold_list",
                    indexes: ["symbolCode", "effectiveDate"],
                };
            }
            // Generic FINRA data with symbolCode
            if (hasSymbolCode(sample)) {
                return {
                    tableName: "finra_data",
                    indexes: ["symbolCode"],
                };
            }

            return undefined;
        }

        // Single object with symbolCode
        if (isRecord(data) && hasSymbolCode(data)) {
            return {
                tableName: "finra_record",
                indexes: ["symbolCode"],
            };
        }

        return undefined;
    }
}
