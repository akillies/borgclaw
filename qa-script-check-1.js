// Standalone chat — works even if main script has issues
(function(){
  var SECRET='a717926b33b7ceb53210527a8b0ec823f80d39e95862fa5abced9274ed64ab45';
  var hdr={'Content-Type':'application/json'};
  if(SECRET)hdr['Authorization']='Bearer '+SECRET;

  // Event delegation for data-action buttons
  document.addEventListener('click',function(e){
    var btn=e.target.closest('[data-action]');
    if(!btn)return;
    var a=btn.getAttribute('data-action');
    var id=btn.getAttribute('data-id');
    var nd=btn.getAttribute('data-node');
    var md=btn.getAttribute('data-model');
    var pr=btn.getAttribute('data-profile');
    if(a==='approve')fetch('/api/approvals/'+id+'/approve',{method:'POST',headers:hdr}).then(function(){btn.closest('tr').style.opacity='0.3';btn.closest('tr').querySelector('.appr-type').textContent='APPROVED'});
    if(a==='reject')fetch('/api/approvals/'+id+'/reject',{method:'POST',headers:hdr}).then(function(){btn.closest('tr').style.opacity='0.3';btn.closest('tr').querySelector('.appr-type').textContent='REJECTED'});
    if(a==='view')fetch('/api/approvals/'+id,{headers:hdr}).then(function(r){return r.json()}).then(function(d){alert(JSON.stringify(d,null,2))});
    if(a==='pull'){btn.textContent='PULLING...';fetch('/api/models/pull',{method:'POST',headers:hdr,body:JSON.stringify({model:md,node_id:nd})}).then(function(){btn.textContent='DONE'}).catch(function(){btn.textContent='FAILED'})}
    if(a==='modelswap')fetch('/api/config/models'+(pr?'?profile='+pr:''),{headers:hdr}).then(function(r){return r.json()}).then(function(d){alert('Available models:\\n'+JSON.stringify(d.models||d,null,2))});
  });

  window.sendChat=function(){
    var inp=document.getElementById('chat-input');
    var log=document.getElementById('chat-log');
    var msg=inp.value.trim();
    if(!msg)return;
    inp.value='';inp.disabled=true;
    log.innerHTML+='<div style="color:#0cf;margin-top:4px">'+msg.replace(/</g,'&lt;')+'</div>';
    log.innerHTML+='<div style="color:#888">Queen is thinking...</div>';
    log.scrollTop=log.scrollHeight;
    fetch('/api/chat',{method:'POST',headers:hdr,body:JSON.stringify({message:msg})})
    .then(function(r){return r.json()})
    .then(function(d){
      var els=log.querySelectorAll('div');
      var last=els[els.length-1];
      if(last&&last.textContent.includes('thinking'))last.remove();
      log.innerHTML+='<div style="color:#0f8;margin-top:2px">'+((d.response||d.error||'').replace(/</g,'&lt;'))+'</div>';
      if(d.actions_taken&&d.actions_taken.length>0)d.actions_taken.forEach(function(a){
        log.innerHTML+='<div style="color:#fa0;font-size:10px">  > '+a.cmd+' '+JSON.stringify(a.params)+'</div>';
      });
      log.scrollTop=log.scrollHeight;inp.disabled=false;inp.focus();
    })
    .catch(function(e){
      log.innerHTML+='<div style="color:#f44">Error: '+e.message+'</div>';
      inp.disabled=false;inp.focus();
    });
  };
})();