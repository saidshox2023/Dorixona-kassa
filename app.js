import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager, doc, onSnapshot, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

var app=initializeApp(window.FIREBASE_CONFIG);
var auth=getAuth(app);
var fdb=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentSingleTabManager()})});
var ref=doc(fdb,'kassa','main');

var MONTHS=['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr'];
var TICK='<svg class="tick" viewBox="0 0 32 24" aria-hidden="true"><path d="M3 12.5c2.6 1.6 4.6 4.2 6.4 8.2C13.8 12 19.6 5.6 29 2.2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var PENCIL='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.8 2.2l3 3L5.5 13.5 2 14l.5-3.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
var SW=400,SH=160;

var state=clone(window.INITIAL_STATE);
var saved=clone(state);
var loaded=false,dirty=false,saving=false,user=null,canEdit=false,remoteWaiting=null;
var ui={tab:'gaps',gap:null,open:null,edit:false,del:null,sign:null};
try{var s=JSON.parse(sessionStorage.getItem('kassa-ui')||'null');if(s){ui.tab=s.tab||ui.tab;ui.gap=s.gap||null;ui.open=s.open||null;}}catch(e){}
var sig={strokes:[]};

function clone(o){return JSON.parse(JSON.stringify(o));}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function num(n){n=+n||0;var r=Math.round(Math.abs(n));return (n<0?'−':'')+String(r).replace(/\B(?=(\d{3})+(?!\d))/g,' ');}
function cur(){return state.settings.cur||'$';}
function usd(n){return cur()+num(n);}
function som(n){return num(n)+' soʻm';}
function lotsTxt(x){x=Math.round((+x||0)*100)/100;return String(x).replace('.',',');}
function toNum(v){var t=String(v).replace(/\s| /g,'').replace(',','.').replace(/[^\d.]/g,'');return t?+t:0;}
function parseISO(d){var p=String(d).split('-');return new Date(+p[0],(+p[1]||1)-1,+p[2]||1);}
function dmy(d){var p=String(d).split('-');return p.length===3?p[2]+'.'+p[1]+'.'+p[0]:d;}
function dayMonth(dt){return dt.getDate()+'-'+MONTHS[dt.getMonth()];}
function iso(dt){return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');}
function stamp(){var d=new Date();return iso(d)+'T'+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function atTxt(a){if(!a)return '';var p=String(a).split('T');return dmy(p[0])+(p[1]?', '+p[1].slice(0,5):'');}
function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function member(id){return state.members.find(function(m){return m.id===id;})||{id:id,name:'(oʻchirilgan)',lots:0};}
function active(){return state.members.filter(function(m){return m.active!==false;});}
function sorted(){return state.gaps.slice().sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:0;});}
function gapNo(g){return sorted().indexOf(g)+1;}
function pot(g){return g.rows.reduce(function(s,r){return s+(+r.amt||0);},0);}
function collected(g){return g.rows.reduce(function(s,r){return s+(r.paid?(+r.amt||0):0);},0);}
function isEdit(){return canEdit&&ui.edit;}
function curGap(){var gs=sorted();return gs.find(function(x){return x.id===ui.gap;})||gs[gs.length-1]||null;}
function names(ids){return ids.map(function(id){return member(id).name;});}
function prevRate(g){var gs=sorted(),i=gs.indexOf(g);for(var j=(i<0?gs.length:i)-1;j>=0;j--)if(+gs[j].rate)return +gs[j].rate;return 0;}

function stats(){
  var st={};state.members.forEach(function(m){st[m.id]={paid:0,due:0,won:0,parts:0,exp:0,hist:[]};});
  sorted().forEach(function(g,i){
    var p=pot(g),per=g.rows.length?(+g.expense||0)/g.rows.length:0;
    g.rows.forEach(function(r){var s=st[r.m];if(!s)return;var a=+r.amt||0;if(r.paid)s.paid+=a;else s.due+=a;s.exp+=per;s.hist.push({g:g,n:i+1,amt:a,paid:!!r.paid,won:0});});
    (g.winners||[]).forEach(function(w){var s=st[w.m];if(!s)return;s.won+=p*w.part;s.parts+=w.part;var h=s.hist.find(function(x){return x.g===g;});if(h)h.won=p*w.part;else s.hist.push({g:g,n:i+1,amt:0,paid:true,won:p*w.part,absent:true});});
  });
  return st;
}
function pool(excludeId){
  var won={};state.gaps.forEach(function(g){if(g.id===excludeId)return;(g.winners||[]).forEach(function(w){won[w.m]=(won[w.m]||0)+w.part;});});
  var t=[],halves=[];
  active().forEach(function(m){var r=Math.round(((+m.lots||0)-(won[m.id]||0))*100)/100;if(r<=0)return;var f=Math.floor(r+1e-9);for(var i=0;i<f;i++)t.push({ms:[m.id],part:1});if(r-f>=0.49)halves.push(m.id);});
  for(var i=0;i<halves.length;i+=2)t.push({ms:halves.slice(i,i+2),part:0.5});
  return t;
}
function tLabel(t){return names(t.ms).join(' + ')+(t.part<1&&t.ms.length<2?' (yarim)':'');}
function tKey(t){return t.ms.join('+')+'|'+t.part;}
function nextGap(){var day=+state.settings.day||15,t=new Date();t.setHours(0,0,0,0);var c=new Date(t.getFullYear(),t.getMonth(),day);if(c<t)c=new Date(t.getFullYear(),t.getMonth()+1,day);return {dt:c,diff:Math.round((c-t)/864e5)};}
function newGapDate(){var gs=sorted(),day=+state.settings.day||15;if(!gs.length)return iso(nextGap().dt);var l=parseISO(gs[gs.length-1].date);return iso(new Date(l.getFullYear(),l.getMonth()+1,day));}
function dots(total,used){
  var h='',full=Math.floor(total+1e-9),half=total-full>=0.49,u=used;
  for(var i=0;i<full;i++){var usedThis=u>=1-1e-9;h+='<i class="dot'+(usedThis?' used':'')+'"></i>';if(usedThis)u-=1;}
  if(half)h+='<i class="dot half'+(u>=0.49?' used':'')+'"></i>';
  return '<span class="dots" aria-hidden="true">'+h+'</span>';
}
function sigSvg(d,cls){return '<svg class="'+(cls||'sig')+'" viewBox="0 0 '+SW+' '+SH+'" preserveAspectRatio="xMinYMid meet" aria-hidden="true"><path d="'+esc(d)+'" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';}

