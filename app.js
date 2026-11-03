import { createAuthClient } from '@neondatabase/auth';
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

const roleConfig = {
  customer: {label:'عميل',default:'home',nav:[['home','الرئيسية','🏡'],['cars','السيارات','🚘'],['bookings','حجوزاتي','🗓️'],['favorites','المفضلة','💗'],['account','حسابي','👤']]},
  owner: {label:'مالك سيارة',default:'owner-overview',nav:[['owner-overview','ملخص المالك','📊'],['owner-vehicles','سياراتي','🚗'],['owner-requests','طلبات الحجز','📩'],['owner-calendar','التوافر','🗓️'],['owner-earnings','الأرباح والتسويات','💰']]},
  driver: {label:'سائق',default:'driver-tasks',nav:[['driver-tasks','مهامي','🧭'],['driver-history','سجل الرحلات','🚦'],['driver-account','حسابي','👤']]},
  admin: {label:'إدارة زفّة',default:'admin-overview',nav:[['admin-overview','مركز العمليات','🎛️'],['admin-bookings','الحجوزات','📋'],['admin-vehicles','اعتماد السيارات','🚘'],['admin-people','الملاك والسائقون','👥'],['admin-finance','المالية والتسويات','💳'],['admin-reports','التقارير','📈']]}
};
const viewTitles = {
  home:'الرئيسية',cars:'اكتشف السيارات',bookings:'حجوزاتي',favorites:'المفضلة',account:'حسابي',
  'owner-overview':'ملخص المالك','owner-vehicles':'سياراتي','owner-requests':'طلبات الحجز','owner-calendar':'التوافر','owner-earnings':'الأرباح والتسويات',
  'driver-tasks':'مهامي اليوم','driver-history':'سجل الرحلات','driver-account':'حسابي',
  'admin-overview':'مركز العمليات','admin-bookings':'إدارة الحجوزات','admin-vehicles':'اعتماد السيارات','admin-people':'الملاك والسائقون','admin-finance':'المالية والتسويات','admin-reports':'التقارير'
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
  return `<article class="car-card"><div class="car-art ${escapeHtml(car.color)}">${carArt(car.color)}<span class="car-badge">✓ سيارة معتمدة</span><button class="favorite ${favorite?'active':''}" data-action="favorite" data-id="${car.id}" aria-label="إضافة للمفضلة">${favorite?'♥':'♡'}</button></div><div class="car-body"><div class="car-title-row"><div><h3>${escapeHtml(car.brand)} ${escapeHtml(car.model)}</h3><div class="car-sub">موديل ${car.year} · ${escapeHtml(car.zone)}</div></div><span class="rating">★ ${car.rating?car.rating.toFixed(1):'جديد'} <small>(${car.reviews})</small></span></div><div class="car-meta"><span>♙ ${car.seats} أفراد</span><span>⚙ ${escapeHtml(car.transmission)}</span><span>✓ بسائق</span></div><div class="car-price-row"><div class="price">${money(low)} <small>/ 3 ساعات</small></div><span class="owner-type">${car.ownerType==='fleet'?'أسطول زفّة':'مالك موثّق'}</span></div><div class="car-actions"><button class="btn btn-outline btn-small" data-action="details" data-id="${car.id}">التفاصيل</button><button class="btn btn-primary btn-small" data-action="book" data-id="${car.id}">احجز السيارة</button></div></div></article>`;
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
    'admin-overview':renderAdminOverview,'admin-bookings':renderAdminBookings,'admin-vehicles':renderAdminVehicles,'admin-people':renderAdminPeople,'admin-finance':renderAdminFinance,'admin-reports':renderAdminReports};
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
function renderAdminOverview(){const all=state.bookings;const open=all.filter(b=>!['completed','cancelled','declined'].includes(b.status));const pendingCars=state.cars.filter(c=>c.approval==='pending');const confirmed=all.filter(b=>['confirmed','driver_assigned','ready','in_progress','completed'].includes(b.status));const volume=confirmed.reduce((s,b)=>s+b.total,0);return `${pageHeading('لوحة الإدارة','مركز العمليات','نظرة تشغيلية على الحجوزات والسيارات ومهام اليوم.')}
 <div class="stats-grid">${statCard('▤','إجمالي الحجوزات',all.length,'بيانات تجريبية')}${statCard('⌖','حجوزات نشطة',open.length,'تحتاج متابعة تشغيلية')}${statCard('◇','سيارات قيد الاعتماد',pendingCars.length,'مراجعة مستندات وصور')}${statCard('◈','قيمة حجوزات مؤكدة',money(volume),'ليست إيراد المنصة')}</div>
 <div class="admin-grid"><div class="panel"><h3>آخر الحجوزات</h3><div class="table-wrap"><table><thead><tr><th>رقم الحجز</th><th>العميل</th><th>الموعد</th><th>الحالة</th><th>القيمة</th></tr></thead><tbody>${allAdminBookings().slice(0,6).map(b=>`<tr><td>${b.id}</td><td>${escapeHtml(b.customerName)}</td><td>${b.date} · ${b.time}</td><td>${statusInfo(b.status)}</td><td>${money(b.total)}</td></tr>`).join('')}</tbody></table></div><button class="text-link" data-action="go" data-view="admin-bookings">كل الحجوزات ←</button></div><div class="panel"><h3>قائمة تحتاج تدخل</h3><div class="mini-list"><div class="mini-row"><div><b>طلبات مالك بانتظار الرد</b><small>${all.filter(b=>b.status==='pending_owner').length} طلب</small></div><button class="btn btn-outline btn-small" data-action="go" data-view="admin-bookings">مراجعة</button></div><div class="mini-row"><div><b>سيارات بانتظار الاعتماد</b><small>${pendingCars.length} سيارة</small></div><button class="btn btn-outline btn-small" data-action="go" data-view="admin-vehicles">مراجعة</button></div><div class="mini-row"><div><b>مدفوعات تحتاج متابعة</b><small>${all.filter(b=>b.status==='awaiting_payment').length} عملية</small></div><button class="btn btn-outline btn-small" data-action="go" data-view="admin-finance">المالية</button></div></div></div></div><div class="notice">هذه لوحة تشغيل ببيانات اصطناعية محلية. لا توجد حجوزات أو عملاء حقيقيون متصلون.</div>`;}
