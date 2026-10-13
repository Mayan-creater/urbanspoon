# Urban Spoon — UI/UX Design Specification

## Design Goal
Modern, trustworthy, fast, local, food-focused, and operationally powerful across mobile/tablet/desktop.

## Customer Navigation
Home, Search, Orders, Cart, Profile.

## Restaurant Navigation
Dashboard, Orders, Menu, Promotions, Analytics, Settings.

## Delivery Navigation
Availability, Deliveries, Earnings, History, Profile.

## Admin Navigation
Dashboard, Users, Restaurants, Orders, Delivery, Payments, Promotions, Support, Reports, Configuration.

## Customer Screens
Landing/Home; Login/Register; Location; Restaurant Listing; Search; Filters; Restaurant Details; Menu; Item Customization; Cart; Shared Cart; Group Order; Checkout; Payment; Confirmation; Live Tracking; History; Order Details; Reviews; Favorites; Loyalty; Membership; Profile; Addresses; Support; AI Assistant; Meal Planner.

## Restaurant Screens
Onboarding, Verification, Dashboard, Orders, Order Details, Menu Categories, Item Editor, Availability, Promotions, Reviews, Analytics, Settlements, Staff, Settings, AI Menu Assistant.

## Delivery Screens
Onboarding, Availability, Requests, Active Delivery, Navigation, Pickup, Delivery Confirmation, Earnings, History, Incentives, Support, Profile.

## Admin Screens
Dashboard, User Management, Restaurant Management, Delivery Management, Orders, Payments/Refunds, Promotions, Reviews, Complaints/Support, Reports, Roles/Permissions, Configuration, Audit Logs.

## Design System
Create reusable tokens for typography, spacing, radius, elevation, borders, icons, statuses, and breakpoints. Avoid arbitrary repeated values.

## Reusable Components
Button, Input, Select, Checkbox, Radio, Modal, Drawer, Toast, Card, RestaurantCard, FoodItemCard, PriceBreakdown, Rating, Badge, Tabs, Pagination, Skeleton, EmptyState, ErrorState, AddressSelector, CartSummary, OrderTimeline, TrackingPanel, DataTable, ConfirmationDialog.

## Required UX States
Loading, loaded, empty, error, retry, disabled, unauthorized, offline/degraded where relevant.

## Food Discovery
Cards should prioritize restaurant, cuisine, rating, delivery time, useful distance, price indicator, offers, and open/closed state without visual overload.

## Cart
Clearly show restaurant, item, quantity, customization, item price, subtotal, discount, fees, and final payable amount.

## Checkout
Address → order summary → offer → fees/taxes → payment → confirmation. Prevent duplicate submission.

The price breakdown must label subtotal, item customizations, discount, tax,
delivery fee, platform/service fee, packaging fee, tip, and final total. The
client displays server-provided amounts and does not calculate the payable
total authoritatively. Order-intent expiry, payment pending, payment failure,
refund pending, and retry states must be visible without implying success.

After payment, the confirmation screen waits on the intent state rather than
the provider redirect. It must handle: payment being verified (pending),
order confirmed, payment failed (retry allowed until the intent expires), and
"payment received but the order could not be placed" for a voided intent,
which explains that a full refund has been issued and shows its status.

## Tracking
Order placed → accepted → preparing → ready → partner assigned → on the way → arriving → delivered. Labels map to states as listed in [STATE_MACHINES.md](STATE_MACHINES.md); partner assignment can appear before "ready" because dispatch runs during preparation.

Delivery views must also represent assignment pending, offer expired,
reassignment, delayed, failed, and location unavailable states. Admin and
operations views must show dispatch candidates, assignment history, partner
availability, ETA confidence, and the reason for each reassignment.

## Accessibility
Use semantic controls, keyboard navigation, visible focus, screen-reader labels, sufficient contrast, logical headings, accessible errors, and suitable mobile touch targets.

## Responsive
Do not simply shrink desktop. Reprioritize primary tasks on mobile and allow richer information density on desktop.

## Trust
Clearly show fees, total cost, cancellation policy, refund status, and verification/review signals where applicable. Avoid dark patterns.

Uploads must show allowed purpose, progress, validation/scanning status, and
failure/retry states. Private documents and delivery proof must never be
rendered through an unrestricted public URL.

## AI UX
Explain what AI is doing, provide context/source where useful, show limitations when relevant, and require explicit user action for high-impact operations.
