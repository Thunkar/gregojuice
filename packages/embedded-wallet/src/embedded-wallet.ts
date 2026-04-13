/**
 * Extended EmbeddedWallet with initializerless Schnorr account support.
 *
 * The initializerless account is a proper account type that flows through the
 * standard createAccountInternal → AccountManager → getAccountFromAddress pipeline.
 *
 * Storage layout for initializerless accounts in WalletDB:
 *   type:       'schnorr-initializerless' (cast to AccountType — WalletDB stores as a raw string)
 *   secretKey:  the account secret key (Fr)
 *   salt:       the actualSalt (Fr) — the derived salt is recomputed on the fly
 *   signingKey: the signing private key (Fq buffer, derivable from secretKey but stored for consistency)
 */

import {
  collectOffchainEffects,
  SimulationOverrides,
  mergeExecutionPayloads,
  type ExecutionPayload,
  type TxSimulationResult,
  type TxExecutionRequest,
  TxStatus,
} from "@aztec/stdlib/tx";
import { NO_FROM } from "@aztec/aztec.js/account";
import { DefaultEntrypoint } from "@aztec/entrypoints/default";
import type { DefaultAccountEntrypointOptions } from "@aztec/entrypoints/account";
import type { SimulateViaEntrypointOptions } from "@aztec/wallet-sdk/base-wallet";
import type { AztecNode } from "@aztec/aztec.js/node";
import {
  type InteractionWaitOptions,
  NO_WAIT,
  type SendReturn,
  extractOffchainOutput,
  ContractFunctionInteraction,
  getGasLimits,
} from "@aztec/aztec.js/contracts";
import { waitForTx } from "@aztec/aztec.js/node";
import type { SendOptions } from "@aztec/aztec.js/wallet";
import { CallAuthorizationRequest } from "@aztec/aztec.js/authorization";
import { AccountManager } from "@aztec/aztec.js/wallet";
import {
  txProgress,
  type PhaseTiming,
  type TxProgressEvent,
} from "./tx-progress";
import {
  EmbeddedWallet as EmbeddedWalletBase,
  type EmbeddedWalletOptions,
  type AccountType,
} from "@aztec/wallets/embedded";
import { Fr } from "@aztec/foundation/curves/bn254";
import {
  createSchnorrInitializerlessAccount,
  computeContractSalt,
  serializeSigningKey,
} from "./initializerless-account";
import { GasSettings } from "@aztec/stdlib/gas";
import type { AztecAddress } from "@aztec/stdlib/aztec-address";

/** The initializerless type string — cast to AccountType for WalletDB storage. */
export const INITIALIZERLESS_TYPE = "schnorr-initializerless" as AccountType;

export class EmbeddedWallet extends EmbeddedWalletBase {
  static override create<T extends EmbeddedWalletBase = EmbeddedWallet>(
    nodeOrUrl: string | AztecNode,
    options?: EmbeddedWalletOptions,
  ): Promise<T> {
    return super.create<T>(nodeOrUrl, options);
  }

  /**
   * Override to add the 'schnorr-initializerless' account type.
   *
   * For this type:
   *   - `salt` is the actualSalt (not derived) — we compute the derived salt on the fly
   *   - `signingKey` is the Fq signing private key buffer (standard, derivable from secret)
   *   - The AccountContract returns undefined from getInitializationFunctionAndArgs()
   *     so AccountManager computes the instance with initializationHash = Fr.ZERO
   *   - After registration, we store the immutables capsule in PXE
   */
  protected override async createAccountInternal(
    type: AccountType,
    secret: Fr,
    salt: Fr,
    signingKey: Buffer,
  ): Promise<AccountManager> {
    if (type !== INITIALIZERLESS_TYPE) {
      return super.createAccountInternal(type, secret, salt, signingKey);
    }

    // `salt` here is the actualSalt. Derive the contract salt from it + signing public key.
    const actualSalt = salt;
    const { account: accountContract, signingPublicKey } =
      await createSchnorrInitializerlessAccount(secret);
    const derivedSalt = await computeContractSalt(actualSalt, signingPublicKey);

    // AccountManager.create() uses the derived salt for address computation.
    // getInitializationFunctionAndArgs() returns undefined → initializationHash = Fr.ZERO.
    const accountManager = await AccountManager.create(
      this,
      secret,
      accountContract,
      derivedSalt,
    );

    const instance = accountManager.getInstance();
    const existingInstance = await this.pxe.getContractInstance(
      instance.address,
    );
    if (!existingInstance) {
      const artifact = await accountContract.getContractArtifact();
      await this.registerContract(
        instance,
        artifact,
        accountManager.getSecretKey(),
      );
    }

    // Always store/refresh the immutables capsule so the contract can verify the signing key.
    // This is idempotent — store_immutables validates against the salt before persisting.
    const artifact = await accountContract.getContractArtifact();
    const capsuleData = [
      actualSalt,
      ...(await serializeSigningKey(signingPublicKey)),
    ];
    const storeAbi = artifact.functions.find(
      (f) => f.name === "store_immutables",
    );
    if (storeAbi) {
      const storeCall = new ContractFunctionInteraction(
        this,
        instance.address,
        storeAbi,
        [capsuleData],
      );
      await storeCall.simulate({ from: instance.address });
    }

    return accountManager;
  }

