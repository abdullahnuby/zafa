import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  buckets: {
    "payment-receipts": {},
    "vehicle-photos": { access: "public_read" }
  }
});
