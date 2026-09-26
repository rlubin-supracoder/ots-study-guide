const errorBox=document.querySelector('#entryError');
for(const [id,path]of [['unlockForm','/api/unlock'],['joinForm','/api/join'],['connectForm','/api/connect']]){
  const form=document.getElementById(id);if(!form)continue;
  form.addEventListener('submit',async event=>{
    event.preventDefault();errorBox.hidden=true;
    const buttons=[...document.querySelectorAll('button[type=submit]')];buttons.forEach(b=>b.disabled=true);
    try{
      const response=await fetch(path,{method:'POST',credentials:'same-origin',redirect:'manual',cache:'no-store',headers:{'Content-Type':'application/json','X-Tether-Request':'1'},body:JSON.stringify(Object.fromEntries(new FormData(form))),signal:AbortSignal.timeout(15000)});
      if(!response.headers.get('Content-Type')?.includes('application/json'))throw new Error('Sign-in is unavailable. Refresh the page and try again.');
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not confirm this request.');
      form.reset();location.replace('/');
    }catch(error){errorBox.textContent=error.name==='TypeError'||error.name==='TimeoutError'?'Connection interrupted. Refresh the page to check whether your setup completed before trying again.':error.message;errorBox.hidden=false;errorBox.scrollIntoView({block:'nearest'});}
    finally{buttons.forEach(b=>b.disabled=false);}
  });
}
