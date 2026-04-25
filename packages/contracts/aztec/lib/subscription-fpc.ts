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
import type { EmbeddedWallet } from "@aztec/wallets/embedded";
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
 * further based on whether the tx contains a public phase — the FPC's own
 * private note ops get repriced at AVM rates in that case.
 *
 * `hasPublicCall` reflects the **whole tx**'s pricing regime, not just the
 * sponsored fn's top-level type: a private-typed fn that enqueues a public
 * call (e.g. via `self.call(...)` into a public fn) still shifts the tx
 * into public pricing. Pass `true` iff anything in the sponsored call's
 * transitive execution ends up in a public phase.
 */
export function fpcSubscribeOverhead(hasPublicCall: boolean): Gas {
  return new Gas(
    hasPublicCall ? FPC_SUBSCRIBE_OVERHEAD_DA_GAS_PUBLIC : FPC_SUBSCRIBE_OVERHEAD_DA_GAS_PRIVATE,
    hasPublicCall ? FPC_SUBSCRIBE_OVERHEAD_L2_GAS_PUBLIC : FPC_SUBSCRIBE_OVERHEAD_L2_GAS_PRIVATE,
  );
}

export function fpcSponsorOverhead(hasPublicCall: boolean): Gas {
  return new Gas(
    hasPublicCall ? FPC_SPONSOR_OVERHEAD_DA_GAS_PUBLIC : FPC_SPONSOR_OVERHEAD_DA_GAS_PRIVATE,
    hasPublicCall ? FPC_SPONSOR_OVERHEAD_L2_GAS_PUBLIC : FPC_SPONSOR_OVERHEAD_L2_GAS_PRIVATE,
  );
}

const FPC_TEARDOWN_GAS = new Gas(FPC_TEARDOWN_DA_GAS, FPC_TEARDOWN_L2_GAS);

const MAX_U128 = 2n ** 128n - 1n;

/**
 * Measures the gas a sponsored fn uses when dispatched from the FPC's
 * `subscribe` entrypoint, and returns it standalone (overhead subtracted).
 *
 * Can't just simulate the fn directly: the standalone path runs through
 * the admin's account entrypoint, which has different gas than the FPC's
 * `subscribe` dispatch. At runtime the FPC's entrypoint is what executes,
 * so we need to measure under those same conditions.
 *
 * How: provision a throwaway slot with `max_fee = MAX_U128` at a random
 * index (so no fee gate trips during the estimator's inflated-limits pass),
 * simulate `fpc.subscribe(noirCall, ...)`, then subtract the known
 * subscribe overhead. Callers add whatever overhead fits their path
 * (subscribe/sponsor) when they actually send.
 *
 * Returns the `calibrationIndex` of the throwaway slot so callers can
 * cache it per contract+selector. Pass it back in via `calibrationIndex`
 * to reuse the slot — the `sign_up` tx is then skipped, since simulation
 * doesn't consume the slot's notes.
 */