function renderAdminBookings(){const list=allAdminBookings();return `${pageHeading('التحكم في الحجوزات','إدارة الحجوزات','راجع الحالة، التعيين، ومتابعة تنفيذ الخدمة.')}
 <div class="panel"><div class="table-wrap"><table><thead><tr><th>رقم</th><th>العميل</th><th>السيارة</th><th>التاريخ</th><th>المالك</th><th>الحالة</th><th>القيمة</th><th></th></tr></thead><tbody>${list.map(b=>{const c=carById(b.carId)||{};return `<tr><td><b>${b.id}</b></td><td>${escapeHtml(b.customerName)}</td><td>${escapeHtml(c.brand||'')} ${escapeHtml(c.model||'')}</td><td>${b.date} · ${b.time}</td><td>${b.ownerId==='fleet1'?'أسطول زفّة':'مالك مستقل'}</td><td>${statusInfo(b.status)}</td><td>${money(b.total)}</td><td><button class="btn btn-outline btn-small" data-action="booking-details" data-id="${b.id}">فتح</button></td></tr>`}).join('')}</tbody></table></div></div>`;}
function renderAdminVehicles(){const pending=state.cars.filter(c=>c.approval==='pending');const done=state.cars.filter(c=>c.approval!=='pending');return `${pageHeading('مراجعة الشركاء','اعتماد السيارات','لا تظهر السيارة للعميل إلا بعد استيفاء التحقق والمراجعة.')}
 <div class="panel"><h3>طلبات اعتماد جديدة (${pending.length})</h3>${pending.length?pending.map(c=>`<div class="queue-item"><div class="queue-thumb">◇</div><div class="queue-info"><b>${escapeHtml(c.brand)} ${escapeHtml(c.model)} · ${escapeHtml(c.plate)}</b><small>${c.year} · مالك مستقل · مستندات غير مرفوعة في النموذج</small></div><button class="btn btn-primary btn-small" data-action="approve-car" data-id="${c.id}">اعتماد تجريبي</button><button class="btn btn-danger btn-small" data-action="reject-car" data-id="${c.id}">رفض</button></div>`).join(''):`<div class="empty-state"><b>لا توجد سيارات جديدة</b></div>`}</div><div class="panel" style="margin-top:14px"><h3>سجل السيارات المعتمدة والمرفوضة</h3><div class="table-wrap"><table><thead><tr><th>السيارة</th><th>المالك</th><th>الحالة</th><th>المنطقة</th></tr></thead><tbody>${done.map(c=>`<tr><td>${escapeHtml(c.brand)} ${escapeHtml(c.model)}</td><td>${c.ownerId==='owner1'?'مالك 1':'أسطول / مالك 2'}</td><td>${c.approval==='approved'?'<span class="status green">معتمدة</span>':'<span class="status red">مرفوضة</span>'}</td><td>${escapeHtml(c.zone)}</td></tr>`).join('')}</tbody></table></div></div><div class="notice warning">زر الاعتماد يغيّر حالة السجل التجريبي فقط. الاعتماد الفعلي يتطلب مراجعة ترخيص المركبة والملكية والتأمين وصور السيارة.</div>`;}
