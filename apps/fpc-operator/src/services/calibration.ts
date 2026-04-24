import { AztecAddress } from "@aztec/aztec.js/addresses";
import { FunctionType, type AbiType, type ContractArtifact, type FunctionAbi } from "@aztec/aztec.js/abi";
import { Contract } from "@aztec/aztec.js/contracts";
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract";
import { EmbeddedWallet } from "@gregojuice/embedded-wallet";
import {
  FPC_SUBSCRIBE_OVERHEAD_DA_GAS_PRIVATE,
  FPC_SUBSCRIBE_OVERHEAD_DA_GAS_PUBLIC,
  FPC_SUBSCRIBE_OVERHEAD_L2_GAS_PRIVATE,
  FPC_SUBSCRIBE_OVERHEAD_L2_GAS_PUBLIC,
} from "@gregojuice/aztec/fpc-gas-constants";

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
}

interface CalibrationBaseParams {
  adminWallet: EmbeddedWallet;
  adminAddress: AztecAddress;
  artifact: ContractArtifact;
  contractInstance: ContractInstanceWithAddress;
  selectedFunction: FunctionAbi;
  argValues: string[];
}

/**
 * Simulates the sponsored fn standalone (no FPC wrapping) and derives the
 * subscribe-wrapped total by adding the known FPC overhead.
 *
 * Replaces the previous flow of provisioning a throwaway slot with
 * `max_fee=MAX_U128` and simulating `subscribe(...)` through the FPC —
 * which required a real tx per calibration. Standalone simulation is
 * equivalent for gas purposes (the FPC's contribution is a fixed constant
 * that depends only on whether the sponsored call has a public phase) and
 * saves one tx + its proof.
 */
export async function runCalibration(params: CalibrationBaseParams): Promise<CalibrationResult> {
  const { adminWallet, adminAddress, artifact, contractInstance, selectedFunction, argValues } = params;

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

  const { estimatedGas } = await action.simulate({
    from: adminAddress,
    fee: { estimateGas: true, estimatedGasPadding: 0 },
  });
  if (!estimatedGas) {
    throw new Error("Simulation returned no gas estimate");
  }

  const gasLimits = {
    daGas: Number(estimatedGas.gasLimits.daGas),
    l2Gas: Number(estimatedGas.gasLimits.l2Gas),
  };

  const isPublic = sampleCall.type === FunctionType.PUBLIC;
  const subscribeOverheadDa = isPublic
    ? FPC_SUBSCRIBE_OVERHEAD_DA_GAS_PUBLIC
    : FPC_SUBSCRIBE_OVERHEAD_DA_GAS_PRIVATE;
  const subscribeOverheadL2 = isPublic
    ? FPC_SUBSCRIBE_OVERHEAD_L2_GAS_PUBLIC
    : FPC_SUBSCRIBE_OVERHEAD_L2_GAS_PRIVATE;

  return {
    gasLimits,
    subscribeGasLimits: {
      daGas: gasLimits.daGas + subscribeOverheadDa,
      l2Gas: gasLimits.l2Gas + subscribeOverheadL2,
    },
    teardownGasLimits: {
      daGas: Number(estimatedGas.teardownGasLimits.daGas),
      l2Gas: Number(estimatedGas.teardownGasLimits.l2Gas),
    },
  };
}
