import "package:ente_ui/components/app_update_sheet.dart" as shared;
import "package:flutter/material.dart";
import "package:photos/service_locator.dart";
import "package:photos/services/update_service.dart";

const _changelogUrl = "https://github.com/sh-clock/ente";

Future<void> showAppUpdateSheet(
  BuildContext context, {
  required LatestVersionInfo latestVersionInfo,
}) {
  return shared.showAppUpdateSheet(
    context,
    version: latestVersionInfo.name,
    downloadUrl: latestVersionInfo.url,
    changelogUrl: _changelogUrl,
    isCritical: updateService.shouldForceUpdate(latestVersionInfo),
    notificationsEnabled: updateService.updateNotificationsEnabled,
    onNotificationsChanged: updateService.setUpdateNotificationsEnabled,
  );
}
