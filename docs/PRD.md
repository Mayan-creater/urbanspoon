# Urban Spoon — Product Requirements Document (PRD)

**Project Name:** Urban Spoon  
**Document:** Product Requirements Document  
**Version:** 1.0  
**Status:** Initial Product Definition  
**Product Type:** AI-powered hyperlocal food marketplace and food
delivery platform

------------------------------------------------------------------------

# 1. Product Overview

## 1.1 Product Vision

Urban Spoon is an AI-powered, hyperlocal food marketplace that connects
customers with restaurants, cloud kitchens, home chefs, tiffin
providers, caterers, and delivery partners.

The platform will provide food discovery, ordering, customization,
payments, delivery tracking, restaurant management, group ordering,
smart carts, loyalty, subscriptions, corporate ordering, catering, and
AI-powered food assistance.

Urban Spoon should not be positioned as merely a clone of Zomato or
Swiggy. Its long-term objective is to combine food discovery, ordering,
social/group purchasing, AI assistance, hyperlocal businesses, recurring
food services, and business/corporate food ordering into one ecosystem.

## 1.2 One-Line Product Description

> Urban Spoon is an AI-powered hyperlocal food marketplace that makes
> discovering, comparing, ordering, sharing, and managing food smarter
> and more convenient.

## 1.3 Problem Statement

Customers often need to:

-   Search through many restaurants.
-   Compare prices, ratings, delivery charges, and offers.
-   Decide what to eat.
-   Coordinate group orders.
-   Track deliveries.
-   Manage payments and refunds.
-   Find healthy, dietary, budget-friendly, or customized food.
-   Discover local and home-cooked food.

Restaurants need to:

-   Manage menus.
-   Receive and process orders.
-   Manage availability.
-   Promote products.
-   Understand customer behavior.
-   Track revenue and settlements.
-   Improve operational performance.

Urban Spoon should provide a unified solution for these problems.

------------------------------------------------------------------------

# 2. Product Goals

## 2.1 Primary Goals

1.  Enable customers to discover restaurants and food.
2.  Enable customers to place and pay for food orders.
3.  Enable real-time order status and delivery tracking.
4.  Enable restaurants to manage menus and orders.
5.  Enable delivery partners to manage assigned deliveries.
6.  Provide administrators with complete platform control.
7.  Provide intelligent food recommendations.
8.  Provide smart cart and group ordering capabilities.
9.  Support hyperlocal food businesses.
10. Build a scalable platform that can expand city by city.

## 2.2 Business Goals

Urban Spoon should support revenue through:

-   Restaurant commissions.
-   Delivery fees.
-   Platform/service fees.
-   Advertising/promoted restaurants.
-   Subscription/membership plans.
-   Corporate food accounts.
-   Catering commissions.
-   Home-chef commissions.
-   Tiffin subscriptions.
-   Premium restaurant analytics.
-   Promotional campaigns.

------------------------------------------------------------------------

# 3. Product Differentiation

Urban Spoon should provide features beyond a conventional food-delivery
marketplace.

## 3.1 Smart Portable Cart

Customers can create a shareable cart.

Example:

`urbanspoon.com/cart/ABC123`

A shared cart can allow multiple users to:

-   View the cart.
-   Add items.
-   Remove items.
-   Customize items.
-   Comment on items.
-   Approve the cart.
-   Split payment.
-   Set a deadline.
-   Convert the cart into an order.

## 3.2 Group Ordering

Multiple people can contribute to one order.

Use cases:

-   Family.
-   Friends.
-   Office lunch.
-   College groups.
-   Parties.
-   Events.

## 3.3 Smart Food Comparison

Urban Spoon can compare:

-   Food price.
-   Delivery charge.
-   Platform fee.
-   Offers.
-   Rating.
-   Estimated delivery time.
-   Final payable amount.

The platform can identify the best-value option.

## 3.4 AI Food Assistant

Customers can ask natural-language questions such as:

> "I want vegetarian food for four people under ₹1,000."

The AI should recommend suitable restaurants/items based on available
information.

## 3.5 AI Meal Planner

The customer can specify:

-   Number of people.
-   Budget.
-   Cuisine.
-   Dietary requirements.
-   Occasion.

The AI can create a meal plan and optionally add it to the cart.

## 3.6 AI Review Analysis

AI can analyze customer reviews and summarize:

-   Taste.
-   Quantity.
-   Packaging.
-   Delivery speed.
-   Food temperature.
-   Common complaints.
-   Common positive comments.

## 3.7 AI Menu Generator

A restaurant can provide food information and/or images and receive
assistance generating:

-   Item name.
-   Description.
-   Category.
-   Tags.
-   Dietary labels.
-   Search keywords.
-   Nutritional information where reliable data is available.

AI-generated nutritional information must not be presented as medically
verified unless validated by an appropriate source.

## 3.8 AI Voice Ordering

Customers can use voice commands such as:

> "Order my usual meal from my favourite restaurant."

The system must show the proposed order and obtain confirmation before
placing an order.

## 3.9 Hyperlocal Marketplace

Urban Spoon should support:

-   Restaurants.
-   Cloud kitchens.
-   Home chefs.
-   Tiffin providers.
-   Bakeries.
-   Sweet shops.
-   Juice shops.
-   Tea shops.
-   Caterers.
-   Local food vendors where legally and operationally appropriate.

