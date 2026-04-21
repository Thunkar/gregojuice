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
import { Gas, type GasSettings } from "@aztec/stdlib/gas";
import { FPC_TEARDOWN_L2_GAS, FPC_TEARDOWN_DA_GAS } from "./fpc-gas-constants.js";
import {
  SubscriptionFPCContract,
  SubscriptionFPCContractArtifact,
} from "../noir/artifacts/SubscriptionFPC.js";
import { computeVarArgsHash, computeCalldataHash } from "@aztec/stdlib/hash";
import { HashedValues } from "@aztec/stdlib/tx";
import { NO_FROM } from "@aztec/aztec.js/account";
import { Fr } from "@aztec/aztec.js/fields";
import { deriveKeys } from "@aztec/aztec.js/keys";

const MAX_U128 = 2n ** 128n - 1n;

/**
 * Converts a TS FunctionCall into the Noir FunctionCall struct shape
 * expected by the SubscriptionFPC's `sponsor` method.
 */
/**
 * For public calls, the args_hash is computed over [selector, ...args] (the full calldata).
 * For private calls, it's computed over just args.
 * See encoding.ts in @aztec/entrypoints for the canonical behavior.
 */
export async function buildNoirFunctionCall(call: FunctionCall) {
  const isPublic = call.type === FunctionType.PUBLIC;
  // Public calldata = [selector, ...args] hashed with the public calldata domain separator.
  // Private args are hashed with the function args domain separator.
  const argsHash = isPublic
    ? await computeCalldataHash([call.selector.toField(), ...call.args])
    : await computeVarArgsHash(call.args);
  return {
    args_hash: argsHash,
    function_selector: call.selector.toField(),
    hide_msg_sender: call.hideMsgSender,
    is_static: call.isStatic,
    target_address: call.to,
    is_public: isPublic,
  };
}

/**
 * Builds the HashedValues for the sponsored call's extra hashed args.
 * Public calls use HashedValues.fromCalldata([selector, ...args]).
 * Private calls use HashedValues.fromArgs(args).
 */
export async function buildExtraHashedArgs(call: FunctionCall): Promise<HashedValues[]> {
  const isPublic = call.type === FunctionType.PUBLIC;
  if (isPublic) {
    return [await HashedValues.fromCalldata([call.selector.toField(), ...call.args])];
  }
  return [await HashedValues.fromArgs(call.args)];
}

export async function calibrateSponsoredApp(params: {
  /** Wallet with the admin account, used to send sign_up txs */
  adminWallet: EmbeddedWallet;
  /** Address of the admin account in adminWallet */
  adminAddress: AztecAddress;
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
  /** Auth witnesses required by the sponsored call */
  authWitnesses?: AuthWitness[];
  /** Additional scopes required by the sponsored call  */
  additionalScopes?: AztecAddress[];
}): Promise<{
  maxFee: bigint;
  estimatedGas: Pick<GasSettings, "gasLimits" | "teardownGasLimits">;
}> {
  const {
    adminWallet,
    adminAddress,
    node,
    fpcAddress,
    sampleCall,
    feeMultiplier = 10,
    authWitnesses = [],
    additionalScopes = [],
  } = params;

  const appAddress = sampleCall.to;
  const selector = sampleCall.selector;

  // Instantiate the FPC
  const adminFpc = SubscriptionFPCContract.at(fpcAddress, adminWallet);

  // --- Step 1: Calibration sign_up (unique index per calibration, MAX fee) ---
  // Use a high index unlikely to collide with production indices
  const calibrationIndex = 1000000 + Math.floor(Math.random() * 1000000);
  await adminFpc.methods
    .sign_up(appAddress, selector, calibrationIndex, 1, MAX_U128, 1)
    .send({ from: adminAddress });

  // --- Step 2: Simulate subscription to measure gas ---
  const noirCall = await buildNoirFunctionCall(sampleCall);

  const { estimatedGas } = await adminFpc.methods
    .subscribe(noirCall, calibrationIndex, adminAddress)
    .with({
      authWitnesses,
      extraHashedArgs: await buildExtraHashedArgs(sampleCall),
    })
    .simulate({
      from: NO_FROM,
      fee: { estimateGas: true, estimatedGasPadding: 0 },
      additionalScopes: [adminAddress, fpcAddress, ...additionalScopes],
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
      extraHashedArgs: await buildExtraHashedArgs(call),
    })
    .send({
      from: NO_FROM,
      additionalScopes: [userAddress, fpc.address],
      fee: {
        gasSettings: { teardownGasLimits: new Gas(FPC_TEARDOWN_DA_GAS, FPC_TEARDOWN_L2_GAS) },
      },
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
      extraHashedArgs: await buildExtraHashedArgs(call),
    })
    .send({
      from: NO_FROM,
      additionalScopes: [userAddress, fpc.address],
      fee: {
        gasSettings: { teardownGasLimits: new Gas(FPC_TEARDOWN_DA_GAS, FPC_TEARDOWN_L2_GAS) },
      },
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
   *
   * Pass `secretKey` to make the FPC address deterministic (e.g. so tests can
   * include it in a pre-funded genesis set). Otherwise a random key is used.
   */
  static async deployWithKeys(
    wallet: Wallet,
    admin: AztecAddressLike,
    opts: { secretKey?: Fr } = {},
  ) {
    const secretKey = opts.secretKey ?? Fr.random();
    const { publicKeys } = await deriveKeys(secretKey);
    const deployment = SubscriptionFPCContract.deployWithPublicKeys(publicKeys, wallet, admin);
    return { deployment, secretKey };
  }

  static get artifact(): ContractArtifact {
    return SubscriptionFPCContractArtifact;
  }

  // --- Helpers ---

  get helpers() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const fpc = this;
    return {
      /**
       * Calibrates gas for a sponsored app by running the full sponsor flow
       */
      calibrate: (params: {
        adminWallet: EmbeddedWallet;
        adminAddress: AztecAddress;
        node: AztecNode;
        sampleCall: FunctionCall;
        maxUses?: number;
        maxUsers?: number;
        feeMultiplier?: number;
        authWitnesses?: AuthWitness[];
        additionalScopes?: AztecAddress[];
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
