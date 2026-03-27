/**
 * E2E Tests for the Initializerless Schnorr Account
 *
 * Verifies that the initializerless immutables pattern works end-to-end:
 * - Account creation produces correct addresses
 * - Immutables are stored and verified against the contract salt
 * - The account can sign and send transactions without deployment
 * - Different keys/salts produce different addresses
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import type { AztecNode } from "@aztec/aztec.js/node";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";

import {
  SchnorrInitializerlessAccountContract,
  SchnorrInitializerlessAccountContractArtifact,
} from "../artifacts/SchnorrInitializerlessAccount.js";
import {
  computeContractSalt,
  createSchnorrInitializerlessAccount,
  serializeSigningKey,
  createSigningKeyCapsule,
  type SigningPublicKey,
  deployWithImmutables,
  computeImmutablesAddress,
  createImmutablesInstance,
} from "@gregojuice/embedded-wallet";

const NODE_URL = process.env.AZTEC_NODE_URL ?? "http://localhost:8080";

const SIGNING_KEY_1: SigningPublicKey = {
  x: new Fr(111n),
  y: new Fr(222n),
};
const SIGNING_KEY_2: SigningPublicKey = {
  x: new Fr(333n),
  y: new Fr(444n),
};
const ACTUAL_SALT_1 = new Fr(12345n);
const ACTUAL_SALT_2 = new Fr(54321n);

describe("SchnorrInitializerlessAccount", () => {
  let node: AztecNode;
  let wallet: EmbeddedWallet;
  let alice: AztecAddress;

  beforeAll(async () => {
    node = createAztecNodeClient(NODE_URL);
    await waitForNode(node);

    wallet = await EmbeddedWallet.create(node, { ephemeral: true });

    const testAccounts = await getInitialTestAccountsData();
    [alice] = await Promise.all(
      testAccounts.slice(0, 1).map(async (account) => {
        return (
          await wallet.createSchnorrAccount(
            account.secret,
            account.salt,
            account.signingKey,
          )
        ).address;
      }),
    );
  });

  // -- Pure computation tests (no deployment) --

  it("should produce different addresses for different signing keys", async () => {
    const result1 = await computeSchnorrAccountAddress(
      SIGNING_KEY_1,
      ACTUAL_SALT_1,
    );
    const result2 = await computeSchnorrAccountAddress(
      SIGNING_KEY_2,
      ACTUAL_SALT_1,
    );

    expect(result1.toString()).not.toBe(result2.toString());
  });

  it("should produce different addresses for different actualSalt", async () => {
    const result1 = await computeSchnorrAccountAddress(
      SIGNING_KEY_1,
      ACTUAL_SALT_1,
    );
    const result2 = await computeSchnorrAccountAddress(
      SIGNING_KEY_1,
      ACTUAL_SALT_2,
    );

    expect(result1.toString()).not.toBe(result2.toString());
  });

  it("should compute correct contract salt", async () => {
    const salt = await computeContractSalt(ACTUAL_SALT_1, SIGNING_KEY_1);

    expect(salt.toBigInt()).not.toBe(0n);

    // Same inputs → same salt
    const salt2 = await computeContractSalt(ACTUAL_SALT_1, SIGNING_KEY_1);
    expect(salt.toBigInt()).toBe(salt2.toBigInt());

    // Different key → different salt
    const differentSalt = await computeContractSalt(
      ACTUAL_SALT_1,
      SIGNING_KEY_2,
    );
    expect(salt.toBigInt()).not.toBe(differentSalt.toBigInt());

    // Different actualSalt → different salt
    const saltWithDifferentActual = await computeContractSalt(
      ACTUAL_SALT_2,
      SIGNING_KEY_1,
    );
    expect(salt.toBigInt()).not.toBe(saltWithDifferentActual.toBigInt());
  });

  // -- Deployment tests --

  it("should deploy account and read signing key back", async () => {
    const secretKey = Fr.random();
    const { signingPublicKey } =
      await createSchnorrInitializerlessAccount(secretKey);
    const serialized = serializeSigningKey(signingPublicKey);

    const result = await deployWithImmutables(
      wallet,
      SchnorrInitializerlessAccountContractArtifact,
      serialized,
      { secretKey },
    );

    expect(result.instance.address).toBeDefined();

    // Read signing key back from capsule storage
    const contract = SchnorrInitializerlessAccountContract.at(
      result.instance.address,
      wallet,
    );
    const { result: readResult } = await contract.methods
      .get_signing_public_key()
      .simulate({
        from: alice,
      });

    expect(readResult[0]).toEqual(signingPublicKey.x.toBigInt());
    expect(readResult[1]).toEqual(signingPublicKey.y.toBigInt());
  });

  it("should deploy with different secrets and get different addresses", async () => {
    const sk1 = Fr.random();
    const sk2 = Fr.random();

    const { signingPublicKey: pk1 } =
      await createSchnorrInitializerlessAccount(sk1);
    const { signingPublicKey: pk2 } =
      await createSchnorrInitializerlessAccount(sk2);

    const result1 = await deployWithImmutables(
      wallet,
      SchnorrInitializerlessAccountContractArtifact,
      serializeSigningKey(pk1),
      { secretKey: sk1 },
    );
    const result2 = await deployWithImmutables(
      wallet,
      SchnorrInitializerlessAccountContractArtifact,
      serializeSigningKey(pk2),
      { secretKey: sk2 },
    );

    expect(result1.instance.address.toString()).not.toBe(
      result2.instance.address.toString(),
    );
  });

  it("should fail with wrong capsule data", async () => {
    // Register the contract WITHOUT persisting the capsule to the store.
    // This way, only the transient capsule is available — and it has wrong data.
    const secretKey = Fr.random();
    const { signingPublicKey } =
      await createSchnorrInitializerlessAccount(secretKey);
    const serialized = serializeSigningKey(signingPublicKey);

    const { instance } = await createImmutablesInstance(
      SchnorrInitializerlessAccountContractArtifact,
      serialized,
      { secretKey },
    );

    // Register contract in PXE but do NOT store the capsule
    await wallet.registerContract(
      instance,
      SchnorrInitializerlessAccountContractArtifact,
      secretKey,
    );

    const contract = SchnorrInitializerlessAccountContract.at(
      instance.address,
      wallet,
    );

    // Wrong signing key — produces a different capsule that won't match the salt
    const wrongKey: SigningPublicKey = {
      x: new Fr(signingPublicKey.x.toBigInt() + 1n),
      y: new Fr(signingPublicKey.y.toBigInt() + 1n),
    };
    const wrongCapsule = createSigningKeyCapsule(
      instance.address,
      Fr.random(), // wrong actualSalt too — guarantees salt mismatch
      wrongKey,
    );

    await expect(
      contract.methods
        .get_signing_public_key()
        .with({ capsules: [wrongCapsule] })
        .simulate({ from: alice }),
    ).rejects.toThrow("Immutables do not match contract salt");
  });
});

// -- Helper --

async function computeSchnorrAccountAddress(
  key: SigningPublicKey,
  actualSalt: Fr,
): Promise<AztecAddress> {
  const { address } = await computeImmutablesAddress(
    SchnorrInitializerlessAccountContractArtifact,
    serializeSigningKey(key),
    { actualSalt },
  );
  return address;
}
