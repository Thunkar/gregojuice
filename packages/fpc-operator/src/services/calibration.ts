import type { AztecNode } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { AbiType, ContractArtifact, FunctionAbi } from "@aztec/aztec.js/abi";
import { Contract } from "@aztec/aztec.js/contracts";
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract";
import { EmbeddedWallet } from "@gregojuice/embedded-wallet";
import { calibrateSponsoredApp } from "@gregojuice/contracts/subscription-fpc";

/**
 * Converts user-provided string args into the format expected by contract.methods[name]().
 * Follows the same pattern as the Aztec playground: fields and integers are passed as hex
 * strings, booleans as booleans, addresses as strings, structs as objects.
 * The contract methods API handles encoding internally via encodeArguments.
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
      // For other structs, pass as hex (best effort)
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
  maxFee: bigint;
  estimatedGas: {
    gasLimits: { daGas: number; l2Gas: number };
    teardownGasLimits: { daGas: number; l2Gas: number };
  };
}

/**
 * Runs calibration for a sponsored function.
 *
 * Uses the admin wallet for both sign_up and subscribe simulation
 * (no separate dummy user needed).
 */
export async function runCalibration(params: {
  adminWallet: EmbeddedWallet;
  adminAddress: AztecAddress;
  node: AztecNode;
  fpcAddress: AztecAddress;
  artifact: ContractArtifact;
  contractInstance: ContractInstanceWithAddress;
  selectedFunction: FunctionAbi;
  argValues: string[];
}): Promise<CalibrationResult> {
  const {
    adminWallet,
    adminAddress,
    node,
    fpcAddress,
    artifact,
    contractInstance,
    selectedFunction,
    argValues,
  } = params;

  // Register the target contract in the admin wallet (if not already)
  const adminMeta = await adminWallet.getContractMetadata(
    contractInstance.address,
  );
  if (!adminMeta.instance) {
    await adminWallet.registerContract(contractInstance, artifact);
  }

  // Build the sample FunctionCall
  const contract = Contract.at(contractInstance.address, artifact, adminWallet);
  const parsedArgs = selectedFunction.parameters.map((p, i) =>
    parseArg(argValues[i] ?? "0", p.type),
  );
  const sampleCall = await contract.methods[selectedFunction.name](
    ...parsedArgs,
  ).getFunctionCall();

  // Run calibration (uses admin wallet for both sign_up and subscribe simulation)
  const result = await calibrateSponsoredApp({
    adminWallet,
    adminAddress,
    node,
    fpcAddress,
    sampleCall,
  });

  return {
    maxFee: result.maxFee,
    estimatedGas: {
      gasLimits: {
        daGas: Number(result.estimatedGas.gasLimits.daGas),
        l2Gas: Number(result.estimatedGas.gasLimits.l2Gas),
      },
      teardownGasLimits: {
        daGas: Number(result.estimatedGas.teardownGasLimits.daGas),
        l2Gas: Number(result.estimatedGas.teardownGasLimits.l2Gas),
      },
    },
  };
}
