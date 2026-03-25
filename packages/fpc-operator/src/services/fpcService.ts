import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { AztecNode } from "@aztec/aztec.js/node";
import type { FunctionSelector } from "@aztec/aztec.js/abi";
import { Fr } from "@aztec/aztec.js/fields";
import { poseidon2Hash } from "@aztec/foundation/crypto/poseidon";
import { EmbeddedWallet } from "@gregojuice/embedded-wallet";
import {
  SubscriptionFPCContract,
  SubscriptionFPCContractArtifact,
} from "@gregojuice/contracts/artifacts/SubscriptionFPC";
import { deriveKeys } from "@aztec/aztec.js/keys";

// ── localStorage keys ────────────────────────────────────────────────

const FPC_ADDRESS_KEY = "gregojuice_fpc_address";
const FPC_SECRET_KEY = "gregojuice_fpc_secret";
const FPC_SALT_KEY = "gregojuice_fpc_salt";
const FPC_DEPLOYED_KEY = "gregojuice_fpc_deployed";
const SIGNED_UP_APPS_KEY = "gregojuice_fpc_apps";

// ── Stored FPC state ─────────────────────────────────────────────────

export interface StoredFPC {
  address: string;
  secretKey: string;
  salt: string;
  deployed: boolean;
}

export function getStoredFPC(): StoredFPC | null {
  try {
    const address = localStorage.getItem(FPC_ADDRESS_KEY);
    const secretKey = localStorage.getItem(FPC_SECRET_KEY);
    const salt = localStorage.getItem(FPC_SALT_KEY);
    if (address && secretKey && salt) return {
      address,
      secretKey,
      salt,
      deployed: localStorage.getItem(FPC_DEPLOYED_KEY) === "true",
    };
  } catch {}
  return null;
}

function storeFPC(address: string, secretKey: string, salt: string) {
  localStorage.setItem(FPC_ADDRESS_KEY, address);
  localStorage.setItem(FPC_SECRET_KEY, secretKey);
  localStorage.setItem(FPC_SALT_KEY, salt);
}

function markFPCDeployed() {
  localStorage.setItem(FPC_DEPLOYED_KEY, "true");
}

// ── Signed-up app configs ────────────────────────────────────────────

export interface SignedUpApp {
  appAddress: string;
  functionSelector: string;
  configIndex: number;
  maxUses: number;
  maxFee: string;
  maxUsers: number;
  createdAt: number;
}

