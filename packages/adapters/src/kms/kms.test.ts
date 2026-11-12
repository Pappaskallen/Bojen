import { randomBytes } from "node:crypto";
import { DecryptCommand, GenerateDataKeyCommand } from "@aws-sdk/client-kms";
import { describe, expect, it } from "vitest";
import { createAwsKms, type KmsSender } from "./aws";
import { kmsFromEnv } from "./env";
import { createLocalKms, localKmsFromEnv } from "./local";

describe("local KMS", () => {
  const kms = createLocalKms(randomBytes(32));

  it("wraps and unwraps a 32-byte data key", async () => {
    const { plaintext, encrypted } = await kms.generateDataKey("tenant-a");
    expect(plaintext).toHaveLength(32);
    expect(encrypted.includes(plaintext)).toBe(false);
    expect((await kms.decryptDataKey("tenant-a", encrypted)).equals(plaintext)).toBe(true);
  });

  it("refuses to unwrap a key for another tenant or with another master key", async () => {
    const { encrypted } = await kms.generateDataKey("tenant-a");
    await expect(kms.decryptDataKey("tenant-b", encrypted)).rejects.toThrow(/this tenant/);
    await expect(
      createLocalKms(randomBytes(32)).decryptDataKey("tenant-a", encrypted),
    ).rejects.toThrow();
  });

  it("needs a master key of 32 bytes from the environment", () => {
    expect(() => localKmsFromEnv({})).toThrow(/LOCAL_KMS_MASTER_KEY/);
    expect(() => createLocalKms(randomBytes(16))).toThrow(/32 bytes/);
    expect(() =>
      localKmsFromEnv({ LOCAL_KMS_MASTER_KEY: randomBytes(32).toString("base64") }),
    ).not.toThrow();
  });
});

describe("AWS KMS adapter", () => {
  /** A fake client that records commands; no call ever leaves the process. */
  function fakeClient() {
    const commands: unknown[] = [];
    const client: KmsSender = {
      send: ((command: unknown) => {
        commands.push(command);
        if (command instanceof GenerateDataKeyCommand) {
          return Promise.resolve({
            Plaintext: new Uint8Array(32).fill(7),
            CiphertextBlob: new Uint8Array([1, 2, 3]),
          });
        }
        return Promise.resolve({ Plaintext: new Uint8Array(32).fill(7) });
      }) as KmsSender["send"],
    };
    return { client, commands };
  }

  it("asks for an AES-256 key with the tenant as encryption context", async () => {
    const { client, commands } = fakeClient();
    const kms = createAwsKms(client, "alias/bojen-test");

    const key = await kms.generateDataKey("tenant-a");
    expect(key.plaintext).toHaveLength(32);
    expect([...key.encrypted]).toEqual([1, 2, 3]);

    await kms.decryptDataKey("tenant-a", key.encrypted);
    const [generate, decrypt] = commands as [GenerateDataKeyCommand, DecryptCommand];
    expect(generate.input).toMatchObject({
      KeyId: "alias/bojen-test",
      KeySpec: "AES_256",
      EncryptionContext: { tenant_id: "tenant-a" },
    });
    expect(decrypt).toBeInstanceOf(DecryptCommand);
    expect(decrypt.input).toMatchObject({ EncryptionContext: { tenant_id: "tenant-a" } });
  });
});

describe("kmsFromEnv", () => {
  const local = { LOCAL_KMS_MASTER_KEY: randomBytes(32).toString("base64") };

  it("uses the local KMS outside production", async () => {
    const kms = kmsFromEnv(local);
    const { plaintext, encrypted } = await kms.generateDataKey("tenant-a");
    expect((await kms.decryptDataKey("tenant-a", encrypted)).equals(plaintext)).toBe(true);
  });

  it("refuses the local KMS in production", () => {
    expect(() => kmsFromEnv(local, true)).toThrow("KMS_KEY_ID");
  });

  it("uses AWS KMS when a key id is set, without calling it", () => {
    expect(kmsFromEnv({ KMS_KEY_ID: "alias/bojen-test" }, true)).toHaveProperty("generateDataKey");
  });
});
