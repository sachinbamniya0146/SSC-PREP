# Upload status + search + Excel download (Oct 7 2026)

1. Upload History (Admin home): har upload ka status ab server par save hota hai - Chal raha hai (%), Poora, Fail, Beech me ruka.
   Columns: Total / Upload hue / Failed / Duplicate review. Page reload ya server restart ke baad bhi dikhta hai.
   Chalte upload ke liye history har 4 sec me apne aap refresh hoti hai.
2. Question Manager search: question ki line / aadha hissa, options ya solution ke shabd (kisi bhi order me, sab words match hone chahiye).
3. Question Manager > "Download": current filters (exam / subject / chapter / year / shift / PYQ-Practice / status / search) ke sab questions.
   Excel ya CSV; ek sheet (merge) ya subject / chapter / year / year+shift / exam wise alag sheets. Max 50,000 per download.
   Columns upload template jaise (+ question/option images) - file wapas upload ho sakti hai.

Migration: 20261007100000_upload_batch_status (deploy me prisma migrate deploy se chalti hai)
