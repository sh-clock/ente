import "package:ente_components/ente_components.dart";
import "package:ente_strings/ente_strings.dart";
import "package:ente_ui/pages/log_file_viewer.dart";
import "package:flutter/foundation.dart";
import "package:flutter/material.dart";
import "package:hugeicons/hugeicons.dart";
import "package:logging/logging.dart";
import "package:photos/core/constants.dart";
import "package:photos/core/error-reporting/super_logging.dart";
import "package:photos/service_locator.dart";
import "package:photos/ui/notification/toast.dart";
import "package:photos/ui/settings/support/report_issue_page.dart";
import "package:photos/utils/email_util.dart";
import "package:url_launcher/url_launcher_string.dart";

class HelpSupportPage extends StatelessWidget {
  static final _logger = Logger("HelpSupportPage");
  // Fork: the hosted help-center/FAQ pages were ente.com web properties and
  // were removed with the debrand; support routes to the fork's repository
  // (ask a question / request a feature) and the in-app issue reporter.
  const HelpSupportPage({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.strings;

    return SettingsPageScaffold(
      title: l10n.helpAndSupport,
      children: [
        _sectionTitle(context, l10n.getInTouch),
        SettingsItem(
          title: l10n.askAQuestion,
          icon: HugeIcons.strokeRoundedHelpCircle,
          showOnlyLoadingState: true,
          onTap: () async {
            await openEmailComposer(context, to: supportEmail);
          },
        ),
        const SizedBox(height: 8),
        SettingsItem(
          title: l10n.requestAFeature,
          icon: HugeIcons.strokeRoundedIdea01,
          showOnlyLoadingState: true,
          onTap: () async {
            await launchUrlString(
              githubDiscussionsUrl,
              mode: LaunchMode.externalApplication,
            );
          },
        ),
        const SizedBox(height: 8),
        SettingsItem(
          title: l10n.reportAnIssue,
          icon: HugeIcons.strokeRoundedBug01,
          showOnlyLoadingState: true,
          onTap: () async {
            await Navigator.of(context).push(
              MaterialPageRoute(builder: (context) => const ReportIssuePage()),
            );
          },
        ),
        if (flagService.internalUser || kDebugMode) ...[
          const SizedBox(height: 8),
          SettingsItem(
            title: "(i) ${l10n.viewLogs}",
            icon: HugeIcons.strokeRoundedNote01,
            showOnlyLoadingState: true,
            onTap: () async {
              await _viewLogs(context);
            },
          ),
        ],
        SettingsLink(label: l10n.exportLogs, onTap: () => _exportLogs(context)),
        const SizedBox(height: 24),
      ],
    );
  }

  Widget _sectionTitle(BuildContext context, String title) {
    final colors = context.componentColors;
    return Padding(
      padding: const EdgeInsets.only(left: Spacing.sm, top: 6, bottom: 6),
      child: Text(
        title,
        style: TextStyles.large.copyWith(color: colors.textBase),
      ),
    );
  }

  Future<void> _viewLogs(BuildContext context) async {
    final logFile = SuperLogging.logFile;
    if (logFile == null) {
      showShortToast(context, context.strings.somethingWentWrong);
      return;
    }
    await Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (context) => LogFileViewer(logFile)));
  }

  Future<void> _exportLogs(BuildContext context) async {
    try {
      final zipFilePath = await getZippedLogsFile(context);
      if (!context.mounted) return;
      await exportLogs(context, zipFilePath);
    } catch (e, s) {
      _logger.severe("Failed to export logs", e, s);
      if (context.mounted) {
        showShortToast(context, context.strings.somethingWentWrong);
      }
    }
  }
}
