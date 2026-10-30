'use strict';
(() => {
  const buttons=[...document.querySelectorAll('[data-view]')];
  function select(view) {
    const chosen=view==='productivity'?'productivity':'creative';
    document.getElementById('creative-view').hidden=chosen!=='creative';
    document.getElementById('productivity-view').hidden=chosen!=='productivity';
    for(const button of buttons)button.setAttribute('aria-pressed',String(button.dataset.view===chosen));
    try{localStorage.setItem('roomsuite-home-view',chosen);}catch{}
  }
  let preferred='creative';try{preferred=localStorage.getItem('roomsuite-home-view')||preferred;}catch{}
  const query=new URLSearchParams(location.search).get('view');if(query==='creative'||query==='productivity')preferred=query;
  for(const button of buttons)button.addEventListener('click',()=>select(button.dataset.view));
  select(preferred);
})();
