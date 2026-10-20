import "package:ente_components/ente_components.dart";
import "package:ente_pure_utils/ente_pure_utils.dart";
import "package:ente_strings/ente_strings.dart";
import "package:ente_ui/components/settings/app_engagement_section.dart";
import "package:ente_ui/components/settings/more_from_ente_footer.dart";
import "package:ente_ui/pages/settings_search_page.dart";
import "package:flutter/foundation.dart";
import "package:flutter/material.dart";
import "package:hugeicons/hugeicons.dart";
import "package:photos/core/configuration.dart";
import "package:photos/service_locator.dart";
import "package:photos/services/account/user_service.dart";
import "package:photos/services/review_service.dart";
import "package:photos/ui/notification/toast.dart";
import "package:photos/ui/notification/update/change_log_page.dart";
import "package:photos/ui/settings/about/about_us_page.dart";
import "package:photos/ui/settings/appearance/appearance_settings_page.dart";
import "package:photos/ui/settings/backup/backup_settings_page.dart";
import "package:photos/ui/settings/backup/free_space_options.dart";
import "package:photos/ui/settings/debug/debug_settings_page.dart";
import "package:photos/ui/settings/debug/ml_debug_settings_page.dart";
import "package:photos/ui/settings/inherited_settings_state.dart";
import "package:photos/ui/settings/memories_settings_screen.dart";
import "package:photos/ui/settings/ml/machine_learning_settings_page.dart";
import "package:photos/ui/settings/notification_settings_screen.dart";
import "package:photos/ui/settings/search/settings_search_registry.dart";
import "package:photos/ui/settings/security/security_settings_page.dart";
import "package:photos/ui/settings/streaming/video_streaming_settings_page.dart";
import "package:photos/ui/settings/support/help_support_page.dart";
import "package:photos/ui/settings/widget_settings_screen.dart";
import "package:photos/utils/dialog_util.dart";

class SettingsPage extends StatelessWidget {
  final ValueNotifier<String?> emailNotifier;

  const SettingsPage({super.key, required this.emailNotifier});

  @override
  Widget build(BuildContext context) {
    return SettingsStateContainer(
      child: _SettingsBody(emailNotifier: emailNotifier),
    );
  }
}

class _SettingsBody extends StatelessWidget {
  final ValueNotifier<String?> emailNotifier;

  const _SettingsBody({required this.emailNotifier});

  @override
  Widget build(BuildContext context) {
    final hasLoggedIn = Configuration.instance.isLoggedIn();

    return AnimatedBuilder(
      animation: emailNotifier,
      builder: (context, _) {
        final email = hasLoggedIn ? emailNotifier.value ?? "" : "";
        final title = email.isEmpty ? context.strings.settings : email;

        return SettingsPageScaffold(
          title: title,
          actions: _buildHeaderActions(context),
          children: [
            if (hasLoggedIn && !isLocalGalleryMode) ...[
              _buildMenuItem(
                title: context.strings.backup,
                icon: HugeIcons.strokeRoundedCloudUpload,
                onTap: () async {
                  await routeToPage(context, const BackupSettingsPage());
                },
              ),
              const SizedBox(height: 8),
            ],
            _buildMenuItem(
              title: context.strings.security,
              icon: HugeIcons.strokeRoundedSecurityCheck,
              onTap: () async {
                await routeToPage(context, const SecuritySettingsPage());
              },
            ),
            const SizedBox(height: 8),
            _buildMenuItem(
              title: context.strings.appearance,
              icon: HugeIcons.strokeRoundedPaintBoard,
              onTap: () async {
                await routeToPage(context, const AppearanceSettingsPage());
              },
            ),
            const SizedBox(height: 8),
            if (isLocalGalleryMode) ...[
              _buildOfflineFeaturesCard(context),
              const SizedBox(height: 8),
            ],
            if (hasLoggedIn && !isLocalGalleryMode) ...[
              _buildFeaturesAndPlansCard(context),
              const SizedBox(height: 8),
            ],
            AppEngagementSection(reviewUrl: ReviewService.url),
            const SizedBox(height: 8),
            _buildMenuItem(
              title: context.strings.helpAndSupport,
              icon: HugeIcons.strokeRoundedHelpCircle,
              onTap: () async {
                await routeToPage(context, const HelpSupportPage());
              },
            ),
            const SizedBox(height: 8),
            _buildMenuItem(
              title: context.strings.about,
              icon: HugeIcons.strokeRoundedInformationCircle,
              onTap: () async {
                await routeToPage(context, const AboutUsPage());
              },
            ),
            if (hasLoggedIn && !isLocalGalleryMode) ...[
              const SizedBox(height: 8),
              _buildLogoutCard(context),
            ],
            MoreFromEnteFooter(
              currentApp: ComponentApp.photos,
              onVersionTap: () => showChangeLogSheet(context),
            ),
            if (hasLoggedIn &&
                !isLocalGalleryMode &&
                (flagService.flags.internalUser || kDebugMode)) ...[
              _buildMenuItem(
                title: "Debug",
                icon: HugeIcons.strokeRoundedBug02,
                onTap: () async {
                  await routeToPage(context, const DebugSettingsPage());
                },
              ),
              const SizedBox(height: 8),
              _buildMenuItem(
                title: "ML Debug",
                icon: HugeIcons.strokeRoundedAiBrain01,
                onTap: () async {
                  await routeToPage(context, const MLDebugSettingsPage());
                },
              ),
              const SizedBox(height: 16),
            ],
            const SizedBox(height: 60),
          ],
        );
      },
    );
  }

