import { formatPrice, requestJson } from '/browserUtils.js';

const statusContent = {
  awaiting_payment: { label: 'Esperando pago', className: 'awaiting' },
  paid: { label: 'Pagado', className: 'paid' },
  expired: { label: 'Vencido', className: 'expired' },
  canceled: { label: 'Cancelado', className: 'canceled' },
};

const state = { paymentLinks: [] };
let createIntentId = '';
const createLinkDialog = /** @type {HTMLDialogElement | null} */ (document.getElementById('createLinkDialog'));
const createLinkForm = /** @type {HTMLFormElement | null} */ (document.getElementById('createLinkForm'));
const createLinkFields = document.getElementById('createLinkFields');
const createLinkSuccess = document.getElementById('createLinkSuccess');
const createLinkError = document.getElementById('createLinkError');
const createLinkSubmit = /** @type {HTMLButtonElement | null} */ (document.getElementById('createLinkSubmit'));
const payerDniField = document.getElementById('payerDniField');
const payerNameField = document.getElementById('payerNameField');
const payerDniInput = /** @type {HTMLInputElement | null} */ (document.getElementById('linkPayerDni'));
const payerNameInput = /** @type {HTMLInputElement | null} */ (document.getElementById('linkPayerName'));
const paymentLinksError = document.getElementById('paymentLinksError');
const paymentLinksLoading = document.getElementById('paymentLinksLoading');
const paymentLinksEmpty = document.getElementById('paymentLinksEmpty');
const paymentLinksTableWrap = document.getElementById('paymentLinksTableWrap');
const paymentLinksBody = document.getElementById('paymentLinksBody');
const inventoryCount = document.getElementById('inventoryCount');
const createdPublicUrl = /** @type {HTMLAnchorElement | null} */ (document.getElementById('createdPublicUrl'));
const openPublicUrl = /** @type {HTMLAnchorElement | null} */ (document.getElementById('openPublicUrl'));
const copyPublicUrl = /** @type {HTMLButtonElement | null} */ (document.getElementById('copyPublicUrl'));

const formatDate = value => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const setPageError = message => {
  if (!paymentLinksError) return;
  paymentLinksError.textContent = message;
  paymentLinksError.classList.toggle('hidden', !message);
  if (message) paymentLinksError.focus();
};

const updateMetrics = () => {
  const counts = { awaiting_payment: 0, paid: 0, expired: 0, canceled: 0 };
  for (const link of state.paymentLinks) {
    if (Object.hasOwn(counts, link.status)) counts[link.status] += 1;
  }
  const values = {
    metricAwaiting: counts.awaiting_payment,
    metricPaid: counts.paid,
    metricExpired: counts.expired,
    metricCanceled: counts.canceled,
  };
  for (const [id, value] of Object.entries(values)) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  }
};

const replacePaymentLink = paymentLink => {
  const index = state.paymentLinks.findIndex(current => current.id === paymentLink.id);
  if (index === -1) state.paymentLinks.unshift(paymentLink);
  else state.paymentLinks.splice(index, 1, paymentLink);
};

const createCell = (label, text, className = '') => {
  const cell = document.createElement('td');
  cell.dataset.label = label;
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
};

const runRowAction = async (button, paymentLink, action) => {
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = action === 'refresh' ? 'Revisando…' : 'Cancelando…';
  setPageError('');
  try {
    const payload = await requestJson(`/api/payment-links/${encodeURIComponent(paymentLink.id)}/${action}`, {
      method: 'POST',
    });
    replacePaymentLink(payload.paymentLink);
    renderInventory();
  } catch (error) {
    setPageError(error instanceof Error ? error.message : 'No pudimos actualizar el Link de pago.');
    button.disabled = false;
    button.textContent = originalLabel;
  }
};

