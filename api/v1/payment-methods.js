import { getPool } from "../../lib/db.js";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") { res.setHeader("Allow","GET"); return res.status(405).json({ ok:false,code:"METHOD_NOT_ALLOWED" }); }
  try {
    const { rows } = await getPool().query("SELECT instapay_recipient,instapay_display_name,deposit_percent_bps,cash_enabled FROM public.payment_settings WHERE id=1");
    const s = rows[0] || {};
    const ready = Boolean(s.instapay_recipient);
    return res.status(200).json({
      ok:true, currency:"EGP", depositPercent:Number(s.deposit_percent_bps || 3000)/100,
      methods:{
        instapay:{ enabled:ready, recipient:ready?s.instapay_recipient:null, displayName:ready?s.instapay_display_name:null, receiptRequired:true },
        cash:{ enabled:s.cash_enabled===true, receiptRequired:false }
      }
    });
  } catch (error) {
    console.error("[ZAFFA API] payment methods read failed",{code:error?.code||"UNKNOWN"});
    return res.status(503).json({ok:false,code:"PAYMENT_SETTINGS_UNAVAILABLE"});
  }
}
