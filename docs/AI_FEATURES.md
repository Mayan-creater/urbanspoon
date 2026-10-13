# Urban Spoon — AI Features

## MVP Boundary

AI is post-MVP. It may assist discovery or content generation but cannot authorize, price, dispatch, refund, or place an order without deterministic backend validation and explicit customer confirmation.

## Capabilities

- Food assistant and recommendations: translate natural-language preferences into suggestions from current, available menu items.
- Meal planner: propose items from one restaurant; server-computed totals enforce the requested budget and quantity bounds. Optional coordinates use the marketplace service-radius filter before catalog data is sent to the provider.
- Review analysis: summarize up to 50 published reviews and validate every cited review ID against that source set.
- Smart Cart: analyze only the signed-in customer's cart; identify duplicate lines, current restaurant offers, lower-priced same-section alternatives, exact potential item savings, and up to three complementary items. Suggestions never update the cart unless the customer explicitly confirms an addition. Savings exclude offers and option-bearing items and are not guaranteed checkout discounts.
- Restaurant insights: authorized restaurant partners can request a 7-, 30-, or 90-day report based on recorded order snapshots and published reviews. It includes sales trends, item performance, cancellation patterns, review sentiment, and metric-linked operational suggestions. Review and metric citations are validated against the source datasets.
- Menu assistant: draft editable descriptions and keywords for an authorized restaurant partner; drafts are never persisted automatically. Partners supply any dietary tags as claims to verify.
- Voice ordering: browser speech recognition fills the prompt; the customer reviews the transcript and submits it to a single-restaurant order-proposal endpoint. The server validates item IDs, quantities, current prices, and the computed total. The customer must review the restaurant menu and use the existing cart/checkout flow; no AI endpoint changes a cart or places an order. Order history is not provided to the model.

## Security and Privacy

Treat model output and retrieved content as untrusted. The API uses an OpenAI-compatible chat-completions endpoint configured by `AI_API_BASE_URL`, `AI_API_KEY`, and `AI_MODEL`; credentials remain server-side. Food suggestions are restricted to open restaurants and active, available menu items, and canonical names, prices, tags, and IDs come from the database rather than model output. Meal plans are checked against computed totals. Review analysis receives only published reviews with email addresses and phone-like strings redacted, and citation IDs are checked against the submitted dataset. Menu generation requires the existing restaurant menu-management permission and does not save drafts.

Provider requests use JSON response mode, low temperature, a 12-second timeout, and bounded inputs/outputs. Contact-like email and phone strings are redacted from free-text prompts, review text, and menu item information; this is minimization, not guaranteed anonymization. Do not configure a provider until its retention and data-processing terms are acceptable for the content sent to it. Prompts and provider output are not stored by the application. Successful actions write minimal audit metadata (actor, capability, target restaurant where relevant, and result count) without content. AI routes have a stricter per-IP throttle than the general API. Smart Cart still returns deterministic duplicate, offer, and price-comparison results without provider configuration; complementary suggestions are omitted. Restaurant insight metrics remain available without the provider, while generated explanations and recommendations are omitted.

## Acceptance

AI responses identify uncertainty, use current availability when claiming availability, cite review source IDs where practical, refuse unauthorized actions, and require explicit confirmation for any high-impact action. AI suggestions never silently alter a cart, set a price, or place an order. Smart Cart additions require a customer click and use the existing cart validation API. Browser speech recognition has its own browser/provider privacy behavior; only the reviewed transcript is sent to Urban Spoon's configured AI endpoint.
