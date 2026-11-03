export const PACKAGE_CODES = Object.freeze({
  mini: { label: 'باقة ميني', hours: 2 },
  classic: { label: 'باقة كلاسيك', hours: 3 },
  wedding: { label: 'باقة الزفاف', hours: 5 },
  royal: { label: 'باقة رويال', hours: 6 }
});

export const ADD_ONS = Object.freeze({
  decor: { label: 'تزيين بسيط', amount: 350 },
  waiting: { label: 'ساعة انتظار إضافية', amount: 250 },
  convoy: { label: 'سيارة ضمن موكب', amount: 500 },
  distance: { label: 'تسعير مسافة خارج النطاق', amount: null }
});

export function calculateQuote({ packageCode, packagePrices, addOns = [] }) {
  const definition = PACKAGE_CODES[packageCode];
  if (!definition) throw new Error('UNKNOWN_PACKAGE');
  const base = Number(packagePrices?.[packageCode]);
  if (!Number.isSafeInteger(base) || base < 0) throw new Error('INVALID_PACKAGE_PRICE');
  let extras = 0;
  const lines = [{ code: packageCode, label: definition.label, amount: base }];
  for (const code of addOns) {
    const addOn = ADD_ONS[code];
    if (!addOn) throw new Error('UNKNOWN_ADD_ON');
    if (addOn.amount === null) throw new Error('MANUAL_QUOTE_REQUIRED');
    extras += addOn.amount;
    lines.push({ code, label: addOn.label, amount: addOn.amount });
  }
  const total = base + extras;
  if (!Number.isSafeInteger(total)) throw new Error('QUOTE_OVERFLOW');
  return Object.freeze({ packageCode, durationHours: definition.hours, currency: 'EGP', lines, base, extras, total });
}

export const PAYMENT_METHODS = Object.freeze({
  instapay_deposit: { label: 'إنستا باي — عربون', depositBasisPoints: 3000 },
  cash: { label: 'كاش', depositBasisPoints: 3000 }
});
export function calculateDeposit(total, basisPoints = 3000) {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('INVALID_TOTAL');
  if (!Number.isInteger(basisPoints) || basisPoints < 500 || basisPoints > 10000) throw new Error('INVALID_DEPOSIT_BASIS_POINTS');
  return Math.ceil(total * basisPoints / 10000);
}
export function initialBookingStatus({ ownerType, paymentMethod }) {
  if (!['fleet', 'independent'].includes(ownerType)) throw new Error('UNKNOWN_OWNER_TYPE');
  if (!Object.hasOwn(PAYMENT_METHODS, paymentMethod)) throw new Error('UNSUPPORTED_PAYMENT_METHOD');
  return ownerType === 'independent' ? 'pending_owner' : 'awaiting_payment';
}

const TRANSITIONS = Object.freeze({
  draft: ['pending_owner', 'awaiting_payment', 'confirmed', 'cancelled'],
  pending_owner: ['awaiting_payment', 'confirmed', 'declined', 'cancelled'],
  awaiting_payment: ['confirmed', 'cancelled'],
  confirmed: ['driver_assigned', 'cancelled', 'disputed'],
  driver_assigned: ['ready', 'cancelled', 'no_show', 'disputed'],
  ready: ['in_progress', 'cancelled', 'no_show', 'disputed'],
  in_progress: ['completed', 'disputed'],
  completed: ['disputed'],
  declined: [], cancelled: [], no_show: [], disputed: []
});

export function canTransitionBooking(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}

export function assertBookingTransition(from, to) {
  if (!canTransitionBooking(from, to)) {
    throw new Error(`INVALID_BOOKING_TRANSITION:${from}->${to}`);
  }
}

export function calculateDemoCommission(total, basisPoints = 1200) {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('INVALID_TOTAL');
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) throw new Error('INVALID_BASIS_POINTS');
  return Math.round(total * basisPoints / 10000);
}
