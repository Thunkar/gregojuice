import type { AztecNode } from "@aztec/aztec.js/node";
import type { EmbeddedWallet } from "@aztec/wallets/embedded";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import {
  FunctionType,
  type AztecAddressLike,
  type ContractArtifact,
  type FunctionCall,
} from "@aztec/aztec.js/abi";
import type { Wallet } from "@aztec/aztec.js/wallet";
import type { AuthWitness } from "@aztec/stdlib/auth-witness";
import type { Gas, GasSettings } from "@aztec/stdlib/gas";
import {
  SubscriptionFPCContract,
  SubscriptionFPCContractArtifact,
} from "../artifacts/SubscriptionFPC.js";
import { computeVarArgsHash } from "@aztec/stdlib/hash";
import { HashedValues } from "@aztec/stdlib/tx";
import { NO_FROM } from "@aztec/aztec.js/account";
import { Fr } from "@aztec/aztec.js/fields";
import { deriveKeys } from "@aztec/aztec.js/keys";

const MAX_U128 = 2n ** 128n - 1n;

/**
 * Converts a TS FunctionCall into the Noir FunctionCall struct shape
 * expected by the SubscriptionFPC's `sponsor` method.
 */
export async function buildNoirFunctionCall(call: FunctionCall) {
  return {
    args_hash: await computeVarArgsHash(call.args),
    function_selector: call.selector.toField(),
    hide_msg_sender: call.hideMsgSender,
    is_static: call.isStatic,
    target_address: call.to,
    is_public: call.type === FunctionType.PUBLIC,
  };
}

export async function calibrateSponsoredApp(params: {
  /** Wallet with the admin account, used to send sign_up txs */
  adminWallet: EmbeddedWallet;
  /** Address of the admin account in adminWallet */
  adminAddress: AztecAddress;
  /** Wallet for the dummy user, must have sponsored app + FPC contracts registered */
  userWallet: EmbeddedWallet;
  /** Address of a dummy user account in userWallet */
  userAddress: AztecAddress;
  /** Aztec node client */
  node: AztecNode;
  /** Address of the already-deployed and funded SubscriptionFPC contract */
  fpcAddress: AztecAddress;
  /** A sample FunctionCall for the sponsored method (from getFunctionCall()) */
  sampleCall: FunctionCall;
  /** Max uses per subscription (default 1) */
  maxUses?: number;
  /** Max concurrent subscribers (default 1) */
  maxUsers?: number;
  /** Fee safety multiplier on currentFees (default 10) */
  feeMultiplier?: number;
  /** Auth witnesses required by the sponsored call (e.g. for transfer_in_private) */
  authWitnesses?: AuthWitness[];
}): Promise<{
  maxFee: bigint;
  estimatedGas: Pick<GasSettings, "gasLimits" | "teardownGasLimits">;
}> {
  const {
    adminWallet,
    adminAddress,
    userWallet,
    userAddress,
    node,
    fpcAddress,
    sampleCall,
    feeMultiplier = 10,
    authWitnesses = [],
  } = params;

  const appAddress = sampleCall.to;
  const selector = sampleCall.selector;

  // Instantiate the FPC for each wallet
  const adminFpc = SubscriptionFPCContract.at(fpcAddress, adminWallet);
  const userFpc = SubscriptionFPCContract.at(fpcAddress, userWallet);

  // --- Step 1: Calibration sign_up (unique index per calibration, MAX fee) ---
  // Use a high index unlikely to collide with production indices
  const calibrationIndex = 1000000 + Math.floor(Math.random() * 1000000);
  await adminFpc.methods
    .sign_up(appAddress, selector, calibrationIndex, 1, MAX_U128, 1)
    .send({ from: adminAddress });

  // --- Step 2: Simulate subscription to measure gas ---
  const noirCall = await buildNoirFunctionCall(sampleCall);

  const { estimatedGas } = await userFpc.methods
    .subscribe(noirCall, calibrationIndex, userAddress)
    .with({
      authWitnesses,
      extraHashedArgs: [
        new HashedValues(
          sampleCall.args,
          await computeVarArgsHash(sampleCall.args),
        ),
      ],
    })
    .simulate({
      from: NO_FROM,
      fee: { estimateGas: true, estimatedGasPadding: 0 },
      additionalScopes: [userAddress, fpcAddress],
    });

  // --- Step 3: Compute tight max_fee ---
  const currentFees = await node.getCurrentMinFees();
  const maxFee = estimatedGas.gasLimits
    .add(estimatedGas.teardownGasLimits)
    .computeFee(currentFees.mul(feeMultiplier))
    .toBigInt();

  return {
    maxFee,
    estimatedGas,
  };
}

