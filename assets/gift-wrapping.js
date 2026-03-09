/**
 * Gift Wrapping Feature
 * Module 1 - PDP: Gift wrap toggle form + intercepts ATC to add gift wrap product.
 * Module 2 - Cart Drawer: Edit / update / remove gift wrap per cart line item.
 */

(() => {
  if (window.__giftWrappingLoaded) return;
  window.__giftWrappingLoaded = true;

  /* ============================================================
     Shared utility: character counter
     ============================================================ */

  /**
   * Update the .gw-char-count span that immediately follows an input/textarea.
   * Displays "remaining / max" (e.g. "95 / 100").
   * Turns red when the field is at the limit.
   *
   * @param {HTMLInputElement|HTMLTextAreaElement} field
   */
  function _updateCharCount(field) {
    const max = parseInt(field.dataset.charMax, 10);
    if (!max) return;

    const remaining = max - field.value.length;
    const counter = field.closest('.field')?.querySelector('.gw-char-count');
    if (!counter) return;

    counter.textContent = `${remaining} / ${max}`;
    counter.classList.toggle('tw:text-red-500', remaining <= 0);
    counter.classList.toggle('tw:opacity-50', remaining > 0);
    counter.classList.toggle('tw:opacity-100', remaining <= 0);
  }

  /* ============================================================
     PDP - Custom Element
     ============================================================ */

  class GiftWrappingPDP extends HTMLElement {
    connectedCallback() {
      this.sectionId = this.dataset.sectionId;
      this.giftWrapVariantId = this.dataset.giftWrapVariantId;

      this._checkbox = this.querySelector('.gift-wrapping-pdp__checkbox');
      this._form = this.querySelector('.gift-wrapping-pdp__form');
      this._isProcessing = false;

      this._onCheckboxChange = this._handleCheckboxChange.bind(this);
      this._onFormSubmit = this._handleFormSubmit.bind(this);

      this._checkbox.addEventListener('change', this._onCheckboxChange);

      this.addEventListener('input', (e) => {
        if (e.target.dataset.charMax) _updateCharCount(e.target);
        if (e.target.value.trim()) {
          e.target.closest('.field')?.classList.remove('field__input--error');
        }
      });

      document.addEventListener('submit', this._onFormSubmit, { capture: true });
    }

    disconnectedCallback() {
      this._checkbox.removeEventListener('change', this._onCheckboxChange);
      document.removeEventListener('submit', this._onFormSubmit, { capture: true });
    }

    _handleCheckboxChange() {
      const checked = this._checkbox.checked;
      this._form.hidden = !checked;
      this._form.setAttribute('aria-hidden', String(!checked));
      this._checkbox.setAttribute('aria-expanded', String(checked));
    }

    _handleFormSubmit(event) {
      const form = event.target;
      if (form.getAttribute('data-type') !== 'add-to-cart-form') return;

      const productFormEl = form.closest('product-form');
      if (!productFormEl || productFormEl.dataset.sectionId !== this.sectionId) return;

      if (!this._checkbox.checked) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      if (this._isProcessing) return;
      this._addBothToCart(form);
    }

    _validateFields(root) {
      const fields = [...root.querySelectorAll('[required]')];
      let firstInvalid = null;

      fields.forEach((field) => {
        const invalid = !field.value.trim() || !field.checkValidity();
        field.closest('.field')?.classList.toggle('field__input--error', invalid);
        if (invalid && !firstInvalid) firstInvalid = field;
      });

      if (firstInvalid) {
        firstInvalid.focus();
        return false;
      }
      return true;
    }

    async _addBothToCart(form) {
      const variantInput = form.querySelector('[name="id"]');
      if (!variantInput || variantInput.disabled) return;

      if (!this._validateFields(this)) return;

      const variantId = parseInt(variantInput.value, 10);
      const quantityInput = form.querySelector('[name="quantity"]');
      const quantity = parseInt(quantityInput?.value || 1, 10);

      const giftTo = (this.querySelector('[name="_gift_to"]')?.value || '').trim();
      const giftFrom = (this.querySelector('[name="_gift_from"]')?.value || '').trim();
      const giftMessage = (this.querySelector('[name="_gift_message"]')?.value || '').trim();

      const giftWrapId = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      this._setSubmitLoading(true);
      this._isProcessing = true;

      try {
        const res = await fetch('/cart/add.js', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({
            items: [
              {
                id: variantId,
                quantity,
                properties: {
                  _gift_wrap_id: giftWrapId,
                },
              },
              {
                id: parseInt(this.giftWrapVariantId, 10),
                quantity: 1,
                parent_id: variantId,
                properties: {
                  _is_gift_wrap: 'true',
                  _gift_wrap_id: giftWrapId,
                  _gift_to: giftTo,
                  _gift_from: giftFrom,
                  _gift_message: giftMessage,
                },
              },
            ],
            sections: ['cart-drawer', 'cart-icon-bubble'],
            sections_url: window.location.pathname,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.description || 'Failed to add to cart');
        }

        const parsedState = await res.json();

        const cartDrawer = document.querySelector('cart-drawer');

        // is-empty lives on <cart-drawer> (the outer custom element), not inside
        // #CartDrawer which section rendering updates — remove it directly.
        if (cartDrawer) {
          cartDrawer.classList.remove('is-empty');
        }

        if (parsedState.sections) {
          const cartDrawerInner = document.querySelector('#CartDrawer');
          if (cartDrawerInner && parsedState.sections['cart-drawer']) {
            const doc = new DOMParser().parseFromString(
              parsedState.sections['cart-drawer'],
              'text/html'
            );
            const newInner = doc.querySelector('#CartDrawer');
            if (newInner) cartDrawerInner.innerHTML = newInner.innerHTML;
          }

          const iconBubble = document.getElementById('cart-icon-bubble');
          if (iconBubble && parsedState.sections['cart-icon-bubble']) {
            iconBubble.innerHTML = parsedState.sections['cart-icon-bubble'];
          }
        }

        if (typeof publish !== 'undefined' && typeof PUB_SUB_EVENTS !== 'undefined') {
          const cartData = {
            ...(parsedState.items?.[0] ?? {}),
            sections: parsedState.sections,
          };
          publish(PUB_SUB_EVENTS.cartUpdate, { source: 'gift-wrapping', cartData });
        }

        if (cartDrawer && typeof cartDrawer.open === 'function') {
          cartDrawer.open();
        }

        this._resetForm();
      } catch (err) {
        console.error('[GiftWrapping] Add to cart failed:', err);
        this._showError(err.message);
      } finally {
        this._setSubmitLoading(false);
        this._isProcessing = false;
      }
    }

    _resetForm() {
      this._checkbox.checked = false;
      this._form.hidden = true;
      this._form.setAttribute('aria-hidden', 'true');
      this._checkbox.setAttribute('aria-expanded', 'false');
      this.querySelectorAll('input[type="email"], textarea').forEach((el) => {
        el.value = '';
      });
    }

    _showError(message) {
      const errorWrapper = document.querySelector(
        `#product-form-${this.sectionId} .product-form__error-message-wrapper`
      );
      if (errorWrapper) {
        errorWrapper.hidden = false;
        const msgEl = errorWrapper.querySelector('.product-form__error-message');
        if (msgEl) msgEl.textContent = message;
      }
    }

    _setSubmitLoading(loading) {
      const btn = document.getElementById(`ProductSubmitButton-${this.sectionId}`);
      if (!btn) return;
      if (loading) {
        btn.setAttribute('aria-disabled', 'true');
        btn.querySelector('.loading__spinner')?.classList.remove('hidden');
      } else {
        btn.removeAttribute('aria-disabled');
        btn.querySelector('.loading__spinner')?.classList.add('hidden');
      }
    }
  }

  if (!customElements.get('gift-wrapping-pdp')) {
    customElements.define('gift-wrapping-pdp', GiftWrappingPDP);
  }

  /* ============================================================
     Cart Drawer - Event Delegation Handler
     ============================================================ */

  class CartGiftWrap {
    constructor() {
      document.addEventListener('input', (e) => {
        if (e.target.closest('.cart-gift-wrap__form') && e.target.dataset.charMax) {
          _updateCharCount(e.target);
        }
        if (e.target.closest('.cart-gift-wrap__form') && e.target.value.trim()) {
          e.target.closest('.field')?.classList.remove('field__input--error');
        }
      });

      document.addEventListener('change', (e) => {
        if (e.target.matches('.cart-gift-wrap__checkbox')) {
          this._handleCheckboxChange(e.target);
        }
      });

      document.addEventListener('click', (e) => {
        if (e.target.closest('.cart-gift-wrap__edit-btn')) {
          this._handleEditClick(e.target.closest('.cart-gift-wrap'));
        }
        if (e.target.closest('.cart-gift-wrap__cancel-btn')) {
          this._handleCancelClick(e.target.closest('.cart-gift-wrap'));
        }
        if (e.target.closest('.cart-gift-wrap__update-btn')) {
          this._handleUpdateClick(e.target.closest('.cart-gift-wrap'));
        }
      });
    }

    _handleCheckboxChange(checkbox) {
      if (!checkbox.checked) {
        const container = checkbox.closest('.cart-gift-wrap');
        const line = checkbox.dataset.line;
        this._removeGiftWrap(container, line);
      }
    }

    _handleEditClick(container) {
      if (!container) return;
      container.querySelector('.cart-gift-wrap__inactive').hidden = true;
      container.querySelector('.cart-gift-wrap__form').hidden = false;
    }

    _handleCancelClick(container) {
      if (!container) return;
      container.querySelector('.cart-gift-wrap__inactive').hidden = false;
      container.querySelector('.cart-gift-wrap__form').hidden = true;
    }

    _validateFields(root) {
      const fields = [...root.querySelectorAll('[required]')];
      let firstInvalid = null;

      fields.forEach((field) => {
        const invalid = !field.value.trim() || !field.checkValidity();
        field.closest('.field')?.classList.toggle('field__input--error', invalid);
        if (invalid && !firstInvalid) firstInvalid = field;
      });

      if (firstInvalid) {
        firstInvalid.focus();
        return false;
      }
      return true;
    }

    async _handleUpdateClick(container) {
      if (!container) return;

      const form = container.querySelector('.cart-gift-wrap__form');
      if (form && !this._validateFields(form)) return;

      const line = parseInt(container.dataset.line, 10);

      const giftTo = (container.querySelector('[name="update_gift_to"]')?.value || '').trim();
      const giftFrom = (container.querySelector('[name="update_gift_from"]')?.value || '').trim();
      const giftMessage = (container.querySelector('[name="update_gift_message"]')?.value || '').trim();

      // Preserve _gift_wrap_id so Shopify keeps this line item separate
      // from other line items of the same variant.
      const giftWrapId = container.dataset.giftWrapId || '';

      this._setLoading(container, true);

      try {
        const res = await fetch('/cart/change.js', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({
            line,
            quantity: 1,
            properties: {
              _is_gift_wrap: 'true',
              _gift_wrap_id: giftWrapId,
              _gift_to: giftTo,
              _gift_from: giftFrom,
              _gift_message: giftMessage,
            },
          }),
        });

        if (!res.ok) throw new Error('Update failed');

        this._refreshCartDrawer();
      } catch (err) {
        console.error('[GiftWrapping] Update failed:', err);
        this._setLoading(container, false);
      }
    }

    async _removeGiftWrap(container, line) {
      if (!container || !line) return;
      this._setLoading(container, true);

      try {
        const res = await fetch('/cart/change.js', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({ line: parseInt(line, 10), quantity: 0 }),
        });

        if (!res.ok) throw new Error('Remove failed');

        this._refreshCartDrawer();
      } catch (err) {
        console.error('[GiftWrapping] Remove failed:', err);
        const checkbox = container?.querySelector('.cart-gift-wrap__checkbox');
        if (checkbox) checkbox.checked = true;
        this._setLoading(container, false);
      }
    }

    _refreshCartDrawer() {
      if (typeof publish !== 'undefined' && typeof PUB_SUB_EVENTS !== 'undefined') {
        publish(PUB_SUB_EVENTS.cartUpdate, { source: 'gift-wrapping' });
      } else {
        window.location.reload();
      }
    }

    _setLoading(container, loading) {
      if (!container) return;
      container.classList.toggle('is-loading', loading);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new CartGiftWrap());
  } else {
    new CartGiftWrap();
  }
})();
