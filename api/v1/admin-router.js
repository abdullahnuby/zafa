import cashPaymentConfirmation from "../../lib/admin-api/cash-payment-confirmation.js";
import documents from "../../lib/admin-api/documents.js";
import fleet from "../../lib/admin-api/fleet.js";
import bookings from "../../lib/admin-api/bookings.js";
import people from "../../lib/admin-api/people.js";
import paymentReceiptsReview from "../../lib/admin-api/payment-receipts-review.js";
import paymentReceipts from "../../lib/admin-api/payment-receipts.js";
import paymentSettings from "../../lib/admin-api/payment-settings.js";
import assignDriver from "../../lib/admin-api/assign-driver.js";
import availability from "../../lib/admin-api/availability.js";
import vehicles from "../../lib/admin-api/vehicles.js";
import vehiclePhotos from "../../lib/admin-api/vehicle-photos.js";

const routes = {
  "cash-payment-confirmation": cashPaymentConfirmation,
  "documents": documents,
  "fleet": fleet,
  "bookings": bookings,
  "people": people,
  "payment-receipts-review": paymentReceiptsReview,
  "payment-receipts": paymentReceipts,
  "payment-settings": paymentSettings,
  "assign-driver": assignDriver,
  "availability": availability,
  "vehicles": vehicles,
  "vehicle-photos": vehiclePhotos
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const host = req.headers?.host || "localhost";
  const url = new URL(req.url || "/", "https://" + host);
  const routeName = String(url.searchParams.get("route") || "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")[0];
  const routeHandler = routes[routeName];

  if (!routeHandler) {
    return res.status(404).json({ ok: false, code: "ADMIN_ROUTE_NOT_FOUND" });
  }

  return routeHandler(req, res);
}
