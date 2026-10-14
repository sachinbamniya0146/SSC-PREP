# Oct 14 2026 - Duplicate "latest rakho" + multi Excel + speed + error details
1. Admin > Upload: ek saath kai Excel/CSV/JSON/Word files chun sakte hain (ek ke baad ek, duplicates files ke beech bhi pakde jate hain).
2. "Upload ke baad duplicates me naya rakho + publish" checkbox (default ON): upload ke turant baad har duplicate me naya question rakha jata hai, purana hide, sab publish.
3. Duplicate Review page: "Sab naya rakho + Publish" ek click (Exact + Milte-julte dono). Server 40 sec ke tukdon me kaam karta hai, page khud baar-baar chalata hai - timeout nahi.
4. Speed: duplicates ek batch me queue hote hain (pehle 2+ query per row), bulk resolve 6 parallel, PYQ mock sirf ek baar rebuild.
5. Errors: har rejected row me Column + "Kaise theek karein"; CSV / rejected Excel me bhi.
