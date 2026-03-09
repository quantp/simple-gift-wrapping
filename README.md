# Simple Gift Wrapping — Shopify Dawn Theme Extension
It adds a configurable gift wrapping form on the Product Detail Page (PDP) and a matching edit / remove UI in the cart drawer.

---

## Table of Contents

1. [Feature Overview](#feature-overview)
2. [File Structure](#file-structure)
3. [Architecture & Approach](#architecture--approach)
4. [Data Model](#data-model)
5. [Per-Product Configuration](#per-product-configuration)
6. [Theme Editor Settings](#theme-editor-settings)
7. [CSS & Tailwind Setup](#css--tailwind-setup)
8. [Warehouse / Order Visibility](#warehouse--order-visibility)
9. [Setup Guide](#setup-guide)
10. [Development Workflow](#development-workflow)

---

## Feature Overview

| Capability | Detail |
|---|---|
| PDP toggle | Checkbox reveals a gift message form below the Add to Cart button |
| Gift price | Free or paid — driven by the price of the selected gift wrap product |
| Cart drawer | Inline summary with Edit / Remove controls per line item |
| Per-product control | Metafield `gift_wrapping.enabled` overrides the global default |
| Character limits | Configurable per field via Theme Editor |
| Warehouse info | Gift message data is visible in Shopify Admin order detail |
| Separate line items | Same variant added multiple times (with/without gift wrap) always creates distinct cart lines |

---

## File Structure

```
├── assets/
│   ├── gift-wrapping.js          # All JavaScript (PDP + Cart Drawer)
│   └── gift-wrapping.css         # Compiled output — DO NOT edit directly
│
├── snippets/
│   ├── gift-wrapping-form.liquid # PDP snippet (rendered inside buy-buttons.liquid)
│   └── cart-drawer.liquid        # Modified Dawn snippet — includes gift wrap UI row
│
├── config/
│   └── settings_schema.json      # Theme Editor settings for gift wrap
│
├── locales/
│   └── en.default.json           # Translation keys (products.gift_wrapping.*)
│
├── tailwind.input.css            # Tailwind source — edit this, not gift-wrapping.css
├── tailwind.config.js            # (not used in v4 — config lives in tailwind.input.css)
└── package.json                  # npm scripts for Tailwind build
```

---

## Architecture & Approach

### Module 1 — PDP (`GiftWrappingPDP` custom element)

The PDP form is a Web Component (`<gift-wrapping-pdp>`) rendered by `snippets/gift-wrapping-form.liquid`. It wraps the toggle checkbox and the collapsible form fields.

**Add to Cart interception**

Dawn's `product-form.js` handles ATC submissions. To add two items atomically (main product + gift wrap product), the component attaches a `submit` listener at the **capture phase** on `document`. This fires before Dawn's handler, allowing `event.preventDefault()` and `event.stopImmediatePropagation()` to fully block the default flow.

```
User clicks ATC
  → document submit (capture) → GiftWrappingPDP._handleFormSubmit()
      → POST /cart/add.js  { items: [main, gift_wrap] }
      → Update cart drawer DOM from response sections
      → publish(PUB_SUB_EVENTS.cartUpdate)
      → cartDrawer.open()
```

**Preventing cart line merging**

Shopify merges cart lines that share the same variant ID and identical properties. To allow the same variant to be added both with and without gift wrapping as separate lines, a unique `_gift_wrap_id` (UUID via `crypto.randomUUID`) is stamped onto **both** the main product line item and the gift wrap line item at add time.

---

### Module 2 — Cart Drawer (`CartGiftWrap` class)

The cart drawer DOM is completely re-rendered after every cart update. All event handlers are therefore attached via **event delegation** on `document`, which means they survive re-renders automatically.

```
document
  ├── input  → update char counter / clear field error on the .field wrapper
  ├── change → checkbox uncheck → remove gift wrap line via /cart/change.js
  └── click
        ├── .cart-gift-wrap__edit-btn   → show edit form
        ├── .cart-gift-wrap__cancel-btn → hide edit form
        └── .cart-gift-wrap__update-btn → PATCH properties via /cart/change.js
```

A single `CartGiftWrap` instance is created once at page load (guarded by `window.__giftWrappingLoaded`). The guard also prevents double-registration on PDP pages where both `gift-wrapping-form.liquid` and `cart-drawer.liquid` include the same `<script>` tag.

---

## Data Model

Gift wrapping uses Shopify's **native nested cart lines** (`parent_id` / `parent_line_key`).

| Line item | Key properties |
|---|---|
| Main product | `_gift_wrap_id: <uuid>` |
| Gift wrap product (child) | `_is_gift_wrap: "true"`, `_gift_wrap_id: <uuid>`, `_gift_to`, `_gift_from`, `_gift_message`, `parent_id: <main variant id>` |

**Why nested lines?**

- The gift wrap child line is **automatically removed** when its parent is removed — no custom logic needed.
- Shopify renders the relationship natively in checkout, order confirmation emails, and the order status page.
- No complex Liquid loop is required in `cart-drawer.liquid` to pair items.

**Why `_gift_wrap_id`?**

Shopify merges two cart lines if they share the same `variant_id` and have identical `properties`. Stamping each add with a unique UUID prevents merging even when the same product is added multiple times — once with gift wrap and once without.

---

## Per-Product Configuration

Gift wrapping availability is resolved in two layers:

```
1. Global default   →  Theme Editor › Gift Wrapping › "Enable for all products by default"
2. Per-product      →  product.metafields.gift_wrapping.enabled  (boolean, overrides global)
```

**To disable gift wrap on a specific product:**

1. Shopify Admin › Products › select the product
2. Scroll to **Metafields**
3. Add `gift_wrapping.enabled` = `false`

**To enable gift wrap on a product when the global default is off:**

Set `gift_wrapping.enabled` = `true` on the product metafield.


---

## Theme Editor Settings

All settings live under **Theme Editor › Gift Wrapping**.

| Setting ID | Type | Default | Purpose |
|---|---|---|---|
| `gift_wrapping_product_handle` | product picker | — | The product that represents the gift wrap service. Its price is added to the cart. Set to a free product for complimentary gift wrapping. |
| `gift_wrapping_enabled_by_default` | checkbox | `true` | Enable gift wrap for all products unless overridden by a metafield. |
| `gift_wrapping_to_max_length` | number | `100` | Max characters for the "To" email field. |
| `gift_wrapping_from_max_length` | number | `100` | Max characters for the "From" email field. |
| `gift_wrapping_message_max_length` | number | `300` | Max characters for the message textarea. |

---

### Build commands

```bash
# Install dependencies (first time only)
npm install

# One-time build — output goes to assets/gift-wrapping.css
npm run tw:build

# Watch mode for development
npm run tw:watch
```

> `assets/gift-wrapping.css` is the **compiled output**. Always edit `tailwind.input.css`, then rebuild.

---

## Warehouse / Order Visibility

All gift wrap data is stored as **line item properties** on the gift wrap child line:

| Property | Storefront visible | Shopify Admin visible |
|---|---|---|
| `_gift_to` | No (underscore prefix hides it) | Yes |
| `_gift_from` | No | Yes |
| `_gift_message` | No | Yes |
| `_is_gift_wrap` | No | Yes |
| `_gift_wrap_id` | No | Yes |

Warehouse staff can view the gift message under **Orders › [Order] › Line Items** in Shopify Admin. No additional integration or app is required.

---

## Setup Guide

### 1. Create the gift wrap product

1. Shopify Admin › Products › **Add product**
2. Title: e.g. "Gift Wrapping Service"
3. Price: set to `0` for free, or a positive amount for paid
4. Status: **Active**, published to **Online Store**
5. Inventory: uncheck "Track quantity"

### 2. Configure the theme

1. Online Store › Themes › **Customize**
2. Go to **Theme settings › Gift Wrapping**
3. Select the product created in step 1
4. Adjust character limits and default availability as needed

### 3. (Optional) Set up the metafield definition

Required only if you want per-product control:

1. Settings › Custom data › **Products**
2. Add definition:
   - **Namespace**: `gift_wrapping`
   - **Key**: `enabled`
   - **Type**: Boolean
3. On individual products, set `gift_wrapping.enabled` to `true` or `false` to override the global default