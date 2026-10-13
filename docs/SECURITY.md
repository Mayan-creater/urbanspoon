# Urban Spoon — Security Specification

## Objectives
Protect accounts, personal information, addresses/location, payments, restaurant business data, orders, admin operations, AI data, and infrastructure.

## Authentication
Use secure password hashing or trusted identity provider, secure sessions/tokens, expiry/revocation, recovery, verification, and brute-force/rate-limit controls. Never store plaintext passwords.

The M1 implementation hashes passwords with scrypt and stores only hashes of
random opaque session tokens. Session cookies are `HttpOnly`, `SameSite=Lax`,
and `Secure` in production. Email verification and password-reset codes are
HMAC-hashed, expire, and have bounded attempts; reset revokes existing sessions.
The local SMTP-compatible Mailpit service is for development only. Production
must supply a real SMTP adapter and a unique `AUTH_TOKEN_SECRET`.

## Authorization
Enforce server-side least privilege using scoped RBAC plus policy checks.
Users may have multiple active role assignments, and each assignment may be
scoped to a restaurant, organization, provider account, or platform. Every
protected resource must verify both the permission and the resource scope;
frontend checks are never authoritative. Prevent IDOR/BOLA by checking
ownership, assignment, order state, and actor permission on every request.

Sensitive permissions such as refunds, role changes, commission changes,
restaurant approval, and audit-log access require explicit permission names,
server-side authorization, and audit records.

## Input Validation
Validate type, format, length, range, enums, and business constraints on the server.

## Payments
Never trust client success. Verify provider results. Do not store raw card data unless explicitly supported by compliant architecture. Make webhooks/refunds idempotent.

## Secrets
Use environment/secret management. Never commit keys, passwords, tokens, signing secrets, or database credentials.

## Web/API Security
Protect against SQL injection, XSS, CSRF where applicable, SSRF, command injection, path traversal, insecure deserialization, broken access control, and rate abuse. Use secure headers/cookies and request-size limits as appropriate.

## Privacy
Collect only necessary personal information. Define consent, retention, deletion/anonymization, access controls, and auditability. Treat location data as sensitive operational information.

Initial retention defaults, to be confirmed by legal review: raw partner location 30 days; authentication sessions and verification tokens until expiry plus 30 days; support case content 3 years after closure; financial records (orders, payments, refunds, settlements, invoices) for the statutory tax-record period; audit logs 3 years. Deleted accounts are anonymized where records must be kept.

## Legal and Compliance
Complete a legal review before production launch. At minimum it covers:

- **Digital Personal Data Protection Act, 2023 (India):** notice and consent, purpose limitation, data-principal rights (access, correction, erasure), breach notification, and grievance handling.
- **Food safety:** verify FSSAI registration or licence for every restaurant before approval (`restaurants.fssai_license_number`), and for home-food providers in Phase 4.
- **Payments:** use a provider's hosted checkout so card data never reaches Urban Spoon systems, keeping PCI DSS scope minimal; follow RBI rules applicable to the chosen payment aggregator.
- **Delivery partner KYC:** never store full Aadhaar numbers or images. Use a licensed KYC provider and keep only verification status, reference, and masked identifiers.
- **Tax:** confirm GST treatment for restaurant services sold through the platform (see [PAYMENT_DESIGN.md](PAYMENT_DESIGN.md)).
- **Brand:** complete a trademark clearance search for "Urban Spoon" before public launch.

## AI Security
Defend against prompt injection, data leakage, malicious instructions, unsafe tool calls, unauthorized actions, and hallucinated facts. AI must not bypass deterministic authorization/business validation.

## File Uploads
Validate type/size, scan where appropriate, generate safe names, prevent executable content, and store private documents behind access controls.

## Logging
Do not log passwords, tokens, payment credentials, or unnecessary personal data. Use correlation IDs.

## Audit
Audit role changes, restaurant approval, refunds, admin actions, payment adjustments, account status changes, and configuration changes.

## Security Testing
Authentication, authorization, negative API, dependency/secret scanning, vulnerability scanning, abuse/rate limits, uploads, and AI security.

## Incident Response
Document detection, containment, investigation, recovery, notification obligations, and lessons learned.

## Production Gate
Do not launch with unresolved critical vulnerabilities.
