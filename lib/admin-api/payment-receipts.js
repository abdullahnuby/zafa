import { getPool } from "../db.js";
import { requireRole, sendApiError } from "../auth.js";
import { createPrivateReceiptUrl } from "../storage.js";
export default async function handler(req,res) {
  res.setHeader("Cache-Control","no-store");
  res.setHeader("X-Content-Type-Options","nosniff");
  if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});}
  try {
    await requireRole(req,["admin","finance_admin"]);
    const {rows}=await getPool().query(
      `SELECT r.id,r.payment_id,r.booking_id,r.object_key,r.original_filename,r.content_type,r.size_bytes,r.sha256,r.created_at,
              b.booking_code,p.amount_minor,u.display_name AS customer_name,u.phone_e164 AS customer_phone
         FROM public.payment_receipts r JOIN public.bookings b ON b.id=r.booking_id
         JOIN public.payments p ON p.id=r.payment_id JOIN public.users u ON u.id=b.customer_id
        WHERE r.status='pending_review' ORDER BY r.created_at ASC LIMIT 100`
    );
    const receipts=await Promise.all(rows.map(async r=>({
      id:r.id,paymentId:r.payment_id,bookingId:r.booking_id,bookingCode:r.booking_code,
      customerName:r.customer_name,customerPhone:r.customer_phone,amountMinor:Number(r.amount_minor),currency:"EGP",
      filename:r.original_filename,contentType:r.content_type,sizeBytes:r.size_bytes,sha256:r.sha256,
      submittedAt:r.created_at,previewUrl:await createPrivateReceiptUrl(r.object_key,300)
    })));
    return res.status(200).json({ok:true,count:receipts.length,receipts});
  } catch(error) { return sendApiError(res,error,"RECEIPT_REVIEW_LIST_FAILED"); }
}
