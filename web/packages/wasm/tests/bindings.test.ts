import * as photos from "ente-photos-wasm";
import {
    deriveKey,
    encryptBox,
    generateKey,
    generateKeyPair,
} from "ente-prelogin-wasm";
import { describe, expect, test } from "vitest";

describe("Photos wasm crypto", () => {
    test("box encryption round-trips", async () => {
        const key = await generateKey();
        const box = await encryptBox("aGVsbG8gd29ybGQ=", key);
        expect(await photos.decryptBox(box, key)).toBe("aGVsbG8gd29ybGQ=");
    });

    test("generates distinct key pairs", async () => {
        const { publicKey, privateKey } = await generateKeyPair();
        expect(publicKey).not.toStrictEqual(privateKey);
    });

    test("derives keys from fragments", async () => {
        const key = await deriveKey(
            "fragment",
            // Base64 of 16 zero bytes; the WASM requires a 16 byte salt.
            "AAAAAAAAAAAAAAAAAAAAAA==",
            2,
            8192,
        );
        expect(typeof key).toBe("string");
        expect(key.length).toBeGreaterThan(0);
    });
});