/* ---------- views ---------- */
function header(){
  var gs=sorted(),last=gs[gs.length-1],day=+state.settings.day||15;
  var total=active().reduce(function(s,m){return s+(+m.lots||0);},0);
  var wonP=0;state.gaps.forEach(function(g){(g.winners||[]).forEach(function(w){if(member(w.m).active!==false)wonP+=w.part;});});
  var kassa=last?pot(last):total*(+state.settings.lotPrice||0);
  var ng=nextGap(),left=Math.round((total-wonP)*100)/100;
  var eb=canEdit?'<button class="btn sm'+(ui.edit?' on':'')+'" data-act="toggle-edit" aria-pressed="'+ui.edit+'">'+(ui.edit?'Tayyor':PENCIL+'Tahrirlash')+'</button>':'';
  return '<header class="top"><div><div class="eyebrow">Kassa · har oyning '+day+'-sanasi</div><h1>'+esc(state.settings.name||'Kassa')+'</h1></div>'+eb+'</header>'+
    '<div class="stats">'+
    stat('Kassa',usd(kassa),active().length+' aʼzo · '+lotsTxt(total)+' qurʼa')+
    stat('Qurʼa chiqdi',lotsTxt(wonP)+' / '+lotsTxt(total),left>0?lotsTxt(left)+' ta qoldi':'davra tugadi')+
    stat('Keyingi gap',dayMonth(ng.dt),ng.diff===0?'bugun':ng.diff+' kun qoldi')+
    '</div>';
}
function stat(k,v,s){return '<div class="stat"><div class="k">'+k+'</div><div class="v">'+esc(v)+'</div><div class="s">'+esc(s)+'</div></div>';}
function tabs(){
  var t=[['gaps','Gaplar'],['lots','Qurʼalar'],['members','Aʼzolar']];
  return '<nav class="tabs" role="tablist">'+t.map(function(x){return '<button class="tab" role="tab" id="tab-'+x[0]+'" aria-selected="'+(ui.tab===x[0])+'" data-act="tab" data-v="'+x[0]+'">'+x[1]+'</button>';}).join('')+'</nav>';
}

