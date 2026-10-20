import { recoveryKeyMnemonic } from "@/services/recovery-key";
import { Stack } from "@mui/material";
import { RecoveryKey } from "ente-accounts/components/RecoveryKey";
import { isDesktop } from "ente-base/app";
import {
    TitledNestedSidebarDrawer,
    type NestedSidebarDrawerVisibilityProps,
} from "ente-base/components/mui/SidebarDrawer";
import { useModalVisibility } from "ente-base/components/utils/modal";
import { RowCard } from "ente-base/components/v2/RowCard";
import { useBaseContext } from "ente-base/context";
import { reauthenticateWithAppLock } from "ente-new/photos/services/app-lock";
import type { SidebarActionID } from "ente-new/photos/services/search/types";
import { t } from "i18next";
import React, { useCallback, useEffect } from "react";

export type AccountAction = Extract<SidebarActionID, "account.recoveryKey">;

type AccountProps = NestedSidebarDrawerVisibilityProps & {
    onAuthenticateUser: () => Promise<boolean>;
    pendingAction?: AccountAction;
    onActionHandled?: (action?: AccountAction) => void;
};

export const Account: React.FC<AccountProps> = ({
    open,
    onClose,
    onRootClose,
    onAuthenticateUser,
    pendingAction,
    onActionHandled,
}) => {
    const { showMiniDialog } = useBaseContext();

    const { show: showRecoveryKey, props: recoveryKeyVisibilityProps } =
        useModalVisibility();

    const handleRootClose = () => {
        onClose();
        onRootClose();
    };

    const handleRecoveryKey = useCallback(async () => {
        if (isDesktop) {
            const reauthResult = await reauthenticateWithAppLock();
            if (reauthResult === "cancelled") return;
            if (reauthResult === "fallback" && !(await onAuthenticateUser()))
                return;
        } else {
            if (!(await onAuthenticateUser())) return;
        }
        showRecoveryKey();
    }, [onAuthenticateUser, showRecoveryKey]);

    useEffect(() => {
        if (!open || !pendingAction) return;
        switch (pendingAction) {
            case "account.recoveryKey":
                void handleRecoveryKey();
                break;
        }
        onActionHandled?.();
    }, [handleRecoveryKey, open, onActionHandled, pendingAction]);

    return (
        <TitledNestedSidebarDrawer
            maxWidth="440px"
            {...{ open, onClose }}
            onRootClose={handleRootClose}
            title={t("account")}
        >
            <Stack sx={{ px: 2, py: 1, gap: 1 }}>
                <RowCard
                    title={t("recovery_key")}
                    onClick={() => void handleRecoveryKey()}
                />
            </Stack>
            <RecoveryKey
                {...recoveryKeyVisibilityProps}
                getRecoveryKeyMnemonic={recoveryKeyMnemonic}
                {...{ showMiniDialog }}
            />
        </TitledNestedSidebarDrawer>
    );
};
