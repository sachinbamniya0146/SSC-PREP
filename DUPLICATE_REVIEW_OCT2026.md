# Duplicate Review (Oct 2026)

Upload / single add me jo question pehle se bank me hai, wo ab reject nahi hota — Admin > Duplicate Review me aata hai.

- Exact same = question, options, correct answer, solution (Eng+Hindi), exam, year, shift, date, paper code sab same.
- Milta-julta = question+options+answer same, par solution/shift/year jaisi koi detail alag (alag fields highlight hote hain).
- Admin chunta hai: Purana rakho (naya hatao) / Naya rakho (purana hide) / Dono rakho. Single ya bulk.
- "Hatana" = hide (isActive=false), hard delete nahi. Question Manager > hidden se wapas laa sakte hain.
- "Bank me purane duplicates dhundo" button purane DB ke exact duplicates bhi queue me daal deta hai.

Deploy:
1. git push, server par pull
2. DB migration: 20261006100000_duplicate_reviews (deploy.sh ke `prisma migrate deploy` se chalti hai)
3. Backend + frontend rebuild