function gapsView(){
  var E=isEdit(),gs=sorted(),g=curGap();
  var chips=(E?'<button class="chip add" data-act="new-gap">+ Yangi gap</button>':'')+gs.slice().reverse().map(function(x){var i=gs.indexOf(x);return '<button class="chip" data-act="pick-gap" data-v="'+x.id+'" aria-pressed="'+(!!g&&x.id===g.id)+'">'+(i+1)+'-gap · '+dmy(x.date).slice(0,5)+'</button>';}).join('');
  var h='<div class="chips">'+chips+'</div>';
  if(!g)return h+'<p class="empty">Hali gap yoʻq.'+(E?' “+ Yangi gap” tugmasini bosing.':'')+'</p>';
  var n=gapNo(g),p=pot(g),c=collected(g),rate=+g.rate||0,wids=(g.winners||[]).map(function(w){return w.m;});
  var rows=g.rows.map(function(r,i){
    var m=member(r.m),isW=wids.indexOf(r.m)>=0;
    var mark=E?'<button class="mark" data-act="toggle-paid" data-v="'+i+'" aria-pressed="'+!!r.paid+'" aria-label="'+esc(m.name)+(r.paid?': toʻladi':': toʻlamadi')+'">'+(r.paid?TICK:'<span class="box"></span>')+'</button>'
      :'<span class="mark" aria-label="'+(r.paid?'toʻladi':'toʻlamagan')+'">'+(r.paid?TICK:'<span class="pending">toʻlamagan</span>')+'</span>';
    var amt=E?'<input class="in amt-in" id="amt-'+g.id+'-'+r.m+'" data-f="amt" data-v="'+i+'" inputmode="numeric" aria-label="'+esc(m.name)+' summasi" value="'+(+r.amt||0)+'">':'<span class="amt">'+usd(r.amt)+'</span>';
    return '<li class="row '+(r.paid?'paid':'due')+'"><span class="no">'+(i+1)+'</span><span class="nm">'+esc(m.name)+(isW?'<span class="hand took">— oldi</span>':'')+'</span>'+amt+mark+(E?'<button class="x" data-act="rm-row" data-v="'+i+'" aria-label="'+esc(m.name)+'ni bu gapdan olib tashlash">×</button>':'')+'</li>';
  }).join('');
  var unpaid=g.rows.filter(function(r){return !r.paid;});
  var pct=p?Math.round(c/p*100):0;
  h+='<section class="sheet"><div class="sheet-head"><span class="hand hand-lg">'+n+'-gap</span><span class="hand">'+esc(dmy(g.date))+'</span></div>'+
    '<ol class="rows'+(E?' edit':'')+'">'+rows+'</ol>'+
    '<div class="sum"><span class="lbl">Jami</span><b class="amt big">'+usd(p)+'</b></div>'+
    (rate?'<div class="conv">≈ '+som(p*rate)+' · kurs '+num(rate)+'</div>':'')+
    '<div class="bar" role="img" aria-label="Yigʻildi '+pct+'%"><i style="width:'+pct+'%"></i></div>'+
    '<div class="collect"><span>Yigʻildi <b>'+usd(c)+'</b></span>'+(p-c>0?'<span class="d">Qoldi <b>'+usd(p-c)+'</b></span>':'')+'</div>'+
    (unpaid.length?'<p class="unpaid"><b>Toʻlamaganlar:</b> '+esc(unpaid.map(function(r){return member(r.m).name;}).join(', '))+'</p>':(g.rows.length?'<p class="allpaid">Hamma toʻladi</p>':''));
  if(E){
    var missing=active().filter(function(m){return !g.rows.some(function(r){return r.m===m.id;});});
    if(missing.length)h+='<div class="addrow"><select class="in" id="add-row-sel" aria-label="Aʼzo tanlang">'+missing.map(function(m){return '<option value="'+m.id+'">'+esc(m.name)+' · '+usd((+m.lots||0)*(+state.settings.lotPrice||0))+'</option>';}).join('')+'</select><button class="btn" data-act="add-row">Qoʻshish</button></div>';
  }
  h+='</section>';

  var per=g.rows.length?(+g.expense||0)/g.rows.length:0,pr=prevRate(g);
  h+='<h2>Gap tafsilotlari</h2><dl class="facts">';
  if(E){
    h+=fact('Sana','<input class="in" type="date" id="g-date-'+g.id+'" data-f="g-date" value="'+esc(g.date)+'">')+
      fact('Dollar kursi','<input class="in" id="g-rate-'+g.id+'" data-f="g-rate" inputmode="decimal" placeholder="'+(pr?'oldingi gapda: '+num(pr):'masalan: 12 050')+'" value="'+(rate||'')+'"><small>1 '+esc(cur())+' necha soʻm — shu kungi kurs'+(rate?' · kassa ≈ '+som(p*rate):'')+'</small>')+
      fact('Joy','<input class="in" id="g-place-'+g.id+'" data-f="g-place" placeholder="Samovar, xona" value="'+esc(g.place)+'">')+
      fact('Taom','<input class="in" id="g-food-'+g.id+'" data-f="g-food" placeholder="Osh, 1,4 kg" value="'+esc(g.food)+'">')+
      fact('Xarajat, soʻm','<input class="in" id="g-exp-'+g.id+'" data-f="g-exp" inputmode="numeric" value="'+(+g.expense||0)+'"><small>Har kishiga '+som(per)+'</small>')+
      fact('Izoh','<input class="in" id="g-note-'+g.id+'" data-f="g-note" value="'+esc(g.note)+'">');
  }else{
    h+=fact('Dollar kursi',rate?'1 '+esc(cur())+' = '+som(rate)+'<small>Kassa soʻmda: '+som(p*rate)+'</small>':'<span class="muted">yozilmagan</span>')+
      fact('Joy',esc(g.place||'—'))+fact('Taom',esc(g.food||'—'))+
      fact('Xarajat',(+g.expense?som(g.expense)+'<small>'+g.rows.length+' kishiga teng: har kishiga '+som(per)+(rate?' (≈ '+usd(per/rate)+')':'')+'</small>':'—'))+
      (g.note?fact('Izoh',esc(g.note)):'');
  }
  h+='</dl>';

  var ws=g.winners||[];
  if(ws.length){
    var amt=p*ws[0].part,multi=ws.length>1;
    h+='<div class="won"><div class="won-top"><div><div class="k">Kassani oldi</div><div class="hand">'+esc(names(wids).join(' va '))+'</div></div><div class="r"><b class="amt big">'+usd(amt)+'</b>'+(multi?'<small>har biriga</small>':'')+(rate?'<small>≈ '+som(amt*rate)+'</small>':'')+'</div></div>'+
      ws.map(function(w){return signBlock(g,w,E,multi,amt);}).join('')+'</div>';
  }else{
    h+='<div class="won none">Bu gapda kassani hali hech kim olmagan.</div>';
  }
  if(E){
    var pl=pool(g.id),seen={},opts='<option value="">— hali hech kim —</option>',curW=ws.length?wids.join('+')+'|'+ws[0].part:'';
    pl.forEach(function(t){var k=tKey(t);if(seen[k]){seen[k].c++;return;}seen[k]={t:t,c:1};});
    if(curW&&!seen[curW])seen[curW]={t:{ms:wids,part:ws[0].part},c:1};
    Object.keys(seen).forEach(function(k){opts+='<option value="'+esc(k)+'"'+(k===curW?' selected':'')+'>'+esc(tLabel(seen[k].t))+(seen[k].c>1?' · '+seen[k].c+' qurʼasi bor':'')+'</option>';});
    h+='<div class="won-edit"><label for="win-'+g.id+'" class="note" style="margin:0">Qurʼada kim chiqdi?</label><select class="in" id="win-'+g.id+'" data-f="g-win">'+opts+'</select></div>';
    h+=ui.del===g.id?'<div class="del">'+n+'-gap butunlay oʻchiriladi. <button class="btn sm danger" data-act="del-gap-yes">Ha, oʻchirish</button><button class="btn sm" data-act="del-gap-no">Yoʻq</button></div>'
      :'<div class="del"><button class="btn sm danger" data-act="del-gap">Bu gapni oʻchirish</button></div>';
  }
  return h;
}
function signBlock(g,w,E,multi,amt){
  var s=(g.signs||{})[w.m],nm=member(w.m).name;
  if(E&&ui.sign&&ui.sign.g===g.id&&ui.sign.m===w.m){
    return '<div class="pad"><div class="pad-k"><b>'+esc(nm)+'</b>: “'+gapNo(g)+'-gap kassasini, '+usd(amt)+', oldim.” Pastdagi chiziqqa barmoq bilan imzo qoʻying.</div>'+
      '<canvas id="sigpad" aria-label="Imzo maydoni"></canvas>'+
      '<div class="pad-acts"><button class="btn sm" data-act="sig-clear">Tozalash</button><button class="btn sm" data-act="sig-cancel">Bekor qilish</button><button class="btn sm primary" data-act="sig-ok">Imzoni tasdiqlash</button></div></div>';
  }
  if(s&&s.d){
    return '<div class="sign"><div class="sigline">'+sigSvg(s.d)+'</div><div class="sigcap"><span>'+esc(nm)+' imzosi</span><span>'+esc(atTxt(s.at))+'</span></div>'+
      (E?'<div><button class="btn sm" data-act="sig-open" data-v="'+w.m+'">Qayta imzo qoʻydirish</button></div>':'')+'</div>';
  }
  return E?'<div><button class="btn primary" data-act="sig-open" data-v="'+w.m+'">'+esc(nm)+' imzo qoʻysin</button></div>'
    :'<div><span class="pending">'+esc(nm)+' hali imzo qoʻymagan</span></div>';
}
function fact(k,v){return '<div class="fact"><dt>'+k+'</dt><dd>'+v+'</dd></div>';}

