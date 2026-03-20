import { AztecAddress } from "@aztec/stdlib/aztec-address";
import {
  collectOffchainEffects,
  type ExecutionPayload,
} from "@aztec/stdlib/tx";
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account";
import type { AztecNode } from "@aztec/aztec.js/node";
import {
  type InteractionWaitOptions,
  NO_WAIT,
  type SendReturn,
  extractOffchainOutput,
} from "@aztec/aztec.js/contracts";
import { waitForTx } from "@aztec/aztec.js/node";
import type { SendOptions } from "@aztec/aztec.js/wallet";
import { FeeJuicePaymentMethodWithClaim } from "@aztec/aztec.js/fee";
import { CallAuthorizationRequest } from "@aztec/aztec.js/authorization";
import { type FeeOptions } from "@aztec/wallet-sdk/base-wallet";
import {
  txProgress,
  type PhaseTiming,
  type TxProgressEvent,
} from "./tx-progress";
import type { FieldsOf } from "@aztec/foundation/types";
import { GasSettings } from "@aztec/stdlib/gas";
import {
  EmbeddedWallet as EmbeddedWalletBase,
  type EmbeddedWalletOptions,
} from "@aztec/wallets/embedded";
import { AccountManager } from "@aztec/aztec.js/wallet";
import { Fr } from "@aztec/foundation/curves/bn254";
import type { ClaimCredentials } from "./services/bridgeService";
import { FeeJuiceContract } from "@aztec/aztec.js/protocol";

export class EmbeddedWallet extends EmbeddedWalletBase {
  static override create<T extends EmbeddedWalletBase = EmbeddedWallet>(
    nodeOrUrl: string | AztecNode,
    options?: EmbeddedWalletOptions,
  ): Promise<T> {
    return super.create<T>(nodeOrUrl, options);
  }

  /**
   * Returns the AccountManager for the first stored account, creating a new Schnorr
   * account (with random credentials) if none exist yet. Does NOT deploy.
   */
  async getOrCreateAccount(): Promise<AccountManager> {
    const existing = await this.getAccounts();
    if (existing.length > 0) {
      const { secretKey, salt, signingKey, type } =
        await this.walletDB.retrieveAccount(existing[0].item);
      return this.createAccountInternal(type, secretKey, salt, signingKey);
    }
    return this.createSchnorrAccount(
      Fr.random(),
      Fr.random(),
      undefined,
      "main",
    );
  }

  async isAccountDeployed(): Promise<boolean> {
    const [account] = await this.getAccounts();
    if (!account) return false;
    const metadata = await this.getContractMetadata(account.item);
    return metadata.isContractInitialized;
  }

