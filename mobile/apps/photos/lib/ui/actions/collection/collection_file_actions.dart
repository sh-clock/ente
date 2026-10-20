import "dart:async";

import "package:dio/dio.dart";
import "package:ente_components/ente_components.dart";
import "package:ente_pure_utils/ente_pure_utils.dart";
import "package:ente_strings/ente_strings.dart";
import 'package:flutter/cupertino.dart';
import "package:logging/logging.dart";
import "package:photo_manager/photo_manager.dart";
import "package:photos/core/configuration.dart";
import "package:photos/core/errors.dart";
import "package:photos/core/event_bus.dart";
import "package:photos/db/files_db.dart";
import "package:photos/events/collection_updated_event.dart";
import "package:photos/models/button_result.dart";
import 'package:photos/models/collection/collection.dart';
import 'package:photos/models/file/file.dart';
import 'package:photos/models/files_split.dart';
import 'package:photos/models/selected_files.dart';
import "package:photos/module/upload/service/file_uploader.dart";
import "package:photos/services/collections_service.dart";
import 'package:photos/services/favorites_service.dart';
import "package:photos/services/ignored_files_service.dart";
import "package:photos/services/sync/remote_sync_service.dart";
import 'package:photos/ui/common/progress_dialog.dart';
import 'package:photos/ui/components/action_sheet_widget.dart';
import 'package:photos/ui/components/buttons/button_widget.dart';
import 'package:photos/ui/components/models/button_type.dart';
import "package:photos/ui/notification/toast.dart";
import "package:photos/ui/settings/backup/free_space_options.dart";
import 'package:photos/utils/dialog_util.dart';
import "package:photos/utils/share_util.dart";
import "package:receive_sharing_intent/receive_sharing_intent.dart";
import "package:styled_text/styled_text.dart";

class CollectionActions {
  final Logger logger = Logger((CollectionActions).toString());
  final CollectionsService collectionsService;

  CollectionActions(this.collectionsService);

  Future<bool> deleteMultipleCollectionSheet(
    BuildContext context,
    List<Collection> collections,
  ) async {
    return _showDeleteCollectionConfirmationSheet(
      context: context,
      title: context.strings.deleteMultipleAlbumsQuestion,
      message: context.strings.deleteMultipleAlbumDialog(
        count: collections.length,
      ),
      keepPhotos: () async {
        for (final collection in collections) {
          try {
            await trashCollectionKeepingPhotos(collection);
          } catch (e, s) {
            logger.severe("Failed to keep photos & delete collection", e, s);
            rethrow;
          }
        }
      },
      deletePhotos: () async {
        for (final collection in collections) {
          try {
            await collectionsService.trashNonEmptyCollection(collection);
          } catch (e) {
            logger.severe("Failed to delete collection", e);
            rethrow;
          }
        }
      },
    );
  }

  Future<bool> deleteCollectionSheet(
    BuildContext bContext,
    Collection collection,
  ) async {
    final currentUserID = Configuration.instance.getUserID()!;
    if (collection.owner.id != currentUserID) {
      throw AssertionError("Can not delete album owned by others");
    }
    if (!bContext.mounted) return false;
    return _showDeleteCollectionConfirmationSheet(
      context: bContext,
      title: bContext.strings.deleteAlbumQuestion,
      message: bContext.strings.deleteAlbumDialog,
      keepPhotos: () async {
        try {
          await trashCollectionKeepingPhotos(collection);
        } catch (e, s) {
          logger.severe("Failed to keep photos & delete collection", e, s);
          rethrow;
        }
      },
      deletePhotos: () async {
        try {
          await collectionsService.trashNonEmptyCollection(collection);
        } catch (e) {
          logger.severe("Failed to delete collection", e);
          rethrow;
        }
      },
    );
  }

