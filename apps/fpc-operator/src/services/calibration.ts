import { AztecAddress } from "@aztec/aztec.js/addresses";
import { type AbiType, type ContractArtifact, type FunctionAbi } from "@aztec/aztec.js/abi";
import { Contract } from "@aztec/aztec.js/contracts";
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract";
import { EmbeddedWallet } from "@gregojuice/embedded-wallet";
import { SubscriptionFPC } from "@gregojuice/aztec/subscription-fpc";
import {
  FPC_SUBSCRIBE_OVERHEAD_DA_GAS_PRIVATE,
  FPC_SUBSCRIBE_OVERHEAD_DA_GAS_PUBLIC,
  FPC_SUBSCRIBE_OVERHEAD_L2_GAS_PRIVATE,
  FPC_SUBSCRIBE_OVERHEAD_L2_GAS_PUBLIC,
  FPC_TEARDOWN_DA_GAS,
  FPC_TEARDOWN_L2_GAS,
} from "@gregojuice/aztec/fpc-gas-constants";

// ── Calibration index cache ─────────────────────────────────────────
//
// The throwaway `sign_up` tx that `calibrateSponsoredApp` issues is the
// expensive part of calibration — the simulation that follows is essentially
// free. Cache the index per contract+selector so subsequent runs reuse the
// same slot and skip the sign_up. Backed up via `backupService` so an
// operator can restore them along with the FPC and signed-up apps.

const CALIBRATION_CACHE_KEY = "gregojuice_calibration_indices";

export type CalibrationIndices = Record<string, number>;

/** Returns the full cache map. Used by backup export. */
export function getCalibrationIndices(): CalibrationIndices {
  try {
    return JSON.parse(localStorage.getItem(CALIBRATION_CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Replaces the entire cache. Used by backup restore. */
export function setCalibrationIndices(indices: CalibrationIndices): void {
  localStorage.setItem(CALIBRATION_CACHE_KEY, JSON.stringify(indices));
}

function cacheKey(contract: string, selector: string): string {
  return `${contract}:${selector}`;
}

function getCachedCalibrationIndex(contract: string, selector: string): number | undefined {
  return getCalibrationIndices()[cacheKey(contract, selector)];
}

function setCachedCalibrationIndex(contract: string, selector: string, index: number): void {
  const indices = getCalibrationIndices();
  indices[cacheKey(contract, selector)] = index;
  setCalibrationIndices(indices);
}

/**
 * Converts user-provided string args into the format expected by contract.methods[name]().
 * Fields and integers are passed as hex strings; the contract methods API handles encoding.
 */
function parseArg(value: string, type: AbiType): unknown {
  switch (type.kind) {
    case "field":
    case "integer": {
      try {
        const v = value || "0";
        const bigint = v.startsWith("0x") ? BigInt(v) : BigInt(v);
        return "0x" + bigint.toString(16);
      } catch {
        return "0x0";
      }
    }
    case "boolean":
      return value === "true";
    case "struct": {
      if ("path" in type && typeof type.path === "string" && type.path.includes("AztecAddress"))
        return value || "0x" + "0".repeat(64);
      try {
        return "0x" + BigInt(value || "0").toString(16);
      } catch {
        return "0x0";
      }
    }
    case "array": {
      if ("type" in type && "length" in type) {
        const innerType = type.type as AbiType;
        const len = type.length as number;
        try {
          const items = JSON.parse(value) as string[];
          return items.map((item) => parseArg(String(item), innerType));
        } catch {
          return Array.from({ length: len }, () => parseArg("0", innerType));
        }
      }
      return [];
    }
    default:
      return value || "0x0";
  }
}

export interface CalibrationResult {
  /**
   * Sponsored fn's own gas limits (no FPC overhead). Committed into the
   * swap network config so runtime callers can rebuild the composite with
   * the right overhead for subscribe vs sponsor.
   */
  gasLimits: { daGas: number; l2Gas: number };
  /**
   * Subscribe-wrapped gas (gasLimits + subscribe FPC overhead). Displayed
   * to the operator as the worst-case single-tx cost; also used to size
   * the slot note's `max_fee` against the P75 fee-per-gas.
   */
  subscribeGasLimits: { daGas: number; l2Gas: number };
  teardownGasLimits: { daGas: number; l2Gas: number };
  /**
   * Whether the sponsored call enqueues a public phase. Detected at
   * calibration from the simulation result — not `sampleCall.type`,
   * because private fns can enqueue public work too.
   */
  hasPublicCall: boolean;
}

interface CalibrationBaseParams {
  adminWallet: EmbeddedWallet;
  adminAddress: AztecAddress;
  fpc: SubscriptionFPC;
  artifact: ContractArtifact;
  contractInstance: ContractInstanceWithAddress;
  selectedFunction: FunctionAbi;
  argValues: string[];
}

/**
 * Operator-facing wrapper around the shared `calibrateSponsoredApp` helper.
 * Builds the sample call from the wizard's form state, runs calibration
 * through the FPC, and augments the result with the subscribe-wrapped
 * composite + teardown limits for the UI's fee calculator.
 */
export async function runCalibration(params: CalibrationBaseParams): Promise<CalibrationResult> {
  const {
    adminWallet,
    adminAddress,
    fpc,
    artifact,
    contractInstance,
    selectedFunction,
    argValues,
  } = params;

  const adminMeta = await adminWallet.getContractMetadata(contractInstance.address);
  if (!adminMeta.instance) {
    await adminWallet.registerContract(contractInstance, artifact);
  }

  const contract = Contract.at(contractInstance.address, artifact, adminWallet);
  const parsedArgs = selectedFunction.parameters.map((p, i) =>
    parseArg(argValues[i] ?? "0", p.type),
  );
  const action = contract.methods[selectedFunction.name](...parsedArgs);
  const sampleCall = await action.getFunctionCall();

  // Reuse a cached calibration slot if we've calibrated this contract+selector
  // before. Only the slot is reusable — args may have changed, so we always
  // re-simulate to get fresh gas numbers.
  const cachedIndex = getCachedCalibrationIndex(
    sampleCall.to.toString(),
    sampleCall.selector.toString(),
  );

  const calibrated = await fpc.helpers.calibrate({
    adminWallet,
    adminAddress,
    sampleCall,
    calibrationIndex: cachedIndex,
  });
  if (cachedIndex === undefined) {
    setCachedCalibrationIndex(
      sampleCall.to.toString(),
      sampleCall.selector.toString(),
      calibrated.calibrationIndex,
    );
  }
  const gasLimits = { daGas: calibrated.daGas, l2Gas: calibrated.l2Gas };
  const hasPublicCall = calibrated.hasPublicCall;

  const subscribeOverheadDa = hasPublicCall
    ? FPC_SUBSCRIBE_OVERHEAD_DA_GAS_PUBLIC
    : FPC_SUBSCRIBE_OVERHEAD_DA_GAS_PRIVATE;
  const subscribeOverheadL2 = hasPublicCall
    ? FPC_SUBSCRIBE_OVERHEAD_L2_GAS_PUBLIC
    : FPC_SUBSCRIBE_OVERHEAD_L2_GAS_PRIVATE;

  return {
    gasLimits,
    subscribeGasLimits: {
      daGas: gasLimits.daGas + subscribeOverheadDa,
      l2Gas: gasLimits.l2Gas + subscribeOverheadL2,
    },
    teardownGasLimits: {
      daGas: FPC_TEARDOWN_DA_GAS,
      l2Gas: FPC_TEARDOWN_L2_GAS,
    },
    hasPublicCall,
  };
}
