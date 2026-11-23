/* Presentation-only enhancements. Records and network requests stay in the app. */
(() => {
  const root=document.querySelector('#app'),dialog=document.querySelector('#dialog'),nav=document.querySelector('#nav');
  if(!root||!dialog||!nav||document.querySelector('#workspace-menu'))return;
  const header=nav.closest('.top');
  const menu=document.createElement('button');
  menu.id='workspace-menu';menu.type='button';menu.className='btn mobile-nav-toggle';
  menu.setAttribute('aria-controls','nav');menu.setAttribute('aria-expanded','false');
  header.insertBefore(menu,nav);
  const media=window.matchMedia?.('(max-width:1100px)');
  function closeMenu(){header.classList.remove('mobile-nav-open');menu.setAttribute('aria-expanded','false');}
  menu.addEventListener('click',()=>{const open=header.classList.toggle('mobile-nav-open');menu.setAttribute('aria-expanded',String(open));});
  nav.addEventListener('click',event=>{if(event.target.closest('a'))closeMenu();});
  header.addEventListener('keydown',event=>{if(event.key==='Escape'&&header.classList.contains('mobile-nav-open')){closeMenu();menu.focus();}});
  media?.addEventListener('change',closeMenu);
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const inline=s=>escape(s).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
  function richText(text){
    let html='',paragraph=[],list='',items=[];
    const flushParagraph=()=>{if(paragraph.length){html+='<p>'+paragraph.map(inline).join('<br>')+'</p>';paragraph=[];}};
    const flushList=()=>{if(list){html+='<'+list+'>'+items.map(x=>'<li>'+inline(x)+'</li>').join('')+'</'+list+'>';list='';items=[];}};
    for(const line of text.split(/\r?\n/)){
      const heading=line.match(/^#{1,6}\s+(.+)$/),bullet=line.match(/^\s*[-*]\s+(.+)$/),ordered=line.match(/^\s*\d+[.)]\s+(.+)$/);
      if(heading){flushParagraph();flushList();const level=line.startsWith('###')?'h4':'h3';html+='<'+level+'>'+inline(heading[1])+'</'+level+'>';}
      else if(bullet||ordered){flushParagraph();const type=bullet?'ul':'ol';if(list&&list!==type)flushList();list=type;items.push((bullet||ordered)[1]);}
      else if(!line.trim()){flushParagraph();flushList();}
      else{flushList();paragraph.push(line);}
    }
    flushParagraph();flushList();return html;
  }
  let ticket=0,wasDialogOpen=false,view='';
  const frame=window.requestAnimationFrame?.bind(window)||(callback=>setTimeout(callback,0));
  const queue=()=>{if(!ticket)ticket=frame(()=>{ticket=0;enhance();});};
  function enhance(){
    const active=nav.querySelector('a.active,[aria-current=page]');
    const menuLabel='Navigate · '+(active?.textContent.trim()||'Overview');
    if(menu.textContent!==menuLabel)menu.textContent=menuLabel;
    if(document.title!=='QuidEdge · '+(active?.textContent.trim()||'Recruitment'))document.title='QuidEdge · '+(active?.textContent.trim()||'Recruitment');
    for(const cell of root.querySelectorAll('td[data-label]:not([data-cell-ready])')){
      cell.dataset.cellReady='true';const content=document.createElement('div');content.className='cell-content';while(cell.firstChild)content.append(cell.firstChild);cell.append(content);
    }
    for(const table of root.querySelectorAll('table:not([data-table-ready])')){
      table.dataset.tableReady='true';const title=table.closest('.panel')?.querySelector('h2')?.textContent.trim();if(title)table.setAttribute('aria-label',title);
      for(const th of table.querySelectorAll('th'))th.scope='col';
    }
    for(const item of root.querySelectorAll('.role-text:not([data-copy-ready])')){
      item.dataset.copyReady='true';const text=item.textContent;
      if(/^#{1,6}\s|\*\*[^*]+\*\*|^\s*[-*]\s|^\s*\d+[.)]\s/m.test(text)){item.innerHTML=richText(text);item.classList.add('rich-copy');item.style.whiteSpace='normal';}
    }
    for(const detail of root.querySelectorAll('.role-position details:not([data-role-ready])')){
      detail.dataset.roleReady='true';const button=detail.querySelector('[data-action=job]');if(button?.dataset.id)detail.dataset.jobId=button.dataset.id;
      if(button?.dataset.id){
        const toolbar=detail.querySelector('.toolbar');
        const share=document.createElement('button');share.type='button';share.className='btn primary';share.textContent='Share JD with candidate';share.dataset.action='share-candidate-jd';share.dataset.id=button.dataset.id;toolbar?.append(share);
        const hint=document.createElement('p');hint.className='hint';hint.textContent='Candidate links show this job only, on a separate careers page.';toolbar?.after(hint);
      }
    }
    // Give every saved position a direct route to its own requirements.
    if(location.hash==='#overview')for(const row of root.querySelectorAll('tr')){
      const manage=row.querySelector('[data-action=job][data-id]');if(!manage||row.querySelector('[data-action=role-view]'))continue;
      const actions=row.querySelector('.row-actions');if(!actions)continue;
      const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='View job description';button.dataset.action='open-role-details';button.dataset.id=manage.dataset.id;actions.append(button);
    }
    const status=root.querySelector('.result-count');if(status&&!status.dataset.grammarReady){status.dataset.grammarReady='true';if(/^1 candidates/.test(status.textContent))status.textContent=status.textContent.replace('1 candidates','1 candidate');status.setAttribute('aria-live','polite');}
    const search=root.querySelector('#search');if(search){search.placeholder='Search candidates or positions';search.setAttribute('aria-label','Search candidates or positions');}
    const sameView=view===location.hash;view=location.hash;
    if(!sameView)closeMenu();
    if(dialog.open){
      const title=dialog.querySelector('h2');
      if(title){if(!title.id)title.id='dialog-title';dialog.setAttribute('aria-labelledby',title.id);
        const close=dialog.querySelector('[data-action=close]');
        if(close&&!title.closest('.dialog-heading')){
          if(title.parentElement.classList.contains('section-top'))title.parentElement.classList.add('dialog-heading');
          else{const bar=document.createElement('div');bar.className='dialog-heading';title.before(bar);bar.append(title,close);}
        }
      }
      for(const error of dialog.querySelectorAll('.form-error')){error.setAttribute('role','alert');error.setAttribute('aria-live','assertive');}
      for(const form of dialog.querySelectorAll('form'))for(const field of form.querySelectorAll('input,select,textarea')){
        if(!field.id)field.id='qe-field-'+(field.name||'input')+'-'+Array.from(form.elements).indexOf(field);
      }
      if(!wasDialogOpen){const name=dialog.querySelector('[name=candidate_name],[name=name]');if(name&&name.type!=='hidden')name.focus({preventScroll:true});}
    }
    wasDialogOpen=dialog.open;
  }
  document.addEventListener('click',event=>{
    const share=event.target.closest('[data-action=share-candidate-jd]');
    if(share){
      event.preventDefault();const url='https://quidedge-careers.inquiries-quidedge-au.workers.dev/jobs/'+encodeURIComponent(share.dataset.id);
      const toolbar=share.closest('.toolbar');let box=toolbar.parentElement.querySelector('.share-jd-box');
      if(!box){box=document.createElement('div');box.className='share-jd-box';const label=document.createElement('label');label.className='field';label.textContent='Candidate-only job link';const input=document.createElement('input');input.type='url';input.readOnly=true;input.value=url;input.setAttribute('aria-label','Candidate-only job link');label.append(input);const actions=document.createElement('div');actions.className='toolbar';const copy=document.createElement('button');copy.type='button';copy.className='btn primary';copy.textContent='Copy link';const open=document.createElement('a');open.className='btn';open.textContent='Preview candidate page';open.href=url;open.target='_blank';open.rel='noopener noreferrer';const status=document.createElement('p');status.className='hint';status.setAttribute('role','status');copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(url);status.textContent='Link copied. Ready to send to your candidate.';}catch{input.focus();input.select();status.textContent='Select and copy the link above.';}});actions.append(copy,open);box.append(label,actions,status);toolbar.after(box);}
      box.querySelector('input').focus();box.querySelector('input').select();return;
    }
    const link=event.target.closest('[data-action=open-role-details]');if(!link)return;
    event.preventDefault();const id=link.dataset.id;location.hash='role';
    frame(()=>frame(()=>{
      enhance();const details=Array.from(root.querySelectorAll('.role-position details')).find(x=>x.dataset.jobId===id);
      if(details){details.open=true;details.scrollIntoView({block:'start',behavior:'instant'});const summary=details.querySelector('summary');summary?.focus({preventScroll:true});}
    }));
  });
  dialog.addEventListener('invalid',event=>{
    const input=event.target;if(!input.matches('input,textarea,select'))return;
    // Reveal optional groups before the browser focuses an invalid required field.
    for(let group=input.closest('details');group;group=group.parentElement?.closest('details'))group.open=true;
    input.setAttribute('aria-invalid','true');
    const id=(input.id||'qe-invalid-'+input.name)+'-error';let note=document.getElementById(id);
    if(!note){note=document.createElement('small');note.className='field-error';note.id=id;input.after(note);}
    note.textContent=input.validationMessage||'Check this field.';
    const described=new Set((input.getAttribute('aria-describedby')||'').split(' ').filter(Boolean));described.add(id);input.setAttribute('aria-describedby',Array.from(described).join(' '));
  },true);
  dialog.addEventListener('input',event=>{
    const input=event.target;if(!input.matches('[aria-invalid=true]')||!input.validity.valid)return;
    input.removeAttribute('aria-invalid');const id=(input.id||'qe-invalid-'+input.name)+'-error';document.getElementById(id)?.remove();
    const described=(input.getAttribute('aria-describedby')||'').split(' ').filter(x=>x&&x!==id);if(described.length)input.setAttribute('aria-describedby',described.join(' '));else input.removeAttribute('aria-describedby');
  });
  const observer=new MutationObserver(queue);
  observer.observe(root,{childList:true,subtree:true});observer.observe(dialog,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});observer.observe(nav,{attributes:true,subtree:true,attributeFilter:['class','aria-current']});
  window.addEventListener('hashchange',queue);queue();
})();
