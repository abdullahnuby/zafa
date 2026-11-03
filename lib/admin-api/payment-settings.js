import { getPool } from "../db.js";
import { requireRole, sendApiError, ApiError } from "../auth.js";
export default async function handler(req,res) {
  res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");
  try {
    const actor=await requireRole(req,["admin","finance_admin"]);
    if(req.method==="GET"){
      const {rows}=await getPool().query("SELECT * FROM public.payment_settings WHERE id=1");
      return res.status(200).json({ok:true,settings:rows[0]||null});
    }
    if(req.method!=="PATCH"){res.setHeader("Allow","GET, PATCH");return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});}
    const recipient=String(req.body?.instapayRecipient||"").trim()||null;
    const displayName=String(req.body?.instapayDisplayName||"").trim()||null;
    const depositPercent=Number(req.body?.depositPercent??30);
    const cashEnabled=req.body?.cashEnabled!==false;
    if(recipient&&(recipient.length<3||recipient.length>150))throw new ApiError(400,"INVALID_INSTAPAY_RECIPIENT");
    if(displayName&&(displayName.length<2||displayName.length>120))throw new ApiError(400,"INVALID_INSTAPAY_DISPLAY_NAME");
    if(!Number.isFinite(depositPercent)||depositPercent<5||depositPercent>100)throw new ApiError(400,"INVALID_DEPOSIT_PERCENT");
    const {rows}=await getPool().query(
      `UPDATE public.payment_settings SET instapay_recipient=$1,instapay_display_name=$2,
        deposit_percent_bps=$3,cash_enabled=$4,updated_by=$5,updated_at=now() WHERE id=1 RETURNING *`,
      [recipient,recipient?displayName:null,Math.round(depositPercent*100),cashEnabled,actor.id]
    );
    return res.status(200).json({ok:true,settings:rows[0]||null,instapayEnabled:Boolean(recipient)});
  } catch(error) {return sendApiError(res,error,"PAYMENT_SETTINGS_UPDATE_FAILED");}
}