  Future<bool> _showDeleteCollectionConfirmationSheet({
    required BuildContext context,
    required String title,
    required String message,
    required Future<void> Function() keepPhotos,
    required Future<void> Function() deletePhotos,
  }) async {
    final l10n = context.strings;
    final actionResult = await showBottomSheetComponent<ButtonResult>(
      context: context,
      builder: (sheetContext) {
        final colors = sheetContext.componentColors;
        return BottomSheetComponent(
          title: title,
          illustration: Image.asset("assets/warning-grey.png"),
          closeTooltip: l10n.close,
          closeResult: ButtonResult(ButtonAction.third),
          content: StyledText(
            text: message,
            textAlign: TextAlign.center,
            style: TextStyles.body.copyWith(color: colors.textLight),
            tags: {
              'bold': StyledTextTag(
                style: TextStyles.body.copyWith(color: colors.textBase),
              ),
            },
          ),
          actions: [
            ButtonComponent(
              label: l10n.keepPhotos,
              variant: ButtonComponentVariant.neutral,
              onTap: () => _runCollectionAction(
                sheetContext,
                ButtonAction.first,
                keepPhotos,
              ),
            ),
            ButtonComponent(
              label: l10n.deletePhotos,
              variant: ButtonComponentVariant.critical,
              onTap: () => _runCollectionAction(
                sheetContext,
                ButtonAction.second,
                deletePhotos,
              ),
            ),
          ],
        );
      },
    );
    if (actionResult?.action != null &&
        actionResult!.action == ButtonAction.error) {
      if (!context.mounted) return false;
      await showGenericErrorDialog(
        context: context,
        error: actionResult.exception,
      );
      return false;
    }
    if ((actionResult?.action != null) &&
        (actionResult!.action == ButtonAction.first ||
            actionResult.action == ButtonAction.second)) {
      return true;
    }
    return false;
  }

  Future<void> _runCollectionAction(
    BuildContext context,
    ButtonAction action,
    Future<void> Function() callback,
  ) async {
    try {
      await callback();
      if (context.mounted) {
        Navigator.of(context).pop(ButtonResult(action));
      }
    } catch (error) {
      if (context.mounted) {
        Navigator.of(
          context,
        ).pop(ButtonResult(ButtonAction.error, _toException(error)));
      }
      rethrow;
    }
  }

  Exception _toException(Object error) {
    return error is Exception ? error : Exception(error.toString());
  }

  Future<void> trashCollectionKeepingPhotos(Collection collection) async {
    final List<EnteFile> files = await FilesDB.instance.getAllFilesCollection(
      collection.id,
    );
    await moveFilesFromCurrentCollection(
      null,
      collection,
      files,
      isHidden: collection.isHidden() && !collection.isDefaultHidden(),
    );
    await collectionsService.trashEmptyCollection(collection);
  }

  Future<int> removeFromUncatIfPresentInOtherAlbum(
    Collection collection,
    BuildContext bContext,
  ) async {
    try {
      final List<EnteFile> files = await FilesDB.instance.getAllFilesCollection(
        collection.id,
      );
      if (!bContext.mounted) {
        return 0;
      }
      return await moveFilesFromCurrentCollection(bContext, collection, files);
    } catch (e, s) {
      logger.severe("Failed to remove files from uncategorized", e, s);
      rethrow;
    }
  }