const recoverPublicUrl = async (button, paymentLink) => {
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Recuperando…';
  setPageError('');
  try {
    const payload = await requestJson(`/api/payment-links/${encodeURIComponent(paymentLink.id)}/recover-public-url`, {
      method: 'POST',
    });
    if (!createLinkDialog?.open) createLinkDialog?.showModal();
    showCreatedLink(payload.publicUrl);
  } catch (error) {
    setPageError(error instanceof Error ? error.message : 'No pudimos recuperar la URL pública.');
    button.disabled = false;
    button.textContent = originalLabel;
  }
};

const createActions = paymentLink => {
  const cell = document.createElement('td');
  cell.dataset.label = 'Acciones';
  cell.className = 'link-actions-cell';
  const actions = document.createElement('div');
  actions.className = 'link-row-actions';

  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'button ghost';
  refresh.textContent = 'Revisar estado';
  refresh.addEventListener('click', () => runRowAction(refresh, paymentLink, 'refresh'));
  actions.appendChild(refresh);

  const recoverUrl = document.createElement('button');
  recoverUrl.type = 'button';
  recoverUrl.className = 'button ghost';
  recoverUrl.textContent = 'Recuperar URL';
  recoverUrl.addEventListener('click', () => recoverPublicUrl(recoverUrl, paymentLink));
  actions.appendChild(recoverUrl);

  if (paymentLink.status === 'awaiting_payment') {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button danger-button';
    cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', () => runRowAction(cancel, paymentLink, 'cancel'));
    actions.appendChild(cancel);
  }

  cell.appendChild(actions);
  return cell;
};

const renderInventory = () => {
  updateMetrics();
  const count = state.paymentLinks.length;
  if (inventoryCount) inventoryCount.textContent = `${count} ${count === 1 ? 'registro' : 'registros'}`;
  paymentLinksLoading?.classList.add('hidden');
  paymentLinksEmpty?.classList.toggle('hidden', count > 0);
  paymentLinksTableWrap?.classList.toggle('hidden', count === 0);
  if (!paymentLinksBody) return;
  paymentLinksBody.innerHTML = '';

  for (const paymentLink of state.paymentLinks) {
    const row = document.createElement('tr');
    const descriptionCell = document.createElement('td');
    descriptionCell.dataset.label = 'Cobro';
    const description = document.createElement('div');
    description.className = 'link-description-cell';
    const message = document.createElement('strong');
    message.textContent = paymentLink.message;
    const reference = document.createElement('code');
    reference.textContent = paymentLink.externalId;
    description.append(message, reference);
    descriptionCell.appendChild(description);
    row.appendChild(descriptionCell);
    row.appendChild(createCell('Monto', formatPrice(paymentLink.amount, paymentLink.currency), 'link-amount-cell'));

    const statusCell = document.createElement('td');
    statusCell.dataset.label = 'Estado';
    const status = statusContent[paymentLink.status] ?? { label: paymentLink.status, className: 'canceled' };
    const statusBadge = document.createElement('span');
    statusBadge.className = `link-status ${status.className}`;
    statusBadge.textContent = status.label;
    statusCell.appendChild(statusBadge);
    row.appendChild(statusCell);
    row.appendChild(createCell('Vencimiento', formatDate(paymentLink.expiresAt), 'link-date-cell'));
    row.appendChild(createActions(paymentLink));
    paymentLinksBody.appendChild(row);
  }
};

const setIdentityMode = mode => {
  const usesDni = mode === 'dni';
  payerDniField?.classList.toggle('hidden', !usesDni);
  payerNameField?.classList.toggle('hidden', usesDni);
  if (payerDniInput) payerDniInput.required = usesDni;
  if (payerNameInput) payerNameInput.required = !usesDni;
};

const openCreateDialog = () => {
  if (!createLinkDialog || !createLinkForm) return;
  createLinkForm.reset();
  createIntentId = crypto.randomUUID();
  setIdentityMode('dni');
  createLinkFields?.classList.remove('hidden');
  createLinkSuccess?.classList.add('hidden');
  createLinkError?.classList.add('hidden');
  createLinkError.textContent = '';
  if (createLinkSubmit) {
    createLinkSubmit.disabled = false;
    createLinkSubmit.textContent = 'Crear Link de pago';
  }
  createLinkDialog.showModal();
  requestAnimationFrame(() => document.getElementById('linkAmount')?.focus());
};