  /**
   * Exports the account credentials so the user can import them elsewhere.
   */
  async exportAccountCredentials(): Promise<{
    secretKey: string;
    salt: string;
    signingKey: string;
    address: string;
  }> {
    const [account] = await this.getAccounts();
    if (!account) throw new Error("No account exists");
    const retrieved = await this.walletDB.retrieveAccount(account.item);
    const { secretKey, salt } = retrieved;
    // signingKey is stored as Buffer after retrieval — convert to hex
    const sk = (retrieved as Record<string, unknown>).signingKey;
    const signingKeyHex = Buffer.isBuffer(sk)
      ? `0x${sk.toString("hex")}`
      : String(sk);
    return {
      secretKey: secretKey.toString(),
      salt: salt.toString(),
      signingKey: signingKeyHex,
      address: account.item.toString(),
    };
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

  /**
   * Checks if there is an existing stored account (without creating one).
   */
  async hasStoredAccount(): Promise<boolean> {
    const existing = await this.getAccounts();
    return existing.length > 0;
  }

  /**
   * Claims fee juice on an already-deployed account (for self).
   * Uses FeeJuicePaymentMethodWithClaim to claim and pay for the tx in one go.
   */
  async claimFeeJuice(claim: ClaimCredentials) {
    const [account] = await this.getAccounts();
    if (!account) throw new Error("No account exists");

    const fj = FeeJuiceContract.at(this);
    const paymentMethod = new FeeJuicePaymentMethodWithClaim(account.item, {
      claimAmount: BigInt(claim.claimAmount),
      claimSecret: Fr.fromHexString(claim.claimSecret),
      messageLeafIndex: BigInt(claim.messageLeafIndex),
    });

    return fj.methods.check_balance(0n).send({
      from: account.item,
      fee: { paymentMethod },
    });
  }

  /**
   * Claims fee juice for an arbitrary target address.
   * The caller (this account) pays for the claim tx gas.
   * The claimed fee juice goes to `targetAddress`, not to the caller.
   */
  async claimFeeJuiceForRecipient(
    claim: ClaimCredentials,
    targetAddress: string,
  ) {
    const [account] = await this.getAccounts();
    if (!account) throw new Error("No account exists");

    const fj = FeeJuiceContract.at(this);
    const target = AztecAddress.fromString(targetAddress);

    return fj.methods
      .claim(
        target,
        BigInt(claim.claimAmount),
        Fr.fromHexString(claim.claimSecret),
        Fr.fromHexString(
          `0x${BigInt(claim.messageLeafIndex).toString(16).padStart(64, "0")}`,
        ),
      )
      .send({ from: account.item });
  }

  /**
   * Deploys the account using FeeJuicePaymentMethodWithClaim —
   * claims bridged fee juice and uses it to pay for the deployment in one tx.
   */
  async deployAccountWithClaim(claim: ClaimCredentials) {
    const accountManager = await this.getOrCreateAccount();
    const deployMethod = await accountManager.getDeployMethod();

    const paymentMethod = new FeeJuicePaymentMethodWithClaim(
      accountManager.address,
      {
        claimAmount: BigInt(claim.claimAmount),
        claimSecret: Fr.fromHexString(claim.claimSecret),
        messageLeafIndex: BigInt(claim.messageLeafIndex),
      },
    );

    return await deployMethod.send({
      from: AztecAddress.ZERO,
      fee: { paymentMethod },
    });
  }

  override async sendTx<W extends InteractionWaitOptions = undefined>(
    executionPayload: ExecutionPayload,
    opts: SendOptions<W>,
  ): Promise<SendReturn<W>> {
    const txId = crypto.randomUUID();
    const startTime = Date.now();
    const phases: PhaseTiming[] = [];

    const meaningfulCall =
      executionPayload.calls?.find(
        (c) =>
          c.name !== "sponsor_unconditionally" &&
          c.name !== "claim_and_end_setup",
      ) ?? executionPayload.calls?.[0];
    const fnName = meaningfulCall?.name ?? "Transaction";
    const label =
      fnName === "constructor"
        ? "Deploy Account"
        : fnName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

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
      const feeOptions = await this.completeFeeOptions(
        opts.from,
        executionPayload.feePayer,
        opts.fee?.gasSettings,
      );

      emit("simulating");
      const simulationStart = Date.now();
      const simulationResult = await this.simulateViaEntrypoint(
        executionPayload,
        {
          from: opts.from,
          feeOptions,
          scopes: this.scopesFrom(opts.from),
          skipFeeEnforcement: true,
          skipTxValidation: true,
        },
      );
      const offchainEffects = collectOffchainEffects(
        simulationResult.privateExecutionResult,
      );
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
      for (const wit of authWitnesses) {
        if (wit) executionPayload.authWitnesses.push(wit);
      }
      const simulationDuration = Date.now() - simulationStart;
      const simStats = simulationResult.stats;
      const breakdown: Array<{ label: string; duration: number }> = [];
      const details: string[] = [];
      if (simStats?.timings) {
        const t = simStats.timings;
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
      const txRequest = await this.createTxExecutionRequestFromPayloadAndFee(
        executionPayload,
        opts.from,
        feeOptions,
      );
      const provenTx = await this.pxe.proveTx(
        txRequest,
        this.scopesFrom(opts.from),
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

      emit("sending");
      const sendingStart = Date.now();
      const tx = await provenTx.toTx();
      const txHash = tx.getTxHash();
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
      const receipt = await waitForTx(this.aztecNode, txHash, waitOpts);
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
