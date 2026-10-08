# Repository maintenance

- Keep reader-specific networking, storage and UI in `sources/<reader>/`.
- Keep CopyManga protocol logic in `packages/copymanga/`; it must not import reader globals or Node.js runtime APIs.
- Keep published reader URLs independent. Suwatte uses `/suwatte/`; Venera is reserved until an adapter is implemented and tested.
- Never commit credentials, tokens, device identifiers from a real account, or manga downloads.
- Preserve source IDs. Increase the numeric source version when changing a released source.
- Preserve published browse feed IDs and maintain sources/suwatte/ENTRYPOINTS.md. Do not remove public browse entries based on personal preferences or an empty response; record any user-requested exclusions explicitly.
- Verify changes from the repository root with `npm run check`, `npm test` and `npm run build`. Live smoke tests must stop on access restrictions; do not rotate identifiers or retry through mirrors to evade them.
