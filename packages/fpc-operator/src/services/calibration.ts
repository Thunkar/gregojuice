import type { AztecNode } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import type {
  ContractArtifact,
  FunctionAbi,
  FunctionCall,
} from "@aztec/aztec.js/abi";
import { Contract } from "@aztec/aztec.js/contracts";
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract";
import { Fr } from "@aztec/aztec.js/fields";
import { EmbeddedWallet } from "@gregojuice/embedded-wallet";
import { SubscriptionFPCContractArtifact } from "@gregojuice/contracts/artifacts/SubscriptionFPC";
import { calibrateSponsoredApp } from "@gregojuice/contracts/subscription-fpc";
import { getStoredFPC } from "./fpcService";
import { deriveKeys } from "@aztec/aztec.js/keys";

/**
 * Parses user-provided string args into the types expected by the contract function.
 * Simple heuristic: fields/integers → Fr or bigint, booleans → bool, addresses → AztecAddress.
 */
function parseArg(
  value: string,
  type: { kind: string; [key: string]: unknown },
): unknown {
  switch (type.kind) {
    case "field":
      return new Fr(BigInt(value || "0"));
    case "boolean":
      return value === "true";
    case "integer":
      return BigInt(value || "0");
    case "struct": {
      const path = (type as { path?: string }).path ?? "";
      if (path.includes("AztecAddress"))
        return AztecAddress.fromString(value || "0x" + "0".repeat(64));
      return new Fr(BigInt(value || "0"));
    }
    case "array": {
      const inner = type as { type: { kind: string }; length: number };
      try {
        const items = JSON.parse(value) as string[];
        return items.map((item) => parseArg(String(item), inner.type));
      } catch {
        return Array.from({ length: inner.length }, () =>
          parseArg("0", inner.type),
        );
      }
    }
    default:
      return new Fr(BigInt(value || "0"));
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
 * Creates an ephemeral dummy user wallet, registers the target contract and FPC
 * in both admin and dummy wallets, then runs `calibrateSponsoredApp`.
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

  // Get FPC secret key for registration
  const stored = getStoredFPC();
  if (!stored) throw new Error("FPC not deployed — run setup first");
  const fpcSecretKey = Fr.fromString(stored.secretKey);

  // Register the target contract in the admin wallet (if not already)
  const adminMeta = await adminWallet.getContractMetadata(
    contractInstance.address,
  );
  if (!adminMeta.instance) {
    await adminWallet.registerContract(contractInstance, artifact);
  }

  // Create ephemeral dummy user wallet
  const dummyWallet = await EmbeddedWallet.create(node, {
    pxeConfig: { proverEnabled: false },
  });
  const dummyAccount = await dummyWallet.createInitializerlessAccount();
  const dummyAddress = dummyAccount.address;

  // Register the target contract in the dummy wallet
  await dummyWallet.registerContract(contractInstance, artifact);

  // Register the FPC contract in the dummy wallet (needs the secret key for note decryption)
  const fpcInstance = await node.getContract(fpcAddress);
  if (!fpcInstance)
    throw new Error("FPC contract not found on-chain — is it deployed?");
  await dummyWallet.registerContract(
    fpcInstance,
    SubscriptionFPCContractArtifact,
    fpcSecretKey,
  );

  // Build the sample FunctionCall
  const contract = Contract.at(contractInstance.address, artifact, dummyWallet);
  const parsedArgs = selectedFunction.parameters.map((p, i) =>
    parseArg(argValues[i] ?? "0", p.type),
  );
  const sampleCall = await contract.methods[selectedFunction.name](
    ...parsedArgs,
  ).getFunctionCall();

  // Run calibration
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
