import { escapeHtml, formatPrice, getSafeImageUrl, requestJson } from '/browserUtils.js';

const state = {
  product: null,
  paymentMethods: [],
  selectedProviderCode: '',
  selectedAcceptedWalletId: '',
  currentOrder: null,
  countdownTimer: null,
  orderSocket: null,
  watchedOrderId: '',
  orderToken: '',
  orderRefreshQueue: Promise.resolve(),
  checkoutError: '',
  checkoutActionError: '',
};

const checkoutStartCard = document.getElementById('checkoutStartCard');
const checkoutWaitingCard = document.getElementById('checkoutWaitingCard');
const orderSummary = document.getElementById('orderSummary');

const query = new URLSearchParams(window.location.search);
const productId = query.get('productId') ?? '';
const orderId = query.get('orderId') ?? '';

const orderTokenStorageKey = value => `altokepay-example:order:${value}`;

const storeOrderToken = (value, token) => {
  sessionStorage.setItem(orderTokenStorageKey(value), token);
  state.orderToken = token;
};

const readOrderToken = value => sessionStorage.getItem(orderTokenStorageKey(value)) ?? '';

const authorizedOrderRequest = (url, init = {}) =>
  requestJson(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      'X-Order-Token': state.orderToken,
    },
  });

const getProviderMeta = providerCode => {
  const method = state.paymentMethods.find(item => item.providerCode === providerCode);
  return {
    providerCode,
    displayName: method?.displayName ?? state.currentOrder?.providerDisplayName ?? 'Medio de pago',
  };
};

const getSelectedMethod = () =>
  state.paymentMethods.find(method => method.providerCode === state.selectedProviderCode) ?? null;

const getSelectedWallet = () =>
  getSelectedMethod()?.acceptedWallets?.find(wallet => wallet.id === state.selectedAcceptedWalletId) ?? null;

const renderWalletIcon = (wallet, className = 'wallet-icon') => {
  const iconUrl = getSafeImageUrl(wallet?.iconUrl ?? wallet?.icon?.secureUrl);
  if (!iconUrl) {
    return `<span class="${className} wallet-icon-fallback" aria-hidden="true">${escapeHtml(wallet?.name?.charAt(0) ?? '?')}</span>`;
  }

  return `<img class="${className}" src="${escapeHtml(iconUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
};

const renderProviderIcon = method => {
  const iconUrl = getSafeImageUrl(method?.iconUrl);
  if (!iconUrl) {
    return `<span class="payment-method-icon wallet-icon-fallback" aria-hidden="true">${escapeHtml(method?.displayName?.charAt(0) ?? '?')}</span>`;
  }

  return `<img class="payment-method-icon" src="${escapeHtml(iconUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
};

const getProviderInstruction = order => {
  if (order.paymentExpectation?.message) {
    return order.paymentExpectation.message;
  }

  const providerName = getProviderMeta(order.providerCode).displayName;
  const walletName = order.acceptedWallet?.name ?? 'tu billetera';
  return `Realiza el pago desde ${walletName} hacia ${providerName} usando la cuenta de la persona registrada.`;
};

const renderQrDownloadAction = asset => {
  const assetUrl = getSafeImageUrl(asset?.secureUrl);
  if (!assetUrl) {
    return '';
  }

  return `
    <a class="button button-secondary" href="${escapeHtml(assetUrl)}" download target="_blank" rel="noreferrer">
      Descargar QR
    </a>
  `;
};