function lotsView(){
  var st=stats(),gs=sorted(),t=pool(null);
  var wonGaps=gs.filter(function(g){return g.winners&&g.winners.length;});
  var cells=wonGaps.map(function(g){return '<span class="lot won" title="'+esc(names(g.winners.map(function(w){return w.m;})).join(' va '))+'">'+gapNo(g)+'</span>';}).join('')+t.map(function(){return '<span class="lot"></span>';}).join('');
  var last=gs[gs.length-1],endTxt='';
  if(t.length&&last){var k=t.length-((last.winners&&last.winners.length)?0:1),b=parseISO(last.date),e=new Date(b.getFullYear(),b.getMonth()+k,+state.settings.day||15);endTxt=' · oxirgi gap taxminan <strong>'+MONTHS[e.getMonth()]+' '+e.getFullYear()+'</strong>';}
  var h='<h2>Qurʼalar · har katak — bitta kassa</h2><div class="lotstrip" aria-hidden="true">'+cells+'</div>'+
    '<p class="lotnote"><b>'+wonGaps.length+'</b> tasi chiqdi · <b>'+t.length+'</b> tasi qoldi'+endTxt+'</p>';

  var list=active().map(function(m){var tot=+m.lots||0,won=(st[m.id]||{}).parts||0;return {m:m,tot:tot,won:won,left:Math.round((tot-won)*100)/100};});
  list.sort(function(a,b){return (b.left>0)-(a.left>0)||b.left-a.left||a.m.name.localeCompare(b.m.name);});
  h+='<h2>Kimda nechta kassa qoldi</h2><div class="ltable" role="table"><div class="lrow lhead" role="row"><span role="columnheader">Aʼzo</span><span role="columnheader">Qurʼa</span><span role="columnheader">Oldi</span><span role="columnheader">Qoldi</span></div>'+
    list.map(function(x){return '<div class="lrow'+(x.left>0?'':' done')+'" role="row"><span class="lname" role="cell">'+esc(x.m.name)+dots(x.tot,x.won)+'</span><span class="n" role="cell">'+lotsTxt(x.tot)+'</span><span class="n" role="cell">'+(x.won?lotsTxt(x.won):'—')+'</span><span class="n left" role="cell">'+(x.left>0?lotsTxt(x.left):'—')+'</span></div>';}).join('')+'</div>';
  var pairs=t.filter(function(x){return x.ms.length>1;});
  if(pairs.length)h+='<p class="note">Yarim qurʼalar juftlanadi: '+esc(pairs.map(function(x){return names(x.ms).join(' + ');}).join('; '))+'. Shu qurʼa chiqsa, kassa ikkalasiga teng boʻlinadi.</p>';

  h+='<h2>Kassani olganlar · '+wonGaps.length+'</h2>';
  h+=wonGaps.length?'<ul class="plist">'+wonGaps.map(function(g){
    var ws=g.winners,p=pot(g),rate=+g.rate||0;
    var sg=ws.map(function(w){var s=(g.signs||{})[w.m];return s&&s.d?sigSvg(s.d,'sigmini'):'<span class="pending">imzosiz</span>';}).join('');
    return '<li><span>'+esc(names(ws.map(function(w){return w.m;})).join(' va '))+'<small>'+gapNo(g)+'-gap · '+dmy(g.date)+' · '+usd(p*ws[0].part)+(ws.length>1?' dan':'')+(rate?' ≈ '+som(p*ws[0].part*rate):'')+'</small></span><span class="rt">'+sg+'</span></li>';
  }).join('')+'</ul>':'<p class="empty">Hali hech kim olmagan.</p>';
  return h;
}