------------------------------------------------------------------------

# 4. Target Market

## 4.1 Initial Market

Urban Spoon should initially support a focused local/city market rather
than attempting nationwide deployment immediately.

The first launch can be designed around one city and then expanded.

## 4.2 Expansion Strategy

Potential expansion:

1.  Initial city.
2.  Nearby cities.
3.  Regional expansion.
4.  State-level expansion.
5.  Multi-state expansion.
6.  National marketplace.

The architecture must allow multiple cities, delivery zones,
restaurants, and operational configurations.

------------------------------------------------------------------------

# 5. User Types

Urban Spoon will support the following major actors.

## 5.1 Customer

Uses the platform to discover and order food.

## 5.2 Restaurant Owner

Manages restaurant operations, menus, orders, offers, and analytics.

## 5.3 Restaurant Staff

Handles order preparation and operational tasks.

## 5.4 Delivery Partner

Accepts and completes delivery assignments.

## 5.5 Home Chef

Lists and sells home-cooked food.

## 5.6 Tiffin Provider

Provides recurring meal/tiffin subscriptions.

## 5.7 Caterer

Handles bulk and event-based food requirements.

## 5.8 Corporate Customer

Manages employee/company food ordering.

## 5.9 Support Agent

Handles customer, restaurant, and delivery support.

## 5.10 Admin

Manages normal platform operations.

## 5.11 Super Admin

Has highest-level platform control.

------------------------------------------------------------------------

# 6. Roles and Permissions

The application must use role-based access control.

## Customer

Can:

-   View public content.
-   Manage own profile.
-   Manage own addresses.
-   Create carts.
-   Place orders.
-   View own orders.
-   Make payments.
-   Submit reviews.
-   Raise support tickets.

Cannot:

-   Modify other users.
-   Modify restaurant operational data.
-   Modify platform configuration.

## Restaurant Owner

Can:

-   Manage own restaurant.
-   Manage own menu.
-   Manage availability.
-   Manage orders.
-   View own analytics.
-   Manage restaurant offers.

Cannot:

-   Access another restaurant's private data.
-   Access platform administration.

## Restaurant Staff

Can:

-   View assigned restaurant orders.
-   Update preparation status where permitted.
-   Manage operational order tasks.

## Delivery Partner

Can:

-   Manage own availability.
-   View assigned delivery requests.
-   Accept/reject assignments where permitted.
-   Update delivery status.
-   View own earnings.

## Support Agent

Can:

-   View authorized customer/order information.
-   Manage support tickets.
-   Assist with refunds/issue resolution according to permissions.

## Admin

Can:

-   Manage customers.
-   Manage restaurants.
-   Manage delivery partners.
-   Manage orders.
-   Manage promotions.
-   Manage complaints.
-   View reports.

## Super Admin

Can:

-   Manage administrators.
-   Manage system configuration.
-   Manage permissions.
-   Access all authorized platform functions.

------------------------------------------------------------------------

# 7. Customer Application

## 7.1 Customer Registration

Support:

-   Mobile number.
-   Email.
-   Password where applicable.
-   OTP verification.
-   Social authentication where supported.
-   Profile setup.

## 7.2 Customer Profile

Customer profile should contain:

-   Name.
-   Mobile.
-   Email.
-   Profile photo.
-   Saved addresses.
-   Food preferences.
-   Dietary preferences.
-   Favourite restaurants.
-   Favourite food.
-   Order history.
-   Loyalty balance.
-   Membership.
-   Payment methods where securely supported.

------------------------------------------------------------------------

# 8. Food Discovery

The homepage should provide:

-   Location selector.
-   Search.
-   Food categories.
-   Cuisine categories.
-   Restaurants near the customer.
-   Popular restaurants.
-   Trending food.
-   Top-rated restaurants.
-   Fast delivery.
-   Budget food.
-   Vegetarian food.
-   Vegan food.
-   Healthy food.
-   Newly added restaurants.
-   Offers.
-   Personalized recommendations.
-   Recently ordered items.
-   Favourite restaurants.

------------------------------------------------------------------------

# 9. Search

Customers should be able to search for:

-   Restaurants.
-   Food items.
-   Cuisines.
-   Categories.
-   Locations.
-   Dietary options.

Search should support:

-   Autocomplete.
-   Suggestions.
-   Typo tolerance where feasible.
-   Search history.
-   Popular searches.
-   Filters.
-   Sorting.
-   Personalized results.

------------------------------------------------------------------------

# 10. Restaurant Discovery Filters

Potential filters:

## Cuisine

-   North Indian.
-   South Indian.
-   Chinese.
-   Italian.
-   Mughlai.
-   Fast food.
-   Pizza.
-   Burgers.
-   Bakery.
-   Desserts.
-   Beverages.
-   Other supported cuisines.

## Dietary

-   Vegetarian.
-   Non-vegetarian.
-   Vegan.
-   Jain.
-   Healthy.
-   Gluten-free where verified.

## Price

-   Under ₹100.
-   ₹100–₹200.
-   ₹200–₹500.
-   ₹500+.

## Operational

-   Open now.
-   Fast delivery.
-   Free delivery.
-   Offers.

## Quality

