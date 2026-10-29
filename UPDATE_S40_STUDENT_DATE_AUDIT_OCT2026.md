# S40 - Students ko exam date kahin nahi dikhti: audit (29 Oct 2026)

## Kya dekha (grep: `examDate`, `paperCode`, `12-Sep`, `formatIsoDate`, `titleForPaper`, template selects)
| Jagah | Result |
|---|---|
| Mock list (`/mocks`, `mocks.service`) | title = `SSC CGL 2025 · Tier 1 · Shift 2 · Set n`; `examDate` select hi nahi - OK |
| Mock list / attempt / result payload (`tests.service`) | `withoutExamDate()` laga hai (S34-S36) - OK |
| Template `description` | "Real SSC CGL Tier 1 paper, Shift 2 ..." - date nahi - OK |
| Question Bank / browse (`bank.service`) | `paperCode` response se hata diya gaya tha - OK |
| Leaderboard, history, notifications, sitemap, share text, `pdf-export/`, Telegram | `testTemplate.title` hi use hota hai (year + shift + Set) - OK |
| **Public search (`GET /search`)** | **LEAK mila**: Meilisearch hit me `paperCode` (`SSC-CGL-T-I-12-Sep-2025-S2`) student ko jata tha. **Fix**: `common/student-safe.ts` `stripAdminOnlyFields()` (hit + `_formatted` dono se `examDate`, `paperCode` hat jate hain); spec `student-safe.spec.ts`. |
| Admin-only endpoints (`admin/pyq-dates` = ADMIN, `bank/admin/*` = ADMIN/MODERATOR) | date dikhna theek hai |

## Ek baaki cheez (jaanbujhkar nahi badli)
Keyed PYQ mock ka **template id** `pyq-k-<exam>-t1-<yyyymmdd>-s2` me tarikh ke 8 ank hain. Student ko ye `/test?...` ya API me `id` ke roop me dikh sakta hai (title/page par nahi). Id badalna matlab purane attempts / purchases / bookmarks ka link tootna, isliye bina migration ke nahi kiya. Agar chahiye to alag session: id me tarikh ki jagah chhota hash + `TestTemplate` ko purane id se map karna.

## Phone checks
`PHONE_CHECK_CHECKLIST_OCT2026.md` me naye sections F (students: Year -> Shift, date kahin nahi) aur G (admin: ek Excel, existing questions panel, Practice gauge).

## Chhoti safai
`bank-upload-job.service.ts` se ek unused import (`rowKind`) hataya (CI lint `no-unused-vars` ke liye).