const closeCreateDialog = () => createLinkDialog?.close();

const showCreatedLink = publicUrl => {
  createLinkFields?.classList.add('hidden');
  createLinkSuccess?.classList.remove('hidden');
  if (createdPublicUrl) {
    createdPublicUrl.href = publicUrl;
    createdPublicUrl.textContent = publicUrl;
  }
  if (openPublicUrl) openPublicUrl.href = publicUrl;
  if (copyPublicUrl) {
    copyPublicUrl.dataset.publicUrl = publicUrl;
    copyPublicUrl.textContent = 'Copiar URL';
  }
  requestAnimationFrame(() => copyPublicUrl?.focus());
};

const submitCreateLink = async event => {
  event.preventDefault();
  if (!createLinkForm || !createLinkSubmit || !createLinkError || !createLinkForm.reportValidity()) return;

  const formData = new FormData(createLinkForm);
  const payerIdentityType = String(formData.get('payerIdentityType') ?? 'dni');
  const input = {
    intentId: createIntentId || crypto.randomUUID(),
    amount: Number(formData.get('amount')),
    message: String(formData.get('message') ?? ''),
    expirationMinutes: Number(formData.get('expirationMinutes')),
    payerIdentityType,
    ...(payerIdentityType === 'name'
      ? { payerName: String(formData.get('payerName') ?? '') }
      : { payerDni: String(formData.get('payerDni') ?? '') }),
  };

  createLinkSubmit.disabled = true;
  createLinkSubmit.textContent = 'Creando Link…';
  createLinkError.classList.add('hidden');
  createLinkError.textContent = '';

  try {
    const payload = await requestJson('/api/payment-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    replacePaymentLink(payload.paymentLink);
    renderInventory();
    showCreatedLink(payload.publicUrl);
  } catch (error) {
    createLinkError.textContent = error instanceof Error ? error.message : 'No pudimos crear el Link de pago.';
    createLinkError.classList.remove('hidden');
    createLinkError.focus();
    createLinkSubmit.disabled = false;
    createLinkSubmit.textContent = 'Crear Link de pago';
  }
};

const loadPaymentLinks = async () => {
  try {
    const payload = await requestJson('/api/payment-links');
    state.paymentLinks = payload.paymentLinks;
    renderInventory();
  } catch (error) {
    paymentLinksLoading?.classList.add('hidden');
    setPageError(error instanceof Error ? error.message : 'No pudimos cargar el inventario local.');
  }
};

document.getElementById('openCreateLink')?.addEventListener('click', openCreateDialog);
document
  .querySelectorAll('[data-open-create-link]')
  .forEach(button => button.addEventListener('click', openCreateDialog));
document
  .querySelectorAll('[data-close-create-link]')
  .forEach(button => button.addEventListener('click', closeCreateDialog));
document.querySelectorAll('input[name="payerIdentityType"]').forEach(input => {
  input.addEventListener('change', event =>
    setIdentityMode(/** @type {HTMLInputElement} */ (event.currentTarget).value),
  );
});
createLinkForm?.addEventListener('submit', submitCreateLink);
copyPublicUrl?.addEventListener('click', async () => {
  const publicUrl = copyPublicUrl.dataset.publicUrl;
  if (!publicUrl) return;
  try {
    await navigator.clipboard.writeText(publicUrl);
    copyPublicUrl.textContent = 'URL copiada';
  } catch {
    copyPublicUrl.textContent = 'No se pudo copiar';
  }
});
createLinkDialog?.addEventListener('close', () => {
  createLinkForm?.reset();
  createIntentId = '';
  if (createdPublicUrl) {
    createdPublicUrl.removeAttribute('href');
    createdPublicUrl.textContent = '';
  }
  if (openPublicUrl) openPublicUrl.removeAttribute('href');
  if (copyPublicUrl) delete copyPublicUrl.dataset.publicUrl;
});

loadPaymentLinks();
