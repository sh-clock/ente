// Local vault bootstrap.
//
// Temporary bridge: the app runs fully offline with an auto-generated local
// vault instead of an ente account login. This will later be replaced by the
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
import { encryptBox, generateKey, generateKeyPair } from "ente-accounts/services/crypto";
import type { KeyAttributes } from "ente-accounts/services/user";
import { isDesktop } from "ente-base/app";
import { haveMasterKeyInSession } from "ente-base/session-storage";
import { saveAuthToken } from "ente-base/token";
import localforage from "localforage";
import {
    saveMasterKeyInSessionAndSafeStore,
    updateSessionFromElectronSafeStorageIfNeeded,
} from "ente-new/photos/services/account-keys";

// Browser (non-desktop) fallback store for the vault master key. The desktop
// app persists it via OS safeStorage instead (see
// saveMasterKeyInSessionAndSafeStore).
const masterKeyStore = localforage.createInstance({
    name: "photos-local-vault",
    storeName: "keys",
});

const LOCAL_VAULT_USER_ID = 1;
const LOCAL_VAULT_EMAIL = "local@vault";

const saveMasterKeyLocally = async (masterKey: string) => {
    if (!isDesktop) await masterKeyStore.setItem("masterKey", masterKey);
};

const readMasterKeyLocally = async (): Promise<string | undefined> => {
    if (!isDesktop) {
        return (await masterKeyStore.getItem<string>("masterKey")) ?? undefined;
    }
    return undefined;
};

const generateVaultKeyAttributes = async (
    masterKey: string,
): Promise<KeyAttributes> => {
    const { publicKey, privateKey } = await generateKeyPair();
    const encryptedSecretKey = await encryptBox(privateKey, masterKey);
    const recoveryKey = await generateKey();
    const encryptedRecoveryKey = await encryptBox(recoveryKey, masterKey);
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
        masterKeyEncryptedWithRecoveryKey: undefined,
        masterKeyDecryptionNonce: undefined,
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
    let user = savedLocalUser();
    if (!user || !savedKeyAttributes()) {
        // First run: generate the vault.
        const masterKey = await generateKey();
        const keyAttributes = await generateVaultKeyAttributes(masterKey);
        replaceSavedLocalUser({
            id: LOCAL_VAULT_USER_ID,
            email: LOCAL_VAULT_EMAIL,
        });
        saveKeyAttributes(keyAttributes);
        saveAuthToken(`local-vault-${crypto.randomUUID()}`);
        await saveMasterKeyLocally(masterKey);
        await saveMasterKeyInSessionAndSafeStore(masterKey);
        return;
    }

    // Existing vault: restore the master key into this session.
    await updateSessionFromElectronSafeStorageIfNeeded();
    if (!haveMasterKeyInSession()) {
        const masterKey = await readMasterKeyLocally();
        if (masterKey) await saveMasterKeyInSessionAndSafeStore(masterKey);
    }
};