const renderQrPanel = (order, providerMeta) => {
  const asset = order?.checkoutAsset ?? null;
  const assetUrl = getSafeImageUrl(asset?.secureUrl);
  const walletName = order.acceptedWallet?.name ?? 'tu billetera';

  if (!assetUrl) {
    return `
      <div class="checkout-qr-card missing">
        <div class="checkout-alert warning" role="alert">
          <strong>No pudimos mostrar el código QR</strong>
          <p>Este medio de pago no está disponible en este momento.</p>
        </div>
      </div>
    `;
  }

  return `
    <div class="checkout-qr-card">
      <div class="checkout-qr-frame">
        <img class="checkout-qr-image" src="${escapeHtml(assetUrl)}" alt="QR receptor de ${escapeHtml(providerMeta.displayName)}" referrerpolicy="no-referrer" />
      </div>
      <div class="checkout-qr-copy">
        <strong>Escanea el QR con ${escapeHtml(walletName)}</strong>
        <p>Verifica que el destinatario sea ${escapeHtml(providerMeta.displayName)} antes de pagar.</p>
      </div>
      <div class="checkout-qr-actions">${renderQrDownloadAction(asset)}</div>
    </div>
  `;
};

const getOrderStatusMeta = order => {
  if (!order) {
    return { label: 'Por iniciar', tone: 'neutral' };
  }
  if (order.paymentStatus === 'paid') {
    return { label: 'Pagado', tone: 'success' };
  }
  if (order.paymentStatus === 'expired' || order.checkoutStatus === 'expired') {
    return { label: 'Vencido', tone: 'expired' };
  }
  if (order.paymentStatus === 'canceled' || order.checkoutStatus === 'canceled') {
    return { label: 'Cancelado', tone: 'neutral' };
  }
  return { label: 'Pendiente', tone: 'pending' };
};

