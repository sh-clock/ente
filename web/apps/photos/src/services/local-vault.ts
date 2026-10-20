// Local vault bootstrap.
//
// Temporary bridge: the app runs fully offline with an auto-generated local
// vault instead of a hosted account login. This will later be replaced by the
// clock protocol's password-derived vault (PASSWORD -> KEK -> master key),
// at which point the placeholder kek fields below become real.
//
// TODO(protocol): replace with password-based vault bootstrap.
import {
    replaceSavedLocalUser,
    savedKeyAttributes,
    savedLocalUser,
    saveKeyAttributes,
} from "ente-accounts/services/accounts-db";
import {
    encryptBox,
    generateKey,
    generateKeyPair,
} from "ente-accounts/services/crypto";
import type { KeyAttributes } from "ente-accounts/services/user";
import { isDesktop } from "ente-base/app";
import log from "ente-base/log";
import { haveMasterKeyInSession } from "ente-base/session-storage";
import { saveAuthToken } from "ente-base/token";
import localforage from "localforage";
import {
    saveMasterKeyInSessionAndSafeStore,
    updateSessionFromElectronSafeStorageIfNeeded,
} from "ente-new/photos/services/account-keys";

// Fallback store for the vault master key.
//
// The desktop app persists the key via OS safeStorage (the preferred path).
// When safeStorage is unavailable (e.g. Linux without a keyring service), the
// key is kept in this local store instead - a vault that silently loses its
// key on restart is strictly worse than a weaker-at-rest fallback, and the
// recovery key (Settings -> Account) provides an independent recovery path.
const masterKeyStore = localforage.createInstance({
    name: "photos-local-vault",
    storeName: "keys",
});

const LOCAL_VAULT_USER_ID = 1;
const LOCAL_VAULT_EMAIL = "local@vault";

const safeStorageRoundTrips = async (masterKey: string) => {
    if (!isDesktop) return false;
    try {
        const stored = await globalThis.electron?.masterKeyFromSafeStorage();
        return stored === masterKey;
    } catch {
        return false;
    }
};

const saveMasterKeyLocally = async (masterKey: string) => {
    // Keep a fallback copy whenever OS safeStorage cannot round-trip the key
    // (e.g. Linux without a usable keyring backend). A vault that loses its
    // key on restart is strictly worse than this weaker-at-rest fallback.
    if (!(await safeStorageRoundTrips(masterKey))) {
        await masterKeyStore.setItem("masterKey", masterKey);
    }
};

const readMasterKeyLocally = async (): Promise<string | undefined> =>
    (await masterKeyStore.getItem<string>("masterKey")) ?? undefined;

const clearMasterKeyLocally = async () => {
    await masterKeyStore.removeItem("masterKey");
};

const generateVaultKeyAttributes = async (
    masterKey: string,
): Promise<KeyAttributes> => {
    const { publicKey, privateKey } = await generateKeyPair();
    const encryptedSecretKey = await encryptBox(privateKey, masterKey);
    const recoveryKey = await generateKey();
    const encryptedRecoveryKey = await encryptBox(recoveryKey, masterKey);
    // The master key sealed with the recovery key, so that the vault can be
    // recovered with it (Settings -> Account -> Recovery key).
    const masterKeyEncryptedWithRecoveryKey = await encryptBox(
        masterKey,
        recoveryKey,
    );
    return {
        // Placeholder kek fields: there is no password yet. Regenerated when
        // the password-based vault bootstrap lands.
        encryptedKey: "",
        keyDecryptionNonce: "",
        kekSalt: "",
        opsLimit: 0,
        memLimit: 0,
        publicKey,
        encryptedSecretKey: encryptedSecretKey.encryptedData,
        secretKeyDecryptionNonce: encryptedSecretKey.nonce,
        masterKeyEncryptedWithRecoveryKey:
            masterKeyEncryptedWithRecoveryKey.encryptedData,
        masterKeyDecryptionNonce: masterKeyEncryptedWithRecoveryKey.nonce,
        recoveryKeyEncryptedWithMasterKey: encryptedRecoveryKey.encryptedData,
        recoveryKeyDecryptionNonce: encryptedRecoveryKey.nonce,
    };
};

/**
 * Ensure that a local vault exists, creating one on first run, and that the
 * vault's master key is available in the current session.
 *
 * After this resolves, the app can open an authenticated (wasm) session and
 * render the gallery - entirely offline.
 */
export const ensureLocalVault = async () => {
    const user = savedLocalUser();
    if (user && savedKeyAttributes()) {
        // Existing vault: restore the master key into this session.
        await updateSessionFromElectronSafeStorageIfNeeded();
        if (!haveMasterKeyInSession()) {
            const masterKey = await readMasterKeyLocally();
            if (masterKey)
                await saveMasterKeyInSessionAndSafeStore(masterKey);
        }
        if (haveMasterKeyInSession()) return;
        // The vault exists but its master key is unrecoverable (both OS
        // safeStorage and the fallback store lost it). A vault without its
        // key is unusable, so regenerate it from scratch; the old vault's
        // data remains on disk in case its recovery key is found later.
        log.error(
            "Local vault master key unrecoverable; regenerating vault (the previous vault's data remains on disk and can be restored with its recovery key)",
        );
    }

    // First run (or regeneration): create the vault.
    const masterKey = await generateKey();
    const keyAttributes = await generateVaultKeyAttributes(masterKey);
    const token = `local-vault-${crypto.randomUUID()}`;
    replaceSavedLocalUser({
        id: LOCAL_VAULT_USER_ID,
        email: LOCAL_VAULT_EMAIL,
        token,
    });
    saveKeyAttributes(keyAttributes);
    saveAuthToken(token);
    await clearMasterKeyLocally();
    await saveMasterKeyInSessionAndSafeStore(masterKey);
    await saveMasterKeyLocally(masterKey);
};
