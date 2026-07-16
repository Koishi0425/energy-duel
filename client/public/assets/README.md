# Runtime asset layout

Only optimized, deployable assets belong here. See `docs/资源与素材管理.md`.

New assets should use these paths:

```text
characters/<character-id>/<form-id>/<pose>.webp
profiles/nameplates/<nameplate-id>/frame.webp
profiles/nameplates/<nameplate-id>/thumbnail.webp
profiles/titles/<title-id>/badge.webp
profiles/ranks/<rank-id>/emblem.webp
profiles/achievements/<achievement-id>/icon.webp
ui/<feature-id>/...
vfx/<effect-id>/...
audio/{bgm,sfx,voice}/...
```

`profiles/nameplates/<nameplate-id>/frame.webp` represents the entire player
banner background. Keep the avatar and the three text rows (Rating, nickname
with rank, and title) clear; reserve the far-right area for decorative art.

Files currently at the root are legacy-compatible assets. Migrate them when
they are next replaced; do not add more root-level assets.
