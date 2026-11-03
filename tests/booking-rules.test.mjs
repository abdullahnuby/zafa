import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateQuote,
  initialBookingStatus,
  canTransitionBooking,
  assertBookingTransition,
  calculateDemoCommission
} from '../booking-rules.mjs';

const prices = { mini: 1500, classic: 2100, wedding: 3300, royal: 4200 };

test('quote total is the package plus selected priced extras', () => {
  const quote = calculateQuote({ packageCode: 'wedding', packagePrices: prices, addOns: ['decor', 'waiting'] });
  assert.equal(quote.total, 3900);
  assert.equal(quote.durationHours, 5);
  assert.equal(quote.currency, 'EGP');
});

test('unknown packages and unpriced distance extras are rejected', () => {
  assert.throws(() => calculateQuote({ packageCode: 'unknown', packagePrices: prices }), /UNKNOWN_PACKAGE/);
  assert.throws(() => calculateQuote({ packageCode: 'classic', packagePrices: prices, addOns: ['distance'] }), /MANUAL_QUOTE_REQUIRED/);
});

test('independent owner booking waits for owner approval regardless of payment intent', () => {
  assert.equal(initialBookingStatus({ ownerType: 'independent', paymentMethod: 'cash' }), 'pending_owner');
  assert.equal(initialBookingStatus({ ownerType: 'independent', paymentMethod: 'deposit' }), 'pending_owner');
});

test('fleet booking status respects payment choice', () => {
  assert.equal(initialBookingStatus({ ownerType: 'fleet', paymentMethod: 'cash' }), 'confirmed');
  assert.equal(initialBookingStatus({ ownerType: 'fleet', paymentMethod: 'deposit' }), 'awaiting_payment');
});

test('booking transitions reject skipping required operational states', () => {
  assert.equal(canTransitionBooking('driver_assigned', 'ready'), true);
  assert.equal(canTransitionBooking('driver_assigned', 'completed'), false);
  assert.throws(() => assertBookingTransition('pending_owner', 'completed'), /INVALID_BOOKING_TRANSITION/);
});

test('demo commission arithmetic is explicit basis-points math', () => {
  assert.equal(calculateDemoCommission(2500, 1200), 300);
  assert.throws(() => calculateDemoCommission(-1), /INVALID_TOTAL/);
});