/**
 * Subscribes to the SubscriptionFPC and sends a call in a single tx.
 *
 * Handles the boilerplate of converting the FunctionCall to the Noir struct,
 * attaching extra hashed args, and sending with the right options.
 */
export async function subscribeAndCall(params: {
  /** SubscriptionFPC contract instance (connected to the user's wallet) */
  fpc: SubscriptionFPCContract;
  /** The FunctionCall to sponsor (from .getFunctionCall()) */
  call: FunctionCall;
  /** The config index for the sponsored app */
  configIndex: number;
  /** The subscribing user's address */
  userAddress: AztecAddress;
  /** Auth witnesses required by the sponsored call */
  authWitnesses?: AuthWitness[];
}) {
  const { fpc, call, configIndex, userAddress, authWitnesses = [] } = params;

  const noirCall = await buildNoirFunctionCall(call);

  return fpc.methods
    .subscribe(noirCall, configIndex, userAddress)
    .with({
      authWitnesses,
      extraHashedArgs: [
        new HashedValues(call.args, await computeVarArgsHash(call.args)),
      ],
    })
    .send({
      from: NO_FROM,
      additionalScopes: [userAddress, fpc.address],
    });
}

/**
 * Sends a sponsored call through the SubscriptionFPC.
 *
 * Handles the boilerplate of converting the FunctionCall to the Noir struct,
 * attaching extra hashed args, and sending with the right options.
 */
export async function sendSponsoredCall(params: {
  /** SubscriptionFPC contract instance (connected to the user's wallet) */
  fpc: SubscriptionFPCContract;
  /** The FunctionCall to sponsor (from .getFunctionCall()) */
  call: FunctionCall;
  /** The config index for the sponsored app */
  configIndex: number;
  /** The subscribing user's address */
  userAddress: AztecAddress;
  /** Auth witnesses required by the sponsored call */
  authWitnesses?: AuthWitness[];
}) {
  const { fpc, call, configIndex, userAddress, authWitnesses = [] } = params;

  const noirCall = await buildNoirFunctionCall(call);

  return fpc.methods
    .sponsor(noirCall, configIndex, userAddress)
    .with({
      authWitnesses,
      extraHashedArgs: [
        new HashedValues(call.args, await computeVarArgsHash(call.args)),
      ],
    })
    .send({
      from: NO_FROM,
      additionalScopes: [userAddress, fpc.address],
    });
}

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

  /**
   * Deploys the FPC with public keys so it can own private notes (slot notes).
   * Returns the deployment handle and the secret key needed to register the contract.
   */
  static async deployWithKeys(wallet: Wallet, admin: AztecAddressLike) {
    const secretKey = Fr.random();
    const { publicKeys } = await deriveKeys(secretKey);
    const deployment = SubscriptionFPCContract.deployWithPublicKeys(
      publicKeys,
      wallet,
      admin,
    );
    return { deployment, secretKey };
  }

  static get artifact(): ContractArtifact {
    return SubscriptionFPCContractArtifact;
  }

  // --- Helpers ---

  get helpers() {
    const fpc = this;
    return {
      /**
       * Calibrates gas for a sponsored app by running the full sponsor flow
       */
      calibrate: (params: {
        adminWallet: EmbeddedWallet;
        adminAddress: AztecAddress;
        userWallet: EmbeddedWallet;
        userAddress: AztecAddress;
        node: AztecNode;
        sampleCall: FunctionCall;
        maxUses?: number;
        maxUsers?: number;
        feeMultiplier?: number;
        authWitnesses?: AuthWitness[];
      }): Promise<{
        maxFee: bigint;
        estimatedGas: { gasLimits: Gas; teardownGasLimits: Gas };
      }> =>
        calibrateSponsoredApp({
          ...params,
          fpcAddress: fpc.address,
        }),

      /**
       * Subscribes and sends a sponsored call through the FPC. Handles building the Noir
       * FunctionCall struct, attaching hashed args, and sending with NO_FROM.
       */
      subscribe: (params: {
        call: FunctionCall;
        configIndex: number;
        userAddress: AztecAddress;
        authWitnesses?: AuthWitness[];
      }) =>
        subscribeAndCall({
          ...params,
          fpc: fpc.contract,
        }),

      /**
       * Sends a sponsored call through the FPC. Handles building the Noir
       * FunctionCall struct, attaching hashed args, and sending with NO_FROM.
       */
      sponsor: (params: {
        call: FunctionCall;
        configIndex: number;
        userAddress: AztecAddress;
        authWitnesses?: AuthWitness[];
      }) =>
        sendSponsoredCall({
          ...params,
          fpc: fpc.contract,
        }),
    };
  }
}
