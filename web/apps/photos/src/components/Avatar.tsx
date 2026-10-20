// TODO: Audit this file
import {
    avatarBackgroundColor,
    avatarBackgroundColorPublicCollectedFile,
    avatarTextColor,
} from "@/services/avatar";
import { styled } from "@mui/material";
import type { LocalUser } from "ente-accounts/services/user";
import type { EnteFile } from "ente-media/file";
import React, { useMemo } from "react";

interface AvatarProps {
    user?: LocalUser;
    file?: EnteFile;
    email?: string;
    opacity?: number;
    emailByUserID?: Map<number, string>;
}

const AvatarBase = styled("div")<{
    colorCode: string;
    size: number;
    opacity: number | undefined;
}>`
    width: ${({ size }) => `${size}px`};
    height: ${({ size }) => `${size}px`};
    background-color: ${({ colorCode, opacity }) =>
        `${colorCode}${opacity === 100 ? "" : (opacity ?? 95)}`};
    border-radius: 50%;
    display: flex;
    justify-content: center;
    align-items: center;
    color: ${avatarTextColor};
    font-weight: bold;
    font-size: ${({ size }) => `${Math.floor(size / 2)}px`};
`;

const colorSeedFromEmail = (email: string) => {
    let seed = 0;
    for (const char of email) {
        seed += char.codePointAt(0) ?? 0;
    }
    return seed;
};

const Avatar: React.FC<AvatarProps> = ({
    user,
    file,
    email,
    opacity,
    emailByUserID,
}) => {
    const isPublicCollectedAvatar =
        !!file && !!user && file.ownerID === user.id && !!file.pubMagicMetadata;
    const uploaderName = file?.pubMagicMetadata?.data.uploaderName;

    const colorCode = useMemo(() => {
        if (isPublicCollectedAvatar) {
            return avatarBackgroundColorPublicCollectedFile;
        }
        if (file && file.ownerID !== user?.id) {
            return avatarBackgroundColor(file.ownerID);
        }
        if (!email) {
            return undefined;
        }
        if (user?.email === email) {
            return avatarBackgroundColorPublicCollectedFile;
        }
        const matchedID = Array.from(emailByUserID?.keys() ?? []).find(
            (key) => emailByUserID?.get(key) === email,
        );
        return avatarBackgroundColor(matchedID ?? colorSeedFromEmail(email));
    }, [emailByUserID, email, file, isPublicCollectedAvatar, user]);

    const userLetter = useMemo(() => {
        if (isPublicCollectedAvatar) {
            return uploaderName?.[0]?.toUpperCase();
        }
        return email?.[0]?.toUpperCase();
    }, [email, isPublicCollectedAvatar, uploaderName]);

    if (!colorCode || !userLetter) {
        return <></>;
    }

    return (
        <AvatarBase size={18} colorCode={colorCode} opacity={opacity}>
            {userLetter}
        </AvatarBase>
    );
};

export default Avatar;