-   Rating.
-   Distance.
-   Customer reviews.
-   Food popularity.

------------------------------------------------------------------------

# 11. Restaurant Profile

Restaurant page should contain:

-   Restaurant name.
-   Logo.
-   Cover images.
-   Rating.
-   Reviews.
-   Cuisine.
-   Address.
-   Distance.
-   Estimated delivery time.
-   Cost information.
-   Operating hours.
-   Delivery radius.
-   Offers.
-   Menu.
-   Photos.
-   Restaurant information.
-   Policies where relevant.

------------------------------------------------------------------------

# 12. Menu System

Restaurants should be able to create:

-   Menu categories.
-   Subcategories.
-   Food items.
-   Variants.
-   Add-ons.
-   Combos.
-   Customizations.

Each food item can contain:

-   Name.
-   Description.
-   Price.
-   Image.
-   Veg/non-veg classification.
-   Dietary tags.
-   Bestseller status.
-   Spiciness.
-   Availability.
-   Preparation time.
-   Add-ons.
-   Variants.
-   Nutritional information when reliable.

Restaurants must be able to mark items as unavailable/out of stock.

------------------------------------------------------------------------

# 13. Smart Cart

The standard cart must support:

-   Add item.
-   Remove item.
-   Change quantity.
-   Customize item.
-   Add add-ons.
-   Apply coupon.
-   Delivery fee.
-   Platform fee.
-   Taxes.
-   Packaging fee.
-   Tip where supported.
-   Final total.

The Smart Cart should additionally support:

-   Save cart.
-   Share cart.
-   Duplicate cart.
-   Group cart.
-   Cart comments.
-   Cart expiry.
-   Cart approval.
-   Split bill.
-   Reorder.
-   AI optimization.

------------------------------------------------------------------------

# 14. Group Ordering

Group ordering should allow:

1.  User creates a group cart.
2.  System generates a shareable link/code.
3.  Other users join.
4.  Participants add/customize food.
5.  Cart owner can review.
6.  Order is locked.
7.  Payment is collected.
8.  Restaurant receives one consolidated order.

Optional future functionality:

-   Individual payment.
-   Equal split.
-   Item-based split.
-   Participant limits.
-   Group order deadline.

------------------------------------------------------------------------

# 15. Checkout

Checkout should contain:

-   Selected address.
-   Map/location.
-   Delivery instructions.
-   Contact information.
-   Order summary.
-   Coupon.
-   Discounts.
-   Delivery charge.
-   Platform fee.
-   Packaging charge.
-   Taxes.
-   Tip.
-   Payment method.
-   Scheduled delivery option.
-   Final total.

Before payment/order confirmation, the customer must see the final
payable amount.

------------------------------------------------------------------------

# 16. Payments

Payment system should support, subject to selected payment provider and
market availability:

-   UPI.
-   Cards.
-   Net banking.
-   Wallets.
-   Cash on delivery (Phase 2; see `docs/PAYMENT_DESIGN.md`).
-   Other supported payment methods.

Payment lifecycle must handle:

-   Payment initiated.
-   Payment pending.
-   Payment successful.
-   Payment failed.
-   Payment cancelled.
-   Duplicate payment.
-   Refund.
-   Partial refund.
-   Failed refund.

The system must reconcile payment status with order status.

------------------------------------------------------------------------

# 17. Order Management

## 17.1 Order Lifecycle

The complete states and allowed transitions for order intents, payment
attempts, refunds, orders, deliveries, and delivery offers are defined in
`docs/STATE_MACHINES.md`, which is authoritative. This section summarizes them.

Checkout creates an **order intent** that freezes the items, charges, address,
and total. The customer pays against the intent. Once the server has
independently verified the payment, it confirms the intent into exactly one
order. If the restaurant or an item is no longer available at that moment, the
intent is voided and the payment is refunded automatically. Late or duplicate
payments are also refunded automatically and never create an order.

An order therefore always starts already paid, and carries no payment states:

``` text
CONFIRMED
↓
RESTAURANT_ACCEPTED
↓
PREPARING
↓
READY_FOR_PICKUP
↓
PICKED_UP
↓
DELIVERED
```

Terminal failure and cancellation states:

``` text
REJECTED_BY_RESTAURANT   (before acceptance, including acceptance timeout)
CANCELLED_BY_CUSTOMER    (only before restaurant acceptance)
CANCELLED_BY_RESTAURANT  (after acceptance, with a reason)
CANCELLED_BY_ADMIN
DELIVERY_FAILED
```

Delivery-partner assignment happens in parallel with preparation, so it is
tracked on the delivery rather than as an order state. Customer tracking
combines both.

All transitions are enforced server-side, and every transition records actor,
timestamp, reason, and the previous/next state. Terminal orders are never
reopened; a replacement is a new order created through a documented support
workflow.

------------------------------------------------------------------------

# 18. Order Tracking

Customers should be able to view:

-   Order number.
-   Restaurant status.
-   Food preparation status.
-   Delivery partner assignment.
-   Pickup status.
-   Delivery status.
-   Estimated delivery time.
-   Map where supported.
-   Delivery partner information where appropriate.
-   Support options.

Potential real-time sequence:

``` text
Order confirmed
↓
Restaurant accepted
↓
Food preparation
↓
Food ready
↓
Delivery partner assigned
↓
Picked up
↓
On the way
↓
Arriving
↓
Delivered
```

