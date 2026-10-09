export const staffPage=location.pathname==='/staff'||location.pathname.startsWith('/staff/');
const memberPath=staffPage?location.pathname.slice(6):location.pathname;
export const classId=memberPath==='/class/27-02'||memberPath.startsWith('/class/27-02/')?'27-02':'27-01';
export const classPrefix=classId==='27-02'?'/class/27-02':'';
export const home=classPrefix+'/';
export const apiPrefix=(staffPage?'/staff':'')+classPrefix;
for(const node of document.querySelectorAll('.brand'))node.href=staffPage?'/staff'+classPrefix:home;
for(const node of document.querySelectorAll('a[href="/staff"]'))node.href='/staff'+classPrefix;
for(const node of document.querySelectorAll('[data-class-label]'))node.textContent='CLASS '+classId;
for(const node of document.querySelectorAll('[data-class-link]')){
  const target=node.dataset.classLink;
  node.href=(staffPage?'/staff':'')+(target==='27-02'?'/class/27-02':'')+(staffPage?'':'/');
  if(target===classId)node.setAttribute('aria-current','page');
  if(staffPage&&target!==classId)node.hidden=true;
}
document.title=`Tether · Class ${classId}${staffPage?' · Staff':''}`;
if(classId==='27-02'){
  const manifest=document.querySelector('link[rel="manifest"]');
  if(manifest)manifest.href='/manifest-27-02.webmanifest';
}
