import test from "node:test";
import assert from "node:assert/strict";
import { PAYMENT_METHODS, calculateDeposit, initialBookingStatus } from "../booking-rules.mjs";
test("only InstaPay deposit and cash are accepted",()=>{
 assert.deepEqual(Object.keys(PAYMENT_METHODS).sort(),["cash","instapay_deposit"]);
 assert.throws(()=>initialBookingStatus({ownerType:"fleet",paymentMethod:"full"}),/UNSUPPORTED_PAYMENT_METHOD/);
 assert.throws(()=>initialBookingStatus({ownerType:"fleet",paymentMethod:"deposit"}),/UNSUPPORTED_PAYMENT_METHOD/);
});
test("deposit amount rounds up",()=>{
 assert.equal(calculateDeposit(10001,3000),3001);
 assert.equal(calculateDeposit(10000,3000),3000);
});
test("cash and InstaPay never auto-confirm",()=>{
 assert.equal(initialBookingStatus({ownerType:"fleet",paymentMethod:"instapay_deposit"}),"awaiting_payment");
 assert.equal(initialBookingStatus({ownerType:"fleet",paymentMethod:"cash"}),"awaiting_payment");
 assert.equal(initialBookingStatus({ownerType:"independent",paymentMethod:"cash"}),"pending_owner");
});