------------------------------------------------------------------------

# 19. Delivery Partner System

## 19.1 Registration

Collect and verify required information according to applicable laws and
business policies:

-   Personal details.
-   Contact information.
-   Identity/KYC information.
-   Vehicle details.
-   Required documents.
-   Bank/payment details.

## 19.2 Availability

Delivery partner can:

-   Go online.
-   Go offline.
-   Receive delivery requests.

## 19.3 Delivery Request

Request should show appropriate information such as:

-   Pickup location.
-   Delivery location/zone.
-   Distance.
-   Estimated earning.
-   Relevant order information.

Delivery partner can accept/reject according to platform rules.

## 19.4 Delivery Lifecycle

Each delivery offer to a partner is accepted, rejected, or expires; on
rejection or expiry the delivery is offered to the next partner. Once a
partner accepts, the delivery progresses:

``` text
PENDING_ASSIGNMENT
↓
ASSIGNED
↓
ARRIVED_AT_RESTAURANT
↓
PICKED_UP
↓
ARRIVED
↓
DELIVERED
```

A delivery can also end as `FAILED` (with a reason) or `CANCELLED` (when the
order is cancelled). The full rules are in `docs/STATE_MACHINES.md`.

Support delivery confirmation through appropriate verification such as
OTP where applicable.

------------------------------------------------------------------------

# 20. Delivery Partner Dashboard

Include:

-   Current status.
-   Current orders.
-   Delivery requests.
-   Earnings.
-   Daily earnings.
-   Weekly earnings.
-   Incentives.
-   Bonuses.
-   Ratings.
-   Completed deliveries.
-   Support.
-   Profile/KYC status.

------------------------------------------------------------------------

# 21. Restaurant Portal

Restaurant dashboard should include:

-   Today's orders.
-   Pending orders.
-   Completed orders.
-   Cancelled orders.
-   Revenue.
-   Average order value.
-   Average preparation time.
-   Rating.
-   Notifications.
-   Menu status.
-   Operational status.

------------------------------------------------------------------------

# 22. Restaurant Order Management

Restaurant must be able to:

-   Receive orders.
-   Accept orders.
-   Reject orders with appropriate reason.
-   Start preparation.
-   Mark food ready.
-   View delivery status.
-   Handle item availability.
-   View order history.

Real-time or near-real-time order updates should be supported where
technically appropriate.

------------------------------------------------------------------------

# 23. Restaurant Menu Management

Restaurant owners should manage:

-   Categories.
-   Items.
-   Prices.
-   Images.
-   Descriptions.
-   Variants.
-   Add-ons.
-   Availability.
-   Timings.
-   Offers.
-   Combos.
-   Dietary tags.
-   Nutritional information where available.

------------------------------------------------------------------------

# 24. Restaurant Analytics

Restaurant analytics should include:

-   Sales.
-   Orders.
-   Average order value.
-   Best-selling items.
-   Poor-performing items.
-   Peak ordering time.
-   Customer retention.
-   Repeat customers.
-   Cancellation rate.
-   Preparation time.
-   Rating.
-   Review trends.
-   Revenue.
-   Settlement information.

Future AI capability:

> Explain why restaurant performance changed and recommend actions.

------------------------------------------------------------------------

# 25. Admin Platform

## 25.1 Admin Dashboard

Display:

-   Customers.
-   Restaurants.
-   Delivery partners.
-   Orders.
-   Active orders.
-   Revenue.
-   GMV.
-   Platform earnings.
-   Refunds.
-   Cancellations.
-   Complaints.
-   Operational metrics.

## 25.2 Restaurant Management

Admin can:

-   Approve restaurant.
-   Reject restaurant.
-   Suspend restaurant.
-   Reactivate restaurant.
-   Verify documents.
-   Manage restaurant information.
-   Manage commission/configuration.
-   Manage delivery zones.
-   View restaurant performance.

## 25.3 Customer Management

Admin can:

-   Search customers.
-   View customer profile.
-   View order history.
-   Handle account issues.
-   Manage restrictions where required.

## 25.4 Delivery Management

Admin can:

-   View delivery partners.
-   Verify delivery partners.
-   View active deliveries.
-   Assign/reassign deliveries where supported.
-   Monitor delays.
-   View delivery history.

## 25.5 Order Management

Admin can:

-   Search orders.
-   View order lifecycle.
-   Investigate failed orders.
-   Handle cancellations.
-   Handle disputes.
-   Support refunds according to permissions.

------------------------------------------------------------------------

# 26. Offers and Promotions

Support:

-   Percentage discounts.
-   Fixed discounts.
-   First-order offers.
-   Restaurant offers.
-   Platform offers.
-   Time-based offers.
-   Location-based offers.
-   Minimum order requirements.
-   Maximum discount.
-   Usage limits.
-   User-specific offers.
-   Promotional campaigns.

------------------------------------------------------------------------

# 27. Loyalty Program

Urban Spoon may implement a loyalty currency such as:

**FoodCoins**

Customers can earn points through:

-   Orders.
-   Repeat purchases.
-   Referrals.
-   Promotions.
-   Reviews where permitted.

Potential loyalty levels:

-   Bronze.
-   Silver.
-   Gold.
-   Platinum.