function membersView(){
  var E=isEdit(),st=stats(),price=+state.settings.lotPrice||0;
  var tp=0,td=0;Object.keys(st).forEach(function(k){tp+=st[k].paid;td+=st[k].due;});
  var h='<div class="summary"><span>Jami berildi <b>'+usd(tp)+'</b></span>'+(td>0?'<span class="d">Qarz <b>'+usd(td)+'</b></span>':'<span>Qarz yoʻq</span>')+'<span>1 qurʼa = <b>'+usd(price)+'</b></span></div>';
  var act=active(),out=state.members.filter(function(m){return m.active===false;});
  if(E){
    h+='<ul class="mlist">'+act.map(function(m){
      return '<li class="mrow"><div class="medit"><input class="in" id="mn-'+m.id+'" data-f="mname" data-v="'+m.id+'" value="'+esc(m.name)+'" aria-label="Ism">'+
        '<div class="stepper"><button data-act="lots-" data-v="'+m.id+'" aria-label="Kamaytirish">−</button><span><b>'+usd((+m.lots||0)*price)+'</b>'+lotsTxt(m.lots)+' qurʼa</span><button data-act="lots+" data-v="'+m.id+'" aria-label="Koʻpaytirish">+</button></div>'+
        '<button class="btn sm danger" data-act="deact" data-v="'+m.id+'">Chiqarish</button></div></li>';
    }).join('')+'</ul>';
    h+='<div class="addform"><input class="in" id="new-name" placeholder="Yangi aʼzo ismi" aria-label="Yangi aʼzo ismi"><select class="in" id="new-lots" aria-label="Qurʼa soni">'+[0.5,1,1.5,2,2.5,3,4,5].map(function(x){return '<option value="'+x+'"'+(x===1?' selected':'')+'>'+lotsTxt(x)+' qurʼa</option>';}).join('')+'</select><button class="btn primary" data-act="add-member">Qoʻshish</button></div>'+
      '<p class="note">Qurʼa soni oʻzgarsa, faqat keyingi yangi gaplarga taʼsir qiladi. Eski gapdagi summani gap sahifasida tuzatish mumkin.</p>';
    if(out.length)h+='<h2>Chiqib ketganlar</h2><ul class="plist">'+out.map(function(m){return '<li><span>'+esc(m.name)+'</span><button class="btn sm" data-act="react" data-v="'+m.id+'">Qaytarish</button></li>';}).join('')+'</ul>';
    h+='<h2>Sozlamalar</h2><div class="settings"><label>Kassa nomi<input class="in" id="set-name" data-f="set-name" value="'+esc(state.settings.name)+'"></label><label>1 qurʼa narxi<input class="in" id="set-price" data-f="set-price" inputmode="numeric" value="'+price+'"></label><label>Valyuta<input class="in" id="set-cur" data-f="set-cur" value="'+esc(state.settings.cur)+'"></label><label>Gap kuni<input class="in" id="set-day" data-f="set-day" inputmode="numeric" value="'+(+state.settings.day||15)+'"></label></div>';
    return h;
  }
  function row(m,isOut){
    var s=st[m.id]||{paid:0,due:0,won:0,parts:0,exp:0,hist:[]},open=ui.open===m.id;
    var pills=(isOut?'<span class="pill out">chiqqan</span>':'')+(s.due>0?'<span class="pill due">Qarz '+usd(s.due)+'</span>':(s.hist.length?'<span class="pill ok">Toʻliq</span>':''))+(s.won>0?'<span class="pill won">Oldi '+usd(s.won)+'</span>':'');
    var r='<li class="mrow"><button class="mbtn" data-act="open" data-v="'+m.id+'" aria-expanded="'+open+'"><span class="mname">'+esc(m.name)+'</span><span class="pills">'+pills+'</span>'+
      '<span class="mmeta">'+dots(+m.lots||0,s.parts)+'<span>Ulush <b>'+usd((+m.lots||0)*price)+'</b></span><span>Berdi <b>'+usd(s.paid)+'</b></span>'+(s.exp?'<span>Xarajat '+som(s.exp)+'</span>':'')+'</span></button>';
    if(open){
      r+='<ul class="hist">'+(s.hist.length?s.hist.map(function(x){
        return '<li><span>'+x.n+'-gap · '+dmy(x.g.date).slice(0,5)+(x.won?' · <b>kassani oldi '+usd(x.won)+'</b>':'')+'</span><span class="amt">'+(x.absent?'':usd(x.amt))+'</span><span class="'+(x.paid?'':'pending')+'">'+(x.absent?'':x.paid?'toʻladi':'toʻlamagan')+'</span></li>';
      }).join(''):'<li class="muted">Hali gaplarda qatnashmagan</li>')+'</ul>';
    }
    return r+'</li>';
  }
  h+='<ul class="mlist">'+act.map(function(m){return row(m,false);}).join('')+'</ul>';
  var outH=out.filter(function(m){return st[m.id]&&st[m.id].hist.length;});
  if(outH.length)h+='<h2>Chiqib ketganlar</h2><ul class="mlist">'+outH.map(function(m){return row(m,true);}).join('')+'</ul>';
  h+='<p class="note"><span class="dots"><i class="dot"></i></span> qurʼada bor · <span class="dots"><i class="dot used"></i></span> chiqib boʻlgan · <span class="dots"><i class="dot half"></i></span> yarim qurʼa</p>';
  return h;
}