  // Moving an owned file must call the move API even if it is already in
  // another owned collection, because move also removes it from this one.
  // Files owned by someone else can only be removed from this collection.
  Future<int> moveFilesFromCurrentCollection(
    BuildContext? context,
    Collection collection,
    Iterable<EnteFile> files, {
    bool isHidden = false,
  }) async {
    var movedFilesCount = 0;
    final int currentUserID = Configuration.instance.getUserID()!;
    final isCollectionOwner = collection.owner.id == currentUserID;
    final bool canRemoveAllParticipants = collectionsService
        .canRemoveFilesFromAllParticipants(collection);
    final bool isCollectionAdmin =
        canRemoveAllParticipants && !isCollectionOwner;
    final FilesSplit split = FilesSplit.split(
      files,
      Configuration.instance.getUserID()!,
    );
    if (isCollectionAdmin) {
      final filesToRemove = <EnteFile>[
        ...split.ownedByCurrentUser,
        ...split.ownedByOtherUsers,
      ];
      if (filesToRemove.isNotEmpty) {
        await collectionsService.removeFromCollection(
          collection.id,
          filesToRemove,
        );
      }
      return filesToRemove.length;
    }
    if (isCollectionOwner && split.ownedByOtherUsers.isNotEmpty) {
      await collectionsService.removeFromCollection(
        collection.id,
        split.ownedByOtherUsers,
      );
      movedFilesCount += split.ownedByOtherUsers.length;
    } else if (!isCollectionOwner && split.ownedByCurrentUser.isNotEmpty) {
      await collectionsService.removeFromCollection(
        collection.id,
        split.ownedByCurrentUser,
      );
      return split.ownedByCurrentUser.length;
    }

    if (!isCollectionOwner && split.ownedByOtherUsers.isNotEmpty) {
      if (context != null && context.mounted) {
        showShortToast(context, context.strings.canOnlyRemoveFilesOwnedByYou);
      }
      return movedFilesCount;
    }

    final Map<int, EnteFile> pendingAssignMap = {};
    final Map<int, List<EnteFile>> destCollectionToFilesMap = {};
    final List<int> uploadedIDs = [];
    for (EnteFile f in split.ownedByCurrentUser) {
      if (f.uploadedFileID != null) {
        pendingAssignMap[f.uploadedFileID!] = f;
        uploadedIDs.add(f.uploadedFileID!);
      }
    }

    final Map<int, List<EnteFile>> collectionToFilesMap = await FilesDB.instance
        .getAllFilesGroupByCollectionID(uploadedIDs);

    // Fix files in pendingAssignMap with correct collectionID entries.
    // This is needed when files are selected after filtering by another album,
    // as the file's collectionID might point to the filtered album instead of
    // the current collection.
    final filesInCurrentCollection = collectionToFilesMap[collection.id];
    if (filesInCurrentCollection != null) {
      for (final file in filesInCurrentCollection) {
        if (file.uploadedFileID != null &&
            pendingAssignMap.containsKey(file.uploadedFileID) &&
            file.ownerID == currentUserID) {
          pendingAssignMap[file.uploadedFileID!] = file;
        }
      }
    }

    // Preserve another album membership instead of moving to Uncategorized.
    for (MapEntry<int, List<EnteFile>> entry in collectionToFilesMap.entries) {
      if (!_isAutoMoveCandidate(collection.id, entry.key, currentUserID)) {
        continue;
      }
      final targetCollection = collectionsService.getCollectionByID(entry.key)!;
      for (EnteFile file in entry.value) {
        if (pendingAssignMap.containsKey(file.uploadedFileID)) {
          if (!destCollectionToFilesMap.containsKey(targetCollection.id)) {
            destCollectionToFilesMap[targetCollection.id] = <EnteFile>[];
          }
          destCollectionToFilesMap[targetCollection.id]!.add(
            pendingAssignMap[file.uploadedFileID!]!,
          );
          pendingAssignMap.remove(file.uploadedFileID);
        }
      }
    }
    if (pendingAssignMap.isNotEmpty) {
      late final int toCollectionID;
      if (isHidden) {
        toCollectionID = collectionsService.cachedDefaultHiddenCollection!.id;
      } else {
        final Collection uncategorizedCollection = await collectionsService
            .getUncategorizedCollection();
        toCollectionID = uncategorizedCollection.id;
      }

      for (MapEntry<int, EnteFile> entry in pendingAssignMap.entries) {
        final file = entry.value;
        if (pendingAssignMap.containsKey(file.uploadedFileID)) {
          if (!destCollectionToFilesMap.containsKey(toCollectionID)) {
            destCollectionToFilesMap[toCollectionID] = <EnteFile>[];
          }
          destCollectionToFilesMap[toCollectionID]!.add(
            pendingAssignMap[file.uploadedFileID!]!,
          );
        }
      }
    }

    int mappedFilesCount = 0;
    destCollectionToFilesMap.forEach((key, value) {
      mappedFilesCount += value.length;
    });
    if (mappedFilesCount != uploadedIDs.length) {
      throw AssertionError(
        "Failed to map all files toMap: ${uploadedIDs.length} and mapped "
        "$mappedFilesCount",
      );
    }

    for (MapEntry<int, List<EnteFile>> entry
        in destCollectionToFilesMap.entries) {
      if (collection.type == CollectionType.uncategorized &&
          entry.key == collection.id) {
        logger.info(
          'skipping moving ${entry.value.length} files to uncategorized collection',
        );
      } else {
        final movedFilesInCollection = entry.value.length;
        await collectionsService.move(
          entry.value,
          toCollectionID: entry.key,
          fromCollectionID: collection.id,
        );
        movedFilesCount += movedFilesInCollection;
      }
    }
    return movedFilesCount;
  }