Rewards can include:

-   Discounts.
-   Free delivery.
-   Exclusive offers.
-   Promotional benefits.

------------------------------------------------------------------------

# 28. Membership / Subscription

Potential product:

**Urban Spoon FoodPass**

Benefits may include:

-   Free/discounted delivery.
-   Exclusive offers.
-   Additional loyalty rewards.
-   Member-only promotions.
-   Priority support.

Exact pricing and benefits should be configurable by administrators.

------------------------------------------------------------------------

# 29. Reviews and Ratings

Customers can rate:

-   Restaurant.
-   Food.
-   Delivery.
-   Packaging.

The platform should support:

-   Written reviews.
-   Photos where supported.
-   Review moderation.
-   Report review.
-   Restaurant response.
-   Fraud/spam detection.

------------------------------------------------------------------------

# 30. Customer Support

Support features:

-   Help center.
-   FAQs.
-   Support tickets.
-   Chat support where implemented.
-   Order-specific support.
-   Missing item complaint.
-   Wrong item complaint.
-   Late delivery complaint.
-   Food quality complaint.
-   Payment issue.
-   Refund request.
-   Restaurant complaint.
-   Delivery complaint.

------------------------------------------------------------------------

# 31. Notifications

Supported channels may include:

-   In-app.
-   Push.
-   Email.
-   SMS.
-   WhatsApp where an approved integration is available.

Important events:

-   Registration.
-   OTP.
-   Order created.
-   Payment status.
-   Restaurant acceptance/rejection.
-   Food preparation.
-   Delivery assignment.
-   Pickup.
-   Delivery.
-   Cancellation.
-   Refund.
-   Promotional campaigns.
-   Subscription events.

Users should have appropriate notification preferences.

------------------------------------------------------------------------

# 32. AI Features

AI is a major differentiator for Urban Spoon.

## 32.1 AI Food Assistant

Natural-language food discovery.

Example:

> "Find me spicy vegetarian food under ₹300 within 5 km."

## 32.2 AI Personalized Recommendations

Recommendations based on permitted and appropriate signals such as:

-   Order history.
-   Cuisine preferences.
-   Price range.
-   Time.
-   Location.
-   Restaurant availability.

## 32.3 AI Meal Planner

Inputs:

-   Number of people.
-   Budget.
-   Cuisine.
-   Dietary requirements.
-   Occasion.

Output:

-   Recommended meal.
-   Estimated total.
-   Suggested restaurant/items.
-   Add-to-cart option.

## 32.4 AI Smart Cart

AI can identify:

-   Better-value combinations.
-   Available offers.
-   Duplicate items.
-   Missing complementary items.
-   Potential savings.

The AI must not silently alter an order. Customer confirmation is
required.

## 32.5 AI Review Analysis

Generate restaurant summaries from reviews.

## 32.6 AI Restaurant Insights

Provide restaurant owners with explanations of:

-   Sales trends.
-   Item performance.
-   Customer sentiment.
-   Cancellation patterns.
-   Potential operational improvements.

## 32.7 AI Menu Assistant

Help restaurant owners create menu content.

## 32.8 AI Voice Ordering

Voice input should create a proposed order that requires customer
confirmation before placement.

------------------------------------------------------------------------

# 33. Party and Event Ordering

Customer can select:

-   Number of people.
-   Budget.
-   Food type.
-   Cuisine.
-   Occasion.
-   Delivery date/time.

Urban Spoon can generate a party food plan.

Potential outputs:

-   Starters.
-   Main course.
-   Bread.
-   Rice.
-   Dessert.
-   Beverages.

Customer can request quotations from suitable restaurants/caterers.

------------------------------------------------------------------------

# 34. Corporate Food Ordering

Urban Spoon should support business accounts.

Corporate organization can have:

-   Company profile.
-   Employee accounts.
-   Food allowance.
-   Department budgets.
-   Spending limits.
-   Monthly reporting.
-   Approved restaurants.
-   Order history.
-   Invoices.

Example:

``` text
ABC Technologies
Monthly employee food allowance: configurable
```

------------------------------------------------------------------------

# 35. Office Group Ordering

Employees can participate in an office group order.

Example:

``` text
Lunch Order Open
↓
Employees add food
↓
Order closes at configured time
↓
Consolidated order
↓
Restaurant prepares bulk order
```

------------------------------------------------------------------------

# 36. Home-Cooked Food Marketplace

Urban Spoon may support verified home-food providers.

Categories:

-   Home meals.
-   Regional food.
-   Homemade snacks.
-   Bakery products.
-   Special occasion food.

Appropriate onboarding, verification, food safety, legal, and local
regulatory requirements must be addressed before launch.

------------------------------------------------------------------------

# 37. Tiffin Subscription

Customers can subscribe to:

-   Lunch.
-   Dinner.
-   Lunch + dinner.
-   Weekly plans.
-   Monthly plans.

Features:

-   Subscription schedule.
-   Skip meal.
-   Pause.
-   Resume.
-   Address management.
-   Meal calendar.
-   Subscription payment.
-   Provider dashboard.

------------------------------------------------------------------------

# 38. Catering Marketplace

Caterers can provide:

-   Event food.
-   Corporate catering.
-   Weddings.
-   Parties.
-   Bulk food orders.

