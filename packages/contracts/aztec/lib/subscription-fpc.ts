import type { AztecAddress } from "@aztec/aztec.js/addresses";
import {
  FunctionType,
  type AztecAddressLike,
  type ContractArtifact,
  type FunctionCall,
} from "@aztec/aztec.js/abi";
import type { Wallet } from "@aztec/aztec.js/wallet";
import type { AuthWitness } from "@aztec/stdlib/auth-witness";
import { Gas } from "@aztec/stdlib/gas";
import {
  SubscriptionFPCContract,
  SubscriptionFPCContractArtifact,
} from "../noir/artifacts/SubscriptionFPC.js";
import { computeVarArgsHash, computeCalldataHash } from "@aztec/stdlib/hash";
import { HashedValues } from "@aztec/stdlib/tx";
import { NO_FROM } from "@aztec/aztec.js/account";
import { Fr } from "@aztec/aztec.js/fields";
import { deriveKeys } from "@aztec/aztec.js/keys";
import {
  FPC_SPONSOR_OVERHEAD_DA_GAS_PRIVATE,
  FPC_SPONSOR_OVERHEAD_DA_GAS_PUBLIC,
  FPC_SPONSOR_OVERHEAD_L2_GAS_PRIVATE,
  FPC_SPONSOR_OVERHEAD_L2_GAS_PUBLIC,
  FPC_SUBSCRIBE_OVERHEAD_DA_GAS_PRIVATE,
  FPC_SUBSCRIBE_OVERHEAD_DA_GAS_PUBLIC,
  FPC_SUBSCRIBE_OVERHEAD_L2_GAS_PRIVATE,
  FPC_SUBSCRIBE_OVERHEAD_L2_GAS_PUBLIC,
  FPC_TEARDOWN_DA_GAS,
  FPC_TEARDOWN_L2_GAS,
} from "./fpc-gas-constants.js";

/**
 * Overhead the FPC adds on top of the sponsored function's gas.
 * `subscribe` is the cold path (notes + nullifiers for slot + subscription);
 * `sponsor` reuses the existing subscription so it's cheaper. Both vary
 * further based on whether the sponsored call enqueues a public call —
 * the FPC's own private note ops get repriced at AVM rates when there is
 * one. See `fpc-overhead.test.ts` for the measurements that pin these.
 */
export function fpcSubscribeOverhead(call: FunctionCall): Gas {
  const isPublic = call.type === FunctionType.PUBLIC;
  return new Gas(
    isPublic ? FPC_SUBSCRIBE_OVERHEAD_DA_GAS_PUBLIC : FPC_SUBSCRIBE_OVERHEAD_DA_GAS_PRIVATE,
    isPublic ? FPC_SUBSCRIBE_OVERHEAD_L2_GAS_PUBLIC : FPC_SUBSCRIBE_OVERHEAD_L2_GAS_PRIVATE,
  );
}

export function fpcSponsorOverhead(call: FunctionCall): Gas {
  const isPublic = call.type === FunctionType.PUBLIC;
  return new Gas(
    isPublic ? FPC_SPONSOR_OVERHEAD_DA_GAS_PUBLIC : FPC_SPONSOR_OVERHEAD_DA_GAS_PRIVATE,
    isPublic ? FPC_SPONSOR_OVERHEAD_L2_GAS_PUBLIC : FPC_SPONSOR_OVERHEAD_L2_GAS_PRIVATE,
  );
}

const FPC_TEARDOWN_GAS = new Gas(FPC_TEARDOWN_DA_GAS, FPC_TEARDOWN_L2_GAS);

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

/**
 * Subscribes to the SubscriptionFPC and sends a call in a single tx.
 *
 * `gasLimits` is the sponsored fn's own gas (no FPC overhead) — the helper
 * adds the `subscribe`-path FPC overhead on top.
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
  /** Sponsored fn's own gas limits (no FPC overhead) */
  gasLimits: { daGas: number; l2Gas: number };
  /** Auth witnesses required by the sponsored call */
  authWitnesses?: AuthWitness[];
}) {
  const { fpc, call, configIndex, userAddress, gasLimits, authWitnesses = [] } = params;

  const totalGasLimits = new Gas(gasLimits.daGas, gasLimits.l2Gas).add(fpcSubscribeOverhead(call));

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
        gasSettings: {
          gasLimits: totalGasLimits,
          teardownGasLimits: FPC_TEARDOWN_GAS,
        },
      },
    });
}

/**
 * Sends a sponsored call through the SubscriptionFPC.
 *
 * `gasLimits` is the sponsored fn's own gas (no FPC overhead) — the helper
 * adds the `sponsor`-path FPC overhead on top. `sponsor`'s overhead is
 * smaller than `subscribe`'s because the subscription already exists.
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
  /** Sponsored fn's own gas limits (no FPC overhead) */
  gasLimits: { daGas: number; l2Gas: number };
  /** Auth witnesses required by the sponsored call */
  authWitnesses?: AuthWitness[];
}) {
  const { fpc, call, configIndex, userAddress, gasLimits, authWitnesses = [] } = params;

  const totalGasLimits = new Gas(gasLimits.daGas, gasLimits.l2Gas).add(fpcSponsorOverhead(call));

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
        gasSettings: {
          gasLimits: totalGasLimits,
          teardownGasLimits: FPC_TEARDOWN_GAS,
        },
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
       * Subscribes and sends a sponsored call through the FPC.
       */
      subscribe: (params: {
        call: FunctionCall;
        configIndex: number;
        userAddress: AztecAddress;
        gasLimits: { daGas: number; l2Gas: number };
        authWitnesses?: AuthWitness[];
      }) =>
        subscribeAndCall({
          ...params,
          fpc: fpc.contract,
        }),

      /**
       * Sends a sponsored call through the FPC.
       */
      sponsor: (params: {
        call: FunctionCall;
        configIndex: number;
        userAddress: AztecAddress;
        gasLimits: { daGas: number; l2Gas: number };
        authWitnesses?: AuthWitness[];
      }) =>
        sendSponsoredCall({
          ...params,
          fpc: fpc.contract,
        }),
    };
  }
}
