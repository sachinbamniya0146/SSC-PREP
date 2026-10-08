# Upload status + search + Excel download (Oct 7 2026)

1. Upload History (Admin home): har upload ka status ab server par save hota hai - Chal raha hai (%), Poora, Fail, Beech me ruka.
   Columns: Total / Upload hue / Failed / Duplicate review. Page reload ya server restart ke baad bhi dikhta hai.
   Chalte upload ke liye history har 4 sec me apne aap refresh hoti hai.
2. Question Manager search: question ki line / aadha hissa, options ya solution ke shabd (kisi bhi order me, sab words match hone chahiye).
3. Question Manager > "Download": current filters (exam / subject / chapter / year / shift / PYQ-Practice / status / search) ke sab questions.
   Excel ya CSV; ek sheet (merge) ya subject / chapter / year / year+shift / exam wise alag sheets. Max 50,000 per download.
   Columns upload template jaise (+ question/option images) - file wapas upload ho sakti hai.

Migration: 20261007100000_upload_batch_status (deploy me prisma migrate deploy se chalti hai)

## Update 2 (Oct 7 2026, screenshots ke baad)
- Download me ab default sirf wahi questions aate hain jo students ko dikhte hain (approved + active + not suspended). "Pending / hidden bhi shamil karein" tick karne par sab.
- Nayi option: "Subject -> Chapter (ZIP)": har subject ka folder, usme har chapter ki alag Excel. Ek chapter ki alag-alag uploads merge hoke aati hain.
- Upload accounting: Total = Upload hue + Failed + Duplicate review + Skip. Failed ki sahi ginti (pehle sirf capped error list se hoti thi).
  Upload ka history row file parse hote hi ban jata hai (Chal raha hai %), bade file me bhi live. Agar kuch rows ka hisaab na mile to warning dikhti hai.
- History ke buttons ab alag row me, badi aur saaf labels ke saath; date chhoti.
- Migration: 20261007110000_upload_batch_skipped

## Update 3 (Oct 7 2026) - Chapter picker download
Question Manager me subject chunne par "Chapter chunkar download" panel aata hai: us subject ke chapters + question count (students ko dikhne wale),
chapters tick karo, phir: ek Excel (merge) / chapter-wise sheets / chapter-wise ZIP. Har chapter ke saamne alag ⬇️ bhi hai.
Counts upar ke baaki filters (exam / year / shift / PYQ-Practice / search) ke hisaab se badalte hain.
