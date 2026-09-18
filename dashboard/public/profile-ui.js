import { reveal } from './motion.js';
const $ = id=>document.getElementById(id);
const initials = name => name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
export function createProfileController(request) {
  let account=null, saved=null, generation=0, photoGeneration=0, bitmap=null, draftPhoto=null, saving=false, photoBusy=false;
  function error(text='') {$('profile-error').textContent=text;$('profile-error').hidden=!text;}
  function paintAvatar(node,name,photo) {
    node.replaceChildren();
    if(photo){const img=document.createElement('img');img.src=photo;img.alt='';node.append(img);}
    else node.textContent=initials(name || 'Minha conta');
  }
  function paint() {
    if(!account)return;
    const name=saved?.display_name || account.display_name || account.name || account.username;
    $('user-name').textContent=name;
    $('welcome-title').textContent=`Olá, ${name}. Seu mês, sem complicação.`;
    $('menu-name').textContent=name;$('menu-username').textContent=`@${account.username}`;
    $('account-trigger').setAttribute('aria-label',`Abrir perfil de ${name}`);
    paintAvatar($('account-avatar'),name,saved?.avatar_data_url);
    paintAvatar($('menu-avatar'),name,saved?.avatar_data_url);
  }
  async function load() {
    if(!account)return;
    const ticket=++generation;
    $('edit-profile').disabled=true;$('profile-load-status').textContent='Carregando perfil...';
    $('retry-profile').hidden=true;
    try {
      const result=await request('/api/profile');
      if(ticket!==generation)return;
      saved=result.profile;paint();$('profile-load-status').textContent='Sincronizado com sua conta';$('edit-profile').disabled=false;
    }catch{
      if(ticket!==generation)return;
      $('profile-load-status').textContent='Não foi possível carregar o perfil.';$('retry-profile').hidden=false;
    }
  }
  function releasePhoto() {photoGeneration++;bitmap?.close();bitmap=null;photoBusy=false;$('profile-save').disabled=saving;$('photo-status').textContent='';$('profile-photo').value='';$('photo-zoom-field').hidden=true;}
  function preview() {paintAvatar($('profile-preview'),$('profile-name').value,draftPhoto);$('remove-photo').disabled=!draftPhoto;}
  function open() {
    if(!saved || !account || saving)return;
    $('account-menu').hidePopover();releasePhoto();draftPhoto=saved.avatar_data_url;
    $('profile-notice').hidden=true;$('profile-fields').disabled=false;$('profile-name').value=saved.display_name;$('profile-username').textContent=`@${account.username}`;error();preview();
    $('profile-dialog').showModal();
  }
  function renderPhoto() {
    if(!bitmap)return;
    const size=Math.min(bitmap.width,bitmap.height)/Number($('photo-zoom').value);
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#171D29';ctx.fillRect(0,0,256,256);
    ctx.drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,256,256);
    draftPhoto=canvas.toDataURL('image/jpeg',.85);preview();
  }
  $('account-trigger').addEventListener('click',()=>{
    $('account-menu').togglePopover();
    if($('account-menu').matches(':popover-open')) {reveal($('account-menu'));$('edit-profile').focus();}
  });
  $('account-menu').addEventListener('toggle',event=>$('account-trigger').setAttribute('aria-expanded',String(event.newState==='open')));
  $('edit-profile').addEventListener('click',open);
  $('settings-edit-profile').addEventListener('click',()=>{if(saved)open();else{$('account-menu').showPopover();load();}});
  $('retry-profile').addEventListener('click',load);
  $('menu-settings').addEventListener('click',()=>{$('account-menu').hidePopover();document.querySelector('#desktop-nav [data-section=settings]').click();});
  $('menu-logout').addEventListener('click',()=>{$('account-menu').hidePopover();$('logout').click();});
  $('profile-cancel').addEventListener('click',()=>$('profile-dialog').close());
  $('profile-close').addEventListener('click',()=>$('profile-dialog').close());
  $('profile-dialog').addEventListener('close',()=>{releasePhoto();draftPhoto=null;error();});
  $('profile-name').addEventListener('input',preview);
  $('photo-zoom').addEventListener('input',renderPhoto);
  $('choose-photo').addEventListener('click',()=>$('profile-photo').click());
  $('remove-photo').addEventListener('click',()=>{releasePhoto();draftPhoto=null;preview();error();});
  $('profile-photo').addEventListener('change',async()=>{
    const file=$('profile-photo').files[0];if(!file)return;
    releasePhoto();const ticket=photoGeneration;error();
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024){error('Escolha uma imagem JPG, PNG ou WebP de até 8 MB.');return;}
    photoBusy=true;$('profile-save').disabled=true;$('photo-status').textContent='Preparando foto...';
    try{
      const next=await createImageBitmap(file,{imageOrientation:'from-image'});
      if(ticket!==photoGeneration){next.close();return;}
      if(next.width*next.height>24000000){next.close();throw new Error('large');}
      bitmap?.close();bitmap=next;$('photo-zoom').value='1';$('photo-zoom-field').hidden=false;renderPhoto();
    }catch{if(ticket===photoGeneration)error('Não consegui abrir essa imagem. Tente outra foto de até 24 megapixels.');}
    finally{if(ticket===photoGeneration){photoBusy=false;$('profile-save').disabled=saving;$('photo-status').textContent='';}}
  });
  $('profile-form').addEventListener('submit',async event=>{
    event.preventDefault();if(saving||photoBusy||!account)return;
    const ticket=generation;error();saving=true;$('profile-save').disabled=true;$('profile-save').textContent='Salvando...';
    $('profile-fields').disabled=true;
    try{
      const result=await request('/api/profile',{method:'PATCH',body:JSON.stringify({display_name:$('profile-name').value.trim(),avatar_data_url:draftPhoto})});
      if(ticket!==generation)return;
      saved=result.profile;paint();$('profile-dialog').close();
      $('profile-notice').textContent='Perfil atualizado. Sua foto e nome acompanham a conta.';$('profile-notice').hidden=false;
    }catch(e){if(ticket===generation)error(e.message||'Não foi possível salvar. Tente novamente.');}
    finally{if(ticket===generation){saving=false;$('profile-save').disabled=photoBusy;$('profile-fields').disabled=false;$('profile-save').textContent='Salvar perfil';}}
  });
  return {
    sync(next) {
      if(!next)return;
      const changed=account?.id!==next.id || account?.username!==next.username;
      account=next;paint();if(changed){saved=null;paint();load();}
    },
    reset(){generation++;saving=false;$('profile-fields').disabled=false;$('profile-save').textContent='Salvar perfil';account=null;saved=null;draftPhoto=null;releasePhoto();$('account-menu').hidePopover();$('profile-dialog').closeImmediately();$('profile-notice').hidden=true;paintAvatar($('account-avatar'),'','');$('menu-name').textContent='';$('menu-username').textContent='';$('menu-avatar').replaceChildren();$('profile-preview').replaceChildren();$('profile-name').value='';},
  };
}
