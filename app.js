import { createAuthClient } from '@neondatabase/auth';
import { getAuthBearerToken } from './lib/client-auth-token.mjs';
import { PACKAGE_CODES, ADD_ONS, calculateQuote, calculateDeposit, assertBookingTransition } from './booking-rules.mjs';
const STORAGE_KEY = 'zaffa_product_v1';
const TODAY = new Date();
const tomorrow = new Date(TODAY); tomorrow.setDate(TODAY.getDate() + 1);
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const money = n => `${new Intl.NumberFormat('ar-EG').format(Math.round(n))} ج.م`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const sampleData = () => ({
  role:'customer', view:'home', filter:'all', searchDate:isoDate(tomorrow),
  searchZone:'وسط الأقصر', searchOccasion:'زفاف', favorites:[],
  cars:[], bookings:[], settlements:[]
});

let state;
try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || sampleData(); } catch { state = sampleData(); }
// A browser-stored role is never an authority. Restore the customer shell and derive privileges from a verified session.
state.role = 'customer';
state.view = 'home';
state.cars = [];
state.bookings = [];
state.settlements = [];
state.favorites = [];
let activeCarId = null;
let browseFilter = 'all';
let bookingDraft = null;
let adminFleet = { owners: [], drivers: [], vehicles: [], availabilityRules: [], availabilityBlocks: [], packages: [] };
let adminFleetLoading = false;
let adminBookings = [];
let adminBookingsLoading = false;
let vehiclePhotoPreviewUrls = [];

