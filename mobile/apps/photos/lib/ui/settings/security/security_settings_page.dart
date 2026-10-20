import "package:ente_components/ente_components.dart";
import "package:ente_lock_screen/auth_util.dart";
import "package:ente_lock_screen/ui/lock_screen_options.dart";
import "package:ente_strings/ente_strings.dart";
import "package:flutter/material.dart";
import "package:hugeicons/hugeicons.dart";
import "package:local_auth/local_auth.dart";
import "package:photos/utils/dialog_util.dart";

/// Offline standalone app: only the on-device app lock remains. The account
/// security sections (2FA, email MFA, passkeys, active sessions) and the
/// remote crash-reporting toggle were removed along with the ente account
/// stack.
class SecuritySettingsPage extends StatelessWidget {
  const SecuritySettingsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.strings;
    return SettingsPageScaffold(
      title: l10n.security,
      children: [
        SettingsItem(
          title: l10n.appLock,
          icon: HugeIcons.strokeRoundedSquareLock02,
          onTap: () async => _onAppLockTap(context),
        ),
      ],
    );
  }

  Future<void> _onAppLockTap(BuildContext context) async {
    if (await LocalAuthentication().isDeviceSupported()) {
      if (!context.mounted) return;
      final bool result = await requestAuthentication(
        context,
        context.strings.authToChangeLockscreenSetting,
      );
      if (result) {
        if (!context.mounted) return;
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (BuildContext context) {
              return const LockScreenOptions();
            },
          ),
        );
      }
    } else {
      if (!context.mounted) return;
      await showErrorDialog(
        context,
        context.strings.noSystemLockFound,
        context.strings.toEnableAppLockPleaseSetupDevicePasscodeOrScreen,
      );
    }
  }
}