const clearCountdownTimer = () => {
  if (state.countdownTimer) {
    window.clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
};

const stopOrderUpdates = () => {
  state.orderSocket?.disconnect();
  state.orderSocket = null;
  state.watchedOrderId = '';
};

const redirectToSuccess = order => {
  clearCountdownTimer();
  stopOrderUpdates();
  window.location.assign(`/success.html?orderId=${encodeURIComponent(order.id)}`);
};

const readLocalOrderStatus = async requestedOrderId => {
  const payload = await authorizedOrderRequest(`/api/orders/${encodeURIComponent(requestedOrderId)}`);
  if (state.currentOrder?.id !== requestedOrderId) {
    return;
  }

  const previousPaymentStatus = state.currentOrder.paymentStatus;
  const previousCheckoutStatus = state.currentOrder.checkoutStatus;
  state.currentOrder = payload.order;

  if (state.currentOrder.paymentStatus === 'paid') {
    redirectToSuccess(state.currentOrder);
    return;
  }

  if (
    state.currentOrder.paymentStatus !== previousPaymentStatus ||
    state.currentOrder.checkoutStatus !== previousCheckoutStatus
  ) {
    render();
  }
};

const queueLocalOrderRefresh = requestedOrderId => {
  state.orderRefreshQueue = state.orderRefreshQueue
    .then(() => readLocalOrderStatus(requestedOrderId))
    .catch(() => undefined);
};

const refreshOrderStatus = () => {
  if (state.currentOrder?.id) {
    queueLocalOrderRefresh(state.currentOrder.id);
  }
};

const watchCurrentOrder = () => {
  if (state.currentOrder?.paymentStatus !== 'awaiting_payment') {
    stopOrderUpdates();
    return;
  }

  if (!state.orderSocket) {
    state.orderSocket = window.io({ transports: ['websocket'] });
    state.orderSocket.on('connect', () => {
      if (state.currentOrder?.paymentStatus !== 'awaiting_payment') {
        return;
      }
      state.watchedOrderId = state.currentOrder.id;
      state.orderSocket.emit('order.watch', { orderId: state.watchedOrderId, token: state.orderToken });
      queueLocalOrderRefresh(state.watchedOrderId);
    });
    state.orderSocket.on('order.updated', update => {
      if (update?.orderId === state.currentOrder?.id) {
        queueLocalOrderRefresh(update.orderId);
      }
    });
  }

  if (state.orderSocket.connected && state.watchedOrderId !== state.currentOrder.id) {
    state.watchedOrderId = state.currentOrder.id;
    state.orderSocket.emit('order.watch', { orderId: state.watchedOrderId, token: state.orderToken });
  }
};

const getCheckoutRemainingMs = order => {
  const expiresAt = order?.checkoutExpiresAt ? new Date(order.checkoutExpiresAt).getTime() : 0;
  return expiresAt ? Math.max(0, expiresAt - Date.now()) : 0;
};

const getCheckoutWindowMs = order => {
  const expiresAt = new Date(order?.checkoutExpiresAt ?? 0).getTime();
  const createdAt = new Date(order?.createdAt ?? 0).getTime();
  return Math.max(1, expiresAt - createdAt);
};

const formatRemainingTime = remainingMs => {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const syncExpiredOrderState = () => {
  if (!state.currentOrder || state.currentOrder.paymentStatus !== 'expired') {
    return;
  }

  state.currentOrder = {
    ...state.currentOrder,
    checkoutStatus: 'expired',
  };
};

const mountCountdown = () => {
  clearCountdownTimer();

  if (state.currentOrder?.paymentStatus !== 'awaiting_payment' || !state.currentOrder.checkoutExpiresAt) {
    return;
  }

  const countdownNode = checkoutWaitingCard.querySelector('[data-countdown]');
  const progressNode = /** @type {HTMLElement | null} */ (
    checkoutWaitingCard.querySelector('[data-countdown-progress]')
  );
  if (!countdownNode) {
    return;
  }

  const fullWindowMs = getCheckoutWindowMs(state.currentOrder);
  const renderCountdown = () => {
    const remainingMs = getCheckoutRemainingMs(state.currentOrder);
    countdownNode.textContent = formatRemainingTime(remainingMs);
    if (progressNode) {
      progressNode.style.width = `${Math.max(0, Math.min(100, (remainingMs / fullWindowMs) * 100))}%`;
    }
    if (remainingMs === 0) {
      clearCountdownTimer();
    }
  };

  renderCountdown();
  state.countdownTimer = window.setInterval(renderCountdown, 1000);
};

const renderSummary = () => {
  if (!state.product) {
    orderSummary.replaceChildren();
    return;
  }

  const orderStatus = getOrderStatusMeta(state.currentOrder);
  const currentProvider = state.currentOrder?.providerCode ?? state.selectedProviderCode;
  const providerMeta = currentProvider ? getProviderMeta(currentProvider) : null;
  const wallet = state.currentOrder?.acceptedWallet ?? getSelectedWallet();
  const productImageUrl = getSafeImageUrl(state.product.imageUrl);

  orderSummary.innerHTML = `
    <div class="summary-block">
      ${productImageUrl ? `<img class="summary-product-image" src="${escapeHtml(productImageUrl)}" alt="${escapeHtml(state.product.name)}" />` : ''}
      <div class="summary-copy">
        <h2>${escapeHtml(state.product.name)}</h2>
        <p>${escapeHtml(state.product.description)}</p>
      </div>
    </div>
    <div class="summary-lines">
      <div><span>Estado</span><strong><span class="order-status-pill ${orderStatus.tone}">${orderStatus.label}</span></strong></div>
      <div><span>Modalidad</span><strong>Checkout directo</strong></div>
      <div><span>Destino</span><strong>${providerMeta ? escapeHtml(providerMeta.displayName) : 'Por elegir'}</strong></div>
      <div><span>Tu billetera</span><strong>${wallet ? escapeHtml(wallet.name) : 'Por elegir'}</strong></div>
      <div><span>Subtotal</span><strong>${formatPrice(state.product.amount, state.product.currency)}</strong></div>
      <div><span>Envío</span><strong>Gratis</strong></div>
      <div class="summary-total"><span>Total</span><strong>${formatPrice(state.product.amount, state.product.currency)}</strong></div>
    </div>
  `;
};

const renderStartCard = () => {
  const selectedMethod = getSelectedMethod();
  const acceptedWallets = Array.isArray(selectedMethod?.acceptedWallets) ? selectedMethod.acceptedWallets : [];
  const canContinue = Boolean(state.selectedProviderCode && state.selectedAcceptedWalletId);
  const providerButtons = state.paymentMethods
    .map(method => {
      const selected = state.selectedProviderCode === method.providerCode;
      return `
        <button class="payment-choice ${selected ? 'active' : ''}" type="button" data-provider="${escapeHtml(method.providerCode)}" aria-pressed="${selected}">
          ${renderProviderIcon(method)}
          <span>${escapeHtml(method.displayName)}</span>
          <small>Disponible</small>
        </button>
      `;
    })
    .join('');
  const walletButtons = acceptedWallets
    .map(wallet => {
      const selected = state.selectedAcceptedWalletId === wallet.id;
      return `
        <button class="wallet-choice ${selected ? 'active' : ''}" type="button" data-wallet-id="${escapeHtml(wallet.id)}" aria-pressed="${selected}">
          ${renderWalletIcon(wallet)}
          <span class="wallet-choice-copy"><strong>${escapeHtml(wallet.name)}</strong><small>${escapeHtml(wallet.code)}</small></span>
          <span class="wallet-choice-check" aria-hidden="true">✓</span>
        </button>
      `;
    })
    .join('');

  checkoutStartCard.classList.remove('hidden');
  checkoutWaitingCard.classList.add('hidden');
  checkoutStartCard.innerHTML = `
    <div class="checkout-card-head checkout-hero-head">
      <div>
        <h1>Elige cómo pagar</h1>
        <p class="hero-copy">Selecciona el destino y la billetera desde la que realizarás el pago.</p>
      </div>
    </div>
    <form id="startCheckoutForm" class="checkout-form">
        <div class="field-stack">
          <span class="section-label">Elige dónde pagar</span>
          <div class="payment-choice-grid">${providerButtons}</div>
        </div>
        ${
          selectedMethod
            ? `
          <div class="field-stack wallet-selection" aria-live="polite">
            <span class="section-label">Elige tu billetera</span>
            ${
              acceptedWallets.length > 0
                ? `<div class="wallet-choice-grid">${walletButtons}</div>`
                : '<p class="form-note">Esta opción no está disponible en este momento.</p>'
            }
          </div>
        `
            : ''
        }
        ${state.checkoutError ? `<div class="checkout-alert warning" role="alert"><strong>No pudimos iniciar el pago</strong><p>${escapeHtml(state.checkoutError)}</p></div>` : ''}
        <button class="button button-primary button-large" type="submit" ${canContinue ? '' : 'disabled'}>Continuar con el pago</button>
        ${
          state.paymentMethods.length === 0
            ? '<p class="form-note">En este momento no hay métodos disponibles.</p>'
            : !state.selectedProviderCode
              ? '<p class="form-note">Selecciona dónde deseas pagar.</p>'
              : !state.selectedAcceptedWalletId
                ? '<p class="form-note">Selecciona la billetera desde la que pagarás.</p>'
                : ''
        }
    </form>
  `;

  checkoutStartCard.querySelectorAll('.payment-choice').forEach(button => {
    const element = /** @type {HTMLElement} */ (button);
    element.addEventListener('click', () => {
      const nextProviderCode = element.dataset.provider ?? '';
      if (nextProviderCode !== state.selectedProviderCode) {
        state.selectedAcceptedWalletId = '';
      }
      state.selectedProviderCode = nextProviderCode;
      state.checkoutError = '';
      render();
    });
  });

  checkoutStartCard.querySelectorAll('.wallet-choice').forEach(button => {
    const element = /** @type {HTMLElement} */ (button);
    element.addEventListener('click', () => {
      state.selectedAcceptedWalletId = element.dataset.walletId ?? '';
      state.checkoutError = '';
      render();
    });
  });

  checkoutStartCard.querySelector('#startCheckoutForm')?.addEventListener('submit', startCheckout);
};

const renderExpiredActions = () => `
  <div class="checkout-actions centered">
    <button id="retryCheckoutButton" class="button button-primary" type="button">Intentar pagar de nuevo</button>
    <button id="cancelPurchaseButton" class="button button-secondary" type="button">Cancelar compra</button>
  </div>
`;

const renderWaitingCard = () => {
  if (!state.currentOrder) {
    stopOrderUpdates();
    clearCountdownTimer();
    checkoutWaitingCard.classList.add('hidden');
    checkoutStartCard.classList.remove('hidden');
    return;
  }

  syncExpiredOrderState();
  const providerMeta = getProviderMeta(state.currentOrder.providerCode);

  if (state.currentOrder.paymentStatus === 'expired' || state.currentOrder.paymentStatus === 'canceled') {
    clearCountdownTimer();
    checkoutStartCard.classList.add('hidden');
    checkoutWaitingCard.classList.remove('hidden');
    checkoutWaitingCard.innerHTML = `
      <div class="waiting-card expired-state">
        <div class="waiting-visual expired"><div class="expired-mark">!</div></div>
        <div class="waiting-copy compact-copy">
          <h1>${state.currentOrder.paymentStatus === 'canceled' ? 'El pago fue cancelado' : 'Se acabó el tiempo para pagar'}</h1>
          <p>${state.currentOrder.paymentStatus === 'canceled' ? 'Puedes iniciar un nuevo pago cuando quieras.' : 'Inténtalo nuevamente para completar tu compra.'}</p>
        </div>
        ${renderExpiredActions()}
      </div>
    `;
    checkoutWaitingCard.querySelector('#retryCheckoutButton')?.addEventListener('click', retryCheckoutOrder);
    checkoutWaitingCard.querySelector('#cancelPurchaseButton')?.addEventListener('click', cancelPurchase);
    return;
  }

  const providerInstruction = getProviderInstruction(state.currentOrder);
  const wallet = state.currentOrder.acceptedWallet;
  const walletName = wallet?.name ?? 'tu billetera';

  checkoutStartCard.classList.add('hidden');
  checkoutWaitingCard.classList.remove('hidden');
  checkoutWaitingCard.innerHTML = `
    <div class="waiting-card hosted-waiting-card">
      <div class="waiting-visual provider-neutral"><div class="spinner large"></div></div>
      <div class="waiting-copy compact-copy">
        <div class="payment-route" aria-label="Ruta del pago">
          <span class="wallet-route-item">${renderWalletIcon(wallet, 'wallet-icon compact')}<strong>${escapeHtml(walletName)}</strong></span>
          <span class="payment-route-arrow" aria-hidden="true">→</span>
          <span class="status-line">${escapeHtml(providerMeta.displayName)}</span>
        </div>
        <h1>Paga con ${escapeHtml(walletName)}</h1>
        <p>${escapeHtml(providerInstruction)}</p>
      </div>
      <div class="checkout-timer-card">
        <div class="checkout-timer-head">
          <span>Tiempo restante</span>
          <strong data-countdown>${formatRemainingTime(getCheckoutRemainingMs(state.currentOrder))}</strong>
        </div>
        <div class="countdown-progress-track"><span data-countdown-progress></span></div>
        <p class="countdown-label">Completa el pago antes de que termine el tiempo.</p>
      </div>
      ${renderQrPanel(state.currentOrder, providerMeta)}
      <div class="hosted-facts-grid">
        <div><span>Pedido</span><strong>${escapeHtml(state.currentOrder.externalId)}</strong></div>
        <div><span>Destino</span><strong>${escapeHtml(providerMeta.displayName)}</strong></div>
        <div><span>Billetera</span><strong>${escapeHtml(walletName)}</strong></div>
        <div><span>Total</span><strong>${formatPrice(state.currentOrder.product.amount, state.currentOrder.product.currency)}</strong></div>
      </div>
      ${
        state.checkoutActionError
          ? `
        <div class="checkout-alert warning" role="alert">
          <strong>No pudimos revisar tu pago</strong>
          <p>${escapeHtml(state.checkoutActionError)}</p>
        </div>
      `
          : ''
      }
      <div class="checkout-actions centered">
        <button id="refreshWebhookState" class="button button-primary" type="button">Revisar estado</button>
        <button id="cancelPurchaseButton" class="button button-secondary" type="button">Cancelar compra</button>
      </div>
    </div>
  `;

  checkoutWaitingCard.querySelector('#refreshWebhookState')?.addEventListener('click', refreshOrderStatus);
  checkoutWaitingCard.querySelector('#cancelPurchaseButton')?.addEventListener('click', cancelPurchase);
  mountCountdown();
  watchCurrentOrder();
};

const render = () => {
  renderSummary();
  if (state.currentOrder) {
    renderWaitingCard();
    return;
  }
  clearCountdownTimer();
  renderStartCard();
};

const startCheckout = async event => {
  event.preventDefault();
  if (!state.selectedProviderCode || !state.selectedAcceptedWalletId) {
    render();
    return;
  }

  state.checkoutError = '';
  try {
    const payload = await requestJson('/api/orders/start-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: state.product.id,
        providerCode: state.selectedProviderCode,
        acceptedWalletId: state.selectedAcceptedWalletId,
      }),
    });

    state.currentOrder = payload.order;
    storeOrderToken(state.currentOrder.id, payload.orderToken);
    window.history.replaceState(
      {},
      '',
      `/checkout.html?productId=${encodeURIComponent(state.product.id)}&orderId=${encodeURIComponent(state.currentOrder.id)}`,
    );
    if (state.currentOrder.paymentStatus === 'paid') {
      redirectToSuccess(state.currentOrder);
      return;
    }
    render();
  } catch (error) {
    state.checkoutError = error instanceof Error ? error.message : 'No se pudo iniciar el pago. Inténtalo nuevamente.';
    render();
  }
};

