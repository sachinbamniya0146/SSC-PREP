# Pricing / Offers / Coupons + Test screen + Vocabulary solutions — 28 Oct 2026

## Test screen (`/test`)
- Instructions screen: "agree" aur "scribe" boxes ab bade (24px) **TickBox** hain — poori row tap hoti hai, tick saaf dikhta hai (`components/TickBox.tsx`).
- Live test: chuna hua option ab right side par **✓ tick** dikhata hai (pehle sirf rang badalta tha). Options min 52px, `role="radiogroup"`.
- Phone: Mark / Clear / Show Answer / Hint 2-column grid me; neeche wali bar (Prev / Palette / Next) hi "Next" hai (duplicate "Save & Next" phone par hidden).
- **Submit se pehle review** (real CBT jaisa): Answered / Not answered / Not visited / Marked ke 4 tile — sab numbers live status se gine jaate hain; section-wise bar (side-scroll nahi); marking scheme; time left; section-lock warning; "kitne sawal 0 marks denge". Phone par bottom-sheet.
- Practice "Show Answer" ab results wali **SolutionPanel** use karta hai (English / हिंदी / dono toggle; `##ANSWER` markers raw nahi dikhte). Hint bhi markers ke bina.

## Vocabulary
- Quiz aur daily revision ke result me ab **har sawal ke saare options** dikhte hain, sahi option ✓ green, aapka galat option red, "N options" chip, "Aapka jawab / Sahi" line aur solution (`components/VocabReview.tsx`).
- Naya column `vocab_questions.explanationHindi`: admin vocab form me "हिंदी solution" box, Excel Questions sheet me optional `explanationHindi` column. Khali cell = purana Hindi solution safe rehta hai.
- Quiz dete waqt bhi option par ✓ tick, bade touch targets.

## Pricing, offers, coupons (`/admin/pricing`)
- Plan: `priceInr` = regular price. Naya: `mrpInr` (sirf kata hua "was" price), `offerPct` + `offerLabel` + `offerStartsAt/EndsAt` (time-boxed offer, date par apne aap band), `badge`, `sortOrder`.
- Student ko kya charge hota hai = `pricing.salePriceInr` (server compute). Coupon **offer price ke upar** lagta hai. Final amount ya to 0 (free) ya ≥ ₹1 (Cashfree minimum).
- Coupon: % ya flat ₹, max-discount cap, minimum order, start/expiry, total uses (0 = unlimited), per-student limit, plan-wise, "offer ke saath chalega ya nahi", pause/resume, usage + discount + revenue stats. Used coupon delete nahi hota (pause karo).
- Admin API ab whitelist + validation se likhta hai (pehle raw body seedha DB me jata tha — `usesCount` tak badla ja sakta tha).
- Checkout `/premium`: kata hua price, offer chip + countdown, "You save", plan-wise coupon check (`POST /payments/coupon/validate { code, planId }`). Invoice / history me offer alag line.
- Migration `20261028100000_pricing_offers_coupons_vocab_hindi` — sirf nullable / default wale columns (additive, idempotent).

## Tests chalaye gaye
- `pricing.util.spec.ts` (25 checks) tiny jest-shim ke saath tsx par chala.
- `monetization.service` ke `validateCoupon` / `createOrder` / `listPlans` par 18 checks (stubbed Prisma + Cashfree).
- Saari migrations real Postgres 16 par order me apply (+ dobara apply), coupon-stats SQL sample payments par chala.
- Real `tsc` / `next build` / jest / `prisma generate` yahan nahi chale (npm registry sandbox me block).
