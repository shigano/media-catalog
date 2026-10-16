Media Catalog V3.13.15 — Episode coordinate recovery

Base: V3.13.14.
No Prisma schema change.

Fix:
- Repairs historical episode rows whose physical file path is correct but whose stored SxxExx coordinate was truncated by an older parser.
- If the newly detected SxxExx key is free and the exact same physical file already exists under the same MediaItem at another coordinate, the existing Episode row is moved to the correct coordinate.
- Preserves Episode.id, therefore preserving relations such as progress/favorites/history.
- Does not overwrite a different physical file already occupying the target SxxExx; existing collision protections remain active.
- Applied to both normal and manually-verified/locked series branches.

Expected One Piece recovery example:
S21E1009 file stored historically as S21E100 -> S21E1009, with log:
[EPISODE-COORDINATE-RECOVERY] One Piece: 21:100 -> 21:1009 | ...

The corrected 4-digit parser from earlier versions will also create the formerly-collided missing rows E1000..E1085 as distinct episodes.
After targeted rescan, verify physical/database counts before any global scan.