const retryCheckoutOrder = async () => {
  if (!state.currentOrder) {
    return;
  }

  state.checkoutActionError = '';
  try {
    const payload = await authorizedOrderRequest(
      `/api/orders/${encodeURIComponent(state.currentOrder.id)}/retry-checkout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
    );

    state.currentOrder = payload.order;
    storeOrderToken(state.currentOrder.id, payload.orderToken);
    window.history.replaceState(
      {},
      '',
      `/checkout.html?productId=${encodeURIComponent(state.product.id)}&orderId=${encodeURIComponent(state.currentOrder.id)}`,
    );
    render();
  } catch (error) {
    state.checkoutActionError = error instanceof Error ? error.message : 'No se pudo crear otro intento';
    render();
  }
};

const cancelPurchase = async () => {
  if (!state.currentOrder) {
    window.location.href = '/';
    return;
  }

  state.checkoutActionError = '';
  try {
    const payload = await authorizedOrderRequest(
      `/api/orders/${encodeURIComponent(state.currentOrder.id)}/cancel-checkout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
    );

    state.currentOrder = payload.order;
    clearCountdownTimer();
    stopOrderUpdates();
    window.location.href = '/';
  } catch (error) {
    state.checkoutActionError = error instanceof Error ? error.message : 'No se pudo cancelar el checkout';
    render();
  }
};

const boot = async () => {
  const [{ products }, { payer }] = await Promise.all([
    requestJson('/api/products'),
    requestJson('/api/session/payer'),
  ]);
  if (!payer) {
    window.location.href = '/?flow=checkout';
    return;
  }
  state.product = products.find(product => product.id === productId) ?? null;
  if (!state.product) {
    window.location.href = '/';
    return;
  }

  if (orderId) {
    state.orderToken = readOrderToken(orderId);
    if (!state.orderToken) {
      window.location.href = '/';
      return;
    }
    const payload = await authorizedOrderRequest(`/api/orders/${encodeURIComponent(orderId)}`);
    state.currentOrder = payload.order;
    if (state.currentOrder.paymentStatus === 'paid') {
      redirectToSuccess(state.currentOrder);
      return;
    }
    syncExpiredOrderState();
  }

  const methodsPayload = await requestJson(
    `/api/payment-methods?currency=${encodeURIComponent(state.product.currency)}`,
  );
  state.paymentMethods = methodsPayload.methods;
  render();
};

boot().catch(error => {
  console.error(error);
  alert(error.message);
});