function renderAdminPeople(){return `${pageHeading('إدارة الحسابات','الملاك والسائقون','عرض مبدئي للشركاء والسائقين المسجلين.')}
 <div class="stats-grid">${statCard('♙','ملاك مسجلون','3','بيانات حسابات تجريبية')}${statCard('⌖','سائقون','2','منهم حساب تجريبي')}${statCard('✓','ملفات مكتملة','0','لا يوجد تحقق حقيقي')}${statCard('!','ملفات تحتاج مراجعة','2','مستندات غير متصلة')}</div><div class="panel"><h3>سجل الشركاء</h3><div class="table-wrap"><table><thead><tr><th>الحساب</th><th>نوع الشراكة</th><th>السيارات</th><th>حالة الملف</th></tr></thead><tbody><tr><td>مالك تجريبي 1</td><td>مالك مستقل</td><td>3</td><td><span class="status orange">مراجعة مستندات</span></td></tr><tr><td>شريك أسطول تجريبي</td><td>أسطول متعاقد</td><td>2</td><td><span class="status green">بيانات افتراضية</span></td></tr></tbody></table></div></div>`;}
function renderAdminFinance(){const total=state.bookings.reduce((s,b)=>s+b.total,0);const fees=state.bookings.reduce((s,b)=>s+b.commission,0);return `${pageHeading('الرقابة المالية','المدفوعات والتسويات','افصل قيمة الحجز عن عمولة المنصة ومستحقات مقدم الخدمة.')}
 <div class="stats-grid">${statCard('▤','إجمالي قيمة الحجوزات',money(total),'قيمة التعاملات وليست إيراد زفّة')}${statCard('◈','عمولة تقديرية',money(fees),'افتراض تجريبي فقط')}${statCard('↗','مدفوعات إلكترونية','0','لا يوجد PSP متصل')}${statCard('⌛','تسويات معلقة',state.settlements.length,'سجلات توضيحية')}</div>
 <div class="panel"><h3>حركات حجوزات تجريبية</h3><div class="table-wrap"><table><thead><tr><th>الحجز</th><th>طريقة الدفع</th><th>حالة التحصيل</th><th>قيمة الحجز</th><th>العمولة الافتراضية</th></tr></thead><tbody>${allAdminBookings().map(b=>`<tr><td>${b.id}</td><td>${b.paymentMethod==='cash'?'نقدي':b.paymentMethod==='deposit'?'عربون إلكتروني':'دفع إلكتروني كامل'}</td><td>${b.paymentState==='deposit_due'?'<span class="status orange">عربون مستحق</span>':b.paymentState==='cash_due'?'<span class="status gray">نقدي عند الخدمة</span>':b.paymentState==='paid_simulated'?'<span class="status blue">مدفوع محاكاة</span>':'<span class="status orange">غير محصل</span>'}</td><td>${money(b.total)}</td><td>${money(b.commission)}</td></tr>`).join('')}</tbody></table></div></div><div class="notice warning">لا يتم تحصيل أو تحويل أي أموال في هذا النظام التجريبي. نسبة العمولة 12% مستخدمة فقط كافتراض توضيحي وليست نسبة تعاقدية معتمدة.</div>`;}