  bool _isAutoMoveCandidate(int fromCollectionID, toCollectionID, int userID) {
    if (fromCollectionID == toCollectionID) {
      return false;
    }
    final Collection? targetCollection = collectionsService.getCollectionByID(
      toCollectionID,
    );
    if (targetCollection == null ||
        targetCollection.isDeleted ||
        (CollectionType.uncategorized == targetCollection.type ||
            targetCollection.type == CollectionType.favorites) ||
        targetCollection.owner.id != userID) {
      return false;
    }
    return true;
  }
}

extension CollectionFileActions on CollectionActions {
  Future<void> showRemoveFromCollectionSheetV2(
    BuildContext context,
    Collection collection,
    SelectedFiles selectedFiles,
    bool removingOthersFile, {
    bool isHidden = false,
    String? body,
  }) async {
    final actionResult = await showActionSheet(
      context: context,
      buttons: [
        ButtonWidget(
          labelText: context.strings.remove,
          buttonType: removingOthersFile
              ? ButtonType.critical
              : ButtonType.neutral,
          buttonSize: ButtonSize.large,
          shouldStickToDarkTheme: true,
          isInAlert: true,
          onTap: () async {
            try {
              await moveFilesFromCurrentCollection(
                context,
                collection,
                selectedFiles.files,
                isHidden: isHidden,
              );
            } catch (e) {
              logger.severe("Failed to move files", e);
              rethrow;
            }
          },
        ),
        ButtonWidget(
          labelText: context.strings.cancel,
          buttonType: ButtonType.secondary,
          buttonSize: ButtonSize.large,
          buttonAction: ButtonAction.second,
          shouldStickToDarkTheme: true,
          isInAlert: true,
        ),
      ],
      title: context.strings.removeFromAlbumTitle,
      body:
          body ??
          (removingOthersFile
              ? context.strings.removeShareItemsWarning
              : context.strings.itemsWillBeRemovedFromAlbum),
      actionSheetType: ActionSheetType.defaultActionSheet,
    );
    if (actionResult?.action != null &&
        actionResult!.action == ButtonAction.error) {
      if (!context.mounted) return;
      await showGenericErrorDialog(
        context: context,
        error: actionResult.exception,
      );
    } else {
      selectedFiles.clearAll();
    }
  }