  List<Widget> _buildHeaderActions(BuildContext context) {
    return [
      IconButtonComponent(
        variant: IconButtonComponentVariant.primary,
        shouldSurfaceExecutionStates: false,
        icon: const HugeIcon(icon: HugeIcons.strokeRoundedSearch01),
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (context) => SettingsSearchPage(
                items: SettingsSearchRegistry.getSearchableItems(context),
                suggestions: SettingsSearchRegistry.getSuggestions(context),
                onNavigate: (context, routeBuilder) {
                  Navigator.of(context).pop();
                  routeToPage(context, routeBuilder(context));
                },
              ),
            ),
          );
        },
      ),
    ];
  }

  SettingsItem _buildMenuItem({
    required String title,
    required List<List<dynamic>> icon,
    String? subtitle,
    Widget? trailing,
    Future<void> Function()? onTap,
    bool showOnlyLoadingState = false,
    bool isDestructive = false,
  }) {
    return SettingsItem(
      title: title,
      subtitle: subtitle,
      icon: icon,
      trailing: trailing,
      showOnlyLoadingState: showOnlyLoadingState,
      isDestructive: isDestructive,
      onTap: onTap,
    );
  }

  Widget _buildOfflineFeaturesCard(BuildContext context) {
    return MenuGroupComponent(
      items: [
        _buildMenuItem(
          title: context.strings.machineLearning,
          icon: HugeIcons.strokeRoundedMagicWand01,
          onTap: () async {
            await routeToPage(context, const MachineLearningSettingsPage());
          },
        ),
        _buildMenuItem(
          title: context.strings.memories,
          icon: HugeIcons.strokeRoundedSparkles,
          onTap: () async {
            await routeToPage(context, const MemoriesSettingsScreen());
          },
        ),
        _buildMenuItem(
          title: context.strings.notifications,
          icon: HugeIcons.strokeRoundedNotification01,
          onTap: () async {
            await routeToPage(context, const NotificationSettingsScreen());
          },
        ),
        _buildMenuItem(
          title: context.strings.widgets,
          icon: HugeIcons.strokeRoundedAlignBoxBottomRight,
          onTap: () async {
            await routeToPage(context, const WidgetSettingsScreen());
          },
        ),
        _buildMapsMenuItem(context),
      ],
    );
  }

  Widget _buildFeaturesAndPlansCard(BuildContext context) {
    return MenuGroupComponent(
      items: [
        _buildMenuItem(
          title: context.strings.freeUpSpace,
          icon: HugeIcons.strokeRoundedRocket01,
          showOnlyLoadingState: true,
          onTap: () async {
            await routeToPage(context, const FreeUpSpaceOptionsScreen());
          },
        ),
        _buildMenuItem(
          title: context.strings.machineLearning,
          icon: HugeIcons.strokeRoundedMagicWand01,
          onTap: () async {
            await routeToPage(context, const MachineLearningSettingsPage());
          },
        ),
        _buildMenuItem(
          title: context.strings.memories,
          icon: HugeIcons.strokeRoundedSparkles,
          onTap: () async {
            await routeToPage(context, const MemoriesSettingsScreen());
          },
        ),
        _buildMenuItem(
          title: context.strings.notifications,
          icon: HugeIcons.strokeRoundedNotification01,
          onTap: () async {
            await routeToPage(context, const NotificationSettingsScreen());
          },
        ),
        _buildMenuItem(
          title: context.strings.widgets,
          icon: HugeIcons.strokeRoundedAlignBoxBottomRight,
          onTap: () async {
            await routeToPage(context, const WidgetSettingsScreen());
          },
        ),
        _buildMenuItem(
          title: context.strings.videoStreaming,
          icon: HugeIcons.strokeRoundedVideoCameraAi,
          onTap: () async {
            await routeToPage(context, const VideoStreamingSettingsPage());
          },
        ),
        _buildMapsMenuItem(context),
      ],
    );
  }

  SettingsItem _buildMapsMenuItem(BuildContext context) {
    return _buildMenuItem(
      title: context.strings.maps,
      icon: HugeIcons.strokeRoundedMaping,
      trailing: ToggleSwitchComponent.async(
        value: () => mapEnabled,
        onChanged: () async {
          final isEnabled = mapEnabled;
          try {
            await setMapEnabled(!isEnabled);
          } catch (e) {
            if (context.mounted) {
              showShortToast(context, context.strings.somethingWentWrong);
            }
            rethrow;
          }
        },
      ),
    );
  }

  Widget _buildLogoutCard(BuildContext context) {
    return _buildMenuItem(
      title: context.strings.logout,
      icon: HugeIcons.strokeRoundedLogout05,
      isDestructive: true,
      onTap: () async {
        _onLogoutTapped(context);
      },
    );
  }

  void _onLogoutTapped(BuildContext context) {
    showChoiceActionSheet(
      context,
      title: context.strings.warning,
      body: context.strings.areYouSureYouWantToLogout,
      illustration: Image.asset("assets/warning-grey.png"),
      firstButtonLabel: context.strings.yes,
      isCritical: true,
      firstButtonOnTap: () async {
        await UserService.instance.logout(context);
      },
    );
  }

}
