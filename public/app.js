import { formatPrice, getSafeImageUrl, requestJson } from '/browserUtils.js';

const checkoutContent = {
  label: 'Checkout · Cliente',
  eyebrow: 'Experiencia del comprador',
  title: 'Compra como cliente con Checkout',
  description: 'Elige un producto y continúa al selector de receptor y billetera para realizar el pago.',
  action: 'Comprar con Checkout',
};

const state = {
  products: [],
  payer: null,
};

const experienceChooser = document.getElementById('experienceChooser');
const storeView = document.getElementById('storeView');
const productsContainer = document.getElementById('products');
const productCardTemplate = /** @type {HTMLTemplateElement | null} */ (document.getElementById('productCardTemplate'));
const productCount = document.getElementById('productCount');
const storeModeBadge = document.getElementById('storeModeBadge');
const changeExperience = document.getElementById('changeExperience');
const storeFlowEyebrow = document.getElementById('storeFlowEyebrow');
const storeFlowTitle = document.getElementById('storeFlowTitle');
const storeFlowDescription = document.getElementById('storeFlowDescription');
const storeError = document.getElementById('storeError');
const payerDialog = /** @type {HTMLDialogElement | null} */ (document.getElementById('payerDialog'));
const payerForm = /** @type {HTMLFormElement | null} */ (document.getElementById('payerForm'));
const payerDialogDescription = document.getElementById('payerDialogDescription');
const payerFormError = document.getElementById('payerFormError');
const payerSubmit = /** @type {HTMLButtonElement | null} */ (document.getElementById('payerSubmit'));

const setStoreError = message => {
  if (!storeError) return;
  storeError.textContent = message ? `No pudimos continuar. ${message}` : '';
  storeError.classList.toggle('hidden', !message);
};

const showChooser = () => {
  experienceChooser?.classList.remove('hidden');
  storeView?.classList.add('hidden');
  storeModeBadge?.classList.add('hidden');
  changeExperience?.classList.add('hidden');
  window.history.replaceState({}, '', '/');
};

const startPayerDialog = () => {
  if (!payerDialog) return;
  payerDialogDescription.textContent =
    'Ingresa el DNI con el que realizarás la compra. AltokePay resolverá el nombre desde su proveedor de identidad.';
  payerFormError.textContent = '';
  payerFormError.classList.add('hidden');
  payerDialog.showModal();
  requestAnimationFrame(() => document.getElementById('payerDni')?.focus());
};

const renderProducts = () => {
  if (!productsContainer || !productCardTemplate || !productCount) return;
  productsContainer.innerHTML = '';
  productCount.textContent = `${state.products.length} ${state.products.length === 1 ? 'producto' : 'productos'}`;

  for (const product of state.products) {
    const fragment = /** @type {DocumentFragment} */ (productCardTemplate.content.cloneNode(true));
    const name = fragment.querySelector('.product-name');
    const description = fragment.querySelector('.product-description');
    const label = fragment.querySelector('.product-image-label');
    const price = fragment.querySelector('.price');
    if (name) name.textContent = product.name;
    if (description) description.textContent = product.description;
    if (label) label.textContent = product.imageLabel ?? 'Producto';
    if (price) price.textContent = formatPrice(product.amount, product.currency);

    const productImage = /** @type {HTMLImageElement | null} */ (fragment.querySelector('.product-image'));
    const productImageUrl = getSafeImageUrl(product.imageUrl);
    if (productImageUrl && productImage) {
      productImage.src = productImageUrl;
      productImage.alt = product.name;
    } else {
      productImage?.remove();
    }

    const selectButton = /** @type {HTMLButtonElement | null} */ (fragment.querySelector('.select-product'));
    if (selectButton) {
      selectButton.textContent = checkoutContent.action;
      selectButton.addEventListener('click', () => {
        window.location.href = `/checkout.html?productId=${encodeURIComponent(product.id)}`;
      });
    }
    productsContainer.appendChild(fragment);
  }
};

const showCheckoutStore = () => {
  setStoreError('');
  experienceChooser?.classList.add('hidden');
  storeView?.classList.remove('hidden');
  if (storeFlowEyebrow) storeFlowEyebrow.textContent = checkoutContent.eyebrow;
  if (storeFlowTitle) storeFlowTitle.textContent = checkoutContent.title;
  if (storeFlowDescription) storeFlowDescription.textContent = checkoutContent.description;
  if (storeModeBadge) {
    storeModeBadge.textContent = checkoutContent.label;
    storeModeBadge.classList.remove('hidden');
  }
  changeExperience?.classList.remove('hidden');
  window.history.replaceState({}, '', '/?flow=checkout');
  renderProducts();
};

const submitPayer = async event => {
  event.preventDefault();
  if (!payerForm || !payerSubmit || !payerFormError || !payerForm.reportValidity()) return;

  payerSubmit.disabled = true;
  payerSubmit.textContent = 'Preparando sesión…';
  payerFormError.textContent = '';
  payerFormError.classList.add('hidden');
  const formData = new FormData(payerForm);

  try {
    const payload = await requestJson('/api/session/payer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dni: String(formData.get('dni') ?? '') }),
    });
    state.payer = payload.payer;
    payerDialog?.close();
    payerForm.reset();
    showCheckoutStore();
  } catch (error) {
    payerFormError.textContent =
      error instanceof Error ? error.message : 'No pudimos guardar el DNI. Revísalo e inténtalo nuevamente.';
    payerFormError.classList.remove('hidden');
    payerFormError.focus();
  } finally {
    payerSubmit.disabled = false;
    payerSubmit.textContent = 'Continuar';
  }
};

const boot = async () => {
  const flow = new URLSearchParams(window.location.search).get('flow');
  if (flow === 'payment_link') {
    window.location.replace('/payment-links.html');
    return;
  }

  const [productsPayload, payerPayload] = await Promise.all([
    requestJson('/api/products'),
    requestJson('/api/session/payer'),
  ]);
  state.products = productsPayload.products;
  state.payer = payerPayload.payer;

  if (flow === 'checkout' && state.payer) {
    showCheckoutStore();
    return;
  }
  showChooser();
  if (flow === 'checkout') startPayerDialog();
};

document.querySelectorAll('[data-flow]').forEach(button => {
  button.addEventListener('click', () => {
    const mode = /** @type {HTMLElement} */ (button).dataset.flow;
    if (mode === 'checkout') startPayerDialog();
    if (mode === 'payment_link') window.location.href = '/payment-links.html';
  });
});

document.querySelectorAll('[data-close-dialog]').forEach(button => {
  button.addEventListener('click', () => payerDialog?.close());
});

payerDialog?.addEventListener('close', () => {
  payerFormError.textContent = '';
  payerFormError.classList.add('hidden');
});

payerForm?.addEventListener('submit', submitPayer);
changeExperience?.addEventListener('click', showChooser);

boot().catch(error => {
  console.error(error);
  showChooser();
  setStoreError(error instanceof Error ? error.message : 'No pudimos cargar la demostración.');
});
