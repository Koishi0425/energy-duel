# Runtime asset layout

Only generated, optimized deployable assets belong here. Put imports in
`art-source/runtime-imports/` and run `npm run assets:optimize`. See
`docs/资源与素材管理.md`.

New assets should use these paths:

```text
characters/<character-id>/<form-id>/portrait.<hash>.webp
characters/<character-id>/<form-id>/preview.<hash>.webp
profiles/nameplates/<nameplate-id>/frame.<hash>.webp
profiles/nameplates/<nameplate-id>/thumbnail.<hash>.webp
profiles/titles/<title-id>/badge.<hash>.webp
profiles/ranks/<rank-id>/emblem.webp
profiles/achievements/<achievement-id>/icon.webp
ui/<feature-id>/...
vfx/<effect-id>/...
audio/{bgm,sfx,voice}/...
```

`profiles/nameplates/<nameplate-id>/frame.webp` represents the entire player
banner background. Keep the avatar and the three text rows (Rating, nickname
with rank, and title) clear; reserve the far-right area for decorative art.

`manifests/assets.json` catalogs generated URLs. Do not edit generated files by
hand; rerun the optimizer so stale hashes are removed consistently.
