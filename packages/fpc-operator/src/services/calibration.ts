import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { AbiType, ContractArtifact, FunctionAbi } from "@aztec/aztec.js/abi";
import { Contract } from "@aztec/aztec.js/contracts";
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract";
import { EmbeddedWallet } from "@gregojuice/embedded-wallet";
import { buildNoirFunctionCall } from "@gregojuice/contracts/subscription-fpc";
import {
  SubscriptionFPCContract,
} from "@gregojuice/contracts/artifacts/SubscriptionFPC";
import { computeVarArgsHash } from "@aztec/stdlib/hash";
import { HashedValues } from "@aztec/stdlib/tx";
import { NO_FROM } from "@aztec/aztec.js/account";

const MAX_U128 = 2n ** 128n - 1n;

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
  gasLimits: { daGas: number; l2Gas: number };
  teardownGasLimits: { daGas: number; l2Gas: number };
  calibrationIndex: number;
}

interface CalibrationBaseParams {
  adminWallet: EmbeddedWallet;
  adminAddress: AztecAddress;
  fpcAddress: AztecAddress;
  artifact: ContractArtifact;
  contractInstance: ContractInstanceWithAddress;
  selectedFunction: FunctionAbi;
  argValues: string[];
}

async function buildSampleCall(params: CalibrationBaseParams) {
  const { adminWallet, artifact, contractInstance, selectedFunction, argValues } = params;

  const adminMeta = await adminWallet.getContractMetadata(contractInstance.address);
  if (!adminMeta.instance) {
    await adminWallet.registerContract(contractInstance, artifact);
  }

  const contract = Contract.at(contractInstance.address, artifact, adminWallet);
  const parsedArgs = selectedFunction.parameters.map((p, i) =>
    parseArg(argValues[i] ?? "0", p.type),
  );
  return contract.methods[selectedFunction.name](...parsedArgs).getFunctionCall();
}

async function simulateSubscription(params: {
  adminWallet: EmbeddedWallet;
  adminAddress: AztecAddress;
  fpcAddress: AztecAddress;
  sampleCall: Awaited<ReturnType<typeof buildSampleCall>>;
  calibrationIndex: number;
}): Promise<CalibrationResult> {
  const { adminWallet, adminAddress, fpcAddress, sampleCall, calibrationIndex } = params;

  const adminFpc = SubscriptionFPCContract.at(fpcAddress, adminWallet);
  const noirCall = await buildNoirFunctionCall(sampleCall);

  const { estimatedGas } = await adminFpc.methods
    .subscribe(noirCall, calibrationIndex, adminAddress)
    .with({
      extraHashedArgs: [
        new HashedValues(sampleCall.args, await computeVarArgsHash(sampleCall.args)),
      ],
    })
    .simulate({
      from: NO_FROM,
      fee: { estimateGas: true, estimatedGasPadding: 0 },
      additionalScopes: [adminAddress, fpcAddress],
    });

  return {
    gasLimits: { daGas: Number(estimatedGas.gasLimits.daGas), l2Gas: Number(estimatedGas.gasLimits.l2Gas) },
    teardownGasLimits: { daGas: Number(estimatedGas.teardownGasLimits.daGas), l2Gas: Number(estimatedGas.teardownGasLimits.l2Gas) },
    calibrationIndex,
  };
}

export class CalibrationError extends Error {
  constructor(message: string, public readonly calibrationIndex: number) {
    super(message);
  }
}

/**
 * Full calibration: sign_up (creates a slot) + simulate subscription.
 * Returns the calibrationIndex for retries.
 * If simulation fails after sign_up succeeds, throws CalibrationError with the index.
 */
export async function runCalibration(
  params: CalibrationBaseParams,
): Promise<CalibrationResult> {
  const { adminWallet, adminAddress, fpcAddress } = params;

  const sampleCall = await buildSampleCall(params);

  const adminFpc = SubscriptionFPCContract.at(fpcAddress, adminWallet);
  const calibrationIndex = 1000000 + Math.floor(Math.random() * 1000000);

  await adminFpc.methods
    .sign_up(sampleCall.to, sampleCall.selector, calibrationIndex, 1, MAX_U128, 1)
    .send({ from: adminAddress });

  try {
    return await simulateSubscription({
      adminWallet,
      adminAddress,
      fpcAddress,
      sampleCall,
      calibrationIndex,
    });
  } catch (err) {
    throw new CalibrationError(
      err instanceof Error ? err.message : "Simulation failed",
      calibrationIndex,
    );
  }
}

/**
 * Retry just the simulation with different args, reusing the existing calibration slot.
 * Simulation doesn't consume notes, so the same slot can be re-simulated.
 */
export async function retryCalibrationSimulation(
  params: CalibrationBaseParams & { calibrationIndex: number },
): Promise<CalibrationResult> {
  const sampleCall = await buildSampleCall(params);

  return simulateSubscription({
    adminWallet: params.adminWallet,
    adminAddress: params.adminAddress,
    fpcAddress: params.fpcAddress,
    sampleCall,
    calibrationIndex: params.calibrationIndex,
  });
}