function renderAdminReports(){const all=state.bookings;const completion=all.filter(b=>b.status==='completed').length;return `${pageHeading('قراءة الأداء','التقارير والمؤشرات','مؤشرات أولية لتجربة النموذج، وليست بيانات تشغيل فعلية.')}
 <div class="stats-grid">${statCard('✓','معدل الإكمال',`${all.length?Math.round(completion/all.length*100):0}%`,'من حجوزات النموذج')}${statCard('⌛','طلبات بانتظار المالك',all.filter(b=>b.status==='pending_owner').length,'مؤشر زمن الاستجابة')}${statCard('↗','متوسط قيمة الحجز',money(all.length?all.reduce((s,b)=>s+b.total,0)/all.length:0),'متوسط عينة صغيرة')}${statCard('◇','السيارات المعتمدة',state.cars.filter(c=>c.approval==='approved').length,'في بيانات العرض')}</div><div class="panel"><h3>أولويات القياس قبل الإطلاق</h3><div class="mini-list"><div class="mini-row"><div><b>Booking Conversion</b><small>من مشاهدة السيارة حتى تأكيد الحجز</small></div></div><div class="mini-row"><div><b>Fulfillment Rate</b><small>نسبة الحجوزات التي نُفذت بالكامل</small></div></div><div class="mini-row"><div><b>On-time Rate</b><small>الالتزام بموعد الوصول</small></div></div><div class="mini-row"><div><b>Contribution Margin</b><small>هامش المساهمة بعد تكاليف التشغيل والدفع</small></div></div></div></div>`;}

function go(view){state.view=view;persist();render();window.scrollTo({top:0,behavior:'smooth'});}
const authClient = createAuthClient("https://ep-tiny-mud-becp4j1y.neonauth.c-9.us-east-2.aws.neon.tech/neondb/auth");
let authMode="signin",authSession=null,currentProfile=null,pendingBookingCarId=null;
let paymentSettings={methods:{instapay:{enabled:false,recipient:null,displayName:null},cash:{enabled:true}},depositPercent:30};
async function getAuthToken(){
 const result=await authClient.token?.();
 const token=result?.data?.token;
 return typeof token==="string"&&token.length>20?token:null;
}
function roleForProfile(p){const r=p?.roles||[];if(r.includes("admin")||r.includes("finance_admin")||r.includes("operations_admin"))return "admin";if(r.includes("owner"))return "owner";if(r.includes("driver"))return "driver";return "customer";}
function applyProfile(p){currentProfile=p;state.role=roleForProfile(p);state.view=roleConfig[state.role].default;updateAccountButton();render();}
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
  if(stage==="session")return "بيانات الدخول وصلت لخدمة المصادقة، لكن استرجاع جلسة الحساب رجع 404. هنراجع مسار الجلسة، ومش محتاج تعيد إنشاء حسابك.";
  if(stage==="profile")return "تمت المصادقة، لكن ملف العميل غير متاح على الخادم حاليًا. حسابك لم يُحذف؛ هنراجع ربط الملف.";
  return "خدمة المصادقة لم تتعرف على طلب الدخول لهذا الحساب. لا تنشئ حسابًا جديدًا بنفس الرقم؛ هنراجع ربط الحساب وكلمة المرور.";
 }
 if(status===401||/bad_credentials|invalid_email_or_password|invalid password/i.test(code+" "+raw))return "رقم الموبايل أو كلمة المرور غير صحيحة. راجع البيانات وحاول تاني.";
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
  if(authData?.user){
   authSession={user:authData.user,session:authData.session||null};
  }else{
   stage="session";
   const session=await authClient.getSession();
   authSession=session?.data||null;
  }
  if(!authSession?.user){
   if(authMode==="signup"){toast("الحساب اتعمل. سجّل الدخول بنفس رقم الموبايل وكلمة المرور.");openAuthModal("signin");return;}
   throw new Error("تعذر استعادة جلسة الدخول.");
  }
  stage="profile";
  await loadProfile(signupDetails);
 }catch(e){
  showAuthError(friendlyAuthError(e,stage));
 }finally{
  const button=document.querySelector("#auth-submit-button");
  if(button){button.disabled=false;button.textContent=authMode==="signup"?"إنشاء حسابي":"دخول إلى حسابي";}
 }
}

