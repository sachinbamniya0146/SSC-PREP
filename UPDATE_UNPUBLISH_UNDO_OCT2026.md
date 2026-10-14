# Oct 14 2026 - Unpublish (undo) + Select all in Upload History
- Upload History: har row ka checkbox + "Select all". Selected: Publish / Selected: Unpublish (undo).
- Har upload par "Unpublish (N)" button: galti se publish hue questions wapas Pending (students ko nahi dikhte, delete nahi).
- Backend: POST /bank/admin/upload/batches/:id/unpublish, POST /bank/admin/upload/batches-bulk {action, ids}.
