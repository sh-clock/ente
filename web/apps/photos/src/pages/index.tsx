import { CenteredFill } from "ente-base/components/containers";
import { ActivityIndicator } from "ente-base/components/mui/ActivityIndicator";
import { canAccessIndexedDB } from "ente-gallery/services/files-db";
import { ensureLocalVault } from "@/services/local-vault";
import { useBaseContext } from "ente-base/context";
import { t } from "i18next";
import { useRouter } from "next/router";
import React, { useEffect } from "react";

// Offline-first: the app boots straight into the gallery using an
// auto-generated local vault (no login). See services/local-vault.ts.
const Page: React.FC = () => {
    const { showMiniDialog } = useBaseContext();
    const router = useRouter();

    useEffect(() => {
        void (async () => {
            try {
                await ensureLocalVault();
            } catch (error) {
                console.error("Failed to bootstrap local vault", error);
                showMiniDialog({
                    title: t("error"),
                    message: t("generic_error_retry"),
                    nonClosable: true,
                    cancel: false,
                });
                return;
            }

            if (!(await canAccessIndexedDB())) {
                showMiniDialog({
                    title: t("error"),
                    message: t("local_storage_not_accessible"),
                    nonClosable: true,
                    cancel: false,
                });
                return;
            }

            await router.push("/gallery");
        })();
    }, [showMiniDialog, router]);

    return (
        <CenteredFill>
            <ActivityIndicator />
        </CenteredFill>
    );
};

export default Page;
