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
const SIGNED_UP_APPS_KEY = "gregojuice_fpc_apps";

// ── Stored FPC state ─────────────────────────────────────────────────

export interface StoredFPC {
  address: string;
  secretKey: string;
}

export function getStoredFPC(): StoredFPC | null {
  try {
    const address = localStorage.getItem(FPC_ADDRESS_KEY);
    const secretKey = localStorage.getItem(FPC_SECRET_KEY);
    if (address && secretKey) return { address, secretKey };
  } catch {}
  return null;
}

function storeFPC(address: string, secretKey: string) {
  localStorage.setItem(FPC_ADDRESS_KEY, address);
  localStorage.setItem(FPC_SECRET_KEY, secretKey);
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

// ── FPC deployment ───────────────────────────────────────────────────

export async function deployFPC(
  wallet: EmbeddedWallet,
  adminAddress: AztecAddress,
): Promise<{ fpcAddress: AztecAddress; secretKey: Fr }> {
  const secretKey = Fr.random();
  const { publicKeys } = await deriveKeys(secretKey);

  const deployment = SubscriptionFPCContract.deployWithPublicKeys(
    publicKeys,
    wallet,
    adminAddress,
  );
  const instance = await deployment.getInstance();

  // Register the contract so the wallet's PXE can decrypt its notes
  await wallet.registerContract(instance, SubscriptionFPCContractArtifact, secretKey);

  // Send the deployment tx
  await deployment.send({ from: adminAddress });

  const fpcAddress = instance.address;
  storeFPC(fpcAddress.toString(), secretKey.toString());

  return { fpcAddress, secretKey };
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