  /**
   * Creates and stores a new initializerless Schnorr account.
   * Returns the AccountManager — the account is immediately usable (no deployment needed).
   */
  async createInitializerlessAccount(
    secretKey?: Fr,
    actualSalt?: Fr,
  ): Promise<AccountManager> {
    const sk = secretKey ?? Fr.random();
    const as = actualSalt ?? Fr.random();

    // Derive signing key for WalletDB storage (standard Fq buffer)
    const { signingPrivateKey } = await createSchnorrInitializerlessAccount(sk);

    // Store actualSalt in the `salt` field. The derived salt is computed in createAccountInternal.
    return this.createAndStoreAccount(
      "main",
      INITIALIZERLESS_TYPE,
      sk,
      as, // actualSalt — NOT the derived salt
      signingPrivateKey.toBuffer(),
    );
  }

  /**
   * Loads an existing stored account. If none exists, returns null.
   * Works for both initializerless and standard account types.
   */
  async loadStoredAccount(): Promise<AccountManager | null> {
    const accounts = await this.getAccounts();
    if (accounts.length === 0) return null;

    const address = accounts[0].item;
    const { secretKey, salt, signingKey, type } =
      await this.walletDB.retrieveAccount(address);

    return this.createAccountInternal(type, secretKey, salt, signingKey);
  }

  /**
   * Returns the raw account data (secretKey, salt, type) for export/backup purposes.
   */
  async getAccountData(address: AztecAddress): Promise<{
    secretKey: Fr;
    salt: Fr;
    type: string;
  }> {
    const { secretKey, salt, type } =
      await this.walletDB.retrieveAccount(address);
    return { secretKey, salt, type: type as string };
  }

  /**
   * Checks if there is an existing stored account (without creating one).
   */
  async hasStoredAccount(): Promise<boolean> {
    const existing = await this.getAccounts();
    return existing.length > 0;
  }

  /**
   * Deletes the stored account so a fresh one can be created.
   */
  async deleteStoredAccount(): Promise<void> {
    const [account] = await this.getAccounts();
    if (account) {
      await this.walletDB.deleteAccount(account.item);
    }
  }

