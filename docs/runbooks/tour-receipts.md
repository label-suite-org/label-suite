# Tour receipt connection

The native tour uses Paperless for original PDFs and OCR. Label Suite keeps receipt status and reviewed expense links. Configure `PAPERLESS_URL` (HTTPS origin), `PAPERLESS_TOKEN`, and `PAPERLESS_ORG_ID` in the private runtime environment. Never ship the token to native clients. The connection fails closed for other organizations.

Use a non-staff Paperless service account with only `documents.add_document`, `documents.view_document`, and `documents.view_paperlesstask`. Uploads belong to that account. Paperless API version 9 is requested explicitly for stable task fields.

The authenticated native receipts endpoint accepts PDFs up to 10 MiB, uses a stable receipt UUID and an organization-scoped SHA256 identity, and reconciles uncertain archive responses by deterministic filename. Originals remain on the iPhone until a completed document is confirmed. The archive performs OCR independently of the phone.

Suggestions require review: currency cannot be inferred from a dollar sign, and payer is never inferred. Saving creates one expense and updates its allowance or additional forecast cost in the same transaction. Receipt UUIDs are locked and linked atomically. Matching recorded expenses can receive the receipt without changing spending or the forecast; equal-total candidates require attachment or confirmation of a separate purchase. Scanning a visually similar receipt with different bytes still requires this review. Imported income and cash balances are not changed.

The additive receipt migration preserves existing money records. During rollback, retain the receipt table and Paperless originals; restore the previous application and private runtime configuration through the deployment owner. Do not erase receipt evidence to reverse an application release.
