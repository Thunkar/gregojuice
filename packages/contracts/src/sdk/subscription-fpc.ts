import type { AztecNode } from "@aztec/aztec.js/node";
import type { EmbeddedWallet } from "@aztec/wallets/embedded";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import type {
  AztecAddressLike,
  ContractArtifact,
  FunctionCall,
} from "@aztec/aztec.js/abi";
import type { Wallet } from "@aztec/aztec.js/wallet";
import type { Gas } from "@aztec/stdlib/gas";
import {
  SubscriptionFPCContract,
  SubscriptionFPCContractArtifact,
} from "../../artifacts/SubscriptionFPC.js";
import { setupSponsoredApp } from "./setup-sponsored-app.js";
import { sendSponsoredCall } from "./send-sponsored-call.js";

/**
 * Wrapper around the codegen'd SubscriptionFPCContract that adds helper methods
 * for common operations (setup calibration, sending sponsored calls).
 */
export class SubscriptionFPC {
  constructor(public readonly contract: SubscriptionFPCContract) {}

  // --- Delegated properties ---

  get address(): AztecAddress {
    return this.contract.address;
  }

  get methods(): SubscriptionFPCContract["methods"] {
    return this.contract.methods;
  }

  withWallet(wallet: Wallet): SubscriptionFPC {
    return new SubscriptionFPC(this.contract.withWallet(wallet));
  }

  // --- Delegated statics ---

  static at(address: AztecAddress, wallet: Wallet): SubscriptionFPC {
    return new SubscriptionFPC(SubscriptionFPCContract.at(address, wallet));
  }

  static deploy(wallet: Wallet, admin: AztecAddressLike) {
    return SubscriptionFPCContract.deploy(wallet, admin);
  }

  static get artifact(): ContractArtifact {
    return SubscriptionFPCContractArtifact;
  }

  // --- Helpers ---

  get helpers() {
    const fpc = this;
    return {
      /**
       * Calibrates gas for a sponsored app by running the full sponsor flow,
       * then creates the production config with a measured max_fee.
       *
       * Uses index 0 for calibration, index 1 for production.
       */
      setup: (params: {
        adminWallet: EmbeddedWallet;
        adminAddress: AztecAddress;
        userWallet: EmbeddedWallet;
        userAddress: AztecAddress;
        node: AztecNode;
        sampleCall: FunctionCall;
        maxUses?: number;
        maxUsers?: number;
        feeMultiplier?: number;
      }): Promise<{ maxFee: bigint; gasLimits: Gas; teardownGasLimits: Gas }> =>
        setupSponsoredApp({
          ...params,
          fpcAddress: fpc.address,
        }),

      /**
       * Sends a sponsored call through the FPC. Handles building the Noir
       * FunctionCall struct, attaching hashed args, and sending with NO_FROM.
       */
      sponsor: (params: {
        call: FunctionCall;
        configIndex: number;
        userAddress: AztecAddress;
      }) =>
        sendSponsoredCall({
          ...params,
          fpc: fpc.contract,
        }),
    };
  }
}