export function getSignedUpApps(): SignedUpApp[] {
  try {
    const raw = localStorage.getItem(SIGNED_UP_APPS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSignedUpApps(apps: SignedUpApp[]) {
  localStorage.setItem(SIGNED_UP_APPS_KEY, JSON.stringify(apps));
}

export function addSignedUpApp(app: SignedUpApp) {
  const apps = getSignedUpApps();
  apps.push(app);
  saveSignedUpApps(apps);
}

// ── Config ID computation (matches Noir contract) ────────────────────

export async function computeConfigId(
  appAddress: AztecAddress,
  selector: FunctionSelector,
  configIndex: number,
): Promise<Fr> {
  return poseidon2Hash([
    appAddress.toField(),
    selector.toField(),
    new Fr(configIndex),
  ]);
}

// ── FPC preparation + deployment ─────────────────────────────────────

/**
 * Pre-computes the FPC address without deploying. The address is deterministic
 * from the secret key and admin address, so it can be funded before deployment.
 * Stores the FPC keys in localStorage for later deployment.
 */
export async function prepareFPC(
  wallet: EmbeddedWallet,
  adminAddress: AztecAddress,
): Promise<{ fpcAddress: AztecAddress; secretKey: Fr }> {
  const stored = getStoredFPC();
  if (stored) {
    return {
      fpcAddress: AztecAddress.fromString(stored.address),
      secretKey: Fr.fromString(stored.secretKey),
    };
  }

  const secretKey = Fr.random();
  const salt = Fr.random();
  const { publicKeys } = await deriveKeys(secretKey);

  const deployment = SubscriptionFPCContract.deployWithPublicKeys(
    publicKeys,
    wallet,
    adminAddress,
  );
  const instance = await deployment.getInstance({ contractAddressSalt: salt });

  await wallet.registerContract(instance, SubscriptionFPCContractArtifact, secretKey);

  storeFPC(instance.address.toString(), secretKey.toString(), salt.toString());

  return { fpcAddress: instance.address, secretKey };
}

/**
 * Deploys the FPC contract on-chain. Must call prepareFPC first.
 * The admin account must have fee juice to pay for the deployment tx.
 */
export async function deployFPC(
  wallet: EmbeddedWallet,
  adminAddress: AztecAddress,
): Promise<{ fpcAddress: AztecAddress }> {
  const stored = getStoredFPC();
  if (!stored) throw new Error("Call prepareFPC first");

  const secretKey = Fr.fromString(stored.secretKey);
  const salt = Fr.fromString(stored.salt);
  const { publicKeys } = await deriveKeys(secretKey);

  const deployment = SubscriptionFPCContract.deployWithPublicKeys(
    publicKeys,
    wallet,
    adminAddress,
  );
  // getInstance caches, so passing the salt here ensures the same address
  await deployment.getInstance({ contractAddressSalt: salt });

  await deployment.send({ from: adminAddress, contractAddressSalt: salt });
  markFPCDeployed();

  return { fpcAddress: AztecAddress.fromString(stored.address) };
}

// ── Load existing FPC ────────────────────────────────────────────────

export async function loadExistingFPC(
  wallet: EmbeddedWallet,
  node: AztecNode,
  stored: StoredFPC,
): Promise<SubscriptionFPCContract> {
  const address = AztecAddress.fromString(stored.address);
  const secretKey = Fr.fromString(stored.secretKey);

  // Check if already registered locally in PXE
  const metadata = await wallet.getContractMetadata(address);
  if (!metadata.instance) {
    // Fetch the publicly deployed instance from the node
    const instance = await node.getContract(address);
    if (!instance) {
      throw new Error(
        `FPC contract at ${address.toString()} not found on-chain. It may need to be redeployed.`,
      );
    }
    await wallet.registerContract(instance, SubscriptionFPCContractArtifact, secretKey);
  }

  return SubscriptionFPCContract.at(address, wallet);
}

// ── Sign up an app ───────────────────────────────────────────────────

export interface SignUpParams {
  appAddress: AztecAddress;
  selector: FunctionSelector;
  configIndex: number;
  maxUses: number;
  maxFee: bigint;
  maxUsers: number;
}

export async function signUpApp(
  fpc: SubscriptionFPCContract,
  adminAddress: AztecAddress,
  params: SignUpParams,
) {
  await fpc.methods
    .sign_up(
      params.appAddress,
      params.selector,
      params.configIndex,
      params.maxUses,
      params.maxFee,
      params.maxUsers,
    )
    .send({ from: adminAddress });

  addSignedUpApp({
    appAddress: params.appAddress.toString(),
    functionSelector: params.selector.toString(),
    configIndex: params.configIndex,
    maxUses: params.maxUses,
    maxFee: params.maxFee.toString(),
    maxUsers: params.maxUsers,
    createdAt: Date.now(),
  });
}

// ── Query slot availability ──────────────────────────────────────────

export async function queryAvailableSlots(
  fpc: SubscriptionFPCContract,
  configId: Fr,
): Promise<number> {
  const result = await fpc.methods
    .count_available_slots(configId)
    .simulate();
  return Number(result);
}

// ── Query subscription info ──────────────────────────────────────────

export async function querySubscriptionInfo(
  fpc: SubscriptionFPCContract,
  user: AztecAddress,
  configId: Fr,
): Promise<{ hasSubscription: boolean; remainingUses: number }> {
  const result = await fpc.methods
    .get_subscription_info(user, configId)
    .simulate();
  return {
    hasSubscription: result[0] as boolean,
    remainingUses: Number(result[1]),
  };
}
