import * as photos from "ente-photos-wasm";
import {
    deriveKey,
    encryptBox,
    generateKey,
    generateKeyPair,
} from "ente-prelogin-wasm";
import { afterEach, describe, expect, test, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("Photos", () => {
    test("returns decrypted contacts and picture bytes as plain values", async () => {
        const fixture = await encryptedContact();
        mockFetch((request) => {
            switch (new URL(request.url).pathname) {
                case "/contacts/diff":
                    return Response.json({
                        diff: Array.from({ length: 2 }, (_, i) => ({
                            ...fixture.contact,
                            id: `ct_${i}`,
                        })),
                    });
                case "/contacts/ct_test":
                    return Response.json(fixture.contact);
                case "/attachments/profile_picture/att_test":
                    return Response.json({
                        url: "http://localhost/picture",
                    });
                case "/picture":
                    return new Response(fixture.encryptedPicture);
                default:
                    throw new Error(`Unexpected request: ${request.url}`);
            }
        });

        const session = await photos.openSession({
            baseUrl: "http://localhost",
            authToken: "test-token",
            masterKeyB64: fixture.masterKey,
            ...(await sessionKeyAttributes(fixture.masterKey)),
        });
        try {
            const diff = await photos.contactsGetDiff(
                session,
                fixture.wrappedRootContactKey,
                0,
                2,
            );
            expect(diff).toStrictEqual({
                records: Array.from({ length: 2 }, (_, i) => ({
                    id: `ct_${i}`,
                    contactUserId: 42,
                    email: "friend@example.com",
                    name: "Zoë 🦋",
                    profilePictureAttachmentID: "att_test",
                    isDeleted: false,
                    updatedAt: 1725000000000000,
                })),
                wrappedRootContactKey: fixture.wrappedRootContactKey,
            });

            const picture = await photos.contactsGetProfilePicture(
                session,
                fixture.wrappedRootContactKey,
                "ct_test",
            );
            expect(picture.bytes).toBeInstanceOf(Uint8Array);
            expect(picture).toStrictEqual({
                bytes: fixture.picture,
                wrappedRootContactKey: fixture.wrappedRootContactKey,
            });
        } finally {
            session.free();
        }
    });

    test("preserves tombstone optionals and rejects failures as Errors", async () => {
        const contact = {
            id: "ct_deleted",
            contactUserID: 42,
            isDeleted: true,
            createdAt: 100,
            updatedAt: 200,
        };
        mockFetch(() => Response.json({ diff: [contact] }));

        const masterKey = await generateKey();
        const session = await photos.openSession({
            baseUrl: "http://localhost",
            authToken: "test-token",
            masterKeyB64: masterKey,
            ...(await sessionKeyAttributes(masterKey)),
        });
        try {
            expect(
                await photos.contactsGetDiff(session, undefined, 0, 1000),
            ).toStrictEqual({
                records: [
                    {
                        id: "ct_deleted",
                        contactUserId: 42,
                        email: undefined,
                        name: undefined,
                        profilePictureAttachmentID: undefined,
                        isDeleted: true,
                        updatedAt: 200,
                    },
                ],
                wrappedRootContactKey: undefined,
            });

            contact.updatedAt = Number.MAX_SAFE_INTEGER + 1;
            await expect(
                photos.contactsGetDiff(session, undefined, 0, 1000),
            ).rejects.toBeInstanceOf(Error);

            mockFetch(() => new Response(null, { status: 500 }));
            await expect(
                photos.contactsGetDiff(session, undefined, 0, 1000),
            ).rejects.toBeInstanceOf(Error);
        } finally {
            session.free();
        }
    });
});

test("box encryption round-trips and derives keys from fragments", async () => {
    const key = await generateKey();
    const box = await encryptBox("aGVsbG8gd29ybGQ=", key);
    expect(await photos.decryptBox(box, key)).toBe("aGVsbG8gd29ybGQ=");

    const { publicKey, privateKey } = await generateKeyPair();
    expect(publicKey).not.toStrictEqual(privateKey);
    expect(typeof (await deriveKey("", "", 0, 0))).not.toBe("undefined");
});

const mockFetch = (
    respond: (request: Request) => Response | Promise<Response>,
) =>
    vi.stubGlobal("fetch", async (request: Request) => {
        const response = await respond(request);
        // reqwest reads the response URL, which constructed Responses omit.
        Object.defineProperty(response, "url", { value: request.url });
        return response;
    });

const sessionKeyAttributes = async (
    masterKey: string,
    recoveryKey?: string,
) => {
    const { publicKey, privateKey } = await generateKeyPair();
    const encryptedSecretKey = await encryptBox(privateKey, masterKey);
    const encryptedRecoveryKey = await encryptBox(
        recoveryKey ?? (await generateKey()),
        masterKey,
    );
    return {
        userID: 42,
        keyAttributes: {
            publicKey,
            encryptedSecretKey: encryptedSecretKey.encryptedData,
            secretKeyDecryptionNonce: encryptedSecretKey.nonce,
            recoveryKeyEncryptedWithMasterKey:
                encryptedRecoveryKey.encryptedData,
            recoveryKeyDecryptionNonce: encryptedRecoveryKey.nonce,
        },
    };
};

const encryptedContact = async () => {
    const masterKey = await generateKey();
    const rootKey = await generateKey();
    const contactKey = await generateKey();
    const wrappedRootKey = await encryptBox(rootKey, masterKey);
    const wrappedContactKey = await encryptBox(contactKey, rootKey);
    const data = await encryptBox(
        Buffer.from(JSON.stringify({ contactUserId: 42, name: "Zoë 🦋" }))
            .toString("base64"),
        contactKey,
    );
    const picture = Uint8Array.from({ length: 4096 }, (_, i) => i % 256);
    const encryptedPicture = await encryptBox(
        Buffer.from(picture).toString("base64"),
        contactKey,
    );
    const fixture = {
        masterKey,
        wrappedRootContactKey: {
            encryptedKey: wrappedRootKey.encryptedData,
            header: wrappedRootKey.nonce,
        },
        contact: {
            id: "ct_test",
            contactUserID: 42,
            email: "friend@example.com",
            profilePictureAttachmentID: "att_test",
            encryptedKey: combined(
                wrappedContactKey.nonce,
                wrappedContactKey.encryptedData,
            ).toString("base64"),
            encryptedData: combined(
                data.nonce,
                data.encryptedData,
            ).toString("base64"),
            isDeleted: false,
            createdAt: 100,
            updatedAt: 1725000000000000,
        },
        picture,
        encryptedPicture: combined(
            encryptedPicture.nonce,
            encryptedPicture.encryptedData,
        ),
    };
    return fixture;
};

const combined = (header: string, ciphertext: string) =>
    Buffer.concat([
        Buffer.from(header, "base64"),
        Buffer.from(ciphertext, "base64"),
    ]);