Customers can request:

-   Number of guests.
-   Budget.
-   Cuisine.
-   Date.
-   Location.

Providers can submit quotations.

------------------------------------------------------------------------

# 39. Smart Restaurant Comparison

Customers should be able to compare restaurants based on:

-   Food price.
-   Delivery charge.
-   Platform fee.
-   Offers.
-   Rating.
-   Delivery time.
-   Distance.
-   Final payable amount.

The system may identify:

**Best Value**

but must explain the basis of the recommendation.

------------------------------------------------------------------------

# 40. Restaurant Health Score

Urban Spoon may provide an operational score based on configurable
factors:

-   Customer rating.
-   Order accuracy.
-   Delivery performance.
-   Cancellation rate.
-   Preparation time.
-   Complaint rate.
-   Repeat customers.
-   Verification status.

Example:

``` text
Restaurant Health Score: 92/100
```

The calculation must be transparent enough for restaurant partners and
should not unfairly penalize restaurants because of factors outside
their control.

------------------------------------------------------------------------

# 41. "Why This Restaurant?" Explanation

The platform can explain recommendations:

> Recommended because:
>
> -   High rating.
> -   Close to you.
> -   Matches your preferred cuisine.
> -   Fits your normal price range.
> -   Good delivery performance.

------------------------------------------------------------------------

# 42. Location and Delivery

The system should support:

-   Customer location.
-   Restaurant location.
-   Delivery partner location.
-   Address management.
-   Delivery zones.
-   Delivery radius.
-   Distance calculation.
-   ETA.
-   Maps.
-   Route/navigation integration.
-   Live tracking where available.

Location data must be handled according to applicable privacy
requirements.

------------------------------------------------------------------------

# 43. Business Rules

The following rules should be enforced.

1.  Closed restaurants must not receive normal new orders.
2.  Unavailable food items cannot be ordered.
3.  Customers cannot review orders they did not complete/receive.
4.  Expired coupons cannot be used.
5.  Coupon rules must be validated server-side.
6.  Cancelled orders cannot transition to delivered.
7.  Delivery partners cannot accept new delivery assignments while
    unavailable/offline unless explicitly supported.
8.  Customers must see the final payable amount before confirmation.
9.  AI must not place an order without required customer confirmation.
10. Sensitive operations require authorization.
11. Customers cannot access other customers' private data.
12. Restaurants cannot access another restaurant's private data.
13. Delivery partners can access only information required for their
    assigned delivery.
14. Payment status must be verified independently from client-side UI
    state.
15. Refunds must follow defined authorization and payment rules.
16. Administrative actions must be auditable.

------------------------------------------------------------------------

# 44. Edge Cases

The system must define behavior for:

-   Restaurant rejects order.
-   Restaurant closes after order placement.
-   Food item becomes unavailable after order placement.
-   Customer cancels order.
-   Delivery partner rejects/cancels assignment.
-   Delivery partner cannot reach restaurant.
-   Delivery partner cannot reach customer.
-   Payment fails.
-   Payment succeeds but order creation fails.
-   Duplicate payment.
-   Duplicate order request.
-   Refund fails.
-   Network connection is lost.
-   GPS is unavailable.
-   Address cannot be verified.
-   Restaurant preparation is delayed.
-   Delivery is delayed.
-   Customer changes address.
-   Customer is unavailable at delivery.
-   Order is missing an item.
-   Wrong item is delivered.

------------------------------------------------------------------------

# 45. Security Requirements

The platform must implement appropriate:

-   Authentication.
-   Authorization.
-   Role-based access control.
-   Input validation.
-   Output encoding.
-   Secure session management.
-   Rate limiting.
-   Secret management.
-   Encryption in transit.
-   Secure password handling where passwords are used.
-   Payment security.
-   Audit logging.
-   Abuse prevention.
-   Fraud detection.
-   Privacy controls.

Never store or expose payment credentials unless explicitly required and
compliant with the selected payment architecture.

Secrets must never be committed to source control.

------------------------------------------------------------------------

# 46. Privacy

The platform may process:

-   Personal information.
-   Contact information.
-   Addresses.
-   Location information.
-   Order history.
-   Payment-related information.
-   Restaurant business information.
-   Delivery partner information.

Privacy requirements must include:

-   Appropriate consent.
-   Data minimization.
-   Access control.
-   Retention policies.
-   Deletion/account closure process where legally applicable.
-   Secure handling of personal information.
-   Appropriate privacy notices.

Applicable Indian laws/regulations and other jurisdictional requirements
must be reviewed before production launch.

------------------------------------------------------------------------

# 47. Performance Requirements

The system should be designed for:

-   Fast page loading.
-   Responsive search.
-   Efficient restaurant listing.
-   Reliable cart operations.
-   Reliable checkout.
-   Reliable order state updates.
-   Efficient API calls.
-   Mobile-friendly performance.

Exact performance targets should be finalized during technical
architecture.

------------------------------------------------------------------------

# 48. Scalability Requirements

The architecture should be capable of expanding from:

``` text
1 City
↓
Multiple Cities
↓
Multiple Regions
↓
National Platform
```

Scalability should consider:

-   Customers.
-   Restaurants.
-   Orders.
-   Delivery partners.
-   Concurrent users.
-   Notifications.
-   Search.
-   Payments.
-   Analytics.
-   Real-time tracking.

