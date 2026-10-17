# Repository maintenance

- Keep reader-specific networking, storage and UI in `sources/<reader>/`.
- Keep CopyManga protocol logic in `packages/copymanga/`; it must not import reader globals or Node.js runtime APIs. Native Kotlin equivalents live under `packages/<site>/native/` and are compiled into Tachimanga.
- Keep published reader URLs independent. Suwatte uses `/suwatte/`; Venera uses `/venera/index.json`.
- Tachimanga uses `/tachimanga/index.min.json` and a signed APK containing five stable source IDs. Keep its native adapter in `sources/tachimanga/`; never commit the signing key. Commit updated public release APKs, and verify their bytecode, resources and signing fingerprint during CI.
- Never commit credentials, tokens, device identifiers from a real account, or manga downloads.
- Preserve source IDs. Increase Suwatte's numeric version or Venera's semantic version when changing a released source.
- Preserve published browse feed IDs and maintain each reader's ENTRYPOINTS.md. Do not remove public browse entries based on personal preferences or an empty response; record any user-requested exclusions explicitly.
- Verify changes from the repository root with `npm run check`, `npm test` and `npm run build`. Live smoke tests must stop on access restrictions; do not rotate identifiers or retry through mirrors to evade them.
