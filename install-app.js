// Instalação PWA. Não interfere com Firebase, balança nem registros do caixa.
let deferredInstallPrompt=null;
const installButton=document.getElementById('installApp');
window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();deferredInstallPrompt=event;installButton.hidden=false;
});
installButton.addEventListener('click',async()=>{
  if(!deferredInstallPrompt)return;
  const prompt=deferredInstallPrompt;deferredInstallPrompt=null;installButton.hidden=true;
  try{await prompt.prompt();await prompt.userChoice;}catch(err){console.warn('Instalação não disponível:',err);}
});
window.addEventListener('appinstalled',()=>{installButton.hidden=true;deferredInstallPrompt=null;});
if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost' || location.hostname==='127.0.0.1')){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(err=>console.warn('Service worker:',err)));
}