------------------------------------------------------------------------

# 49. Responsive Design

The customer-facing application should support:

-   Desktop.
-   Tablet.
-   Mobile.

Restaurant/admin dashboards should be responsive where practical.

Mobile-first UX should be considered because food ordering is
predominantly a mobile-oriented use case.

------------------------------------------------------------------------

# 50. Accessibility

The product should aim to support:

-   Keyboard navigation.
-   Screen readers.
-   Accessible labels.
-   Appropriate color contrast.
-   Focus management.
-   Accessible forms.
-   Error messages.
-   Responsive text sizing.

------------------------------------------------------------------------

# 51. Analytics and KPIs

## Customer KPIs

-   New customers.
-   Active customers.
-   Repeat customers.
-   Customer retention.
-   Average order value.
-   Orders/customer.
-   Customer lifetime value.

## Restaurant KPIs

-   Orders.
-   Sales.
-   Average order value.
-   Preparation time.
-   Cancellation rate.
-   Rating.
-   Repeat customers.

## Delivery KPIs

-   Acceptance rate.
-   Pickup time.
-   Delivery time.
-   Completion rate.
-   Cancellation rate.
-   Earnings.

## Platform KPIs

-   GMV.
-   Platform revenue.
-   Commission revenue.
-   Delivery revenue.
-   Active users.
-   Active restaurants.
-   Active delivery partners.
-   Orders/day.
-   Cancellation rate.
-   Refund rate.
-   Customer acquisition cost.
-   Retention.

------------------------------------------------------------------------

# 52. External Integrations

Potential integrations:

-   Payment gateway.
-   Maps/location provider.
-   GPS/location services.
-   SMS provider.
-   Email provider.
-   Push notification service.
-   WhatsApp provider where available.
-   AI/LLM provider.
-   Cloud storage.
-   Authentication provider.
-   Analytics platform.
-   Restaurant/POS integrations.
-   Accounting/invoicing services.

The exact vendors should be selected separately from this PRD.

------------------------------------------------------------------------

# 53. Admin Configuration

Where practical, business rules should be configurable instead of
hard-coded.

Examples:

-   Delivery fees.
-   Commission rates.
-   Platform fees.
-   Coupon rules.
-   Loyalty points.
-   Membership pricing.
-   Delivery zones.
-   Restaurant categories.
-   Food categories.
-   Notification templates.
-   Order timeouts.
-   Cancellation rules.

------------------------------------------------------------------------

# 54. Content Management

Admin should eventually be able to manage:

-   Homepage banners.
-   Promotional campaigns.
-   Food categories.
-   Cuisine categories.
-   Featured restaurants.
-   Offers.
-   Help content.
-   FAQs.
-   Policy pages.
-   Promotional content.

------------------------------------------------------------------------

# 55. Auditability

Important actions should be auditable.

Examples:

-   Admin changed commission.
-   Restaurant was suspended.
-   Order was cancelled.
-   Refund was issued.
-   User role was changed.
-   Coupon was modified.
-   Menu price was changed.

Audit records should contain appropriate:

-   Actor.
-   Action.
-   Timestamp.
-   Target.
-   Relevant before/after information where appropriate.

------------------------------------------------------------------------

# 56. MVP Definition

The first production-capable MVP should focus on the essential
marketplace flow.

Sections 56–60 summarize the intended phasing. `docs/ROADMAP.md` is the
authoritative phase definition; where the two differ, the roadmap wins and
this PRD should be updated to match.

## Customer MVP

-   Registration/login.
-   Location.
-   Restaurant discovery.
-   Search.
-   Restaurant profile.
-   Menu.
-   Cart.
-   Checkout.
-   Payment.
-   Order placement.
-   Order history.
-   Basic tracking.
-   Reviews.

## Restaurant MVP

-   Registration/onboarding.
-   Restaurant profile.
-   Menu management.
-   Availability.
-   Order management.
-   Basic analytics.

## Delivery MVP

-   Registration.
-   Availability.
-   Order assignment.
-   Pickup.
-   Delivery.
-   Delivery status.
-   Basic earnings.

## Admin MVP

-   Dashboard.
-   Customer management.
-   Restaurant management.
-   Delivery management.
-   Order management.
-   Payment/refund management.
-   Basic reports.

------------------------------------------------------------------------

# 57. Phase 2

Add:

-   Smart Cart.
-   Group Ordering.
-   Advanced offers.
-   Loyalty.
-   Membership.
-   Advanced reviews.
-   Restaurant analytics.
-   Delivery analytics.
-   Better live tracking.
-   Scheduled ordering.

------------------------------------------------------------------------

# 58. Phase 3

Add:

-   AI Food Assistant.
-   AI recommendations.
-   AI meal planner.
-   AI review analysis.
-   AI restaurant insights.
-   AI menu assistant.
-   AI Smart Cart.
-   Voice ordering.

------------------------------------------------------------------------

# 59. Phase 4

Add:

-   Corporate accounts.
-   Office group ordering.
-   Catering marketplace.
-   Home-chef marketplace.
-   Tiffin subscriptions.
-   Bulk ordering.
-   Party planning.

------------------------------------------------------------------------

# 60. Phase 5

