# Tour receipt connection

The native tour uses Paperless for original PDFs and OCR. Label Suite keeps receipt status and reviewed expense links. Configure `PAPERLESS_URL` (HTTPS origin), `PAPERLESS_TOKEN`, and `PAPERLESS_ORG_ID` in the private runtime environment. Never ship the token to native clients. The connection fails closed for other organizations.

Use a non-staff Paperless service account with only `documents.add_document`, `documents.view_document`, and `documents.view_paperlesstask`. Uploads belong to that account. Paperless API version 9 is requested explicitly for stable task fields.

The authenticated native receipts endpoint accepts PDFs up to 10 MiB, uses a stable receipt UUID and an organization-scoped SHA256 identity, and reconciles uncertain archive responses by deterministic filename. Originals remain on the iPhone until a completed document is confirmed. The archive performs OCR independently of the phone.

Suggestions require review: currency cannot be inferred from a dollar sign, and payer is never inferred. Saving creates one expense and updates its allowance or additional forecast cost in the same transaction. Receipt UUIDs are locked and linked atomically. Matching recorded expenses can receive the receipt without changing spending or the forecast; equal-total candidates require attachment or confirmation of a separate purchase. Scanning a visually similar receipt with different bytes still requires this review. Imported income and cash balances are not changed.

The additive receipt migration preserves existing money records. During rollback, retain the receipt table and Paperless originals; restore the previous application and private runtime configuration through the deployment owner. Do not erase receipt evidence to reverse an application release.

Existing archive receipts can be selected through the authenticated receipts GET with `archive=paperless`, optional bounded `query` (title search), and `page`. POST accepts `{receipt_id, document_id}` and reads the selected document plus original SHA256 through the same restricted Paperless account. It creates or returns one tour receipt using the existing unique organization/document and organization/hash keys; it never uploads a second archive copy or creates a cost. A document assigned to another tour is rejected. An unconfirmed upload of the same bytes must be reconciled first. Expense confirmation remains the separate duplicate-safe entries flow.

Only documents already visible to the Paperless service account appear. Owners may share specific tour receipts with that account using document-level view permission; do not grant archive-wide access or change ownership. The native picker requires connectivity; after linking, cached OCR/review details can reopen offline. Original PDF viewing still opens Paperless online. Existing upload behavior is retained; the picker is the reuse path for archived documents.