const roleConfig = {
  customer: {label:'عميل',default:'home',nav:[['home','الرئيسية','🏡'],['cars','السيارات','🚘'],['bookings','حجوزاتي','🗓️'],['favorites','المفضلة','💗'],['account','حسابي','👤']]},
  owner: {label:'مالك سيارة',default:'owner-overview',nav:[['owner-overview','ملخص المالك','📊'],['owner-vehicles','سياراتي','🚗'],['owner-requests','طلبات الحجز','📩'],['owner-calendar','التوافر','🗓️'],['owner-earnings','الأرباح والتسويات','💰']]},
  driver: {label:'سائق',default:'driver-tasks',nav:[['driver-tasks','مهامي','🧭'],['driver-history','سجل الرحلات','🚦'],['driver-account','حسابي','👤']]},
  admin: {label:'إدارة زفّة',default:'admin-overview',nav:[['admin-overview','مركز العمليات','🎛️'],['admin-vehicles','السيارات','🚘'],['admin-people','الملاك والسائقون','👥'],['admin-schedule','المواعيد والتوافر','🗓️'],['admin-bookings','الحجوزات','📋'],['admin-finance','المالية','💳'],['admin-reports','التقارير','📈']]}
};
const viewTitles = {
  home:'الرئيسية',cars:'اكتشف السيارات',bookings:'حجوزاتي',favorites:'المفضلة',account:'حسابي',
  'owner-overview':'ملخص المالك','owner-vehicles':'سياراتي','owner-requests':'طلبات الحجز','owner-calendar':'التوافر','owner-earnings':'الأرباح والتسويات',
  'driver-tasks':'مهامي اليوم','driver-history':'سجل الرحلات','driver-account':'حسابي',
  'admin-overview':'مركز العمليات','admin-bookings':'إدارة الحجوزات','admin-vehicles':'إدارة السيارات','admin-people':'الملاك والسائقون','admin-schedule':'المواعيد والتوافر','admin-finance':'المالية والتسويات','admin-reports':'التقارير'
};
function persist(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function carById(id){ return state.cars.find(c=>c.id===id); }
function bookingById(id){ return state.bookings.find(b=>b.id===id); }
function statusInfo(status){
  const m={pending_owner:['بانتظار موافقة المالك','orange'],awaiting_payment:['بانتظار الدفع','orange'],confirmed:['مؤكد','green'],driver_assigned:['تم تعيين السائق','blue'],ready:['السائق جاهز','blue'],in_progress:['الخدمة جارية','blue'],completed:['مكتمل','green'],cancelled:['ملغي','gray'],declined:['مرفوض','red'],no_show:['عدم حضور','red'],disputed:['قيد المراجعة','red']};
  const [label,color]=m[status]||['غير محدد','gray']; return `<span class="status ${color}">${label}</span>`;
}
function carArt(color='silver'){
  return `<svg class="car-svg" viewBox="0 0 360 150" role="img" aria-label="رسم توضيحي لسيارة"><defs><linearGradient id="body-${color}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fbfbf7"/><stop offset=".46" stop-color="#d4d7d2"/><stop offset="1" stop-color="#89979a"/></linearGradient></defs><ellipse cx="180" cy="128" rx="135" ry="9" fill="#273b4428"/><path d="M48 99 67 76q8-10 27-14l35-8 29-31q8-8 23-8h52q16 0 27 12l30 35 22 7q14 4 19 17l7 17q3 10-9 12H43q-10-3-5-14z" fill="url(#body-${color})" stroke="#65757a" stroke-width="2"/><path d="m143 53 27-29q5-5 14-5h49q9 0 16 8l24 27z" fill="#536d79"/><path d="m181 25-27 28h109l-22-28q-4-5-12-5h-39q-5 0-9 5" fill="#aebfc1" opacity=".72"/><path d="M48 99h272" stroke="#65757a" stroke-width="2"/><path d="m74 82 49-9 3 26H57z" fill="#edf0eb" opacity=".45"/><rect x="291" y="85" width="18" height="8" rx="3" fill="#f0d8b8"/><rect x="48" y="87" width="15" height="8" rx="3" fill="#d4d9d6"/><circle cx="96" cy="112" r="23" fill="#26343b"/><circle cx="96" cy="112" r="12" fill="#c6cac4"/><circle cx="96" cy="112" r="5" fill="#7f8b8e"/><circle cx="275" cy="112" r="23" fill="#26343b"/><circle cx="275" cy="112" r="12" fill="#c6cac4"/><circle cx="275" cy="112" r="5" fill="#7f8b8e"/><path d="M145 54v44m74-44v44" stroke="#778589" stroke-width="2" opacity=".6"/></svg>`;
}
function carCard(car){
  const favorite=state.favorites.includes(car.id);
  const low=car.packagePrices.classic;
  const media=car.imageUrl
    ? `<img class="car-photo" src="${escapeHtml(car.imageUrl)}" alt="${escapeHtml(car.brand)} ${escapeHtml(car.model)}" loading="lazy">`
    : carArt(car.color||'silver');
  return `<article class="car-card"><div class="car-art ${escapeHtml(car.color||'silver')}">${media}<span class="car-badge">✓ سيارة معتمدة</span><button class="favorite ${favorite?'active':''}" data-action="favorite" data-id="${car.id}" aria-label="إضافة للمفضلة">${favorite?'♥':'♡'}</button></div><div class="car-body"><div class="car-title-row"><div><h3>${escapeHtml(car.brand)} ${escapeHtml(car.model)}</h3><div class="car-sub">موديل ${car.year} · ${escapeHtml(car.zone)}</div></div><span class="rating">★ ${car.rating?car.rating.toFixed(1):'جديد'} <small>(${car.reviews})</small></span></div><div class="car-meta"><span>♙ ${car.seats} أفراد</span><span>⚙ ${escapeHtml(car.transmission)}</span><span>✓ بسائق</span></div><div class="car-price-row"><div class="price">${money(low)} <small>/ 3 ساعات</small></div><span class="owner-type">${car.ownerType==='fleet'?'أسطول زفّة':'مالك موثّق'}</span></div><div class="car-actions"><button class="btn btn-outline btn-small" data-action="details" data-id="${car.id}">التفاصيل</button><button class="btn btn-primary btn-small" data-action="book" data-id="${car.id}">احجز السيارة</button></div></div></article>`;
}
function pageHeading(kicker,title,desc,button=''){return `<div class="page-heading"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${desc}</p></div>${button}</div>`;}
function statCard(icon,label,value,foot){return `<div class="stat-card"><div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></div>`;}
function navButton(item,active){return `<button class="nav-item ${active?'active':''}" data-action="go" data-view="${item[0]}"><span class="nav-icon">${item[2]}</span><span class="nav-label">${item[1]}</span></button>`;}
function renderNav(){
  const cfg=roleConfig[state.role];
  document.querySelector('#side-nav').innerHTML=cfg.nav.map(n=>navButton(n,n[0]===state.view)).join('');
  document.querySelector('#mobile-nav').innerHTML=cfg.nav.slice(0,5).map(n=>navButton(n,n[0]===state.view)).join('');
  document.querySelector('#page-title').textContent=viewTitles[state.view]||cfg.label;
}
function render(){
  renderNav();
  const root=document.querySelector('#app-content');
  const pages={home:renderHome,cars:renderCars,bookings:renderCustomerBookings,favorites:renderFavorites,account:renderCustomerAccount,
    'owner-overview':renderOwnerOverview,'owner-vehicles':renderOwnerVehicles,'owner-requests':renderOwnerRequests,'owner-calendar':renderOwnerCalendar,'owner-earnings':renderOwnerEarnings,
    'driver-tasks':renderDriverTasks,'driver-history':renderDriverHistory,'driver-account':renderDriverAccount,
    'admin-overview':renderAdminOverview,'admin-bookings':renderAdminBookings,'admin-vehicles':renderAdminVehicles,'admin-people':renderAdminPeople,'admin-schedule':renderAdminSchedule,'admin-finance':renderAdminFinance,'admin-reports':renderAdminReports};
  root.innerHTML=(pages[state.view]||renderHome)();
}
function renderHome(){
 const featured=state.cars.filter(c=>c.approval==='approved').slice(0,3);
 return `
 <section class="hero hero-wedding">
   <img class="hero-photo" src="https://images.unsplash.com/photo-1748840092111-05f67ab7a321?auto=format&fit=crop&w=1800&q=85" alt="سيارة مرسيدس بيضاء في أجواء مناسبة أنيقة" fetchpriority="high">
   <div class="hero-shade"></div>
   <div class="hero-copy">
     <div class="hero-kicker"><span>✦</span> لكل حكاية بداية جميلة</div>
     <h1>يومك فرحة…<br><em>ووصولك حكاية</em></h1>
     <p>اختار عربية تليق بلحظتك، وسيب علينا تفاصيل المشوار.</p>
     <button class="btn btn-gold" data-action="go" data-view="cars">اكتشف سيارات زفّة <span>←</span></button>
     <div class="hero-trust"><span>✿</span> سيارات معتمدة <i></i><span>♡</span> تجربة تليق بيومك</div>
   </div>
   <div class="hero-sticker"><span>💍</span><b>لحظتك<br>الأجمل</b></div>
 </section>
 <section class="search-panel wedding-search">
   <div class="search-heading"><span class="search-heading-icon">✨</span><div><b>خلّينا نرتب فرحتك</b><small>اختار المناسبة والتاريخ ومكان الانطلاق</small></div></div>
   <div class="search-fields">
    <div class="field"><label>🎉 المناسبة</label><select id="home-occasion"><option>زفاف</option><option>خطوبة</option><option>كتب كتاب</option><option>مناسبة خاصة</option></select></div>
    <div class="field"><label>📅 تاريخ المناسبة</label><input id="home-date" type="date" min="${isoDate(TODAY)}" value="${escapeHtml(state.searchDate)}"></div>
    <div class="field"><label>📍 منطقة الانطلاق</label><select id="home-zone"><option>وسط الأقصر</option><option>الكرنك</option><option>العوامية</option><option>البياضية</option><option>القرنة</option><option>البر الغربي</option></select></div>
    <button class="btn btn-primary search-submit" data-action="search-cars">اعثر على عربيتك <span>←</span></button>
   </div>
 </section>
 <section class="occasion-section">
   <div class="section-head"><div><span class="eyebrow">اختار مناسبتك</span><h2>كل فرحة وليها زفّتها</h2><p>ابدأ من نوع اليوم اللي مستنيه</p></div></div>
   <div class="occasion-tiles">
    <button class="occasion-tile occasion-rose" data-action="occasion" data-value="زفاف"><span class="occasion-emoji">💍</span><b>زفاف</b><small>دخلة تفضل في الذاكرة</small><span class="occasion-arrow">←</span></button>
    <button class="occasion-tile occasion-lilac" data-action="occasion" data-value="خطوبة"><span class="occasion-emoji">🌷</span><b>خطوبة</b><small>بداية حكاية جديدة</small><span class="occasion-arrow">←</span></button>
    <button class="occasion-tile occasion-peach" data-action="occasion" data-value="كتب كتاب"><span class="occasion-emoji">✨</span><b>كتب كتاب</b><small>تفاصيل بسيطة ومميزة</small><span class="occasion-arrow">←</span></button>
   </div>
 </section>
 <section class="featured-section">
  <div class="section-head"><div><span class="eyebrow">اختيارات زفّة</span><h2>سيارات مختارة ليك</h2><p>هنعرض هنا العربيات الحقيقية بعد اعتمادها</p></div><button class="text-link" data-action="go" data-view="cars">عرض كل السيارات ←</button></div>
  ${featured.length?'<div class="car-grid">'+featured.map(carCard).join('')+'</div>':`<div class="empty-state wedding-empty">
   <div class="empty-state-photo"><img src="https://images.unsplash.com/photo-1691343327025-4b0cc1dc053f?auto=format&fit=crop&w=900&q=80" alt="تفصيلة زهور على سيارة مناسبة" loading="lazy"><span>🌸</span></div>
   <div class="empty-state-copy"><div class="empty-state-kicker">قريبًا في زفّة</div><h3>أول أسطول فرحتك بيتجهّز</h3><p>بنضيف السيارات المعتمدة واحدة واحدة، بصورها وأسعارها وتفاصيلها الحقيقية. مش هنعرض صور أو أسعار لسيارات مش موجودة.</p><button class="btn btn-soft" data-action="go" data-view="cars">استكشف زفّة <span>←</span></button></div>
  </div>`}
 </section>
 <section class="journey-section">
  <div class="section-head"><div><span class="eyebrow">بكل بساطة</span><h2>زفّتك في 3 خطوات</h2><p>من أول اختيار لحد يوم الفرحة</p></div></div>
  <div class="journey-grid">
   <article class="journey-card"><span class="journey-icon journey-icon-pink">🚘</span><b>اختار عربيتك</b><small>صور ومواصفات واضحة لكل سيارة</small><span class="journey-number">01</span></article>
   <article class="journey-card"><span class="journey-icon journey-icon-lilac">🗓️</span><b>حدد تفاصيل يومك</b><small>التاريخ والمكان والباقة المناسبة</small><span class="journey-number">02</span></article>
   <article class="journey-card"><span class="journey-icon journey-icon-gold">🎀</span><b>استمتع بفرحتك</b><small>تنظيم ومتابعة لتجربة أهدى</small><span class="journey-number">03</span></article>
  </div>
 </section>
 <div class="payment-methods-strip wedding-payments">
   <div class="payment-method-card"><span class="payment-method-icon">↗</span><div><b>إنستا باي</b><small id="instapay-home-status">إيصال التحويل يخضع للمراجعة قبل اعتماد الدفع</small></div></div>
   <div class="payment-method-card"><span class="payment-method-icon">ج.م</span><div><b>كاش</b><small>يظل المبلغ مستحقًا حتى تأكيد الاستلام</small></div></div>
 </div>
 <div class="footer-note">زفّة تعرض السيارات المعتمدة فقط. تأكيد الحجز والدفع لا يتم إلا بعد اكتمال إجراءات التشغيل والمراجعة.</div>`;
}
function renderCars(){
 const cars=state.cars.filter(c=>c.approval==='approved').filter(c=>browseFilter==='all'||(browseFilter==='fleet'?c.ownerType==='fleet':browseFilter==='independent'?c.ownerType==='independent':c.model.toLowerCase().includes(browseFilter)));
 return `${pageHeading('اكتشف زفّة','اختار السيارة المناسبة لمناسبتك','كل سيارة معتمدة، وبسائق، وبسعر واضح قبل تأكيد الحجز.')}
 <div class="filter-row"><button class="filter-chip ${browseFilter==='all'?'active':''}" data-action="filter" data-filter="all">كل السيارات</button><button class="filter-chip ${browseFilter==='fleet'?'active':''}" data-action="filter" data-filter="fleet">أسطول زفّة</button><button class="filter-chip ${browseFilter==='independent'?'active':''}" data-action="filter" data-filter="independent">ملاك موثّقون</button><button class="filter-chip ${browseFilter==='S-Class'?'active':''}" data-action="filter" data-filter="S-Class">فئة ملكية</button></div>
 <div class="section-head"><div><h2>${cars.length} سيارات متاحة للعرض</h2><p>الأقصر والمناطق المحددة حسب تغطية كل سيارة</p></div><span class="owner-type">خدمة بسائق فقط</span></div>
 ${cars.length?`<div class="car-grid">${cars.map(carCard).join('')}</div>`:`<div class="empty-state wedding-empty cars-empty"><div class="empty-state-photo"><img src="https://images.unsplash.com/photo-1691343327025-4b0cc1dc053f?auto=format&fit=crop&w=900&q=80" alt="زينة زهور لسيارة مناسبة" loading="lazy"><span>🌷</span></div><div class="empty-state-copy"><div class="empty-state-kicker">قريبًا جدًا</div><h3>لسه بنجهّز أول مجموعة سيارات</h3><p>تابعنا قريبًا لمشاهدة السيارات المعتمدة بصورها وأسعارها وتفاصيلها.</p><button class="btn btn-soft" data-action="go" data-view="home">العودة للرئيسية</button></div></div>`}
 <div class="notice">المعروض يُجلب من قاعدة بيانات زفّة. لن يتم تأكيد أي حجز قبل فحص التوافر ومراجعة العربون.</div>`;
}
function bookingRow(b,admin=false){
 const car=carById(b.carId)||{};
 return `<div class="booking-card"><div class="booking-thumb">${carArt(car.color||'silver')}</div><div class="booking-info"><b>${escapeHtml(car.brand||'سيارة')} ${escapeHtml(car.model||'')}</b><small>رقم الحجز ${b.id} · ${escapeHtml(b.date)} · ${escapeHtml(b.time)}</small><small>${escapeHtml(b.zone)} ← ${escapeHtml(b.destination)}</small><div style="margin-top:6px">${statusInfo(b.status)}</div></div><div class="booking-end"><strong>${money(b.total)}</strong><small>${escapeHtml(b.packageLabel)}</small><button class="btn btn-outline btn-small" data-action="booking-details" data-id="${b.id}">التفاصيل</button></div></div>`;
}
function renderCustomerBookings(){
 const list=state.bookings.filter(b=>b.customerName==='مريم أحمد'||b.customerPhone==='0100•••4821');
 return `${pageHeading('رحلتك مع زفّة','حجوزاتي','تابع حالة كل حجز، تفاصيل الخدمة، والمدفوعات.')}
 ${list.length?`<div class="booking-list">${list.map(b=>bookingRow(b)).join('')}</div>`:`<div class="panel empty-state"><div class="empty-icon">▤</div><b>لسه مفيش حجوزات</b><p>ابدأ باختيار السيارة المناسبة لمناسبتك.</p><button class="btn btn-primary" data-action="go" data-view="cars">اكتشف السيارات</button></div>`}`;
}
function renderFavorites(){const cars=state.cars.filter(c=>state.favorites.includes(c.id)&&c.approval==='approved');return `${pageHeading('اختياراتك','السيارات المفضلة','احتفظ بالسيارات اللي عجبتك وارجعلها وقت ما تحب.')}${cars.length?`<div class="car-grid">${cars.map(carCard).join('')}</div>`:`<div class="panel empty-state"><div class="empty-icon">♡</div><b>مفيش سيارات في المفضلة</b><p>اضغط على علامة القلب في أي سيارة علشان تحفظها هنا.</p><button class="btn btn-primary" data-action="go" data-view="cars">تصفح السيارات</button></div>`}`;}
function renderCustomerAccount(){const p=currentProfile;return `${pageHeading('بياناتك','حسابي','بيانات الملف الشخصي وإعدادات التواصل.')}
 <div class="panel" style="max-width:720px">${p?`<div class="profile-card" style="border:0;padding:0 0 18px"><div class="avatar" style="width:50px;height:50px;font-size:20px">◎</div><div><b style="font-size:14px">${escapeHtml(p.displayName)}</b><small>رقم الموبايل: ${escapeHtml(p.phone||'')}</small></div></div><div class="profile-grid"><div class="profile-card"><span class="profile-icon">☎</span><div><b>رقم الهاتف</b><small>${escapeHtml(p.phone)}</small></div></div><div class="profile-card"><span class="profile-icon">⌖</span><div><b>المدينة</b><small>الأقصر، مصر</small></div></div></div><button class="btn btn-outline" data-action="account" style="margin-top:15px">إدارة الحساب</button>`:'<div class="empty-state"><b>سجّل الدخول لإدارة حسابك</b><p>حسابك يحفظ بيانات التواصل والحجوزات.</p><button class="btn btn-primary" data-action="account">تسجيل الدخول</button></div>'}</div>`;}

function ownerBookings(){return state.bookings.filter(b=>b.ownerId==='owner1');}
function renderOwnerOverview(){const list=ownerBookings();const pending=list.filter(b=>b.status==='pending_owner');const revenue=list.filter(b=>['confirmed','driver_assigned','ready','in_progress','completed'].includes(b.status)).reduce((s,b)=>s+b.total-b.commission,0);return `${pageHeading('مساحة الشريك','أهلاً بيك في زفّة','إدارة سياراتك وطلبات الحجز والتسويات من مكان واحد.',`<button class="btn btn-primary" data-action="go" data-view="owner-vehicles">+ أضف سيارة</button>`)}
 <div class="stats-grid">${statCard('◇','سياراتك المعتمدة',state.cars.filter(c=>c.ownerId==='owner1'&&c.approval==='approved').length,'سيارات جاهزة لاستقبال الطلبات')}${statCard('▤','طلبات جديدة',pending.length,'تحتاج مراجعتك')}${statCard('◈','مستحقات تقديرية',money(revenue),'قبل التسوية والخصومات')}${statCard('★','متوسط التقييم','4.8','بيانات تقييم تجريبية')}</div>
 <div class="owner-layout"><div class="panel"><h3>طلبات تحتاج قرارك</h3>${pending.length?`<div class="mini-list">${pending.map(b=>`<div class="mini-row"><div><b>${escapeHtml(b.customerName)} · ${escapeHtml(b.packageLabel)}</b><small>${b.date} · ${b.time} · ${money(b.total)}</small></div><button class="btn btn-primary btn-small" data-action="booking-details" data-id="${b.id}">مراجعة الطلب</button></div>`).join('')}</div>`:`<div class="empty-state"><b>مفيش طلبات جديدة</b><p>أي طلب جديد هتلاقيه هنا.</p></div>`}</div><div class="panel"><h3>تذكير مهم</h3><div class="notice">تأكد من تحديث التوافر والأسعار قبل استقبال الحجوزات.</div><div class="mini-row"><div><b>مستندات السيارة</b><small>مراجعة الصلاحية قبل انتهاءها</small></div><span class="status green">سارية تجريبيًا</span></div><div class="mini-row"><div><b>التسوية القادمة</b><small>مستحقات قيد المراجعة</small></div><span class="status orange">معلقة</span></div></div></div>`;}
function renderOwnerVehicles(){const cars=state.cars.filter(c=>c.ownerId==='owner1');return `${pageHeading('إدارة الأسطول','سياراتي','حدّث بيانات سيارتك ومستنداتها وحالة اعتمادها.',`<button class="btn btn-primary" data-action="add-car">+ إضافة سيارة</button>`)}<div class="panel"><div class="table-wrap"><table><thead><tr><th>السيارة</th><th>رقم اللوحة</th><th>نوع الشراكة</th><th>حالة الاعتماد</th><th>باقة كلاسيك</th><th>إجراء</th></tr></thead><tbody>${cars.map(c=>`<tr><td><b>${escapeHtml(c.brand)} ${escapeHtml(c.model)}</b><br><small>${c.year}</small></td><td>${escapeHtml(c.plate)}</td><td>مالك مستقل</td><td>${c.approval==='approved'?'<span class="status green">معتمدة</span>':c.approval==='pending'?'<span class="status orange">قيد المراجعة</span>':'<span class="status red">مرفوضة</span>'}</td><td>${money(c.packagePrices.classic)}</td><td><button class="btn btn-outline btn-small" data-action="edit-car" data-id="${c.id}">تعديل البيانات</button></td></tr>`).join('')}</tbody></table></div></div><div class="notice">إضافة السيارة هنا تحفظ سجلًا تجريبيًا فقط. رفع الوثائق والتحقق من الملكية والتأمين غير متصلين بعد.</div>`;}
function renderOwnerRequests(){const list=ownerBookings();return `${pageHeading('طلبات العملاء','طلبات الحجز','راجع الطلبات الجديدة، وتأكد من تفاصيل الموعد والتغطية قبل القبول.')}${list.length?`<div class="booking-list">${list.map(b=>bookingRow(b)).join('')}</div>`:`<div class="panel empty-state"><b>مفيش طلبات حتى الآن</b></div>`}`;}
function renderOwnerCalendar(){const days=Array.from({length:28},(_,i)=>{const n=i+1;const b=ownerBookings().find(x=>Number(x.date.slice(-2))===n);return `<div class="calendar-cell ${b?'booked':''}"><b>${n}</b>${b?'حجز':''}</div>`}).join('');return `${pageHeading('تنظيم جدولك','التوافر والحجوزات','راجع الأيام المشغولة وحدد فترات عدم التوافر.')}
 <div class="panel"><div class="section-head" style="margin:0 0 14px"><h2 style="font-size:14px">نوفمبر 2026 — عرض توضيحي</h2><span class="status green">محجوز</span></div><div class="calendar-grid">${['أحد','إثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'].map(d=>`<div class="calendar-cell" style="min-height:auto;background:transparent"><b>${d}</b></div>`).join('')}${days}</div><div class="notice">التقويم لا يفرض الحظر على قاعدة بيانات حقيقية بعد؛ لازم ربطه بمحرك منع التداخل قبل استقبال أي حجز فعلي.</div><button class="btn btn-outline" data-action="toast" data-message="إعداد فترات عدم التوافر سيكون ضمن تكامل التقويم">إضافة فترة عدم توافر</button></div>`;}
function renderOwnerEarnings(){const items=ownerBookings();const due=items.reduce((s,b)=>s+(b.paymentMethod==='cash'&&b.status!=='cancelled'?b.commission:0),0);return `${pageHeading('حسابات الشريك','الأرباح والتسويات','تابع إجمالي الحجوزات، عمولة المنصة، وصافي المستحقات.')}
 <div class="stats-grid">${statCard('◈','عمولة مستحقة على النقد',money(due),'محسوبة تجريبيًا')}${statCard('↗','مستحقات تحت التسوية',money(1850),'قيمة توضيحية')}${statCard('▤','عدد الحجوزات',items.length,'على حساب المالك')}${statCard('✓','تسويات مكتملة','0','لا توجد حركات حقيقية')}</div>
 <div class="panel"><h3>سجل التسويات</h3><div class="table-wrap"><table><thead><tr><th>رقم التسوية</th><th>التاريخ</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>${state.settlements.filter(s=>s.ownerId==='owner1').map(s=>`<tr><td>${s.id}</td><td>${s.date}</td><td>${money(s.amount)}</td><td><span class="status orange">قيد المراجعة</span></td></tr>`).join('')||'<tr><td colspan="4">لا توجد تسويات</td></tr>'}</tbody></table></div></div><div class="notice warning">لا يوجد دفع أو تحويل أموال حقيقي داخل النسخة التجريبية. لا تعتبر الأرقام كشف حساب أو مستحقات فعلية.</div>`;}

function driverBookings(){return state.bookings.filter(b=>b.driverId==='driver1');}
function renderDriverTasks(){const list=driverBookings().filter(b=>!['completed','cancelled','declined'].includes(b.status));return `${pageHeading('مساحة السائق','مهامك اليوم','تفاصيل الخدمة وخطوات تأكيد الاستعداد والوصول وبدء الرحلة.')}${list.length?`<div class="booking-list">${list.map(b=>{const c=carById(b.carId)||{};return `<div class="panel"><div class="booking-card" style="border:0;padding:0"><div class="booking-thumb">${carArt(c.color)}</div><div class="booking-info"><b>${escapeHtml(c.brand)} ${escapeHtml(c.model)}</b><small>${b.date} · ${b.time} · ${escapeHtml(b.zone)}</small><small>العميل: ${escapeHtml(b.customerName)} · رقم ${b.id}</small><div style="margin-top:6px">${statusInfo(b.status)}</div></div></div><div class="timeline"><div class="timeline-step ${['ready','in_progress','completed'].includes(b.status)?'done':''}"><i></i>جاهز</div><div class="timeline-step ${['in_progress','completed'].includes(b.status)?'done':''}"><i></i>بدأت الخدمة</div><div class="timeline-step ${b.status==='completed'?'done':''}"><i></i>انتهت</div></div><div style="display:flex;gap:8px;flex-wrap:wrap">${b.status==='driver_assigned'?`<button class="btn btn-primary btn-small" data-action="driver-status" data-id="${b.id}" data-status="ready">تأكيد الاستعداد</button>`:''}${b.status==='ready'?`<button class="btn btn-primary btn-small" data-action="driver-status" data-id="${b.id}" data-status="in_progress">بدء الخدمة</button>`:''}${b.status==='in_progress'?`<button class="btn btn-gold btn-small" data-action="driver-status" data-id="${b.id}" data-status="completed">إنهاء الخدمة</button>`:''}<button class="btn btn-outline btn-small" data-action="booking-details" data-id="${b.id}">تفاصيل المهمة</button></div></div>`}).join('')}</div>`:`<div class="panel empty-state"><div class="empty-icon">⌖</div><b>مفيش مهام نشطة</b><p>هتظهر هنا الحجوزات المسندة ليك.</p></div>`}<div class="notice">تحديثات الحالة هنا تجريبية. لا يوجد GPS أو OTP أو إثبات وصول مرتبط بخدمة خارجية.</div>`;}
function renderDriverHistory(){const list=driverBookings().filter(b=>['completed','cancelled'].includes(b.status));return `${pageHeading('سجل العمل','الرحلات السابقة','راجع المهام المكتملة والملغاة.')}${list.length?`<div class="booking-list">${list.map(bookingRow).join('')}</div>`:`<div class="panel empty-state"><b>لا توجد رحلات سابقة</b><p>بعد انتهاء أي خدمة هتظهر هنا.</p></div>`}`;}
function renderDriverAccount(){return `${pageHeading('ملف السائق','حسابي','بيانات الحساب وحالة الاعتماد.')}
 <div class="panel" style="max-width:650px"><div class="profile-card" style="border:0;padding:0 0 16px"><div class="avatar" style="width:48px;height:48px">س</div><div><b style="font-size:14px">سائق زفّة التجريبي</b><small>ملف غير موثّق فعليًا</small></div><span class="status orange">مراجعة مطلوبة</span></div><div class="profile-grid"><div class="profile-card"><span class="profile-icon">☎</span><div><b>رقم الهاتف</b><small>غير مربوط برقم حقيقي</small></div></div><div class="profile-card"><span class="profile-icon">▣</span><div><b>رخصة القيادة</b><small>لم يتم رفع مستند</small></div></div></div><div class="notice warning">لا تستخدم هذه الواجهة لتشغيل سائق فعلي قبل التحقق من الهوية والرخصة والتأمين.</div></div>`;}

function allAdminBookings(){return [...state.bookings].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
function renderAdminOverview(){
 const cars=adminFleet.vehicles||[], owners=adminFleet.owners||[], drivers=adminFleet.drivers||[];
 const pendingCars=cars.filter(v=>v.approval_status==="pending");
 const pendingOwners=owners.filter(o=>o.onboarding_status==="pending");
 const pendingDrivers=drivers.filter(d=>d.verification_status==="pending");
 const unverifiedDocs=cars.reduce((sum,v)=>sum+Number(v.pending_documents||0),0)+drivers.reduce((sum,d)=>sum+Number(d.pending_documents||0),0);
 return `${pageHeading("لوحة الإدارة","مركز العمليات","بيانات تشغيل مباشرة من قاعدة البيانات؛ إدارة الأسطول والشركاء والتوافر من هنا.")}
 <div class="stats-grid">
  ${statCard("🚘","السيارات المسجلة",cars.length,"سجلات حقيقية")}
  ${statCard("◇","سيارات بانتظار الاعتماد",pendingCars.length,"لا تظهر للعملاء")}
  ${statCard("♙","ملفات ملاك بانتظار المراجعة",pendingOwners.length,"عقود وبيانات الشركاء")}
  ${statCard("⌖","سائقون قيد التحقق",pendingDrivers.length,"لا يتم إسنادهم قبل التوثيق")}
 </div>
 <div class="admin-grid">
  <div class="panel"><div class="section-head" style="margin:0 0 12px"><h3>إجراءات سريعة</h3></div>
   <div class="admin-quick-actions">
    <button class="btn btn-primary" data-action="add-car">+ إضافة سيارة</button>
    <button class="btn btn-outline" data-action="add-owner">+ إضافة مالك</button>
    <button class="btn btn-outline" data-action="add-driver">+ إضافة سائق</button>
    <button class="btn btn-outline" data-action="go" data-view="admin-schedule">إدارة المواعيد</button>
   </div>
   <div class="mini-list" style="margin-top:14px">
    <div class="mini-row"><div><b>سيارات تنتظر قرار الإدارة</b><small>${pendingCars.length} سجل</small></div><button class="btn btn-outline btn-small" data-action="go" data-view="admin-vehicles">فتح</button></div>
    <div class="mini-row"><div><b>مستندات بانتظار المراجعة</b><small>${unverifiedDocs} مستند</small></div><button class="btn btn-outline btn-small" data-action="go" data-view="admin-people">فتح الملفات</button></div>
    <div class="mini-row"><div><b>إجمالي المواعيد الأسبوعية</b><small>${(adminFleet.availabilityRules||[]).filter(r=>r.active).length} قاعدة إتاحة</small></div><button class="btn btn-outline btn-small" data-action="go" data-view="admin-schedule">التقويم</button></div>
   </div>
  </div>
  <div class="panel"><h3>حالة التشغيل</h3>
   <div class="mini-list">
    <div class="mini-row"><div><b>الملاك المعتمدون</b><small>${owners.filter(o=>o.onboarding_status==="approved").length} من ${owners.length}</small></div><span class="status green">قاعدة البيانات</span></div>
    <div class="mini-row"><div><b>السائقون الموثقون والنشطون</b><small>${drivers.filter(d=>d.verification_status==="verified"&&d.active&&d.is_active!==false).length} من ${drivers.length}</small></div><span class="status blue">جاهزية التشغيل</span></div>
    <div class="mini-row"><div><b>السيارات المنشورة</b><small>${cars.filter(v=>v.approval_status==="approved").length} سيارة</small></div><span class="status green">الكتالوج العام</span></div>
    <div class="mini-row"><div><b>الحجوزات</b><small>${state.bookings.length} عنصر في واجهة العرض الحالية</small></div><span class="status orange">تكامل التشغيل قيد الاستكمال</span></div>
   </div>
  </div>
 </div>
 <div class="notice">كل إضافة أو اعتماد أو تعديل في هذه اللوحة يُحفظ في Neon ويُسجل في سجل التدقيق. تصفح العملاء يعرض السيارات المعتمدة فقط.</div>`;
}
function renderAdminBookings(){
 const bookings=adminBookings||[];
 const availableDrivers=(adminFleet.drivers||[]).filter(d=>d.verification_status==="verified"&&d.active&&d.is_active!==false);
 return `${pageHeading("تشغيل الحجوزات","الحجوزات وإسناد السائقين","سجل الحجوزات الفعلي من Neon. لا يظهر السائق ضمن خيارات الإسناد إلا بعد اعتماد مستنداته وتفعيل حسابه.")}
 <div class="stats-grid">
  ${statCard("▤","إجمالي الحجوزات",bookings.length,"سجلات فعلية")}
  ${statCard("⌛","بانتظار المالك",bookings.filter(b=>b.status==="pending_owner").length,"تحتاج قرار")}
  ${statCard("🚘","تحتاج سائقًا",bookings.reduce((n,b)=>n+(b.items||[]).filter(i=>!i.driverId).length,0),"عناصر الحجز غير المسندة")}
  ${statCard("✓","مكتملة",bookings.filter(b=>b.status==="completed").length,"من سجل الحجوزات")}
 </div>
 <div class="panel">
  <div class="section-head" style="margin:0 0 12px"><div><h2>سجل الحجوزات</h2><p>تظهر هنا الحجوزات المخزنة فعليًا، وليس بيانات العرض التجريبية.</p></div><button class="btn btn-outline btn-small" data-action="reload-bookings">تحديث</button></div>
  ${adminBookingsLoading?'<div class="empty-state">جاري تحميل الحجوزات…</div>':bookings.length? `<div class="admin-booking-list">${bookings.map(b=>{
   const total=Number(b.quote_total_minor||0)/100;
   const items=Array.isArray(b.items)?b.items:[];
   const paymentLabel=b.payment_method==="cash"?"نقدي":b.payment_method==="online_deposit"?"عربون إلكتروني":"دفع إلكتروني";
   return `<article class="admin-booking-card">
    <div class="admin-booking-head">
     <div><b>${escapeHtml(b.booking_code)}</b><small>${escapeHtml(b.customer_name)} · <span dir="ltr">${escapeHtml(b.customer_phone)}</span></small></div>
     ${statusInfo(b.status)}
    </div>
    <div class="admin-booking-meta">
     <span>${escapeHtml(b.occasion||"مناسبة")}</span>
     <span>${new Date(b.scheduled_start).toLocaleString("ar-EG")}</span>
     <span>${paymentLabel}</span>
     <strong>${money(total)}</strong>
    </div>
    <div class="admin-booking-addresses">
     <div><small>الانطلاق</small><b>${escapeHtml(b.pickup_address)}</b></div>
     <div><small>الوجهة</small><b>${escapeHtml(b.destination_address)}</b></div>
    </div>
    <div class="admin-dispatch-list">
     ${items.map(item=>{
      const assigned=Boolean(item.driverId);
      const canAssign=["confirmed","driver_assigned","ready"].includes(b.status);
      return `<div class="admin-dispatch-item">
       <div class="admin-dispatch-info">
        <b>${escapeHtml(item.vehicleMake||"سيارة")} ${escapeHtml(item.vehicleModel||"")}</b>
        <small>لوحة ${escapeHtml(item.plateNumber||"—")} · المالك ${escapeHtml(item.ownerName||"—")} · ${escapeHtml(item.packageName||"")}</small>
        <small>${item.serviceStartsAt?new Date(item.serviceStartsAt).toLocaleString("ar-EG"):"—"} — ${item.serviceEndsAt?new Date(item.serviceEndsAt).toLocaleTimeString("ar-EG"):"—"}</small>
        <small>${assigned?"السائق: "+escapeHtml(item.driverName||"مُسند"):"لم يتم تعيين سائق"}</small>
       </div>
       ${canAssign?`<div class="admin-dispatch-control">
        <select data-driver-select="${item.id}" aria-label="اختيار السائق">
         <option value="">اختر سائقًا موثقًا</option>
         ${availableDrivers.map(d=>`<option value="${d.id}" ${d.id===item.driverId?"selected":""}>${escapeHtml(d.display_name)} — ${escapeHtml(d.phone_e164)}</option>`).join("")}
        </select>
        <button class="btn btn-primary btn-small" data-action="assign-driver" data-id="${item.id}">${assigned?"تغيير السائق":"إسناد السائق"}</button>
       </div>`: `<span class="status gray">الإسناد بعد تأكيد الحجز</span>`}
      </div>`;
     }).join("")||'<small>لا توجد عناصر مركبات لهذا الحجز.</small>'}
    </div>
   </article>`;
  }).join("")}</div>`:'<div class="empty-state"><div class="empty-icon">🗓️</div><b>لا توجد حجوزات فعلية حتى الآن</b><p>عندما يتم إنشاء حجز من خدمة الحجز، سيظهر هنا لتعيين السيارة والسائق ومتابعة التنفيذ.</p></div>'}
 </div>
 <div class="notice warning">إسناد السائق متاح للحجوزات المؤكدة فقط. يجب أن يكون ملف السائق موثقًا ونشطًا، ويتحقق الخادم من عدم تعارض مواعيده مع مهمة أخرى.</div>`;
}
function renderAdminVehicles(){
 const vehicles=adminFleet.vehicles||[];
 const pending=vehicles.filter(v=>v.approval_status==="pending");
 const approved=vehicles.filter(v=>v.approval_status==="approved");
 const statusLabel={draft:"مسودة",pending:"بانتظار الاعتماد",approved:"منشورة",rejected:"مرفوضة",suspended:"موقوفة"};
 return `${pageHeading("إدارة الأسطول","السيارات والنشر","أضف السيارات والأسعار والصور وجدول العمل. الاعتماد ينشر السيارة فورًا في واجهة العملاء.",'<button class="btn btn-primary" data-action="add-car">+ إضافة سيارة</button>')}
 <div class="stats-grid">
  ${statCard("🚘","كل السيارات",vehicles.length,"ملفات مركبات")}
  ${statCard("⌛","تنتظر الاعتماد",pending.length,"تحتاج قرارًا")}
  ${statCard("✓","منشورة للعملاء",approved.length,"معتمدة")}
  ${statCard("▣","مستندات بانتظار المراجعة",vehicles.reduce((n,v)=>n+Number(v.pending_documents||0),0),"ترخيص وتأمين")}
 </div>
 <div class="panel">
  <div class="section-head" style="margin:0 0 12px"><div><h2>سجل السيارات</h2><p>اللوحة والأسعار والمالك والمستندات وحالة النشر</p></div><button class="btn btn-outline btn-small" data-action="reload-fleet">تحديث البيانات</button></div>
  ${vehicles.length?`<div class="admin-vehicle-list">${vehicles.map(v=>{
   const status=v.approval_status||"draft";
   const ownerStatus=v.owner_status||"pending";
   return `<article class="admin-vehicle-card">
    <div class="admin-vehicle-main">
     <div class="admin-vehicle-image">${v.image_url?`<img src="${escapeHtml(v.image_url)}" alt="${escapeHtml(v.make)} ${escapeHtml(v.model)}" loading="lazy">`:"🚘"}</div>
     <div class="admin-vehicle-copy">
      <div class="admin-card-title"><b>${escapeHtml(v.make)} ${escapeHtml(v.model)}</b><span class="status ${status==="approved"?"green":status==="pending"?"orange":status==="rejected"?"red":"gray"}">${statusLabel[status]||status}</span></div>
      <small>موديل ${v.model_year} · لوحة ${escapeHtml(v.plate_number)} · ${v.seats} مقاعد</small>
      <small>المالك: ${escapeHtml(v.owner_name)} · ${ownerStatus==="approved"?"ملف مالك معتمد":"ملف المالك غير معتمد"}</small>
      <small>المناطق: ${escapeHtml((v.service_zones||[]).join("، "))}</small>
      <div class="admin-price-chips">${Object.entries(v.package_prices||{}).map(([k,val])=>`<span>${({mini:"ميني",classic:"كلاسيك",wedding:"زفاف",royal:"رويال"}[k]||k)}: ${money(Number(val))}</span>`).join("")}</div>
     </div>
    </div>
    <div class="admin-photo-section">
      <div class="admin-subhead"><b>صور السيارة (${(v.images||[]).length}/3)</b>${(v.images||[]).length<3?`<button class="text-link" data-action="add-vehicle-photos" data-id="${v.id}">+ رفع صور</button>`:"<small>وصلت للحد الأقصى</small>"}</div>
      <div class="admin-photo-grid">${(v.images||[]).map((photo,index)=>`<div class="admin-photo-tile">
        ${photo.approved&&photo.url?`<img src="${escapeHtml(photo.url)}" alt="صورة ${index+1}" loading="lazy">`:'<div class="photo-pending">رفع غير مكتمل</div>'}
        <div class="admin-photo-tile-meta"><span>${photo.sortOrder===0?"رئيسية":`صورة ${index+1}`}</span>
          ${photo.approved&&photo.sortOrder!==0?`<button class="text-link" data-action="vehicle-photo-primary" data-id="${v.id}" data-media-id="${photo.id}">تعيين كرئيسية</button>`:""}
          <button class="text-link danger-link" data-action="delete-vehicle-photo" data-id="${v.id}" data-media-id="${photo.id}">حذف</button>
        </div>
      </div>`).join("")||'<small>لم ترفع صور لهذه السيارة بعد.</small>'}</div>
    </div>
    <div class="admin-vehicle-docs">
      <div class="admin-subhead"><b>المستندات</b><button class="text-link" data-action="add-vehicle-doc" data-id="${v.id}">+ إضافة مستند</button></div>
      ${(v.documents||[]).length?(v.documents||[]).map(doc=>`<div class="doc-review-row"><a href="${escapeHtml(doc.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(doc.documentType)}</a><span class="status ${doc.reviewStatus==="approved"?"green":doc.reviewStatus==="rejected"?"red":"orange"}">${doc.reviewStatus==="approved"?"معتمد":doc.reviewStatus==="rejected"?"مرفوض":"قيد المراجعة"}</span>${doc.reviewStatus==="pending"?`<button class="btn btn-soft btn-small" data-action="review-document" data-kind="vehicle" data-id="${doc.id}" data-decision="approve">اعتماد</button><button class="btn btn-danger btn-small" data-action="review-document" data-kind="vehicle" data-id="${doc.id}" data-decision="reject">رفض</button>`:""}<small>${doc.expiresOn||"بدون تاريخ انتهاء"}</small></div>`).join(""):"<small>لم تتم إضافة مستندات. راجع الترخيص والتأمين ورقيًا قبل النشر.</small>"}
    </div>
    <div class="admin-vehicle-actions">
      <button class="btn btn-outline btn-small" data-action="edit-car" data-id="${v.id}">تعديل السيارة والأسعار</button>
      ${(v.images||[]).length<3?`<button class="btn btn-outline btn-small" data-action="add-vehicle-photos" data-id="${v.id}">+ إضافة صور</button>`:""}
      <button class="btn btn-outline btn-small" data-action="add-rule" data-id="${v.id}">جدول الإتاحة</button>
      ${status!=="approved"?`<button class="btn btn-primary btn-small" data-action="vehicle-decision" data-id="${v.id}" data-decision="approved">اعتماد ونشر</button>`:`<button class="btn btn-danger btn-small" data-action="vehicle-decision" data-id="${v.id}" data-decision="suspended">إيقاف النشر</button>`}
      ${status==="pending"||status==="draft"?`<button class="btn btn-danger btn-small" data-action="vehicle-decision" data-id="${v.id}" data-decision="rejected">رفض</button>`:""}
    </div>
   </article>`;
  }).join("")}</div>`:`<div class="empty-state"><div class="empty-icon">🚘</div><b>لا توجد سيارات حتى الآن</b><p>أضف أول سيارة، وحدد المالك والأسعار والصورة وجدول العمل، ثم اعتمدها للنشر.</p><button class="btn btn-primary" data-action="add-car">إضافة أول سيارة</button></div>`}
 </div>`;
}
function renderAdminPeople(){
 const owners=adminFleet.owners||[],drivers=adminFleet.drivers||[];
 return `${pageHeading("إدارة الشركاء","الملاك والسائقون","أنشئ حسابات دخول فعلية، وأضف العقود والرخص والبطاقات، ثم اعتمد الملف قبل التشغيل.",'<button class="btn btn-primary" data-action="add-owner">+ إضافة مالك</button> <button class="btn btn-outline" data-action="add-driver">+ إضافة سائق</button>')}
 <div class="stats-grid">
  ${statCard("♙","الملاك",owners.length,"حسابات مرتبطة")}
  ${statCard("✓","ملاك معتمدون",owners.filter(o=>o.onboarding_status==="approved").length,"عقود سارية")}
  ${statCard("⌖","السائقون",drivers.length,"ملفات سائقين")}
  ${statCard("▣","سائقون موثقون",drivers.filter(d=>d.verification_status==="verified"&&d.active).length,"جاهزون للإسناد")}
 </div>
 <div class="panel">
  <div class="section-head" style="margin:0 0 12px"><div><h2>الملاك والشركاء</h2><p>لا يمكن اعتماد المالك دون عقد معتمد</p></div></div>
  ${owners.length?`<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>الهاتف</th><th>النوع</th><th>السيارات</th><th>العقد</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${owners.map(o=>{
   const contract=(o.contracts||[])[0];
   return `<tr><td><b>${escapeHtml(o.display_name)}</b><br><small>${escapeHtml(o.legal_name)}</small></td><td dir="ltr">${escapeHtml(o.phone_e164)}</td><td>${({fleet_partner:"أسطول",independent_owner:"مالك مستقل",premium_partner:"شريك مميز"}[o.kind]||o.kind)}</td><td>${Number(o.vehicle_count||0)}</td><td>${contract?`<a href="${escapeHtml(contract.url)}" target="_blank" rel="noopener noreferrer">فتح العقد</a><br><span class="status ${contract.status==="approved"?"green":"orange"}">${contract.status==="approved"?"معتمد":contract.status==="rejected"?"مرفوض":"قيد المراجعة"}</span>${contract.status==="pending"?`<button class="btn btn-soft btn-small" data-action="review-document" data-kind="owner" data-id="${contract.id}" data-decision="approve">اعتماد العقد</button><button class="btn btn-danger btn-small" data-action="review-document" data-kind="owner" data-id="${contract.id}" data-decision="reject">رفض</button>`:""}`:'<small>لا يوجد عقد</small>'}</td><td><span class="status ${o.onboarding_status==="approved"?"green":o.onboarding_status==="rejected"?"red":"orange"}">${o.onboarding_status==="approved"?"معتمد":o.onboarding_status==="rejected"?"مرفوض":o.onboarding_status==="suspended"?"موقوف":"بانتظار المراجعة"}</span></td><td>${o.onboarding_status==="approved"?`<button class="btn btn-danger btn-small" data-action="person-status" data-kind="owner" data-id="${o.id}" data-status="suspended">إيقاف</button>`:`<button class="btn btn-primary btn-small" data-action="person-status" data-kind="owner" data-id="${o.id}" data-status="approved">اعتماد المالك</button>`} <button class="btn btn-outline btn-small" data-action="add-owner-contract" data-id="${o.id}">إضافة عقد</button></td></tr>`;
  }).join("")}</tbody></table></div>`:`<div class="empty-state"><b>لم تتم إضافة ملاك</b><p>أنشئ حساب المالك ورقم الهاتف والعقد، ثم اعتمد ملفه.</p><button class="btn btn-primary" data-action="add-owner">إضافة أول مالك</button></div>`}
 </div>
 <div class="panel" style="margin-top:14px">
  <div class="section-head" style="margin:0 0 12px"><div><h2>السائقون</h2><p>اعتماد السائق يتطلب رخصة قيادة وبطاقة شخصية ساريتين ومعتمدتين</p></div></div>
  ${drivers.length?`<div class="table-wrap"><table><thead><tr><th>السائق</th><th>الهاتف</th><th>المستندات</th><th>حالة التحقق</th><th>النشاط</th><th>الإجراء</th></tr></thead><tbody>${drivers.map(d=>`<tr><td><b>${escapeHtml(d.display_name)}</b></td><td dir="ltr">${escapeHtml(d.phone_e164)}</td><td>${(d.documents||[]).map(doc=>`<div class="doc-review-row"><a href="${escapeHtml(doc.url)}" target="_blank" rel="noopener noreferrer">${doc.documentType==="driving_license"?"رخصة قيادة":doc.documentType==="national_id"?"بطاقة شخصية":escapeHtml(doc.documentType)}</a><span class="status ${doc.reviewStatus==="approved"?"green":doc.reviewStatus==="rejected"?"red":"orange"}">${doc.reviewStatus==="approved"?"معتمد":doc.reviewStatus==="rejected"?"مرفوض":"معلق"}</span>${doc.reviewStatus==="pending"?`<button class="btn btn-soft btn-small" data-action="review-document" data-kind="driver" data-id="${doc.id}" data-decision="approve">اعتماد</button><button class="btn btn-danger btn-small" data-action="review-document" data-kind="driver" data-id="${doc.id}" data-decision="reject">رفض</button>`:""}</div>`).join("")||"<small>لم ترفع مستندات</small>"}<button class="text-link" data-action="add-driver-doc" data-id="${d.id}">+ مستند</button></td><td><span class="status ${d.verification_status==="verified"?"green":d.verification_status==="rejected"?"red":"orange"}">${d.verification_status==="verified"?"موثق":d.verification_status==="rejected"?"مرفوض":"بانتظار التحقق"}</span></td><td>${d.active&&d.is_active!==false?'<span class="status green">نشط</span>':'<span class="status gray">موقوف</span>'}</td><td>${d.verification_status==="verified"&&d.active?`<button class="btn btn-danger btn-small" data-action="person-status" data-kind="driver" data-id="${d.id}" data-status="suspended" data-active="false">إيقاف</button>`:`<button class="btn btn-primary btn-small" data-action="person-status" data-kind="driver" data-id="${d.id}" data-status="verified" data-active="true">اعتماد السائق</button>`}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty-state"><b>لا يوجد سائقون</b><p>أضف السائق وبيانات الدخول ومستنداته.</p><button class="btn btn-primary" data-action="add-driver">إضافة أول سائق</button></div>`}
 </div>`;
}
function renderAdminSchedule(){
 const rules=adminFleet.availabilityRules||[],blocks=adminFleet.availabilityBlocks||[],vehicles=adminFleet.vehicles||[];
 const days=["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
 return `${pageHeading("تنظيم التشغيل","المواعيد والتوافر","حدد أيام وساعات عمل كل سيارة، واحظر فترات الصيانة أو الإجازات.",'<button class="btn btn-primary" data-action="add-rule">+ قاعدة إتاحة</button> <button class="btn btn-outline" data-action="add-block">حظر موعد</button>')}
 <div class="panel">
  <div class="section-head" style="margin:0 0 12px"><div><h2>جداول العمل الأسبوعية</h2><p>${rules.length} قاعدة إتاحة محفوظة بتوقيت القاهرة</p></div></div>
  ${rules.length?`<div class="table-wrap"><table><thead><tr><th>السيارة</th><th>اليوم</th><th>من</th><th>إلى</th><th>فترة الصلاحية</th><th></th></tr></thead><tbody>${rules.map(r=>`<tr><td>${escapeHtml(r.make)} ${escapeHtml(r.model)}<br><small>${escapeHtml(r.plate_number)}</small></td><td>${days[Number(r.weekday)]||r.weekday}</td><td dir="ltr">${String(r.start_time).slice(0,5)}</td><td dir="ltr">${String(r.end_time).slice(0,5)}</td><td>${r.valid_from||"من الآن"} — ${r.valid_to||"مفتوح"}</td><td><button class="btn btn-danger btn-small" data-action="delete-availability" data-kind="rule" data-id="${r.id}">حذف</button></td></tr>`).join("")}</tbody></table></div>`:'<div class="empty-state"><b>لم يتم تحديد ساعات إتاحة</b><p>أضف جدول العمل الأسبوعي للسيارات المعتمدة.</p></div>'}
 </div>
 <div class="panel" style="margin-top:14px">
  <div class="section-head" style="margin:0 0 12px"><div><h2>فترات الحظر والصيانة</h2><p>${blocks.length} فترة مستقبلية مسجلة. قاعدة البيانات تمنع تداخل الحظر لنفس السيارة.</p></div></div>
  ${blocks.length?`<div class="table-wrap"><table><thead><tr><th>السيارة</th><th>بداية الحظر</th><th>نهاية الحظر</th><th>السبب</th><th></th></tr></thead><tbody>${blocks.map(b=>`<tr><td>${escapeHtml(b.make)} ${escapeHtml(b.model)}<br><small>${escapeHtml(b.plate_number)}</small></td><td>${new Date(b.starts_at).toLocaleString("ar-EG")}</td><td>${new Date(b.ends_at).toLocaleString("ar-EG")}</td><td>${escapeHtml(b.reason)}</td><td><button class="btn btn-danger btn-small" data-action="delete-availability" data-kind="block" data-id="${b.id}">إلغاء الحظر</button></td></tr>`).join("")}</tbody></table></div>`:'<div class="empty-state"><b>لا توجد فترات حظر</b><p>استخدم حظر موعد عند صيانة السيارة أو عدم توفرها.</p></div>'}
 </div>
 ${!vehicles.length?'<div class="notice warning">أضف سيارة أولًا حتى تتمكن من إدارة مواعيدها.</div>':""}`;
}
function renderAdminFinance(){const total=state.bookings.reduce((s,b)=>s+b.total,0);const fees=state.bookings.reduce((s,b)=>s+b.commission,0);return `${pageHeading('الرقابة المالية','المدفوعات والتسويات','افصل قيمة الحجز عن عمولة المنصة ومستحقات مقدم الخدمة.')}
 <div class="stats-grid">${statCard('▤','إجمالي قيمة الحجوزات',money(total),'قيمة التعاملات وليست إيراد زفّة')}${statCard('◈','عمولة تقديرية',money(fees),'افتراض تجريبي فقط')}${statCard('↗','مدفوعات إلكترونية','0','لا يوجد PSP متصل')}${statCard('⌛','تسويات معلقة',state.settlements.length,'سجلات توضيحية')}</div>
 <div class="panel"><h3>حركات حجوزات تجريبية</h3><div class="table-wrap"><table><thead><tr><th>الحجز</th><th>طريقة الدفع</th><th>حالة التحصيل</th><th>قيمة الحجز</th><th>العمولة الافتراضية</th></tr></thead><tbody>${allAdminBookings().map(b=>`<tr><td>${b.id}</td><td>${b.paymentMethod==='cash'?'نقدي':b.paymentMethod==='deposit'?'عربون إلكتروني':'دفع إلكتروني كامل'}</td><td>${b.paymentState==='deposit_due'?'<span class="status orange">عربون مستحق</span>':b.paymentState==='cash_due'?'<span class="status gray">نقدي عند الخدمة</span>':b.paymentState==='paid_simulated'?'<span class="status blue">مدفوع محاكاة</span>':'<span class="status orange">غير محصل</span>'}</td><td>${money(b.total)}</td><td>${money(b.commission)}</td></tr>`).join('')}</tbody></table></div></div><div class="notice warning">لا يتم تحصيل أو تحويل أي أموال في هذا النظام التجريبي. نسبة العمولة 12% مستخدمة فقط كافتراض توضيحي وليست نسبة تعاقدية معتمدة.</div>`;}
function renderAdminReports(){const all=state.bookings;const completion=all.filter(b=>b.status==='completed').length;return `${pageHeading('قراءة الأداء','التقارير والمؤشرات','مؤشرات أولية لتجربة النموذج، وليست بيانات تشغيل فعلية.')}
 <div class="stats-grid">${statCard('✓','معدل الإكمال',`${all.length?Math.round(completion/all.length*100):0}%`,'من حجوزات النموذج')}${statCard('⌛','طلبات بانتظار المالك',all.filter(b=>b.status==='pending_owner').length,'مؤشر زمن الاستجابة')}${statCard('↗','متوسط قيمة الحجز',money(all.length?all.reduce((s,b)=>s+b.total,0)/all.length:0),'متوسط عينة صغيرة')}${statCard('◇','السيارات المعتمدة',state.cars.filter(c=>c.approval==='approved').length,'في بيانات العرض')}</div><div class="panel"><h3>أولويات القياس قبل الإطلاق</h3><div class="mini-list"><div class="mini-row"><div><b>Booking Conversion</b><small>من مشاهدة السيارة حتى تأكيد الحجز</small></div></div><div class="mini-row"><div><b>Fulfillment Rate</b><small>نسبة الحجوزات التي نُفذت بالكامل</small></div></div><div class="mini-row"><div><b>On-time Rate</b><small>الالتزام بموعد الوصول</small></div></div><div class="mini-row"><div><b>Contribution Margin</b><small>هامش المساهمة بعد تكاليف التشغيل والدفع</small></div></div></div></div>`;}

function go(view){state.view=view;persist();render();window.scrollTo({top:0,behavior:'smooth'});}
const authClient = createAuthClient("https://ep-tiny-mud-becp4j1y.neonauth.c-9.us-east-2.aws.neon.tech/neondb/auth");
let authMode="signin",authSession=null,currentProfile=null,pendingBookingCarId=null;
let paymentSettings={methods:{instapay:{enabled:false,recipient:null,displayName:null},cash:{enabled:true}},depositPercent:30};
async function getAuthToken(sessionJwt=null){
 return getAuthBearerToken(authClient, sessionJwt);
}
function adminErrorMessage(error){
 const code=String(error?.code||error?.message||"");
 const messages={
  ADMIN_FLEET_LOAD_FAILED:"تعذر تحميل بيانات الإدارة. حدّث الصفحة وحاول مرة أخرى.",
  FORBIDDEN:"هذا الإجراء متاح لحساب الإدارة فقط.",
  AUTH_REQUIRED:"انتهت جلسة الإدارة. سجّل الدخول مرة أخرى.",
  INVALID_EGYPTIAN_PHONE:"رقم الموبايل المصري غير صحيح.",
  PHONE_ALREADY_LINKED:"رقم الهاتف مرتبط بحساب آخر بالفعل.",
  AUTH_PHONE_IDENTITY_MISMATCH:"رقم الحساب لا يطابق رقم الهاتف الذي أدخلته.",
  PROFILE_IDENTITY_CONFLICT:"يوجد تعارض بين ملف الهاتف وحساب الدخول؛ لم يتم ربطهما حفاظًا على الحسابات الحالية.",
  OWNER_NOT_FOUND:"المالك المحدد غير موجود.",
  OWNER_NOT_APPROVED:"يجب اعتماد ملف المالك قبل نشر السيارة.",
  OWNER_CONTRACT_REQUIRED:"أضف عقد المالك وراجعه واعتمده قبل تفعيل الحساب.",
  DRIVER_DOCUMENTS_REQUIRED:"لا يمكن اعتماد السائق قبل مراجعة رخصة القيادة والبطاقة الشخصية.",
  DRIVER_NOT_VERIFIED_OR_INACTIVE:"السائق غير موثق أو غير نشط.",
  VEHICLE_PHOTO_REQUIRED:"أضف صورة واحدة على الأقل للسيارة قبل نشرها.",
  INVALID_PHOTO_COUNT:"اختر من صورة واحدة إلى 3 صور فقط.",
  INVALID_VEHICLE_PHOTO_FILE:"الصور المسموحة JPG أو PNG أو WEBP، وبحد أقصى 5 ميجابايت للصورة.",
  VEHICLE_PHOTO_LIMIT_REACHED:"وصلت السيارة إلى الحد الأقصى وهو 3 صور.",
  INVALID_UPLOADED_VEHICLE_PHOTO:"تعذر التحقق من الصورة المرفوعة. اختر صورة سليمة وحاول مرة أخرى.",
  VEHICLE_PHOTO_NOT_FOUND:"الصورة غير موجودة أو سبق حذفها.",
  INVALID_MEDIA_ID:"معرّف الصورة غير صحيح.",
  INVALID_PHOTO_COMPLETION:"تعذر إكمال رفع الصور.",
  INVALID_PHOTO_CANCELLATION:"تعذر إلغاء رفع الصور. حدّث بيانات السيارة وحاول مرة أخرى.",
  VEHICLE_DOCUMENTS_PENDING:"هناك مستندات سيارة لم تتم مراجعتها بعد.",
  VEHICLE_LICENSE_AND_INSURANCE_REQUIRED:"يجب إضافة ترخيص المركبة ووثيقة التأمين واعتمادهما قبل النشر.",
  DUPLICATE_PLATE_NUMBER:"رقم اللوحة مسجل لسيارة أخرى.",
  DRIVER_SCHEDULE_CONFLICT:"السائق لديه مهمة أخرى تتعارض مع هذا الموعد.",
  AVAILABILITY_CONFLICT:"الفترة تتعارض مع فترة حظر أو موعد موجود.",
  OWNER_NOT_FOUND:"المالك المحدد غير موجود.",
  INVALID_TIME_RANGE:"وقت البداية يجب أن يسبق وقت النهاية.",
  AUTH_USER_NOT_FOUND:"حساب الدخول غير موجود في خدمة المصادقة."
 };
 return messages[code]||String(error?.message||"حدث خطأ غير متوقع. راجع البيانات وحاول مرة أخرى.");
}
async function adminApiRequest(path,method="GET",body=null){
 const token=await getAuthToken();
 if(!token)throw new Error("AUTH_REQUIRED");
 const response=await fetch(path,{
  method,
  headers:{"Authorization":`Bearer ${token}`,"Accept":"application/json","Content-Type":"application/json"},
  body:body===null?undefined:JSON.stringify(body),
  cache:"no-store"
 });
 let data={};
 try{data=await response.json();}catch{}
 if(!response.ok||data.ok!==true){
  const error=new Error(data.code||"ADMIN_REQUEST_FAILED");
  error.code=data.code||"ADMIN_REQUEST_FAILED";
  error.status=response.status;
  throw error;
 }
 return data;
}
async function loadAdminFleet(){
 if(state.role!=="admin")return adminFleet;
 adminFleetLoading=true;
 try{
  const data=await adminApiRequest("/api/v1/admin/fleet");
  adminFleet={
   owners:data.owners||[],drivers:data.drivers||[],vehicles:data.vehicles||[],
   availabilityRules:data.availabilityRules||[],availabilityBlocks:data.availabilityBlocks||[],
   packages:data.packages||[]
  };
  if(state.role==="admin"&&String(state.view).startsWith("admin-"))render();
  return adminFleet;
 }finally{adminFleetLoading=false;}
}
async function loadAdminBookings(){
 if(state.role!=="admin")return adminBookings;
 adminBookingsLoading=true;
 try{
  const data=await adminApiRequest("/api/v1/admin/bookings");
  adminBookings=data.bookings||[];
  if(state.role==="admin"&&(state.view==="admin-bookings"||state.view==="admin-overview"))render();
  return adminBookings;
 }finally{adminBookingsLoading=false;}
}
function roleForProfile(p){const r=p?.roles||[];if(r.includes("admin")||r.includes("finance_admin")||r.includes("operations_admin"))return "admin";if(r.includes("owner"))return "owner";if(r.includes("driver"))return "driver";return "customer";}
function applyProfile(p){
 currentProfile=p;state.role=roleForProfile(p);state.view=roleConfig[state.role].default;updateAccountButton();render();
 if(state.role==="admin"){
  Promise.all([loadAdminFleet(),loadAdminBookings()]).catch(e=>toast(adminErrorMessage(e)));
 }
}
function normalizeCustomerPhone(value){
 const raw=String(value||"").replace(/\D/g,"");
 let digits=raw;
 if(digits.startsWith("00"))digits=digits.slice(2);
 if(digits.startsWith("20")){}
 else if(digits.startsWith("0"))digits="2"+digits;
 else digits="20"+digits;
 return /^201[0125]\d{8}$/.test(digits)?"+"+digits:null;
}
function internalAuthEmail(phone){
 const digits=String(phone||"").replace(/\D/g,"");
 return digits+"@phone.zaffa.invalid";
}
function updateAccountButton(){const b=document.querySelector("#account-button");if(b)b.textContent=currentProfile?.displayName||authSession?.user?.name||(authSession?.user?"حسابي":"تسجيل الدخول");}
function openAuthModal(mode="signin"){
 authMode=mode==="signup"?"signup":"signin";
 const signup=authMode==="signup";
 const signupFields=signup?'<div class="field"><label>اسمك الجميل</label><input name="name" required minlength="2" maxlength="80" autocomplete="name" placeholder="اكتب اسمك بالكامل"></div>':"";
 const note=pendingBookingCarId
  ? "سجّل دخولك علشان نكمل طلب الحجز. باقي زفّة مفتوح للتصفح من غير حساب."
  : "اتفرّج على زفّة براحتك. الحساب مطلوب بس لما تقرر تبدأ الحجز.";
 const body=`<div class="auth-welcome"><span class="auth-welcome-icon">${signup?'🌷':'💗'}</span><div><b>${signup?'أهلاً بيك في زفّة':'نورت زفّة'}</b><small>${signup?'خلّينا نعرفك ونجهّز حسابك':'ادخل لحسابك وكمل رحلتك معانا'}</small></div></div>
 <form id="auth-form">
  ${signupFields}
  <div class="field" style="margin-top:12px"><label>رقم الموبايل المصري</label><input name="phone" type="tel" required inputmode="tel" autocomplete="tel" placeholder="01012345678" dir="ltr"></div>
  <div class="field" style="margin-top:12px"><label>كلمة المرور</label><input name="password" type="password" required minlength="8" autocomplete="${signup?"new-password":"current-password"}" placeholder="اكتب كلمة المرور" dir="ltr"></div>
  <div class="auth-note"><span>✨</span> ${note}</div>
  <div id="auth-error" class="auth-message" role="alert" aria-live="polite" hidden></div>
  <button type="button" class="text-link" data-action="auth-mode" data-mode="${signup?"signin":"signup"}">${signup?"عندك حساب؟ سجّل دخولك":"أول مرة معانا؟ إنشاء حساب جديد"}</button>
 </form>`;
 openModal(signup?"إنشاء حساب جديد":"تسجيل الدخول",body,`<button class="btn btn-outline" data-action="close-modal">إلغاء</button><button id="auth-submit-button" class="btn btn-primary" data-action="auth-submit">${signup?"إنشاء حسابي":"دخول إلى حسابي"} <span>←</span></button>`);
 document.querySelectorAll("#auth-form input").forEach(input=>input.addEventListener("input",()=>showAuthError("")));
}
function showAuthError(message){
 const box=document.querySelector("#auth-error");if(!box)return;
 box.textContent=message||"";box.hidden=!message;
}
function friendlyAuthError(error,stage="sign-in"){
 const status=Number(error?.status||error?.statusCode||error?.response?.status||0);
 const code=String(error?.code||error?.body?.code||"").toLowerCase();
 const raw=String(error?.message||"");
 if(status===404||/http 404/i.test(raw)){
  if(stage==="token")return "خدمة استخراج رمز الأمان لم تستجب على المسار الصحيح. حسابك موجود ولم يتم حذفه؛ جرّب مرة أخرى بعد تحديث الصفحة.";
  if(stage==="profile")return "تمت المصادقة، لكن ملف العميل غير متاح على الخادم حاليًا. حسابك لم يُحذف؛ هنراجع ربط الملف.";
  return "مسار تسجيل الدخول غير متاح على الخدمة. هنراجع الإعدادات، ومش محتاج تنشئ حسابًا جديدًا.";
 }
 if(status===401||/bad_credentials|invalid_email_or_password|invalid password/i.test(code+" "+raw)){
  if(stage==="sign-in")return "رقم الموبايل أو كلمة المرور غير صحيحة. راجع البيانات وحاول تاني.";
  if(stage==="token")return "لم تتوفر جلسة أمان صالحة بعد تسجيل الدخول. أعد المحاولة، وحسابك سيظل محفوظًا.";
  return "تم التحقق من بيانات الدخول، لكن خادم ملف العميل رفض الجلسة. حسابك محفوظ ولم يتم حذفه.";
 }
 if(/user already exists|already exists|user_already_exists|email_already_exists/i.test(code+" "+raw))return "رقم الموبايل مسجل بالفعل. اختار تسجيل الدخول بدل إنشاء حساب جديد.";
 return "ما قدرناش نسجّل دخولك دلوقتي. راجع الاتصال وحاول تاني.";
}

async function submitAuth(){
 const f=document.querySelector("#auth-form");if(!f?.reportValidity())return;const d=new FormData(f);
 const phone=normalizeCustomerPhone(d.get("phone"));
 if(!phone){showAuthError("اكتب رقم موبايل مصري صحيح يبدأ بـ 010 أو 011 أو 012 أو 015.");return;}
 const authEmail=internalAuthEmail(phone);
 const password=String(d.get("password")||"");
 const signupDetails=authMode==="signup"?{displayName:String(d.get("name")||"").trim(),phone}:null;
 const submit=document.querySelector("#auth-submit-button");
 let stage="sign-in";
 if(submit){submit.disabled=true;submit.textContent="جاري التحقق…";}
 showAuthError("");
 try{
  const r=authMode==="signup"
   ?await authClient.signUp.email({name:signupDetails.displayName,email:authEmail,password})
   :await authClient.signIn.email({email:authEmail,password});
  if(r?.error)throw r.error;
  const authData=r?.data||null;
  if(authData?.user)authSession={user:authData.user,session:null};
  stage="token";
  // Neon Auth injects the signed JWT into session.token via set-auth-jwt.
  const jwtFromSignIn=authData?.session?.token||null;
  const jwtToken=await getAuthToken(jwtFromSignIn);
  if(!jwtToken){
   if(authMode==="signup"){toast("الحساب اتعمل. سجّل الدخول بنفس رقم الموبايل وكلمة المرور.");openAuthModal("signin");return;}
   throw new Error("AUTH_TOKEN_UNAVAILABLE");
  }
  if(!authSession?.user)authSession={user:{name:signupDetails?.displayName||""},session:null};
  stage="profile";
  await loadProfile(signupDetails,jwtToken);
 }catch(e){
  showAuthError(friendlyAuthError(e,stage));
 }finally{
  const button=document.querySelector("#auth-submit-button");
  if(button){button.disabled=false;button.textContent=authMode==="signup"?"إنشاء حسابي":"دخول إلى حسابي";}
 }
}

async function loadProfile(signupDetails=null,tokenOverride=null){
 const token=tokenOverride||await getAuthToken();if(!token)throw new Error("AUTH_TOKEN_UNAVAILABLE");
 const r=await fetch("/api/v1/profile",{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});const j=await r.json();
 if(!r.ok||j.ok!==true){const error=new Error(j.code||`PROFILE_HTTP_${r.status}`);error.status=r.status;error.code=j.code||"PROFILE_LOAD_FAILED";throw error;}
 if(j.profile){completeAuthentication(j.profile);return;}
 if(!signupDetails){openProfileModal();return;}
 const created=await fetch("/api/v1/profile",{
  method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
  body:JSON.stringify(signupDetails)
 });
 const saved=await created.json();
 if(!created.ok||saved.ok!==true){const error=new Error(saved.code||`PROFILE_HTTP_${created.status}`);error.status=created.status;error.code=saved.code||"PROFILE_SAVE_FAILED";throw error;}
 completeAuthentication(saved.profile);
}
function completeAuthentication(profile){
 const bookingCarId=pendingBookingCarId;
 pendingBookingCarId=null;
 applyProfile(profile);
 closeModal();
 if(bookingCarId)showBookingUnavailable(bookingCarId);
 else toast("تم تسجيل الدخول بنجاح.",true);
}
function openProfileModal(){
 const body=`<form id="profile-form"><div class="notice">أكمل بيانات التواصل مرة واحدة حتى نربط حسابك بطلباتك.</div>
 <div class="field" style="margin-top:10px"><label>الاسم بالكامل</label><input name="displayName" required minlength="2" maxlength="80" value="${escapeHtml(authSession?.user?.name||"")}" autocomplete="name"></div>
 <div class="field" style="margin-top:10px"><label>رقم الموبايل المصري</label><input name="phone" type="tel" required placeholder="01012345678" autocomplete="tel"></div></form>`;
 openModal("بيانات حسابك",body,`<button class="btn btn-outline" data-action="sign-out">تسجيل الخروج</button><button class="btn btn-primary" data-action="profile-submit">حفظ البيانات</button>`);
}
async function submitProfile(){
 const f=document.querySelector("#profile-form");if(!f?.reportValidity())return;const d=new FormData(f);
 try{
  const token=await getAuthToken();const r=await fetch("/api/v1/profile",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({displayName:d.get("displayName"),phone:d.get("phone")})});const j=await r.json();if(!r.ok||j.ok!==true)throw new Error(j.code||"PROFILE_SAVE_FAILED");completeAuthentication(j.profile);}
 catch(e){toast(e?.message==="PHONE_ALREADY_LINKED"?"رقم الهاتف مرتبط بحساب آخر.":e?.message||"تعذر حفظ البيانات.");}
}
async function restoreAuthSession(){
 try{
  const token=await getAuthToken();
  if(!token){authSession=null;currentProfile=null;updateAccountButton();return;}
  authSession={user:{name:""},session:null};
  await loadProfile(null,token);
 }catch{
  authSession=null;currentProfile=null;updateAccountButton();
 }
}
async function signOut(){try{await authClient.signOut();}catch{}authSession=null;currentProfile=null;state.role="customer";state.view="home";render();updateAccountButton();closeModal(true);toast("تم تسجيل الخروج.",true);}

function toast(message,good=false){const root=document.querySelector('#toast-root');const el=document.createElement('div');el.className=`toast ${good?'good':''}`;el.textContent=message;root.append(el);setTimeout(()=>el.remove(),3200);}
function openModal(title,body,footer=''){document.querySelector('#modal-root').innerHTML=`<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><header class="modal-header"><h2>${title}</h2><button class="modal-close" data-action="close-modal" aria-label="إغلاق">×</button></header><div class="modal-body">${body}</div>${footer?`<footer class="modal-footer">${footer}</footer>`:''}</section></div>`;}
function closeModal(clearBookingIntent=false){
 document.querySelector("#modal-root").innerHTML="";
 bookingDraft=null;
 if(clearBookingIntent)pendingBookingCarId=null;
}
function showBookingUnavailable(id){
 const car=carById(id);
 const name=car?`${escapeHtml(car.brand)} ${escapeHtml(car.model)}`:"السيارة المختارة";
 const body=`<div class="notice warning">الحجز الإلكتروني لم يُفتح بعد. فريق زفّة يستكمل حاليًا نظام تأكيد المواعيد والتوافر.</div>
 <p style="line-height:1.9;color:var(--ink)">تم تسجيل دخولك بنجاح. ${name} ستظهر لك ضمن السيارات المتاحة عندما يبدأ استقبال الحجوزات الفعلية.</p>
 <p style="line-height:1.9;color:var(--muted)">لن نطلب منك تحويل عربون أو نؤكد موعدًا قبل تشغيل نظام الحجز والتحقق من توافر السيارة.</p>`;
 openModal("الحجز الإلكتروني قريبًا",body,`<button class="btn btn-primary" data-action="close-modal">متابعة التصفح</button>`);
}
function carDetails(id){
 const c=carById(id);if(!c)return;activeCarId=id;
 const photos=(c.images||[]).map(item=>item.url||item).filter(Boolean).slice(0,3);
 if(!photos.length&&c.imageUrl)photos.push(c.imageUrl);
 const gallery=photos.length
  ? `<div class="customer-car-gallery">${photos.map((url,index)=>`<img src="${escapeHtml(url)}" alt="${escapeHtml(c.brand)} ${escapeHtml(c.model)} — صورة ${index+1}" loading="lazy">`).join("")}</div>`
  : `<div class="car-art ${escapeHtml(c.color)}" style="height:180px;border-radius:13px">${carArt(c.color)}<span class="car-badge">✓ سيارة معتمدة</span></div>`;
 const body=`${gallery}<div class="car-title-row" style="margin-top:15px"><div><h3 style="font-size:18px">${escapeHtml(c.brand)} ${escapeHtml(c.model)}</h3><div class="car-sub">${c.year} · ${escapeHtml(c.zone)}</div></div><span class="rating">★ ${c.rating.toFixed(1)} (${c.reviews})</span></div><div class="car-meta"><span>♙ ${c.seats} أفراد</span><span>⚙ ${escapeHtml(c.transmission)}</span><span>✓ بسائق</span><span>${c.ownerType==='fleet'?'أسطول زفّة':'مالك مستقل موثّق'}</span></div><h3 style="margin:12px 0 8px">مميزات السيارة</h3><div class="filter-row">${c.features.map(f=>`<span class="filter-chip">${escapeHtml(f)}</span>`).join('')}</div><div class="summary-box"><div class="summary-line"><span>باقة كلاسيك — 3 ساعات</span><b>${money(c.packagePrices.classic)}</b></div><div class="summary-line"><span>الخدمة</span><b>سيارة بسائق</b></div><div class="summary-line"><span>نطاق التغطية</span><b>${escapeHtml(c.zone)}</b></div></div>${c.ownerType==='independent'?'<div class="notice">الحجز يتطلب موافقة المالك قبل التأكيد النهائي.</div>':''}`;
 openModal('تفاصيل السيارة',body,`<button class="btn btn-outline" data-action="close-modal">إغلاق</button><button class="btn btn-primary" data-action="book" data-id="${c.id}">اختار الباقة واحجز</button>`);
}
function openBooking(id){
 const car=carById(id);if(!car)return;
 if(!authSession?.user){pendingBookingCarId=id;openAuthModal("signin");return;}
 if(!currentProfile){pendingBookingCarId=id;openProfileModal();return;}
 showBookingUnavailable(id);
}

function updateBookingStatus(id,status){const b=bookingById(id);if(!b)return;try{assertBookingTransition(b.status,status);}catch{return toast('لا يمكن تنفيذ انتقال الحالة ده وفق دورة الحجز');}b.status=status;if(status==='completed')b.completedAt=new Date().toISOString();persist();render();toast('تم تحديث حالة الحجز في البيانات التجريبية',true);}
function bookingDetails(id){const b=bookingById(id);if(!b)return;const c=carById(b.carId)||{};let actions='';if(state.role==='owner'&&b.ownerId==='owner1'&&b.status==='pending_owner'){actions=`<button class="btn btn-danger" data-action="owner-decline" data-id="${b.id}">رفض الطلب</button><button class="btn btn-primary" data-action="owner-accept" data-id="${b.id}">قبول الطلب</button>`}else if(state.role==='customer'&&b.status==='awaiting_payment'){actions=`<span class="status orange">بانتظار مراجعة الدفع</span>`}else if(state.role==='admin'&&b.status==='confirmed'){actions=`<button class="btn btn-primary" data-action="assign-driver" data-id="${b.id}">إسناد السائق التجريبي</button>`}
 const body=`<div class="profile-grid"><div class="profile-card"><div class="profile-icon">▤</div><div><b>رقم الحجز</b><small>${b.id}</small></div></div><div class="profile-card"><div class="profile-icon">◷</div><div><b>حالة الحجز</b><small>${statusInfo(b.status)}</small></div></div></div><div class="summary-box"><div class="summary-line"><span>السيارة</span><b>${escapeHtml(c.brand||'')} ${escapeHtml(c.model||'')}</b></div><div class="summary-line"><span>العميل</span><b>${escapeHtml(b.customerName)}</b></div><div class="summary-line"><span>الموعد</span><b>${escapeHtml(b.date)} — ${escapeHtml(b.time)}</b></div><div class="summary-line"><span>مكان التجمع</span><b>${escapeHtml(b.zone)}</b></div><div class="summary-line"><span>الوجهة</span><b>${escapeHtml(b.destination)}</b></div><div class="summary-line"><span>الباقة</span><b>${escapeHtml(b.packageLabel)} · ${b.hours} ساعات</b></div><div class="summary-line"><span>الإضافات</span><b>${escapeHtml((b.addons||[]).join('، ')||'لا يوجد')}</b></div><div class="summary-line"><span>طريقة الدفع</span><b>${b.paymentMethod==='cash'?'نقدًا':b.paymentMethod==='deposit'?'عربون إلكتروني':'إلكتروني كامل'}</b></div><div class="summary-line"><span>المطلوب الآن</span><b>${b.paymentMethod==='cash'?'حسب السياسة':money(b.paymentDueNow??(b.paymentMethod==='full'?b.total:Math.ceil(b.total*.3)))}</b></div><div class="summary-line total"><span>الإجمالي</span><b>${money(b.total)}</b></div></div>${b.notes?`<div class="notice">ملاحظات: ${escapeHtml(b.notes)}</div>`:''}<div class="notice warning">بيانات الحجز وسير العمل هنا تجريبية ومحفوظة في متصفحك فقط. لا تستخدمها كإثبات حجز.</div>`;
 openModal(`تفاصيل الحجز ${b.id}`,body,`${actions}<button class="btn btn-outline" data-action="close-modal">إغلاق</button>`);
}
function ownerAccept(id){const b=bookingById(id);if(!b)return;const next='awaiting_payment';try{assertBookingTransition(b.status,next);}catch{return toast('حالة الطلب لا تسمح بالقبول');}b.status=next;persist();closeModal();render();toast(b.status==='confirmed'?'تم قبول الطلب — لم يتم تعيين سائق بعد':'تم قبول الطلب — ينتظر استكمال الدفع التجريبي',true);}
function simulatePayment(id){const b=bookingById(id);if(!b)return;try{assertBookingTransition(b.status,'confirmed');}catch{return toast('لا يمكن تأكيد الدفع لهذه الحالة');}b.paymentState='paid_simulated';b.status='confirmed';persist();closeModal();render();toast('تم تحديث حالة الدفع كمحاكاة فقط — لا توجد معاملة مالية',true);}
async function assignDriverToBooking(bookingItemId){
 const select=[...document.querySelectorAll("[data-driver-select]")].find(node=>node.dataset.driverSelect===bookingItemId);
 const driverId=select?.value||"";
 if(!driverId)return toast("اختر سائقًا موثقًا أولًا");
 try{
  await adminApiRequest("/api/v1/admin/assign-driver","POST",{bookingItemId,driverId});
  await Promise.all([loadAdminBookings(),loadAdminFleet()]);
  render();
  toast("تم إسناد السائق إلى المهمة",true);
 }catch(error){toast(adminErrorMessage(error));}
}
function addCar(){
 const ownerOptions=(adminFleet.owners||[]).map(o=>`<option value="${o.id}">${escapeHtml(o.display_name)} — ${escapeHtml(o.legal_name)}</option>`).join("");
 const body=`<form id="add-car-form">
  <div class="admin-form-section"><b>بيانات السيارة والمالك</b><div class="modal-grid">
   <div class="field"><label>المالك</label><select name="ownerId" required><option value="">اختر المالك</option><option value="__company__">أسطول زفّة</option>${ownerOptions}</select></div>
   <div class="field"><label>الماركة</label><input name="make" required maxlength="80" placeholder="Mercedes-Benz"></div>
   <div class="field"><label>الموديل / الفئة</label><input name="model" required maxlength="100" placeholder="E-Class"></div>
   <div class="field"><label>سنة الصنع</label><input name="modelYear" type="number" min="1990" max="2100" required value="2022"></div>
   <div class="field"><label>رقم اللوحة</label><input name="plateNumber" required maxlength="40" placeholder="أ ق ص ١٢٣٤"></div>
   <div class="field"><label>عدد المقاعد</label><select name="seats"><option>4</option><option>5</option><option>7</option><option>8</option></select></div>
   <div class="field"><label>ناقل الحركة</label><select name="transmission"><option>أوتوماتيك</option><option>مانيوال</option></select></div>
   <div class="field"><label>مناطق الخدمة</label><input name="zones" required value="وسط الأقصر، الكرنك، العوامية" placeholder="افصل بين المناطق بفاصلة"></div>
  </div></div>
  <div class="admin-form-section"><b>صور السيارة</b>
   <div class="field field-wide"><label>اختر من صورة إلى 3 صور — JPG أو PNG أو WEBP</label>
    <input name="photos" id="vehicle-photo-input" type="file" accept="image/jpeg,image/png,image/webp" multiple required data-max-photos="3">
    <small class="photo-upload-hint">الحد الأقصى 5 ميجابايت لكل صورة. الصورة الأولى ستكون الصورة الرئيسية ويمكن تغييرها لاحقًا.</small>
    <div id="vehicle-photo-preview" class="vehicle-photo-preview"></div>
   </div>
  </div>
  <div class="admin-form-section"><b>أسعار الباقات بالجنيه</b><div class="modal-grid">
   <div class="field"><label>ميني</label><input name="mini" type="number" min="0" step="1" value="1500"></div>
   <div class="field"><label>كلاسيك — مطلوب</label><input name="classic" type="number" min="1" step="1" required value="2100"></div>
   <div class="field"><label>زفاف</label><input name="wedding" type="number" min="0" step="1" value="3200"></div>
   <div class="field"><label>رويال</label><input name="royal" type="number" min="0" step="1" value="4200"></div>
  </div></div>
  <div class="admin-form-section"><b>مواعيد الإتاحة الأسبوعية — توقيت القاهرة</b>
   <div class="weekday-picker">${["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"].map((day,i)=>`<label><input type="checkbox" name="weekdays" value="${i}" checked><span>${day}</span></label>`).join("")}</div>
   <div class="modal-grid"><div class="field"><label>من الساعة</label><input name="startTime" type="time" value="08:00" required></div><div class="field"><label>إلى الساعة</label><input name="endTime" type="time" value="23:00" required></div></div>
  </div>
  <div class="admin-form-section"><b>مستندات السيارة (روابط HTTPS)</b><div class="modal-grid">
   <div class="field"><label>رابط الترخيص</label><input name="registrationUrl" type="url" placeholder="رابط ملف الترخيص"></div>
   <div class="field"><label>انتهاء الترخيص</label><input name="registrationExpiry" type="date"></div>
   <div class="field"><label>رابط التأمين</label><input name="insuranceUrl" type="url" placeholder="رابط وثيقة التأمين"></div>
   <div class="field"><label>انتهاء التأمين</label><input name="insuranceExpiry" type="date"></div>
  </div></div>
  <div class="notice warning">السيارة تُحفظ في انتظار المراجعة، ولن تظهر للعملاء قبل اكتمال اعتماد المالك والمستندات والصور.</div>
 </form>`;
 openModal("إضافة سيارة جديدة",body,`<button class="btn btn-outline" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-car">حفظ السيارة</button>`);
}
function validateVehiclePhotoFiles(files,minCount=1,maxCount=3){
 if(files.length<minCount||files.length>maxCount){
  toast(minCount===1?"اختر صورة واحدة على الأقل، وبحد أقصى 3 صور.":`يمكنك إضافة ${maxCount} صور كحد أقصى في هذه العملية.`);
  return false;
 }
 const allowed=["image/jpeg","image/png","image/webp"];
 for(const file of files){
  if(!allowed.includes(file.type)||file.size<1||file.size>5*1024*1024){
   toast("الصورة يجب أن تكون JPG أو PNG أو WEBP ولا تتجاوز 5 ميجابايت.");
   return false;
  }
 }
 return true;
}
function renderVehiclePhotoPreviews(input){
 const preview=document.querySelector("#vehicle-photo-preview");
 if(!preview)return;
 vehiclePhotoPreviewUrls.forEach(url=>URL.revokeObjectURL(url));
 vehiclePhotoPreviewUrls=[];
 const files=[...(input.files||[])];
 const max=Number(input.dataset.maxPhotos||3);
 if(files.length>max||!validateVehiclePhotoFiles(files,0,max)){
  input.value="";
  preview.innerHTML="";
  return;
 }
 preview.innerHTML=files.map((file,index)=>{
  const url=URL.createObjectURL(file);vehiclePhotoPreviewUrls.push(url);
  return `<div class="vehicle-photo-preview-item"><img src="${url}" alt="معاينة الصورة ${index+1}"><small>${escapeHtml(file.name)} · ${(file.size/1024/1024).toFixed(1)} MB</small></div>`;
 }).join("");
}
async function uploadVehiclePhotos(vehicleId,files){
 if(!files.length)throw new Error("INVALID_PHOTO_COUNT");
 const prepared=await adminApiRequest("/api/v1/admin/vehicle-photos","POST",{
  action:"presign",vehicleId,
  files:files.map(file=>({contentType:file.type,size:file.size}))
 });
 const uploads=prepared.uploads||[];
 const mediaIds=uploads.map(item=>item.id);
 if(uploads.length!==files.length)throw new Error("PHOTO_UPLOAD_PREPARATION_FAILED");
 try{
  for(let i=0;i<uploads.length;i++){
   const item=uploads[i],file=files[i];
   const response=await fetch(item.uploadUrl,{
    method:"PUT",
    mode:"cors",
    headers:{"Content-Type":item.contentType},
    body:file,
    cache:"no-store"
   });
   if(!response.ok)throw new Error("PHOTO_UPLOAD_FAILED");
  }
  return await adminApiRequest("/api/v1/admin/vehicle-photos","POST",{
   action:"complete",vehicleId,mediaIds
  });
 }catch(error){
  await adminApiRequest("/api/v1/admin/vehicle-photos","POST",{
   action:"cancel",vehicleId,mediaIds
  }).catch(()=>{});
  throw error;
 }
}
function openVehiclePhotoManager(vehicleId){
 const vehicle=adminFleet.vehicles.find(item=>item.id===vehicleId);if(!vehicle)return;
 const count=(vehicle.images||[]).length,remaining=Math.max(0,3-count);
 const body=`<div class="admin-current-photos">${(vehicle.images||[]).map((photo,index)=>`<div class="admin-current-photo">${photo.approved&&photo.url?`<img src="${escapeHtml(photo.url)}" alt="صورة السيارة">`:'<div class="photo-pending">رفع غير مكتمل</div>'}<small>${index===0?"الصورة الرئيسية":`صورة ${index+1}`}</small></div>`).join("")||'<div class="empty-state">لا توجد صور مضافة</div>'}</div>
  ${remaining?`<form id="vehicle-photo-form" data-id="${vehicleId}">
   <div class="field"><label>اختر حتى ${remaining} ${remaining===1?"صورة إضافية":"صور إضافية"}</label><input name="photos" id="vehicle-photo-input" type="file" accept="image/jpeg,image/png,image/webp" multiple data-max-photos="${remaining}"><small class="photo-upload-hint">الحد الأقصى 3 صور للسيارة كلها، و5 ميجابايت لكل صورة.</small><div id="vehicle-photo-preview" class="vehicle-photo-preview"></div></div>
  </form>`:'<div class="notice">وصلت السيارة إلى الحد الأقصى: 3 صور. احذف صورة لإضافة صورة أخرى.</div>'}`;
 openModal("صور السيارة",body,`<button class="btn btn-outline" data-action="close-modal">إغلاق</button>${remaining?'<button class="btn btn-primary" data-action="save-vehicle-photos">رفع الصور</button>':""}`);
}
async function saveVehiclePhotos(){
 const form=document.querySelector("#vehicle-photo-form");if(!form)return;
 const input=form.elements.photos,files=[...(input?.files||[])].filter(file=>file.size>0);
 const remaining=Number(input?.dataset.maxPhotos||0);
 if(!validateVehiclePhotoFiles(files,1,remaining))return;
 try{
  await uploadVehiclePhotos(form.dataset.id,files);
  closeModal();await loadAdminFleet();await refreshVehicleCatalog();render();
  toast("تم رفع الصور وحفظها بنجاح",true);
 }catch(error){toast(adminErrorMessage(error));}
}
async function deleteAdminVehiclePhoto(vehicleId,mediaId){
 if(!confirm("حذف هذه الصورة نهائيًا من السيارة؟"))return;
 try{
  await adminApiRequest("/api/v1/admin/vehicle-photos","POST",{action:"delete",vehicleId,mediaId});
  await loadAdminFleet();await refreshVehicleCatalog();render();
  toast("تم حذف الصورة",true);
 }catch(error){toast(adminErrorMessage(error));}
}
async function setAdminVehiclePrimaryPhoto(vehicleId,mediaId){
 try{
  await adminApiRequest("/api/v1/admin/vehicle-photos","POST",{action:"primary",vehicleId,mediaId});
  await loadAdminFleet();await refreshVehicleCatalog();render();
  toast("تم تعيين الصورة الرئيسية",true);
 }catch(error){toast(adminErrorMessage(error));}
}
async function saveCar(){
 const f=document.querySelector("#add-car-form");if(!f?.reportValidity())return;
 const d=new FormData(f);
 const photos=d.getAll("photos").filter(file=>file&&file.size>0);
 if(!validateVehiclePhotoFiles(photos,1,3))return;
 const ownerId=String(d.get("ownerId")||"");
 const schedule=[...f.querySelectorAll('input[name="weekdays"]:checked')].map(el=>({weekday:Number(el.value),startTime:d.get("startTime"),endTime:d.get("endTime")}));
 if(!schedule.length)return toast("اختر يومًا واحدًا على الأقل للإتاحة");
 if(d.get("startTime")>=d.get("endTime"))return toast("وقت البداية يجب أن يسبق وقت النهاية");
 const documents=[];
 if(d.get("registrationUrl"))documents.push({documentType:"vehicle_license",url:d.get("registrationUrl"),expiresOn:d.get("registrationExpiry")||null});
 if(d.get("insuranceUrl"))documents.push({documentType:"insurance",url:d.get("insuranceUrl"),expiresOn:d.get("insuranceExpiry")||null});
 let createdVehicleId=null;
 try{
  const result=await adminApiRequest("/api/v1/admin/vehicles","POST",{
   ownerId:ownerId==="__company__"?null:ownerId,
   companyFleet:ownerId==="__company__",
   make:d.get("make"),model:d.get("model"),modelYear:Number(d.get("modelYear")),
   plateNumber:d.get("plateNumber"),seats:Number(d.get("seats")),transmission:d.get("transmission"),
   serviceZones:String(d.get("zones")||"").split(/[،,]/).map(x=>x.trim()).filter(Boolean),
   prices:{mini:d.get("mini"),classic:d.get("classic"),wedding:d.get("wedding"),royal:d.get("royal")},
   schedule,documents,submitForReview:true
  });
  createdVehicleId=result.vehicle.id;
  await uploadVehiclePhotos(createdVehicleId,photos);
  closeModal();await loadAdminFleet();await refreshVehicleCatalog();go("admin-vehicles");
  toast("تم حفظ السيارة ورفع الصور بنجاح",true);
 }catch(e){
  if(createdVehicleId){
   closeModal();await loadAdminFleet();go("admin-vehicles");
   toast("تم حفظ السيارة، لكن رفع الصور لم يكتمل. افتح السيارة وأعد إضافة الصور.");
  }else toast(adminErrorMessage(e));
 }
}
function editCar(id){
 const v=adminFleet.vehicles.find(x=>x.id===id);if(!v)return;
 const p=v.package_prices||{};
 const body=`<form id="edit-car-form" data-id="${v.id}"><div class="modal-grid">
  <div class="field"><label>الماركة</label><input name="make" value="${escapeHtml(v.make)}" required></div>
  <div class="field"><label>الموديل</label><input name="model" value="${escapeHtml(v.model)}" required></div>
  <div class="field"><label>سنة الصنع</label><input name="modelYear" type="number" min="1990" max="2100" value="${v.model_year}" required></div>
  <div class="field"><label>رقم اللوحة</label><input name="plateNumber" value="${escapeHtml(v.plate_number)}" required></div>
  <div class="field"><label>عدد المقاعد</label><input name="seats" type="number" min="2" max="12" value="${v.seats}" required></div>
  <div class="field"><label>ناقل الحركة</label><input name="transmission" value="${escapeHtml(v.transmission||"") }"></div>
  <div class="field field-wide"><label>مناطق الخدمة — افصل بفاصلة</label><input name="zones" value="${escapeHtml((v.service_zones||[]).join("، "))}" required></div>
  <div class="field"><label>ميني</label><input name="mini" type="number" min="0" value="${Number(p.mini||0)}"></div>
  <div class="field"><label>كلاسيك</label><input name="classic" type="number" min="1" value="${Number(p.classic||0)}"></div>
  <div class="field"><label>زفاف</label><input name="wedding" type="number" min="0" value="${Number(p.wedding||0)}"></div>
  <div class="field"><label>رويال</label><input name="royal" type="number" min="0" value="${Number(p.royal||0)}"></div>
 </div></form><div class="notice">إدارة الصور منفصلة عن بيانات السيارة حتى لا يؤدي تعديل السعر أو البيانات إلى حذف الصور.</div>`;
 openModal("تعديل بيانات السيارة",body,`<button class="btn btn-outline" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-car-update">حفظ التعديلات</button>`);
}
async function saveCarUpdate(){
 const f=document.querySelector("#edit-car-form");if(!f?.reportValidity())return;
 const d=new FormData(f);
 try{
  await adminApiRequest("/api/v1/admin/vehicles","PATCH",{
   action:"update",vehicleId:f.dataset.id,make:d.get("make"),model:d.get("model"),
   modelYear:Number(d.get("modelYear")),plateNumber:d.get("plateNumber"),seats:Number(d.get("seats")),
   transmission:d.get("transmission"),serviceZones:String(d.get("zones")||"").split(/[،,]/).map(x=>x.trim()).filter(Boolean),
   prices:{mini:d.get("mini"),classic:d.get("classic"),wedding:d.get("wedding"),royal:d.get("royal")}
  });
  closeModal();await loadAdminFleet();await refreshVehicleCatalog();render();toast("تم تحديث بيانات السيارة والأسعار",true);
 }catch(e){toast(adminErrorMessage(e));}
}
async function decideVehicle(id,decision){
 const prompts={approved:"اعتماد ونشر السيارة للعملاء؟",rejected:"تأكيد رفض السيارة؟",suspended:"إيقاف ظهور السيارة للعملاء؟"};
 if(!confirm(prompts[decision]||"تأكيد الإجراء؟"))return;
 try{
  await adminApiRequest("/api/v1/admin/vehicles","PATCH",{action:"decision",vehicleId:id,decision});
  await loadAdminFleet();await refreshVehicleCatalog();render();
  toast(decision==="approved"?"تم اعتماد السيارة ونشرها في الكتالوج":decision==="suspended"?"تم إيقاف النشر":"تم رفض السيارة",true);
 }catch(e){toast(adminErrorMessage(e));}
}
async function createAuthPerson(name,phone,password){
 if(typeof authClient?.admin?.createUser!=="function")throw new Error("ADMIN_CREATE_USER_UNAVAILABLE");
 const result=await authClient.admin.createUser({email:internalAuthEmail(phone),password,name,role:"user"});
 if(result?.error)throw result.error;
 const user=result?.data?.user||result?.user||null;
 if(!user?.id)throw new Error("AUTH_USER_CREATION_UNCONFIRMED");
 return user;
}
function showTemporaryPassword(title,name,phone,password){
 const body=`<div class="notice good">تم إنشاء الحساب وربطه بملف زفّة. سلّم كلمة المرور المؤقتة لصاحب الحساب عبر وسيلة آمنة، واطلب منه تغييرها عند أول استخدام.</div>
 <div class="profile-card"><div><b>${escapeHtml(name)}</b><small dir="ltr">${escapeHtml(phone)}</small></div></div>
 <div class="field"><label>كلمة المرور المؤقتة</label><input id="created-temp-password" value="${escapeHtml(password)}" readonly dir="ltr"></div>
 <button class="btn btn-outline" data-action="copy-admin-password">نسخ كلمة المرور</button>`;
 openModal(title,body,`<button class="btn btn-primary" data-action="close-modal">تم</button>`);
}
function addOwner(){
 const body=`<form id="add-owner-form">
  <input type="hidden" name="authUserId">
  <div class="modal-grid">
   <div class="field"><label>اسم المالك</label><input name="displayName" required minlength="2" maxlength="80"></div>
   <div class="field"><label>رقم الموبايل</label><input name="phone" required type="tel" inputmode="tel" placeholder="01012345678" dir="ltr"></div>
   <div class="field"><label>الاسم القانوني / اسم الشركة</label><input name="legalName" required maxlength="150"></div>
   <div class="field"><label>نوع الشراكة</label><select name="ownerKind"><option value="independent_owner">مالك مستقل</option><option value="fleet_partner">شريك أسطول</option><option value="premium_partner">شريك مميز</option></select></div>
   <div class="field field-wide"><label>كلمة مرور مؤقتة</label><input name="password" type="text" required minlength="8" autocomplete="new-password" value="${crypto.randomUUID().replace(/-/g,"").slice(0,14)}"></div>
   <div class="field field-wide"><label>رابط العقد الموقّع (HTTPS)</label><input name="contractUrl" type="url" required placeholder="رابط نسخة العقد الموقّع"></div>
   <div class="field"><label>نسخة العقد</label><input name="contractVersion" value="ZAFFA-OWNER-1" required></div>
   <div class="field"><label>بداية العقد</label><input name="validFrom" type="date"></div>
   <div class="field"><label>نهاية العقد</label><input name="validTo" type="date"></div>
  </div>
  <div class="notice warning">سينشئ النظام حساب دخول بكلمة المرور المؤقتة، ثم يربطه بملف المالك. يظل المالك «بانتظار الاعتماد» حتى مراجعة العقد واعتماده.</div>
 </form>`;
 openModal("إضافة مالك / شريك",body,`<button class="btn btn-outline" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-owner">إنشاء الحساب والملف</button>`);
}
async function saveOwner(){
 const f=document.querySelector("#add-owner-form");if(!f?.reportValidity())return;
 const d=new FormData(f),phone=normalizeCustomerPhone(d.get("phone"));
 if(!phone)return toast("رقم الموبايل المصري غير صحيح");
 const password=String(d.get("password")||"");
 try{
  let authUserId=String(d.get("authUserId")||"");
  if(!authUserId){
   const authUser=await createAuthPerson(String(d.get("displayName")).trim(),phone,password);
   authUserId=authUser.id;f.elements.authUserId.value=authUserId;
  }
  const created=await adminApiRequest("/api/v1/admin/people","POST",{
   kind:"owner",authUserId,phone,displayName:d.get("displayName"),legalName:d.get("legalName"),ownerKind:d.get("ownerKind")
  });
  await adminApiRequest("/api/v1/admin/documents","POST",{
   entityType:"owner",entityId:created.person.id,documentType:"contract",url:d.get("contractUrl"),
   contractVersion:d.get("contractVersion")||"ZAFFA-OWNER-1",validFrom:d.get("validFrom")||null,validTo:d.get("validTo")||null
  });
  closeModal();await loadAdminFleet();render();
  showTemporaryPassword("تم إنشاء حساب المالك",d.get("displayName"),phone,password);
 }catch(e){toast(adminErrorMessage(e));}
}
function addDriver(){
 const body=`<form id="add-driver-form">
  <input type="hidden" name="authUserId">
  <div class="modal-grid">
   <div class="field"><label>اسم السائق</label><input name="displayName" required minlength="2" maxlength="80"></div>
   <div class="field"><label>رقم الموبايل</label><input name="phone" required type="tel" inputmode="tel" placeholder="01012345678" dir="ltr"></div>
   <div class="field field-wide"><label>كلمة مرور مؤقتة</label><input name="password" type="text" required minlength="8" autocomplete="new-password" value="${crypto.randomUUID().replace(/-/g,"").slice(0,14)}"></div>
   <div class="field field-wide"><label>رابط رخصة القيادة (HTTPS)</label><input name="licenseUrl" type="url" required placeholder="رابط صورة أو ملف الرخصة"></div>
   <div class="field"><label>انتهاء رخصة القيادة</label><input name="licenseExpiry" type="date" required></div>
   <div class="field field-wide"><label>رابط البطاقة الشخصية (HTTPS)</label><input name="nationalIdUrl" type="url" required placeholder="رابط صورة أو ملف البطاقة"></div>
   <div class="field"><label>انتهاء البطاقة (إن وجد)</label><input name="nationalIdExpiry" type="date"></div>
  </div>
  <div class="notice warning">يُنشأ ملف السائق بحالة «بانتظار التحقق». لا يمكن إسناد مهام له قبل مراجعة واعتماد الرخصة والبطاقة وتفعيل السائق.</div>
 </form>`;
 openModal("إضافة سائق جديد",body,`<button class="btn btn-outline" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-driver">إنشاء الحساب والملف</button>`);
}
async function saveDriver(){
 const f=document.querySelector("#add-driver-form");if(!f?.reportValidity())return;
 const d=new FormData(f),phone=normalizeCustomerPhone(d.get("phone"));
 if(!phone)return toast("رقم الموبايل المصري غير صحيح");
 const password=String(d.get("password")||"");
 try{
  let authUserId=String(d.get("authUserId")||"");
  if(!authUserId){
   const authUser=await createAuthPerson(String(d.get("displayName")).trim(),phone,password);
   authUserId=authUser.id;f.elements.authUserId.value=authUserId;
  }
  const created=await adminApiRequest("/api/v1/admin/people","POST",{
   kind:"driver",authUserId,phone,displayName:d.get("displayName")
  });
  await adminApiRequest("/api/v1/admin/documents","POST",{
   entityType:"driver",entityId:created.person.id,documentType:"driving_license",
   url:d.get("licenseUrl"),expiresOn:d.get("licenseExpiry")
  });
  await adminApiRequest("/api/v1/admin/documents","POST",{
   entityType:"driver",entityId:created.person.id,documentType:"national_id",
   url:d.get("nationalIdUrl"),expiresOn:d.get("nationalIdExpiry")||null
  });
  closeModal();await loadAdminFleet();render();
  showTemporaryPassword("تم إنشاء حساب السائق",d.get("displayName"),phone,password);
 }catch(e){toast(adminErrorMessage(e));}
}
function addPersonDocument(kind,id){
 const driver=kind==="driver";
 const body=`<form id="person-document-form" data-kind="${kind}" data-id="${id}">
  <div class="field"><label>نوع المستند</label><select name="documentType">${driver?'<option value="driving_license">رخصة قيادة</option><option value="national_id">بطاقة شخصية</option><option value="other">مستند آخر</option>':'<option value="contract">عقد شراكة</option>'}</select></div>
  <div class="field"><label>رابط المستند HTTPS</label><input name="url" type="url" required></div>
  <div class="field"><label>تاريخ الانتهاء (إن وجد)</label><input name="expiresOn" type="date"></div>
  ${!driver?'<div class="field"><label>نسخة العقد</label><input name="contractVersion" value="ZAFFA-OWNER-1"></div>':""}
 </form>`;
 openModal(driver?"إضافة مستند للسائق":"إضافة عقد للمالك",body,`<button class="btn btn-outline" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-person-document">حفظ المستند</button>`);
}
async function savePersonDocument(){
 const f=document.querySelector("#person-document-form");if(!f?.reportValidity())return;
 const d=new FormData(f),kind=f.dataset.kind;
 try{
  await adminApiRequest("/api/v1/admin/documents","POST",{
   entityType:kind,entityId:f.dataset.id,documentType:d.get("documentType"),url:d.get("url"),
   expiresOn:d.get("expiresOn")||null,contractVersion:d.get("contractVersion")||"ZAFFA-OWNER-1"
  });
  closeModal();await loadAdminFleet();render();toast("تم حفظ المستند في قائمة المراجعة",true);
 }catch(e){toast(adminErrorMessage(e));}
}
async function updatePersonStatus(kind,id,status,active){
 if(!confirm(status==="approved"?"اعتماد ملف المالك؟":status==="verified"?"تأكيد توثيق السائق؟":"تأكيد تحديث حالة الملف؟"))return;
 try{
  await adminApiRequest("/api/v1/admin/people","PATCH",{kind,id,status,active});
  await loadAdminFleet();render();toast("تم تحديث حالة الملف",true);
 }catch(e){toast(adminErrorMessage(e));}
}
async function reviewAdminDocument(kind,id,decision){
 if(!confirm(decision==="approve"?"اعتماد المستند؟":"رفض المستند؟"))return;
 try{
  await adminApiRequest("/api/v1/admin/documents","PATCH",{entityType:kind,documentId:id,decision});
  await loadAdminFleet();render();toast(decision==="approve"?"تم اعتماد المستند":"تم رفض المستند",true);
 }catch(e){toast(adminErrorMessage(e));}
}
function addVehicleDocument(id){
 const body=`<form id="vehicle-document-form" data-id="${id}">
  <div class="field"><label>نوع المستند</label><select name="documentType"><option value="vehicle_license">ترخيص المركبة</option><option value="insurance">وثيقة التأمين</option><option value="ownership">إثبات الملكية</option><option value="other">مستند آخر</option></select></div>
  <div class="field"><label>رابط المستند HTTPS</label><input name="url" type="url" required></div>
  <div class="field"><label>تاريخ الانتهاء</label><input name="expiresOn" type="date"></div>
 </form>`;
 openModal("إضافة مستند للسيارة",body,`<button class="btn btn-outline" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-vehicle-document">حفظ المستند</button>`);
}
async function saveVehicleDocument(){
 const f=document.querySelector("#vehicle-document-form");if(!f?.reportValidity())return;
 const d=new FormData(f);
 try{
  await adminApiRequest("/api/v1/admin/documents","POST",{
   entityType:"vehicle",entityId:f.dataset.id,documentType:d.get("documentType"),url:d.get("url"),expiresOn:d.get("expiresOn")||null
  });
  closeModal();await loadAdminFleet();render();toast("تم حفظ المستند للمراجعة",true);
 }catch(e){toast(adminErrorMessage(e));}
}
function addVehicleRule(vehicleId=null){
 const options=(adminFleet.vehicles||[]).map(v=>`<option value="${v.id}" ${v.id===vehicleId?"selected":""}>${escapeHtml(v.make)} ${escapeHtml(v.model)} — ${escapeHtml(v.plate_number)}</option>`).join("");
 const body=`<form id="availability-rule-form">
  <div class="field"><label>السيارة</label><select name="vehicleId" required>${options}</select></div>
  <div class="weekday-picker">${["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"].map((day,i)=>`<label><input type="checkbox" name="weekdays" value="${i}" ${[0,1,2,3,4,5,6].includes(i)?"checked":""}><span>${day}</span></label>`).join("")}</div>
  <div class="modal-grid"><div class="field"><label>من الساعة</label><input name="startTime" type="time" value="08:00" required></div><div class="field"><label>إلى الساعة</label><input name="endTime" type="time" value="23:00" required></div>
   <div class="field"><label>ساري من</label><input name="validFrom" type="date"></div><div class="field"><label>ساري حتى</label><input name="validTo" type="date"></div>
  </div>
 </form>`;
 openModal("إضافة جدول إتاحة",body,`<button class="btn btn-outline" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-rule">حفظ الجدول</button>`);
}
async function saveAvailabilityRule(){
 const f=document.querySelector("#availability-rule-form");if(!f?.reportValidity())return;
 const d=new FormData(f),weekdays=[...f.querySelectorAll('input[name="weekdays"]:checked')].map(x=>Number(x.value));
 if(!weekdays.length)return toast("حدد يومًا واحدًا على الأقل");
 try{
  await adminApiRequest("/api/v1/admin/availability","POST",{
   kind:"rule",vehicleId:d.get("vehicleId"),weekdays,startTime:d.get("startTime"),endTime:d.get("endTime"),
   validFrom:d.get("validFrom")||null,validTo:d.get("validTo")||null
  });
  closeModal();await loadAdminFleet();render();toast("تم حفظ جدول الإتاحة",true);
 }catch(e){toast(adminErrorMessage(e));}
}
function addAvailabilityBlock(){
 const options=(adminFleet.vehicles||[]).map(v=>`<option value="${v.id}">${escapeHtml(v.make)} ${escapeHtml(v.model)} — ${escapeHtml(v.plate_number)}</option>`).join("");
 const body=`<form id="availability-block-form">
  <div class="field"><label>السيارة</label><select name="vehicleId" required>${options}</select></div>
  <div class="field"><label>بداية الحظر</label><input name="startsAt" type="datetime-local" required></div>
  <div class="field"><label>نهاية الحظر</label><input name="endsAt" type="datetime-local" required></div>
  <div class="field"><label>السبب</label><input name="reason" required maxlength="240" placeholder="صيانة، إجازة، عدم توافر"></div>
 </form>`;
 openModal("حظر فترة زمنية",body,`<button class="btn btn-outline" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-block">حفظ الحظر</button>`);
}
async function saveAvailabilityBlock(){
 const f=document.querySelector("#availability-block-form");if(!f?.reportValidity())return;
 const d=new FormData(f);
 try{
  await adminApiRequest("/api/v1/admin/availability","POST",{
   kind:"block",vehicleId:d.get("vehicleId"),
   startsAt:new Date(d.get("startsAt")).toISOString(),endsAt:new Date(d.get("endsAt")).toISOString(),reason:d.get("reason")
  });
  closeModal();await loadAdminFleet();render();toast("تم حظر الفترة الزمنية",true);
 }catch(e){toast(adminErrorMessage(e));}
}
async function deleteAvailability(kind,id){
 if(!confirm(kind==="block"?"إلغاء فترة الحظر؟":"حذف قاعدة الإتاحة؟"))return;
 try{
  await adminApiRequest("/api/v1/admin/availability","DELETE",{kind,id});
  await loadAdminFleet();render();toast("تم تحديث جدول التوافر",true);
 }catch(e){toast(adminErrorMessage(e));}
}
async function copyAdminPassword(){
 const input=document.querySelector("#created-temp-password");if(!input)return;
 try{await navigator.clipboard.writeText(input.value);toast("تم نسخ كلمة المرور المؤقتة",true);}catch{input.select();toast("حدد كلمة المرور وانسخها يدويًا");}
}

document.addEventListener('click',event=>{
 const btn=event.target.closest('[data-action]');if(!btn)return;const action=btn.dataset.action;const id=btn.dataset.id;
 if(action==='account'){if(authSession?.user){if(currentProfile)openModal('حسابك',`<div class="profile-card"><div class="profile-icon">◎</div><div><b>${escapeHtml(currentProfile.displayName)}</b><small>رقم الموبايل: ${escapeHtml(currentProfile.phone||'')}</small></div></div>`,`<button class="btn btn-danger" data-action="sign-out">تسجيل الخروج</button><button class="btn btn-outline" data-action="close-modal">إغلاق</button>`);else openProfileModal();}else openAuthModal();}
 else if(action==='auth-mode')openAuthModal(btn.dataset.mode);
 else if(action==='auth-submit')submitAuth();
 else if(action==='profile-submit')submitProfile();
 else if(action==='sign-out')signOut();
 else if(action==='go')go(btn.dataset.view);
 else if(action==='toast')toast(btn.dataset.message||'تم');
 else if(action==='filter'){browseFilter=btn.dataset.filter;render();}
 else if(action==='favorite'){if(state.favorites.includes(id))state.favorites=state.favorites.filter(x=>x!==id);else state.favorites.push(id);persist();render();toast(state.favorites.includes(id)?'اتضافت للمفضلة':'اتشالت من المفضلة',true);}
 else if(action==='details')carDetails(id);
 else if(action==='book')openBooking(id||activeCarId);
 else if(action==='close-modal')closeModal(true);
 else if(action==='backdrop'&&event.target.classList.contains('modal-backdrop'))closeModal(true);
 else if(action==='occasion'){const value=btn.dataset.value||'زفاف';const picker=document.querySelector('#home-occasion');if(picker)picker.value=value;state.searchOccasion=value;toast('اختارت مناسبتك: '+value,true);}
 else if(action==='search-cars'){state.searchDate=document.querySelector('#home-date')?.value||state.searchDate;state.searchZone=document.querySelector('#home-zone')?.value||state.searchZone;state.searchOccasion=document.querySelector('#home-occasion')?.value||state.searchOccasion;persist();browseFilter='all';go('cars');}

 else if(action==='booking-details')bookingDetails(id);
 else if(action==='owner-accept')ownerAccept(id);
 else if(action==='owner-decline'){const b=bookingById(id);if(b)b.status='declined';persist();closeModal();render();toast('تم رفض الطلب في البيانات التجريبية');}
  else if(action==='assign-driver')assignDriverToBooking(id);
 else if(action==='reload-bookings')loadAdminBookings().then(render).catch(e=>toast(adminErrorMessage(e)));
 else if(action==='driver-status')updateBookingStatus(id,btn.dataset.status);
 else if(action==='add-car')addCar();
 else if(action==='save-car')saveCar();
 else if(action==='edit-car')editCar(id);
 else if(action==='save-car-update')saveCarUpdate();
 else if(action==='vehicle-decision')decideVehicle(id,btn.dataset.decision);
 else if(action==='reload-fleet')loadAdminFleet().then(render).catch(e=>toast(adminErrorMessage(e)));
 else if(action==='add-owner')addOwner();
 else if(action==='save-owner')saveOwner();
 else if(action==='add-driver')addDriver();
 else if(action==='save-driver')saveDriver();
 else if(action==='add-owner-contract')addPersonDocument('owner',id);
 else if(action==='add-driver-doc')addPersonDocument('driver',id);
 else if(action==='save-person-document')savePersonDocument();
 else if(action==='person-status')updatePersonStatus(btn.dataset.kind,id,btn.dataset.status,btn.dataset.active===undefined?undefined:btn.dataset.active==='true');
 else if(action==='review-document')reviewAdminDocument(btn.dataset.kind,id,btn.dataset.decision);
 else if(action==='add-vehicle-doc')addVehicleDocument(id);
 else if(action==='save-vehicle-document')saveVehicleDocument();
 else if(action==='add-rule')addVehicleRule(id||null);
 else if(action==='add-block')addAvailabilityBlock();
 else if(action==='save-rule')saveAvailabilityRule();
 else if(action==='save-block')saveAvailabilityBlock();
 else if(action==='delete-availability')deleteAvailability(btn.dataset.kind,id);
 else if(action==='copy-admin-password')copyAdminPassword();
});

document.addEventListener('keydown',event=>{if(event.key==='Escape')closeModal();});
if("serviceWorker" in navigator && location.protocol.startsWith("http")){
 navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"}).then(reg=>reg.update()).catch(()=>{});
}
render();
updateAccountButton();
restoreAuthSession().catch(()=>{});
refreshVehicleCatalog();
refreshPaymentMethods();

// --- Live backend connectivity indicator ---
// Customer inventory is loaded from Neon. Booking submission stays disabled until the transactional booking engine is live.
async function refreshPaymentMethods(){
 try{
  const r=await fetch("/api/v1/payment-methods",{headers:{Accept:"application/json"},cache:"no-store"});
  const j=await r.json();
  if(r.ok&&j.ok===true)paymentSettings=j;
 }catch(e){console.warn("[ZAFFA] payment settings unavailable",e?.message||"unknown");}
 const hint=document.querySelector("#instapay-home-status");
 if(hint)hint.textContent=paymentSettings.methods?.instapay?.enabled
   ? `متاح — العربون ${paymentSettings.depositPercent||30}%، والإيصال يخضع للمراجعة`
   : "يتفعّل بعد إضافة بيانات حساب الاستلام، ويخضع الإيصال للمراجعة";
 return paymentSettings;
}

async function refreshVehicleCatalog(){
 try{
  const r=await fetch("/api/v1/vehicles",{headers:{Accept:"application/json"},cache:"no-store"});const j=await r.json();
  if(!r.ok||j.ok!==true)throw new Error(j.code||"CATALOG_UNAVAILABLE");
  state.cars=(j.vehicles||[]).filter(v=>Number(v.package_prices?.classic)>0).map(v=>({
   id:v.id,brand:v.brand,model:v.model,year:Number(v.year),color:"silver",plate:"",imageUrl:v.image_url||null,seats:Number(v.seats),
   transmission:v.transmission||"أوتوماتيك",ownerType:["fleet_partner","premium_partner"].includes(v.owner_type)?"fleet":"independent",
   ownerId:v.owner_id,zone:Array.isArray(v.service_zones)&&v.service_zones.length?v.service_zones.join("، "):"الأقصر",
   packagePrices:Object.fromEntries(Object.entries(v.package_prices||{}).map(([k,val])=>[k,Number(val)])),
   rating:0,reviews:0,approval:"approved",features:[],driverIncluded:v.driver_included===true
  }));render();
 }catch(e){console.warn("[ZAFFA] catalog refresh failed",e?.message||"unknown");}
}
