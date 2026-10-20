import "package:flutter/material.dart";
import 'package:photos/models/file/file.dart';
import "package:photos/models/search/generic_search_result.dart";
import "package:photos/models/search/search_constants.dart";
import "package:photos/models/search/search_result.dart";
import "package:photos/models/search/search_types.dart";
import 'package:photos/ui/viewer/file/no_thumbnail_widget.dart';
import 'package:photos/ui/viewer/file/thumbnail_widget.dart';
import 'package:photos/ui/viewer/people/person_face_widget.dart';

class SearchThumbnailWidget extends StatelessWidget {
  final EnteFile? file;
  final SearchResult? searchResult;
  final String tagPrefix;
  final double size;
  final double borderRadius;

  const SearchThumbnailWidget(
    this.file,
    this.tagPrefix, {
    this.searchResult,
    this.size = 56,
    this.borderRadius = 12,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return Hero(
      tag: tagPrefix + (file?.tag ?? ""),
      child: SizedBox(
        height: size,
        width: size,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(borderRadius),
          child: file != null
              ? (searchResult != null &&
                        searchResult!.type() == ResultType.faces)
                    ? PersonFaceWidget(
                        personId: (searchResult as GenericSearchResult)
                            .params[kPersonParamID],
                        clusterID: (searchResult as GenericSearchResult)
                            .params[kClusterParamId],
                      )
                    : ThumbnailWidget(file!)
              : const NoThumbnailWidget(addBorder: false),
        ),
      ),
    );
  }
}

