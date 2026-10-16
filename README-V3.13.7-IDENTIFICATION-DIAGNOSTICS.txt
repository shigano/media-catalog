Media Catalog V3.13.7 — Identification diagnostics + query scoring

Base: V3.13.6.
No Prisma schema change. Do NOT run prisma db push.

Changes:
- Query variants used to discover TMDB candidates now also participate in candidate scoring.
- Conservative first-word singular/plural search variant for localized title typos (Perdu/Perdus).
- Detailed identification logs: IDENTIFY-QUERY, IDENTIFY-SEARCH, IDENTIFY-CANDIDATE, IDENTIFY-MATCH, IDENTIFY-REJECT, IDENTIFY-NO-RESULT.
- Existing confidence/year/margin floors remain in place.
- No scanner ownership/root logic changed in this release.

Targeted validation order:
1. Perdu dans l'espace (1965)
2. Ready for Love 2
3. Do NOT refresh Animés yet; Shaman King root migration is a separate scanner fix.