function saveBar(){
  if(!dirty)return '';
  return '<div class="savebar"><div class="in-bar"><span class="msg">'+(saving?'Saqlanmoqda…':'Oʻzgarishlar saqlanmagan')+'</span><span class="acts"><button class="btn sm" data-act="discard"'+(saving?' disabled':'')+'>Bekor qilish</button><button class="btn sm primary" data-act="save"'+(saving?' disabled':'')+'>Saqlash</button></span></div></div>';
}
function footer(){
  var upd=state.updatedAt?'Yangilandi: '+esc(atTxt(state.updatedAt)):(loaded?'':'Yuklanmoqda…');
  var right=user?'<button class="linkbtn" data-act="signout">Chiqish ('+esc(user.email||'')+')</button>'
    :'<button class="linkbtn" data-act="signin">Egasi uchun kirish</button>';
  return '<div class="foot"><span>'+upd+'</span>'+right+'</div>';
}

function render(){
  var body=ui.tab==='members'?membersView():ui.tab==='lots'?lotsView():gapsView();
  document.getElementById('app').innerHTML=header()+tabs()+'<main>'+body+'</main>'+footer()+saveBar();
  initPad();
}
var rq=0;
function later(){if(rq)return;rq=requestAnimationFrame(function(){rq=0;var a=document.activeElement,id=a&&a.id,sel=null;try{sel=a.selectionStart;}catch(e){}render();if(id){var n=document.getElementById(id);if(n&&n!==document.activeElement){try{n.focus({preventScroll:true});if(sel!=null)n.setSelectionRange(sel,sel);}catch(e){}}}});}
function mark(){if(!dirty){dirty=true;later();}}
var tt=0;
function toast(msg){var el=document.getElementById('toast');el.textContent=msg;el.hidden=false;clearTimeout(tt);tt=setTimeout(function(){el.hidden=true;},4200);}
function stash(){try{sessionStorage.setItem('kassa-ui',JSON.stringify({tab:ui.tab,gap:ui.gap,open:ui.open}));}catch(e){}}