Add:

-   Multi-city expansion.
-   Advanced personalization.
-   Advanced fraud detection.
-   Advanced analytics.
-   Restaurant/POS integrations.
-   Advanced business intelligence.
-   Marketplace optimization.

------------------------------------------------------------------------

# 61. Product Roadmap Principle

Urban Spoon should not attempt to build every future capability during
the initial MVP.

The product should be developed incrementally:

``` text
MVP
↓
Validate
↓
Measure
↓
Improve
↓
Differentiate
↓
Scale
```

Each phase should be independently testable and deployable where
practical.

------------------------------------------------------------------------

# 62. Success Criteria

Urban Spoon MVP will be considered successful when:

1.  A customer can discover a restaurant.
2.  A customer can select and customize food.
3.  A customer can add food to a cart.
4.  A customer can complete checkout.
5.  A payment can be successfully processed.
6.  The restaurant receives the order.
7.  The restaurant can accept and prepare the order.
8.  A delivery partner can receive/complete the delivery.
9.  The customer can see order status.
10. The customer receives the completed order.
11. The customer can review the order.
12. Admin can monitor and manage the entire lifecycle.
13. Appropriate failures and cancellations are handled safely.
14. Authorization prevents users from accessing unauthorized
    information.
15. Automated tests cover critical workflows.

------------------------------------------------------------------------

# 63. Product Quality Principle

Urban Spoon must prioritize:

-   Reliability.
-   Security.
-   Usability.
-   Performance.
-   Accessibility.
-   Scalability.
-   Maintainability.
-   Observability.
-   Testability.

The platform should not sacrifice security or correctness merely to add
features quickly.

------------------------------------------------------------------------

# 64. AI Agent Development Principle

This PRD is the master product-level reference.

The AI development agent must:

1.  Read this PRD before implementing major product functionality.
2.  Follow the requirements defined here.
3.  Consult detailed supporting documentation when available.
4.  Never silently contradict a defined requirement.
5.  Identify ambiguous requirements before making major
    product/architecture decisions.
6.  Break large features into manageable tasks.
7.  Implement incrementally.
8.  Add appropriate tests.
9.  Run relevant tests and validation commands.
10. Report actual results.
11. Avoid unrelated changes.
12. Never expose secrets.
13. Preserve working functionality unless a change is explicitly
    required.
14. Update documentation when significant product behavior changes.

------------------------------------------------------------------------

# 65. Supporting Documentation

The project should maintain separate documentation for technical and
operational detail.

Recommended structure:

``` text
.github/
├── copilot-instructions.md
├── instructions/
└── prompts/

docs/
├── PRD.md
├── STATE_MACHINES.md
├── FEATURES_AND_USER_STORIES.md
├── USER_ROLES_AND_PERMISSIONS.md
├── BUSINESS_WORKFLOWS.md
├── UI_UX_DESIGN.md
├── ARCHITECTURE.md
├── DATABASE_DESIGN.md
├── API_SPECIFICATION.md
├── SECURITY.md
├── AI_FEATURES.md
├── PAYMENT_DESIGN.md
├── DELIVERY_SYSTEM.md
├── TESTING_STRATEGY.md
├── IMPLEMENTATION_PLAN.md
├── DEPLOYMENT.md
└── ROADMAP.md
```

The PRD defines **what Urban Spoon should be**.

Supporting documents define **how specific areas should work**.

The source code implements the approved requirements.

------------------------------------------------------------------------

# 66. Legal and Product Governance

Urban Spoon is a working product name and must not be treated as a confirmed
trademark until a trademark search, ownership decision, and registration or
legal clearance are completed for each launch jurisdiction. Marketing,
domains, app-store listings, and partner contracts must use the cleared brand
name and approved marks.

Before production launch, obtain legal review for privacy and data rights,
consumer protection, payment and refund terms, food safety and marketplace
responsibilities, delivery-partner classification, GST/tax treatment, tax
invoicing, accessibility obligations, advertising claims, AI disclosures, and
content/moderation procedures. Record jurisdiction, data-retention basis,
subprocessors, incident-notification duties, and terms/version effective dates.

The product owner, security owner, and legal/compliance owner must approve the
MVP release gate. Unresolved legal or trademark issues block public launch.

------------------------------------------------------------------------

# 67. Final Product Vision

Urban Spoon should evolve from a food-delivery MVP into a broader
AI-powered food ecosystem.

The long-term vision is:

``` text
                 URBAN SPOON
                     │
       ┌─────────────┼─────────────┐
       │             │             │
   Customers     Restaurants    Delivery
       │             │             │
       └─────────────┼─────────────┘
                     │
                  AI Layer
                     │
       ┌─────────────┼─────────────┐
       │             │             │
 Smart Cart     Food AI       Personalization
       │             │             │
       └─────────────┼─────────────┘
                     │
       ┌─────────────┼─────────────┐
       │             │             │
  Home Food      Corporate      Catering
       │             │             │
       └─────────────┼─────────────┘
                     │
              Hyperlocal Food
                 Marketplace
```

Urban Spoon should ultimately become more than a food-ordering
application: it should be a **hyperlocal food marketplace and
intelligent food assistant** that helps customers discover, decide,
purchase, share, and manage food while giving food businesses the tools
to operate and grow.