  override async sendTx<W extends InteractionWaitOptions = undefined>(
    executionPayload: ExecutionPayload,
    opts: SendOptions<W>,
  ): Promise<SendReturn<W>> {
    const txId = crypto.randomUUID();
    const startTime = Date.now();
    const phases: PhaseTiming[] = [];

    const fnName = executionPayload.calls?.[0]?.name ?? "Transaction";
    const label = fnName
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const emit = (
      phase: TxProgressEvent["phase"],
      extra?: Partial<TxProgressEvent>,
    ) => {
      txProgress.emit({
        txId,
        label,
        phase,
        startTime,
        phaseStartTime: Date.now(),
        phases: [...phases],
        ...extra,
      });
    };

    try {
      const feeOptions = await this.completeFeeOptions({
        from: opts.from,
        feePayer: executionPayload.feePayer,
        gasSettings: opts.fee?.gasSettings,
        forEstimation: true,
      });

      emit("simulating");
      const simStart = Date.now();
      const simulationResult = await this.simulateViaEntrypoint(
        executionPayload,
        {
          from: opts.from,
          feeOptions,
          additionalScopes: opts.additionalScopes,
          skipTxValidation: true,
          skipFeeEnforcement: true,
        },
      );
      const simElapsed = Date.now() - simStart;
      const offchainEffects = collectOffchainEffects(
        simulationResult.privateExecutionResult,
      );
      const authWitStart = Date.now();
      const authWitnesses = await Promise.all(
        offchainEffects.map(async (effect) => {
          try {
            const authRequest = await CallAuthorizationRequest.fromFields(
              effect.data,
            );
            return this.createAuthWit(authRequest.onBehalfOf, {
              consumer: effect.contractAddress,
              innerHash: authRequest.innerHash,
            });
          } catch {
            return undefined;
          }
        }),
      );
      const authWitDuration = Date.now() - authWitStart;
      for (const wit of authWitnesses) {
        if (wit) executionPayload.authWitnesses.push(wit);
      }
      const simulationDuration = simElapsed + authWitDuration;
      const simStats = simulationResult.stats;
      const breakdown: Array<{ label: string; duration: number }> = [];
      const details: string[] = [];
      if (simStats?.timings) {
        const t = simStats.timings;
        const prepareDuration = simElapsed - t.total;
        if (prepareDuration > 10)
          breakdown.push({ label: "Prepare", duration: prepareDuration });
        if (t.sync > 0) breakdown.push({ label: "Sync", duration: t.sync });
        if (t.perFunction.length > 0) {
          const witgenTotal = t.perFunction.reduce(
            (sum, fn) => sum + fn.time,
            0,
          );
          breakdown.push({
            label: "Private execution",
            duration: witgenTotal,
          });
          for (const fn of t.perFunction) {
            breakdown.push({
              label: `  ${fn.functionName.split(":").pop() || fn.functionName}`,
              duration: fn.time,
            });
          }
        }
        if (t.publicSimulation)
          breakdown.push({
            label: "Public simulation",
            duration: t.publicSimulation,
          });
        if (t.unaccounted > 0)
          breakdown.push({ label: "Other", duration: t.unaccounted });
      }
      if (authWitDuration > 0)
        breakdown.push({ label: "Auth witnesses", duration: authWitDuration });
      if (simStats?.nodeRPCCalls?.roundTrips) {
        const rt = simStats.nodeRPCCalls.roundTrips;
        const fmt = (ms: number) =>
          ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
        details.push(
          `${rt.roundTrips} RPC round-trips (${fmt(rt.totalBlockingTime)} blocking)`,
        );
      }
      phases.push({
        name: "Simulation",
        duration: simulationDuration,
        color: "#ce93d8",
        ...(breakdown.length > 0 && { breakdown }),
        ...(details.length > 0 && { details }),
      });

      emit("proving");
      const provingStart = Date.now();
      const estimated = getGasLimits(
        simulationResult,
        this.estimatedGasPadding,
      );
      this.log.verbose(
        `Estimated gas limits for tx: DA=${estimated.gasLimits.daGas} L2=${estimated.gasLimits.l2Gas} teardownDA=${estimated.teardownGasLimits.daGas} teardownL2=${estimated.teardownGasLimits.l2Gas}`,
      );
      const gasSettings = GasSettings.from({
        ...opts.fee?.gasSettings,
        maxFeesPerGas: feeOptions.gasSettings.maxFeesPerGas,
        maxPriorityFeesPerGas: feeOptions.gasSettings.maxPriorityFeesPerGas,
        gasLimits: opts.fee?.gasSettings?.gasLimits ?? estimated.gasLimits,
        teardownGasLimits:
          opts.fee?.gasSettings?.teardownGasLimits ??
          estimated.teardownGasLimits,
      });
      const txRequest = await this.createTxExecutionRequestFromPayloadAndFee(
        executionPayload,
        opts.from,
        { ...feeOptions, gasSettings },
      );
      const provenTx = await this.pxe.proveTx(
        txRequest,
        this.scopesFrom(opts.from, opts.additionalScopes),
      );
      const provingDuration = Date.now() - provingStart;
      const stats = provenTx.stats;
      if (stats?.timings) {
        const t = stats.timings;
        if (t.sync && t.sync > 0)
          phases.push({ name: "Sync", duration: t.sync, color: "#90caf9" });
        if (t.perFunction?.length > 0) {
          const witgenTotal = t.perFunction.reduce(
            (sum: number, fn: { time: number }) => sum + fn.time,
            0,
          );
          phases.push({
            name: "Witgen",
            duration: witgenTotal,
            color: "#ffb74d",
            breakdown: t.perFunction.map(
              (fn: { functionName: string; time: number }) => ({
                label: fn.functionName.split(":").pop() || fn.functionName,
                duration: fn.time,
              }),
            ),
          });
        }
        if (t.proving && t.proving > 0)
          phases.push({
            name: "Proving",
            duration: t.proving,
            color: "#f48fb1",
          });
        if (t.unaccounted > 0)
          phases.push({
            name: "Other",
            duration: t.unaccounted,
            color: "#bdbdbd",
          });
      } else {
        phases.push({
          name: "Proving",
          duration: provingDuration,
          color: "#f48fb1",
        });
      }

      const offchainOutput = extractOffchainOutput(
        provenTx.getOffchainEffects(),
        provenTx.publicInputs.constants.anchorBlockHeader.globalVariables
          .timestamp,
      );

      const tx = await provenTx.toTx();
      const txHash = tx.getTxHash();
      emit("sending", { aztecTxHash: txHash.toString() });
      const sendingStart = Date.now();
      if (await this.aztecNode.getTxEffect(txHash)) {
        throw new Error(
          `A settled tx with equal hash ${txHash.toString()} exists.`,
        );
      }
      await this.aztecNode.sendTx(tx);
      phases.push({
        name: "Sending",
        duration: Date.now() - sendingStart,
        color: "#2196f3",
      });

      if (opts.wait === NO_WAIT) {
        emit("complete");
        return { txHash, ...offchainOutput } as unknown as SendReturn<W>;
      }

      emit("mining");
      const miningStart = Date.now();
      const waitOpts = typeof opts.wait === "object" ? opts.wait : undefined;
      const receipt = await waitForTx(this.aztecNode, txHash, {
        ...waitOpts,
        waitForStatus: TxStatus.PROPOSED,
      });
      phases.push({
        name: "Mining",
        duration: Date.now() - miningStart,
        color: "#4caf50",
      });

      emit("complete");
      return { receipt, ...offchainOutput } as unknown as SendReturn<W>;
    } catch (err) {
      emit("error", {
        error: err instanceof Error ? err.message : "Transaction failed",
      });
      throw err;
    }
  }
}
