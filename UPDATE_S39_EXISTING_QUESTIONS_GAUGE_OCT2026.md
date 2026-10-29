# S39 - "Pehle se upload hue questions" + practice 100 gauge (29 Oct 2026)

## Admin: chapter / topic / sub-topic chunte hi purane questions dikhte hain
- API (admin/moderator only, `@Department('QUESTIONS','PRACTICE')`): `GET /bank/admin/manage/existing?chapterId=&topicId=&subTopicId=&kind=pyq|practice&q=&skip=&take=`
  -> `counts {total, pyq, practice, live, hidden, practiceTarget:100, practiceMissing}` + paged list (search: question ka ek hissa / option). Counts hamesha poore node ke hote hain (search/kind filter se nahi badalte).
- **Add question page**: chapter chunte hi "🔎 Is chapter / topic me pehle se ye questions hain" panel (PYQ / Practice chips, search, edit link). Sab exams ke dikhte hain, taaki dusre exam me same question pakda jaye.
- **Uploads page**: "Check only" ke Practice plan me har row par "👁 pehle se" link -> Questions Manager us chapter/topic/sub-topic par khulta hai (`?subject=&chapter=&topic=&subtopic=&kind=`).
- Exam date sirf in admin endpoints me hai; students ko kahin nahi.

## Coverage: Practice 100 gauge
- API: `GET /bank/admin/manage/practice-gauge?subjectId=` aur `/practice-gauge/export` (Excel). Sirf "leaf" nodes: sub-topic, bina sub-topic wala topic, bina topic wala chapter (+ topic ke sub-topic-less questions ek alag row). Sabse kam wale pehle; live PYQ count saath me.
- Admin -> Coverage -> naya tab "📚 Practice 100 gauge" (progress bar N/100, kam kitne, Excel download).

## Tests
`bank-admin.existing.spec.ts` (3), `practice-gauge.spec.ts` (4), `upload-preview.spec.ts` (ids in plan rows). Total related specs: sab pass.