  Future<bool> addToMultipleCollections(
    BuildContext context,
    List<Collection> collections,
    bool showProgressDialog, {
    List<EnteFile>? selectedFiles,
  }) async {
    final ProgressDialog? dialog = showProgressDialog
        ? createProgressDialog(
            context,
            context.strings.uploadingFilesToAlbum,
            isDismissible: true,
          )
        : null;
    await dialog?.show();
    final int currentUserID = Configuration.instance.getUserID()!;
    for (final collection in collections) {
      try {
        final List<EnteFile> files = [];
        final List<EnteFile> filesPendingUpload = [];
        for (final file in selectedFiles!) {
          EnteFile? currentFile;
          if (file.uploadedFileID != null) {
            currentFile = file.copyWith();
          } else if (file.generatedID != null) {
            // Refresh before queuing in case the upload state has changed.
            currentFile = await (FilesDB.instance.getFile(file.generatedID!));
          } else if (file.generatedID == null) {
            logger.severe("generated id should not be null");
          }
          if (currentFile == null) {
            logger.severe("Failed to find fileBy genID");
            continue;
          }

          if (currentFile.uploadedFileID == null) {
            if (currentFile.collectionID != null &&
                currentFile.collectionID != collection.id) {
              currentFile.generatedID = null;
            }
            currentFile.collectionID = collection.id;
            filesPendingUpload.add(currentFile);
          } else {
            files.add(currentFile);
          }
        }
        if (filesPendingUpload.isNotEmpty) {
          // A newly created collection might not be cached yet.
          final Collection? c = CollectionsService.instance.getCollectionByID(
            collection.id,
          );
          if (c != null && c.owner.id != currentUserID) {
            final Collection uncat = await CollectionsService.instance
                .getUncategorizedCollection();
            for (EnteFile unuploadedFile in filesPendingUpload) {
              final uploadedFile = await FileUploader.instance.forceUpload(
                unuploadedFile,
                uncat.id,
              );
              files.add(uploadedFile);
            }
          } else {
            for (final file in filesPendingUpload) {
              file.collectionID = collection.id;
            }
            // filesPendingUpload might be being ignored during auto-upload
            // because the user deleted these files from ente in the past.
            await IgnoredFilesService.instance.removeIgnoredMappings(
              filesPendingUpload,
            );
            await FilesDB.instance.insertMultiple(filesPendingUpload);
            Bus.instance.fire(
              CollectionUpdatedEvent(
                collection.id,
                filesPendingUpload,
                "pendingFilesAdd",
              ),
            );
          }
        }
        if (files.isNotEmpty) {
          await CollectionsService.instance.addOrCopyToCollection(
            collection.id,
            files,
          );
        }
        CollectionsService.instance.recordCollectionUsage(collection.id);
      } catch (e, s) {
        logger.severe("Failed to add to album", e, s);
        await dialog?.hide();
        if (!context.mounted) return false;
        if (_isStorageLimitError(e)) {
          await _showStorageFullSheet(context);
        } else {
          await showGenericErrorDialog(context: context, error: e);
        }
        return false;
      } finally {
        // Earlier collections may have succeeded before a later one failed.
        unawaited(RemoteSyncService.instance.sync(silently: true));
      }
    }

    await dialog?.hide();
    return true;
  }

