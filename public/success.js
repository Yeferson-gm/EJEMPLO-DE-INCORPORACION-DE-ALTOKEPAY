import { escapeHtml, formatPrice, getSafeImageUrl, requestJson } from '/browserUtils.js';

const successCard = document.getElementById('successCard');

const query = new URLSearchParams(window.location.search);
const orderId = query.get('orderId') ?? '';
const orderToken = sessionStorage.getItem(`altokepay-example:order:${orderId}`) ?? '';

const formatDate = value =>
  new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

const renderWalletIcon = wallet => {
  const iconUrl = getSafeImageUrl(wallet?.iconUrl ?? wallet?.icon?.secureUrl);
  if (!iconUrl) {
    return `<span class="wallet-icon compact wallet-icon-fallback" aria-hidden="true">${escapeHtml(wallet?.name?.charAt(0) ?? '?')}</span>`;
  }

  return `<img class="wallet-icon compact" src="${escapeHtml(iconUrl)}" alt="" referrerpolicy="no-referrer" />`;
};

const getSuccessStatusMeta = order => {
  if (order.paymentStatus === 'paid') {
    return { label: 'Pagado', tone: 'success' };
  }

  if (order.paymentStatus === 'expired' || order.checkoutStatus === 'expired') {
    return { label: 'Vencido', tone: 'expired' };
  }

  return { label: 'Pendiente', tone: 'pending' };
};

const render = order => {
  const status = getSuccessStatusMeta(order);
  const providerLabel = order.providerDisplayName ?? 'Método receptor';
  const wallet = order.acceptedWallet;
  const walletName = wallet?.name ?? 'Billetera no disponible';
  const productImageUrl = getSafeImageUrl(order.product.imageUrl);

  successCard.innerHTML = `
    <div class="success-hero-head">
      <div class="success-icon">✓</div>
      <div class="payment-route success-payment-route" aria-label="Ruta confirmada del pago">
        <span class="wallet-route-item">${renderWalletIcon(wallet)}<strong>${escapeHtml(walletName)}</strong></span>
        <span class="payment-route-arrow" aria-hidden="true">→</span>
        <span class="status-line">${escapeHtml(providerLabel)}</span>
      </div>
    </div>
    <h1>Pago confirmado</h1>
    <p class="success-lead">${escapeHtml(walletName)} → ${escapeHtml(providerLabel)}</p>
    <div class="success-product-card">
      ${productImageUrl ? `<img class="success-product-image" src="${escapeHtml(productImageUrl)}" alt="${escapeHtml(order.product.name)}" />` : ''}
      <div class="success-product-copy">
        <strong>${escapeHtml(order.product.name)}</strong>
        <span>${escapeHtml(order.product.description)}</span>
      </div>
    </div>
    <div class="success-summary">
      <div><span>Estado</span><strong><span class="order-status-pill ${status.tone}">${status.label}</span></strong></div>
      <div><span>Pedido</span><strong>${escapeHtml(order.externalId)}</strong></div>
      <div><span>Receptor</span><strong>${escapeHtml(providerLabel)}</strong></div>
      <div><span>Billetera usada</span><strong>${escapeHtml(walletName)}</strong></div>
      <div><span>Total</span><strong>${formatPrice(order.product.amount, order.product.currency)}</strong></div>
      <div><span>Fecha</span><strong>${formatDate(order.updatedAt)}</strong></div>
    </div>

    <div class="success-actions">
      <a class="button button-primary" href="/">Volver a la tienda</a>
      <a class="button button-secondary" href="/checkout.html?productId=${encodeURIComponent(order.product.id)}">Comprar de nuevo</a>
    </div>
  `;
};

const boot = async () => {
  if (!orderId || !orderToken) {
    window.location.href = '/';
    return;
  }

  const payload = await requestJson(`/api/orders/${encodeURIComponent(orderId)}`, {
    headers: { 'X-Order-Token': orderToken },
  });
  if (payload.order.paymentStatus !== 'paid') {
    window.location.href = `/checkout.html?productId=${encodeURIComponent(payload.order.product.id)}&orderId=${encodeURIComponent(payload.order.id)}`;
    return;
  }

  render(payload.order);
};

boot().catch(error => {
  console.error(error);
  alert(error.message);
});