export async function calibrateSponsoredApp(params: {
  /** FPC admin wallet — signs the throwaway sign_up tx and simulates subscribe */
  adminWallet: EmbeddedWallet;
  /** FPC admin address — used as the sponsored call's `from` in simulation */
  adminAddress: AztecAddress;
  /** Address of the already-deployed FPC */
  fpcAddress: AztecAddress;
  /** Sample FunctionCall to measure (from `method(...).getFunctionCall()`) */
  sampleCall: FunctionCall;
  /** Auth witnesses required by the sponsored call */
  authWitnesses?: AuthWitness[];
  /** Additional scopes required by the sponsored call during simulation */
  additionalScopes?: AztecAddress[];
  /**
   * Reuse a previously-provisioned calibration slot at this index. When set,
   * the `sign_up` tx is skipped — caller is responsible for ensuring a slot
   * was previously provisioned at this index for this contract+selector
   * with `max_fee = MAX_U128, max_users = 1` (e.g. by caching the index
   * returned from a prior call).
   */
  calibrationIndex?: number;
}): Promise<{ daGas: number; l2Gas: number; hasPublicCall: boolean; calibrationIndex: number }> {
  const {
    adminWallet,
    adminAddress,
    fpcAddress,
    sampleCall,
    authWitnesses = [],
    additionalScopes = [],
  } = params;

  const adminFpc = SubscriptionFPCContract.at(fpcAddress, adminWallet);
  const calibrationIndex =
    params.calibrationIndex ?? 1_000_000 + Math.floor(Math.random() * 1_000_000);

  if (params.calibrationIndex === undefined) {
    await adminFpc.methods
      .sign_up(sampleCall.to, sampleCall.selector, calibrationIndex, 1, MAX_U128, 1)
      .send({ from: adminAddress });
  }

  const noirCall = await buildNoirFunctionCall(sampleCall);
  const subscribeInteraction = adminFpc.methods
    .subscribe(noirCall, calibrationIndex, adminAddress)
    .with({
      authWitnesses,
      extraHashedArgs: await buildExtraHashedArgs(sampleCall),
    });

  // Build the execution payload ourselves so we can call wallet.simulateTx
  // directly and inspect publicInputs for enqueued public calls — the
  // top-level `simulate({ estimateGas })` API only returns gas numbers and
  // loses the public-phase signal we need to pick the right overhead
  // constant.
  const payload = await subscribeInteraction.request();
  const simulated = await adminWallet.simulateTx(payload, {
    from: NO_FROM,
    fee: { gasSettings: {} },
    additionalScopes: [adminAddress, fpcAddress, ...additionalScopes],
  });

  // A private fn can enqueue public work (e.g. `self.call(...)` to a
  // public fn). When that happens the tx shifts into public pricing —
  // the FPC's own private side effects get repriced at AVM rates — so
  // we must use the PUBLIC overhead constant, not the PRIVATE one.
  // `numberOfPublicCallRequests()` catches both public top-level calls
  // and public calls enqueued from private.
  const hasPublicCall = simulated.publicInputs.numberOfPublicCallRequests() > 0;

  const subscribeDa = Number(simulated.gasUsed.totalGas.daGas);
  const subscribeL2 = Number(simulated.gasUsed.totalGas.l2Gas);
  const subscribeOverhead = fpcSubscribeOverhead(hasPublicCall);
  const derivedDa = Math.max(0, subscribeDa - Number(subscribeOverhead.daGas));
  const derivedL2 = Math.max(0, subscribeL2 - Number(subscribeOverhead.l2Gas));

  return { daGas: derivedDa, l2Gas: derivedL2, hasPublicCall, calibrationIndex };
}

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
  /** Whether the sponsored call has a public phase (from calibration) */
  hasPublicCall: boolean;
  /** Auth witnesses required by the sponsored call */
  authWitnesses?: AuthWitness[];
}) {
  const {
    fpc,
    call,
    configIndex,
    userAddress,
    gasLimits,
    hasPublicCall,
    authWitnesses = [],
  } = params;

  const totalGasLimits = new Gas(gasLimits.daGas, gasLimits.l2Gas).add(
    fpcSubscribeOverhead(hasPublicCall),
  );

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
  /** Whether the sponsored call has a public phase (from calibration) */
  hasPublicCall: boolean;
  /** Auth witnesses required by the sponsored call */
  authWitnesses?: AuthWitness[];
}) {
  const {
    fpc,
    call,
    configIndex,
    userAddress,
    gasLimits,
    hasPublicCall,
    authWitnesses = [],
  } = params;

  const totalGasLimits = new Gas(gasLimits.daGas, gasLimits.l2Gas).add(
    fpcSponsorOverhead(hasPublicCall),
  );

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
       * Measures a sponsored fn's standalone gas under the same entrypoint
       * (the FPC's `subscribe`) that it runs through at send-time.
       */
      calibrate: (params: {
        adminWallet: EmbeddedWallet;
        adminAddress: AztecAddress;
        sampleCall: FunctionCall;
        authWitnesses?: AuthWitness[];
        additionalScopes?: AztecAddress[];
        /**
         * Reuse a previously-provisioned calibration slot at this index.
         * Skips the throwaway `sign_up` tx — caller is responsible for
         * caching the index returned by an earlier `calibrate` call.
         */
        calibrationIndex?: number;
      }) =>
        calibrateSponsoredApp({
          ...params,
          fpcAddress: fpc.address,
        }),

      /**
       * Subscribes and sends a sponsored call through the FPC.
       */
      subscribe: (params: {
        call: FunctionCall;
        configIndex: number;
        userAddress: AztecAddress;
        gasLimits: { daGas: number; l2Gas: number };
        hasPublicCall: boolean;
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
        hasPublicCall: boolean;
        authWitnesses?: AuthWitness[];
      }) =>
        sendSponsoredCall({
          ...params,
          fpc: fpc.contract,
        }),
    };
  }
}