  Future<bool> addToCollection(
    BuildContext context,
    int collectionID,
    bool showProgressDialog, {
    List<EnteFile>? selectedFiles,
    List<SharedMediaFile>? sharedFiles,
    List<AssetEntity>? picketAssets,
  }) async {
    ProgressDialog? dialog = showProgressDialog
        ? createProgressDialog(
            context,
            context.strings.uploadingFilesToAlbum,
            isDismissible: true,
          )
        : null;
    await dialog?.show();
    try {
      final List<EnteFile> files = [];
      final List<EnteFile> filesPendingUpload = [];
      final int currentUserID = Configuration.instance.getUserID()!;
      if (sharedFiles != null) {
        filesPendingUpload.addAll(
          await convertIncomingSharedMediaToFile(sharedFiles, collectionID),
        );
      } else if (picketAssets != null) {
        filesPendingUpload.addAll(
          await convertPicketAssets(picketAssets, collectionID),
        );
      } else {
        for (final file in selectedFiles!) {
          EnteFile? currentFile;
          if (file.uploadedFileID != null) {
            currentFile = file.copyWith();
          } else if (file.generatedID != null) {
            // Refresh before queuing in case the upload state has changed.
            currentFile = await (FilesDB.instance.getFile(file.generatedID!));
          } else if (file.generatedID == null) {
            logger.severe("generated id should not be null");
          }
          if (currentFile == null) {
            logger.severe("Failed to find fileBy genID");
            continue;
          }
          if (currentFile.uploadedFileID == null) {
            currentFile.collectionID = collectionID;
            filesPendingUpload.add(currentFile);
          } else {
            files.add(currentFile);
          }
        }
      }
      if (filesPendingUpload.isNotEmpty) {
        // A newly created collection might not be cached yet.
        final Collection? c = CollectionsService.instance.getCollectionByID(
          collectionID,
        );
        if (c != null && c.owner.id != currentUserID) {
          if (!showProgressDialog) {
            if (!context.mounted) return false;
            dialog = createProgressDialog(
              context,
              context.strings.uploadingFilesToAlbum,
              isDismissible: true,
            );
            await dialog.show();
          }
          final Collection uncat = await CollectionsService.instance
              .getUncategorizedCollection();
          for (EnteFile unuploadedFile in filesPendingUpload) {
            final uploadedFile = await FileUploader.instance.forceUpload(
              unuploadedFile,
              uncat.id,
            );
            files.add(uploadedFile);
          }
        } else {
          for (final file in filesPendingUpload) {
            file.collectionID = collectionID;
          }
          // filesPendingUpload might be being ignored during auto-upload
          // because the user deleted these files from ente in the past.
          await IgnoredFilesService.instance.removeIgnoredMappings(
            filesPendingUpload,
          );
          await FilesDB.instance.insertMultiple(filesPendingUpload);
          Bus.instance.fire(
            CollectionUpdatedEvent(
              collectionID,
              filesPendingUpload,
              "pendingFilesAdd",
            ),
          );
        }
      }
      if (files.isNotEmpty) {
        await CollectionsService.instance.addOrCopyToCollection(
          collectionID,
          files,
        );
      }
      unawaited(RemoteSyncService.instance.sync(silently: true));
      await dialog?.hide();
      return true;
    } catch (e, s) {
      logger.severe("Failed to add to album", e, s);
      await dialog?.hide();
      if (context.mounted) {
        if (_isStorageLimitError(e)) {
          await _showStorageFullSheet(context);
        } else {
          await showGenericErrorDialog(context: context, error: e);
        }
      }
      rethrow;
    }
  }

  Future<bool> updateFavorites(
    BuildContext context,
    List<EnteFile> files,
    bool markAsFavorite,
  ) async {
    final ProgressDialog dialog = createProgressDialog(
      context,
      markAsFavorite
          ? context.strings.addingToFavorites
          : context.strings.removingFromFavorites,
    );
    await dialog.show();

    try {
      if (!context.mounted) return false;
      await FavoritesService.instance.updateFavorites(
        context,
        files,
        markAsFavorite,
      );
      return true;
    } catch (e, s) {
      logger.severe("Failed to update favorites", e, s);
      if (!context.mounted) return false;
      showShortToast(
        context,
        markAsFavorite
            ? context.strings.sorryCouldNotAddToFavorites
            : context.strings.sorryCouldNotRemoveFromFavorites,
      );
    } finally {
      await dialog.hide();
    }
    return false;
  }
}

Future<void> _showStorageFullSheet(BuildContext context) async {
  await showBottomSheetComponent<void>(
    context: context,
    builder: (sheetContext) => BottomSheetComponent(
      title: sheetContext.strings.notEnoughStorageTitle,
      content: Text(
        sheetContext.strings.notEnoughStorageBody,
        style: TextStyles.body.copyWith(
          color: sheetContext.componentColors.textLight,
        ),
      ),
      actions: [
        ButtonComponent(
          label: sheetContext.strings.freeUpSpace,
          variant: ButtonComponentVariant.secondary,
          size: ButtonComponentSize.large,
          onTap: () => Navigator.of(sheetContext).pop(),
        ),
      ],
    ),
  );
  if (!context.mounted) {
    return;
  }
  await routeToPage(context, const FreeUpSpaceOptionsScreen());
}

bool _isStorageLimitError(Object error) {
  return error is StorageLimitExceededError ||
      error is DioException && error.response?.statusCode == 426;
}