/* ---------- signature pad ---------- */
function r2(v){return Math.round(v*2)/2;}
function toD(strokes){
  return strokes.map(function(p){
    if(!p.length)return '';
    var d='M'+p[0][0]+' '+p[0][1];
    if(p.length===1)return d+'l0.1 0';
    for(var i=1;i<p.length-1;i++)d+='Q'+p[i][0]+' '+p[i][1]+' '+r2((p[i][0]+p[i+1][0])/2)+' '+r2((p[i][1]+p[i+1][1])/2);
    var l=p[p.length-1];return d+'L'+l[0]+' '+l[1];
  }).join('');
}
function initPad(){
  var c=document.getElementById('sigpad');if(!c)return;
  var rect=c.getBoundingClientRect();if(!rect.width)return;
  var dpr=window.devicePixelRatio||1,k=rect.width/SW;
  c.width=Math.round(rect.width*dpr);c.height=Math.round(rect.width/SW*SH*dpr);
  var ctx=c.getContext('2d');ctx.setTransform(dpr*k,0,0,dpr*k,0,0);
  ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=3.2;ctx.strokeStyle=getComputedStyle(c).color;
  function draw(){ctx.clearRect(0,0,SW,SH);if(!sig.strokes.length)return;try{ctx.stroke(new Path2D(toD(sig.strokes)));}catch(e){}}
  function pt(e){var b=c.getBoundingClientRect(),s=SW/b.width;return [r2(Math.min(SW,Math.max(0,(e.clientX-b.left)*s))),r2(Math.min(SH,Math.max(0,(e.clientY-b.top)*s)))];}
  var curS=null;
  c.addEventListener('pointerdown',function(e){e.preventDefault();try{c.setPointerCapture(e.pointerId);}catch(err){}curS=[pt(e)];sig.strokes.push(curS);draw();});
  c.addEventListener('pointermove',function(e){if(!curS)return;e.preventDefault();var p=pt(e),l=curS[curS.length-1];if(Math.abs(p[0]-l[0])+Math.abs(p[1]-l[1])<2)return;curS.push(p);draw();});
  function end(){curS=null;}
  c.addEventListener('pointerup',end);c.addEventListener('pointercancel',end);c.addEventListener('pointerleave',end);
  draw();
}

/* ---------- firebase: live data + save ---------- */
onSnapshot(ref,function(snap){
  loaded=true;
  if(!snap.exists()){render();return;}
  var d=snap.data();
  if(!d||!d.members||!d.gaps){render();return;}
  var incoming={v:d.v||1,settings:d.settings||state.settings,members:d.members,gaps:d.gaps,updatedAt:d.updatedAt||''};
  saved=clone(incoming);
  if(dirty){remoteWaiting=clone(incoming);toast('Kassa boshqa qurilmada yangilandi. Saqlasangiz, sizdagi holat yoziladi.');render();return;}
  state=clone(incoming);render();
},function(err){loaded=true;toast('Maʼlumotni olishda xato: '+(err&&err.code||err));render();});

function save(){
  if(saving)return;
  if(!user){toast('Avval Google hisobingiz bilan kiring');return;}
  if(ui.sign&&sig.strokes.length){toast('Avval imzoni tasdiqlang yoki bekor qiling');return;}
  saving=true;render();
  state.updatedAt=stamp();
  var body={v:1,settings:state.settings,members:state.members,gaps:state.gaps,updatedAt:state.updatedAt,by:user.email||''};
  setDoc(ref,body).then(function(){
    saving=false;dirty=false;remoteWaiting=null;saved=clone(state);toast('Saqlandi — hamma shu zahoti koʻradi');render();
  },function(err){
    saving=false;var c=err&&err.code||'';
    if(c.indexOf('permission-denied')>=0)toast('Sizda yozish huquqi yoʻq. Kassa egasining hisobi bilan kiring.');
    else if(c.indexOf('unavailable')>=0)toast('Internet yoʻq — ulanish tiklanganda oʻzi saqlanadi.');
    else toast('Saqlanmadi: '+(err&&err.message||c));
    render();
  });
}