async function loadProfile(signupDetails=null){
 const token=await getAuthToken();if(!token)throw new Error("تعذر الحصول على جلسة آمنة.");
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
async function restoreAuthSession(){try{const r=await authClient.getSession();authSession=r?.data||null;if(!authSession?.user){updateAccountButton();return;}await loadProfile();}catch{authSession=null;currentProfile=null;updateAccountButton();}}
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
function carDetails(id){const c=carById(id);if(!c)return;activeCarId=id;const body=`<div class="car-art ${escapeHtml(c.color)}" style="height:180px;border-radius:13px">${carArt(c.color)}<span class="car-badge">✓ سيارة معتمدة</span></div><div class="car-title-row" style="margin-top:15px"><div><h3 style="font-size:18px">${escapeHtml(c.brand)} ${escapeHtml(c.model)}</h3><div class="car-sub">${c.year} · ${escapeHtml(c.zone)}</div></div><span class="rating">★ ${c.rating.toFixed(1)} (${c.reviews})</span></div><div class="car-meta"><span>♙ ${c.seats} أفراد</span><span>⚙ ${escapeHtml(c.transmission)}</span><span>✓ بسائق</span><span>${c.ownerType==='fleet'?'أسطول زفّة':'مالك مستقل موثّق'}</span></div><h3 style="margin:12px 0 8px">مميزات السيارة</h3><div class="filter-row">${c.features.map(f=>`<span class="filter-chip">${escapeHtml(f)}</span>`).join('')}</div><div class="summary-box"><div class="summary-line"><span>باقة كلاسيك — 3 ساعات</span><b>${money(c.packagePrices.classic)}</b></div><div class="summary-line"><span>الخدمة</span><b>سيارة بسائق</b></div><div class="summary-line"><span>نطاق التغطية</span><b>${escapeHtml(c.zone)}</b></div></div>${c.ownerType==='independent'?'<div class="notice">الحجز يتطلب موافقة المالك قبل التأكيد النهائي.</div>':''}`;
 openModal('تفاصيل السيارة',body,`<button class="btn btn-outline" data-action="close-modal">إغلاق</button><button class="btn btn-primary" data-action="book" data-id="${c.id}">اختار الباقة واحجز</button>`);}
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
function assignDriver(id){const b=bookingById(id);if(!b)return;try{assertBookingTransition(b.status,'driver_assigned');}catch{return toast('لا يمكن تعيين سائق قبل تأكيد الحجز');}b.driverId='driver1';b.status='driver_assigned';persist();closeModal();render();toast('تم إسناد السائق التجريبي للحجز',true);}
function addCar(){const body=`<form id="add-car-form"><div class="modal-grid"><div class="field"><label>الماركة</label><input name="brand" required placeholder="Mercedes-Benz"></div><div class="field"><label>الموديل</label><input name="model" required placeholder="E-Class"></div><div class="field"><label>سنة الصنع</label><input name="year" type="number" min="2000" max="2035" required value="2022"></div><div class="field"><label>رقم اللوحة</label><input name="plate" required placeholder="أ ق ص ١٢٣٤"></div><div class="field"><label>عدد المقاعد</label><select name="seats"><option>4</option><option>5</option><option>7</option></select></div><div class="field"><label>المنطقة</label><select name="zone"><option>الأقصر</option><option>الأقصر والكرنك</option><option>الأقصر والبياضية</option><option>الأقصر والقرنة</option></select></div><div class="field"><label>سعر باقة ميني</label><input name="mini" type="number" required value="1500"></div><div class="field"><label>سعر باقة كلاسيك</label><input name="classic" type="number" required value="2100"></div></div><div class="notice warning">سيتم حفظ السيارة كطلب اعتماد تجريبي. لا ترفع مستندات أو بيانات شخصية في هذه النسخة.</div></form>`;openModal('إضافة سيارة جديدة',body,`<button class="btn btn-outline" data-action="close-modal">إلغاء</button><button class="btn btn-primary" data-action="save-car">حفظ السيارة</button>`);}
function saveCar(){const f=document.querySelector('#add-car-form');if(!f?.reportValidity())return;const d=new FormData(f);const id=`car${Date.now()}`;state.cars.push({id,brand:d.get('brand'),model:d.get('model'),year:Number(d.get('year')),color:'silver',plate:d.get('plate'),seats:Number(d.get('seats')),transmission:'أوتوماتيك',ownerType:'independent',ownerId:'owner1',zone:d.get('zone'),packagePrices:{mini:Number(d.get('mini')),classic:Number(d.get('classic')),wedding:Number(d.get('classic'))*1.55,royal:Number(d.get('classic'))*1.95},rating:0,reviews:0,approval:'pending',features:['تحتاج مراجعة'],driverIncluded:true});persist();closeModal();render();toast('تم حفظ السيارة في قائمة انتظار الاعتماد التجريبية',true);}
function editCar(id){const c=carById(id);if(!c)return;openModal('بيانات السيارة',`<div class="notice">${escapeHtml(c.brand)} ${escapeHtml(c.model)} — ${escapeHtml(c.plate)}</div><p style="font-size:11px;color:#77848a">تحرير الأسعار والمعلومات سيتم توسيعه بعد اعتماد نموذج السيارة والمستندات.</p>`,`<button class="btn btn-outline" data-action="close-modal">إغلاق</button>`);}

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
  else if(action==='assign-driver')assignDriver(id);
 else if(action==='driver-status')updateBookingStatus(id,btn.dataset.status);
 else if(action==='add-car')addCar();
 else if(action==='save-car')saveCar();
 else if(action==='edit-car')editCar(id);
 else if(action==='approve-car'||action==='reject-car'){const c=carById(id);if(c)c.approval=action==='approve-car'?'approved':'rejected';persist();render();toast(action==='approve-car'?'تم تغيير الحالة إلى معتمدة تجريبيًا':'تم رفض السيارة تجريبيًا',true);}
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
   id:v.id,brand:v.brand,model:v.model,year:Number(v.year),color:"silver",plate:"",seats:Number(v.seats),
   transmission:v.transmission||"أوتوماتيك",ownerType:["fleet_partner","premium_partner"].includes(v.owner_type)?"fleet":"independent",
   ownerId:v.owner_id,zone:Array.isArray(v.service_zones)&&v.service_zones.length?v.service_zones.join("، "):"الأقصر",
   packagePrices:Object.fromEntries(Object.entries(v.package_prices||{}).map(([k,val])=>[k,Number(val)])),
   rating:0,reviews:0,approval:"approved",features:[],driverIncluded:v.driver_included===true
  }));render();
 }catch(e){console.warn("[ZAFFA] catalog refresh failed",e?.message||"unknown");}
}
async function refreshBackendStatus() {
  const badge = document.querySelector('#backend-status');
  if (!badge) return;
  badge.className = 'backend-status connecting';
  badge.innerHTML = '<span class="backend-dot"></span> جاري الاتصال بقاعدة البيانات';
  try {
    const response = await fetch('/api/health', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    const payload = await response.json();
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.code || 'BACKEND_UNAVAILABLE');
    }
    badge.className = 'backend-status online';
    badge.innerHTML = '<span class="backend-dot"></span> Neon متصلة';
    badge.title = `قاعدة البيانات متصلة — ${Number(payload.approvedVehicles || 0)} سيارات معتمدة`;
  } catch {
    badge.className = 'backend-status offline';
    badge.innerHTML = '<span class="backend-dot"></span> قاعدة البيانات غير متاحة';
    badge.title = 'تعذر الوصول إلى API أو قاعدة Neon';
  }
}
refreshBackendStatus();
