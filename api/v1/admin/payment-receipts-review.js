import { getPool } from "../../../lib/db.js";
import { requireRole, sendApiError, ApiError } from "../../../lib/auth.js";
export default async function handler(req,res) {
  res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");
  if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});}
  let client;
  try {
    const actor=await requireRole(req,["admin","finance_admin"]);
    const receiptId=String(req.body?.receiptId||""),decision=String(req.body?.decision||"");
    const notes=String(req.body?.notes||"").trim().slice(0,500)||null;
    if(!/^[0-9a-f-]{36}$/i.test(receiptId)||!["approve","reject"].includes(decision))throw new ApiError(400,"INVALID_REVIEW_INPUT");
    client=await getPool().connect();await client.query("BEGIN");
    const {rows}=await client.query(
      `SELECT r.id,r.status AS receipt_status,r.payment_id,r.booking_id,p.provider,p.status AS payment_status,b.status AS booking_status
         FROM public.payment_receipts r JOIN public.payments p ON p.id=r.payment_id
         JOIN public.bookings b ON b.id=r.booking_id WHERE r.id=$1 FOR UPDATE OF r,p,b`,
      [receiptId]
    );
    if(!rows.length)throw new ApiError(404,"RECEIPT_NOT_FOUND");
    const r=rows[0];
    if(r.receipt_status!=="pending_review"||r.provider!=="instapay"||r.payment_status!=="pending")throw new ApiError(409,"RECEIPT_NOT_REVIEWABLE");
    const next=decision==="approve"?"approved":"rejected";
    await client.query("UPDATE public.payment_receipts SET status=$2,reviewed_by=$3,review_notes=$4,reviewed_at=now() WHERE id=$1",[receiptId,next,actor.id,notes]);
    let bookingStatus=r.booking_status;
    if(decision==="approve"){
      await client.query("UPDATE public.payments SET status='captured',captured_at=now() WHERE id=$1 AND status='pending'",[r.payment_id]);
      if(r.booking_status==="awaiting_payment"){
        await client.query("UPDATE public.bookings SET status='confirmed',updated_at=now() WHERE id=$1",[r.booking_id]);
        bookingStatus="confirmed";
        await client.query(
          "INSERT INTO public.booking_events (booking_id,from_status,to_status,actor_user_id,reason) VALUES ($1,'awaiting_payment','confirmed',$2,'تم اعتماد إيصال إنستا باي يدويًا')",
          [r.booking_id,actor.id]
        );
      }
    }
    await client.query(
      `INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
       VALUES($1,$2,'payment_receipts',$3,$4::jsonb,$5::jsonb)`,
      [actor.id,`payment_receipt.${decision}`,receiptId,JSON.stringify({receiptStatus:r.receipt_status,paymentStatus:r.payment_status,bookingStatus:r.booking_status}),JSON.stringify({receiptStatus:next,paymentStatus:decision==="approve"?"captured":"pending",bookingStatus,notes})]
    );
    await client.query("COMMIT");
    return res.status(200).json({ok:true,receiptStatus:next,paymentStatus:decision==="approve"?"captured":"pending",bookingStatus});
  } catch(error) {
    if(client)await client.query("ROLLBACK").catch(()=>{});
    return sendApiError(res,error,"RECEIPT_REVIEW_FAILED");
  } finally {client?.release();}
}