/* ---------- events ---------- */
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-act]');if(!b)return;
  var a=b.getAttribute('data-act'),v=b.getAttribute('data-v'),g=curGap(),price=+state.settings.lotPrice||0,m;
  switch(a){
    case 'tab':ui.tab=v;ui.del=null;stash();break;
    case 'toggle-edit':ui.edit=!ui.edit;ui.del=null;if(!ui.edit){ui.sign=null;sig.strokes=[];}break;
    case 'pick-gap':ui.gap=v;ui.del=null;ui.sign=null;sig.strokes=[];stash();break;
    case 'new-gap':
      var ng={id:uid('g'),date:newGapDate(),rows:active().map(function(x){return {m:x.id,amt:(+x.lots||0)*price,paid:false};}),winners:[],signs:{},rate:0,place:'',food:'',expense:0,note:''};
      state.gaps.push(ng);ui.gap=ng.id;ui.sign=null;dirty=true;toast(gapNo(ng)+'-gap ochildi');break;
    case 'toggle-paid':if(g){var r=g.rows[+v];r.paid=!r.paid;dirty=true;}break;
    case 'rm-row':if(g){g.rows.splice(+v,1);dirty=true;}break;
    case 'add-row':var sel=document.getElementById('add-row-sel');if(g&&sel&&sel.value){m=member(sel.value);g.rows.push({m:m.id,amt:(+m.lots||0)*price,paid:false});dirty=true;}break;
    case 'del-gap':ui.del=g&&g.id;break;
    case 'del-gap-no':ui.del=null;break;
    case 'del-gap-yes':if(g){state.gaps=state.gaps.filter(function(x){return x.id!==g.id;});ui.gap=null;ui.del=null;ui.sign=null;dirty=true;toast('Gap oʻchirildi');}break;
    case 'sig-open':if(g){ui.sign={g:g.id,m:v};sig.strokes=[];}break;
    case 'sig-clear':sig.strokes=[];break;
    case 'sig-cancel':ui.sign=null;sig.strokes=[];break;
    case 'sig-ok':
      if(!g||!ui.sign)return;
      if(!sig.strokes.some(function(s){return s.length>1;})){toast('Avval imzo qoʻying');return;}
      g.signs=g.signs||{};g.signs[ui.sign.m]={d:toD(sig.strokes),at:stamp()};
      ui.sign=null;sig.strokes=[];dirty=true;toast('Imzo qoʻyildi — endi “Saqlash”ni bosing');break;
    case 'open':ui.open=ui.open===v?null:v;stash();break;
    case 'lots-':case 'lots+':m=member(v);m.lots=Math.max(0.5,Math.round(((+m.lots||0)+(a==='lots+'?0.5:-0.5))*2)/2);dirty=true;break;
    case 'deact':
      m=member(v);var used=state.gaps.some(function(x){return x.rows.some(function(r){return r.m===v;})||(x.winners||[]).some(function(w){return w.m===v;});});
      if(used)m.active=false;else state.members=state.members.filter(function(x){return x.id!==v;});
      dirty=true;toast(m.name+(used?' roʻyxatdan chiqarildi (tarixi saqlanadi)':' oʻchirildi'));break;
    case 'react':m=member(v);delete m.active;dirty=true;break;
    case 'add-member':
      var ni=document.getElementById('new-name'),nl=document.getElementById('new-lots'),nm=(ni&&ni.value||'').trim();
      if(!nm){toast('Avval ismini yozing');if(ni)ni.focus();return;}
      state.members.push({id:uid('m'),name:nm,lots:+(nl&&nl.value)||1});dirty=true;toast(nm+' qoʻshildi');break;
    case 'save':save();return;
    case 'discard':
      state=clone(remoteWaiting||saved);dirty=false;remoteWaiting=null;ui.del=null;ui.sign=null;sig.strokes=[];toast('Oʻzgarishlar bekor qilindi');break;
    case 'signin':doSignIn();return;
    case 'signout':signOut(auth);return;
    default:return;
  }
  render();
});
document.addEventListener('input',function(e){
  var el=e.target,f=el.getAttribute&&el.getAttribute('data-f');if(!f)return;
  var g=curGap(),v=el.value;
  switch(f){
    case 'amt':if(g&&g.rows[+el.getAttribute('data-v')])g.rows[+el.getAttribute('data-v')].amt=toNum(v);break;
    case 'g-date':if(g&&v)g.date=v;break;
    case 'g-rate':if(g)g.rate=toNum(v);break;
    case 'g-place':if(g)g.place=v;break;
    case 'g-food':if(g)g.food=v;break;
    case 'g-exp':if(g)g.expense=toNum(v);break;
    case 'g-note':if(g)g.note=v;break;
    case 'mname':var m=member(el.getAttribute('data-v'));m.name=v;break;
    case 'set-name':state.settings.name=v;break;
    case 'set-price':state.settings.lotPrice=toNum(v);break;
    case 'set-cur':state.settings.cur=v.trim().slice(0,4)||'$';break;
    case 'set-day':var d=Math.round(toNum(v));if(d>=1&&d<=28)state.settings.day=d;break;
    case 'g-win':
      if(g){
        if(!v)g.winners=[];else{var p=v.split('|'),ids=p[0].split('+'),part=+p[1]||1;g.winners=ids.map(function(id){return {m:id,part:part};});}
        var keep={};(g.signs&&Object.keys(g.signs)||[]).forEach(function(id){if(g.winners.some(function(w){return w.m===id;}))keep[id]=g.signs[id];});g.signs=keep;
        ui.sign=null;sig.strokes=[];
      }
      dirty=true;later();return;
    default:return;
  }
  mark();
});
document.addEventListener('change',function(e){var f=e.target.getAttribute&&e.target.getAttribute('data-f');if(f&&f!=='g-win')later();});
var rz=0;window.addEventListener('resize',function(){if(!document.getElementById('sigpad'))return;clearTimeout(rz);rz=setTimeout(initPad,150);});
window.addEventListener('beforeunload',function(e){if(dirty){e.preventDefault();e.returnValue='';}});

/* ---------- auth ---------- */
function doSignIn(){
  var p=new GoogleAuthProvider();
  signInWithPopup(auth,p).catch(function(err){
    var c=err&&err.code||'';
    if(c.indexOf('popup')>=0){signInWithRedirect(auth,p);return;}
    toast('Kirishda xato: '+(err&&err.message||c));
  });
}
onAuthStateChanged(auth,function(u){
  user=u||null;canEdit=!!u;
  if(!u){ui.edit=false;ui.sign=null;}
  render();
  if(u)seedIfEmpty();
});
function seedIfEmpty(){
  getDoc(ref).then(function(snap){
    if(snap.exists())return;
    var body={v:1,settings:state.settings,members:state.members,gaps:state.gaps,updatedAt:stamp(),by:(user&&user.email)||''};
    return setDoc(ref,body).then(function(){toast('Kassa maʼlumoti Firebase\'ga yozildi');});
  }).catch(function(err){
    var c=err&&err.code||'';
    if(c.indexOf('permission-denied')>=0)toast('Bu hisobda yozish huquqi yoʻq.');
  });
}

render();
if('serviceWorker' in navigator)window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){});});
