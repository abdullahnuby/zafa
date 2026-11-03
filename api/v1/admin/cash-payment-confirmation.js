import { getPool } from "../../../lib/db.js";
import { requireRole, sendApiError, ApiError } from "../../../lib/auth.js";
export default async function handler(req,res) {
  res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");
  if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});}
  let client;
  try {
    const actor=await requireRole(req,["admin","finance_admin"]);
    const paymentId=String(req.body?.paymentId||"");
    if(!/^[0-9a-f-]{36}$/i.test(paymentId))throw new ApiError(400,"INVALID_PAYMENT_ID");
    client=await getPool().connect();await client.query("BEGIN");
    const {rows}=await client.query(
      "SELECT p.id,p.booking_id,p.status AS payment_status,p.provider,b.status AS booking_status FROM public.payments p JOIN public.bookings b ON b.id=p.booking_id WHERE p.id=$1 FOR UPDATE OF p,b",
      [paymentId]
    );
    if(!rows.length)throw new ApiError(404,"PAYMENT_NOT_FOUND");
    const p=rows[0];
    if(p.provider!=="cash"||p.payment_status!=="cash_due")throw new ApiError(409,"CASH_PAYMENT_NOT_DUE");
    await client.query("UPDATE public.payments SET status='captured',captured_at=now() WHERE id=$1",[paymentId]);
    let bookingStatus=p.booking_status;
    if(bookingStatus==="awaiting_payment"){
      await client.query("UPDATE public.bookings SET status='confirmed',updated_at=now() WHERE id=$1",[p.booking_id]);
      bookingStatus="confirmed";
      await client.query(
        "INSERT INTO public.booking_events (booking_id,from_status,to_status,actor_user_id,reason) VALUES ($1,'awaiting_payment','confirmed',$2,'تم تأكيد استلام العربون النقدي')",
        [p.booking_id,actor.id]
      );
    }
    await client.query(
      `INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
       VALUES($1,'cash_payment.confirmed','payments',$2,$3::jsonb,$4::jsonb)`,
      [actor.id,paymentId,JSON.stringify({paymentStatus:p.payment_status,bookingStatus:p.booking_status}),JSON.stringify({paymentStatus:"captured",bookingStatus})]
    );
    await client.query("COMMIT");
    return res.status(200).json({ok:true,paymentStatus:"captured",bookingStatus});
  } catch(error) {
    if(client)await client.query("ROLLBACK").catch(()=>{});
    return sendApiError(res,error,"CASH_CONFIRMATION_FAILED");
  } finally {client?.release();}
}
