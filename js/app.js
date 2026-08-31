// app.js - lógica principal

// Estado
let funcionarios = [];
let epis = [];
let entregas = [];
let funcStream = null;
let entregaStream = null;
let funcCapturedDescriptor = null;
let funcCapturedFoto = null;

// Utils
const $ = s => document.querySelector(s);
const toast = (msg, ok=true) => {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `fixed bottom-4 left-1/2 -translate-x-1/2 px-5 py-3 rounded-full text-sm shadow-lg z-50 ${ok ? 'bg-slate-900 text-white' : 'bg-red-600 text-white'}`;
  t.classList.remove('hidden');
  setTimeout(()=>t.classList.add('hidden'), 3000);
};
const fmtDate = iso => new Date(iso).toLocaleString('pt-BR');
const cpfMask = v => v.replace(/\D/g,'').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2');
const cpfValid = cpf => cpf.replace(/\D/g,'').length === 11;

// Tabs
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b=>{
    b.classList.toggle('sidebar-active', b.dataset.tab===name);
    b.classList.toggle('text-slate-600', b.dataset.tab!==name);
  });
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.add('hidden'));
  $(`#tab-${name}`).classList.remove('hidden');
  if(name==='dashboard') loadDashboard();
  if(name==='relatorios') renderRelatorio();
}
document.querySelectorAll('.tab-btn').forEach(b=> b.addEventListener('click', ()=> switchTab(b.dataset.tab)));

// Clock
setInterval(()=>{ const el=$('#clock'); if(el) el.textContent=new Date().toLocaleString('pt-BR'); },1000);

// API helpers
async function api(path, opts={}){
  let res;
  // Log de diagnóstico para erro 405
  console.log(`[API] ${opts.method||'GET'} ${path} via ${location.href} (origin=${location.origin})`);
  try {
    res = await fetch(path, { headers:{'Content-Type':'application/json'}, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch (e) {
    console.error('Fetch falhou - servidor offline?', e, `location=${location.href}`);
    throw new Error('Servidor offline. Rode "npm start" e acesse http://localhost:3000 (não abra o arquivo direto). Você está em: '+location.href);
  }
  const text = await res.text();
  // Detecta resposta HTML (quando backend não está rodando e cai no fallback / Live Server)
  const trimmed = text.trim();
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.toLowerCase().startsWith('<!doctype')) {
    console.error(`API ${path} retornou HTML em vez de JSON. Servidor Node não está atendendo. location=${location.href} status=${res.status}`);
    throw new Error('Backend não encontrado (retornou HTML). Você está em '+location.href+' . Feche e acesse http://localhost:3000 (rode "npm start")');
  }
  if(!res.ok){
    // Caso específico 405 - quase sempre é Live Server / servidor estático sem API
    if (res.status === 405 || res.statusText.includes('Method Not Allowed') || trimmed === 'Method Not Allowed' || trimmed.includes('Method Not Allowed')) {
      console.error(`API ${path} 405 Method Not Allowed. Você está acessando o frontend no servidor errado. location=${location.href} status=${res.status} body=${trimmed.slice(0,200)}`);
      throw new Error(`405 Method Not Allowed em ${path}. Você está em ${location.href} (origin ${location.origin}). Correto é http://localhost:3000 — feche essa aba, rode "npm start" e acesse lá. Dica: Ctrl+Shift+R para limpar cache`);
    }
    let msg = res.statusText;
    try { const j = JSON.parse(text); msg = j.error||JSON.stringify(j); } catch { msg = text || msg; }
    console.error(`API ${path} ${res.status}:`, msg, `location=${location.href}`);
    throw new Error(msg||`Erro ${res.status} em ${path} — você está em ${location.href}`);
  }
  return text ? JSON.parse(text) : null;
}

// ===== DASHBOARD =====
async function loadDashboard(){
  const stats = await api('/api/stats');
  $('#statFunc').textContent = stats.totalFuncionarios;
  $('#statEpi').textContent = stats.totalEpis;
  $('#statEntregas').textContent = stats.totalEntregas;
  $('#statMes').textContent = stats.entregasMes;
  $('#statBaixo').textContent = stats.estoqueBaixo ? `⚠️ ${stats.estoqueBaixo} EPIs com estoque baixo` : '✓ Estoque ok';

  const entregasData = await api('/api/entregas');
  const episData = await api('/api/epis');
  // ultimas 5 entregas
  const dashEntregas = $('#dashEntregas');
  if(entregasData.length===0) dashEntregas.innerHTML='<p class="text-slate-400">Nenhuma entrega registrada.</p>';
  else dashEntregas.innerHTML = entregasData.slice(0,5).map(e=>`
    <div class="flex justify-between items-center p-2 bg-slate-50 rounded-lg">
      <div><p class="font-medium">${e.funcionario_nome}</p><p class="text-xs text-slate-500">${e.epi_nome} • ${fmtDate(e.data_entrega)}</p></div>
      <span class="text-xs px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full">facial ✓ ${(e.face_match_score!==null)?(1-e.face_match_score).toFixed(2):''}</span>
    </div>`).join('');

  const baixo = episData.filter(e=>e.quantidade<10);
  const dashEstoque = $('#dashEstoque');
  if(baixo.length===0) dashEstoque.innerHTML='<p class="text-emerald-600">✓ Todos com estoque ok</p>';
  else dashEstoque.innerHTML = baixo.map(e=>`<div class="flex justify-between p-2 border rounded-lg"><span>${e.nome} (${e.tamanho||'-'})</span><span class="font-bold ${e.quantidade===0?'text-red-600':'text-amber-600'}">${e.quantidade} un</span></div>`).join('');
}

// ===== FUNCIONARIOS =====
async function loadFuncionarios(){
  funcionarios = await api('/api/funcionarios');
  renderFuncionarios();
  populateEntregaSelects();
}
function renderFuncionarios(){
  const q = ($('#searchFunc').value||'').toLowerCase();
  const tbody = $('#tbodyFunc');
  const filtered = funcionarios.filter(f=> !q || `${f.nome} ${f.cpf} ${f.matricula} ${f.setor}`.toLowerCase().includes(q));
  if(filtered.length===0) { tbody.innerHTML=`<tr><td colspan="5" class="p-6 text-center text-slate-400">Nenhum funcionário encontrado.</td></tr>`; return; }
  tbody.innerHTML = filtered.map(f=>`
    <tr class="hover:bg-slate-50">
      <td class="p-3">
        <div class="flex items-center gap-3">
          <img src="${f.foto||`https://ui-avatars.com/api/?name=${encodeURIComponent(f.nome)}&background=1e3a8a&color=fff`}" class="w-9 h-9 rounded-full object-cover border">
          <div><p class="font-medium text-slate-800">${f.nome}</p><p class="text-xs text-slate-500">${f.cargo}</p></div>
        </div>
      </td>
      <td class="p-3"><p class="font-mono text-xs">${cpfMask(f.cpf)}</p><p class="text-xs text-slate-500">${f.matricula}</p></td>
      <td class="p-3"><p class="text-sm">${f.cargo}</p><p class="text-xs text-slate-500">${f.setor}</p></td>
      <td class="p-3">${f.hasFace?'<span class="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium"><i class="fa-solid fa-face-smile mr-1"></i> Cadastrado</span>':'<span class="px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs">Sem biometria</span>'}</td>
      <td class="p-3 text-right">
        <button onclick="editFunc(${f.id})" class="w-8 h-8 rounded-lg hover:bg-blue-50 text-blue-700"><i class="fa-solid fa-pen"></i></button>
        <button onclick="deleteFunc(${f.id})" class="w-8 h-8 rounded-lg hover:bg-red-50 text-red-600"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `).join('');
}
$('#searchFunc')?.addEventListener('input', renderFuncionarios);

function openFuncModal(edit=null){
  $('#modalFunc').classList.remove('hidden');
  $('#modalFunc').classList.add('flex');
  if(!edit){
    $('#modalFuncTitle').textContent='Novo funcionário';
    $('#formFunc').reset();
    $('#funcId').value='';
    clearFaceCapture();
  }
}
function closeFuncModal(){
  $('#modalFunc').classList.add('hidden');
  $('#modalFunc').classList.remove('flex');
  stopFuncCamera();
}
window.openFuncModal=openFuncModal;
window.closeFuncModal=closeFuncModal;

function clearFaceCapture(){
  funcCapturedDescriptor=null;
  funcCapturedFoto=null;
  $('#funcDescriptor').value='';
  $('#funcFoto').value='';
  $('#funcPreview').classList.add('hidden');
  $('#funcFaceStatus').textContent='';
  $('#funcDescriptorInfo').textContent='';
}
window.clearFaceCapture=clearFaceCapture;

// Câmera funcionário
async function startFuncCamera(){
  try{
    funcStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'user', width:640, height:480 } });
    const v=$('#videoFunc');
    v.srcObject=funcStream;
    v.classList.remove('hidden');
    $('#videoFuncPlaceholder').classList.add('hidden');
    $('#canvasFunc').classList.add('hidden');
    $('#btnFuncCamera').classList.add('hidden');
    $('#btnFuncStop').classList.remove('hidden');
    $('#btnFuncCapture').disabled=false;
    $('#funcFaceStatus').textContent='Câmera ligada — posicione o rosto de frente, boa luz.';
    $('#funcFaceStatus').className='text-xs mt-2 text-blue-600';
  }catch(e){
    toast('Não foi possível acessar a câmera: '+e.message,false);
  }
}
function stopFuncCamera(){
  if(funcStream){ funcStream.getTracks().forEach(t=>t.stop()); funcStream=null; }
  $('#videoFunc').classList.add('hidden');
  $('#videoFuncPlaceholder').classList.remove('hidden');
  $('#btnFuncCamera').classList.remove('hidden');
  $('#btnFuncStop').classList.add('hidden');
  $('#btnFuncCapture').disabled=true;
}
$('#btnFuncCamera').addEventListener('click', startFuncCamera);
$('#btnFuncStop').addEventListener('click', stopFuncCamera);

$('#btnFuncCapture').addEventListener('click', async ()=>{
  if(!modelsLoaded){ toast('Aguarde a IA facial carregar...',false); return; }
  const v=$('#videoFunc');
  const c=$('#canvasFunc');
  $('#funcFaceStatus').textContent='Analisando rosto...';
  try{
    const detection = await getDescriptorFromVideo(v);
    if(!detection){ $('#funcFaceStatus').textContent='❌ Nenhum rosto detectado. Centralize o rosto e tente novamente.'; $('#funcFaceStatus').className='text-xs mt-2 text-red-600'; return; }
    if(detection.detection.score < 0.5){ $('#funcFaceStatus').textContent='⚠️ Rosto com baixa confiança, tente melhorar a iluminação.'; }
    const desc = descriptorToArray(detection.descriptor);
    funcCapturedDescriptor = desc;
    funcCapturedFoto = captureFrameAsDataURL(v,c);
    $('#funcDescriptor').value = JSON.stringify(desc);
    $('#funcFoto').value = funcCapturedFoto;
    $('#funcPreviewImg').src = funcCapturedFoto;
    $('#funcPreview').classList.remove('hidden');
    $('#funcDescriptorInfo').textContent = `Descriptor 128D • Score ${(detection.detection.score*100).toFixed(1)}%`;
    $('#funcFaceStatus').textContent='✓ Rosto capturado com sucesso! Pode salvar.';
    $('#funcFaceStatus').className='text-xs mt-2 text-emerald-600';
    // desenha box
    const box = detection.detection.box;
    // feedback visual não obrigatório
    toast('Rosto capturado!');
  }catch(e){
    $('#funcFaceStatus').textContent='Erro: '+e.message;
  }
});

$('#funcCpf').addEventListener('input', e=> e.target.value=cpfMask(e.target.value));

// Submit funcionário
$('#formFunc').addEventListener('submit', async e=>{
  e.preventDefault();
  const btn = e.submitter || document.querySelector('#formFunc button[type="submit"]');
  const origText = btn ? btn.textContent : '';
  if(btn){ btn.disabled=true; btn.textContent='Salvando...'; }
  let payload;
  try {
    payload={
      nome: $('#funcNome').value.trim(),
      cpf: $('#funcCpf').value.trim(),
      matricula: $('#funcMatricula').value.trim(),
      cargo: $('#funcCargo').value.trim(),
      setor: $('#funcSetor').value.trim(),
      face_descriptor: funcCapturedDescriptor || ($('#funcDescriptor').value?JSON.parse($('#funcDescriptor').value):null),
      foto: funcCapturedFoto || $('#funcFoto').value || null
    };
    if(!payload.nome || !payload.cpf || !payload.matricula || !payload.cargo || !payload.setor){
      toast('Preencha todos os campos obrigatórios (*)', false);
      return;
    }
    if(payload.cpf.replace(/\D/g,'').length !== 11){
      toast('CPF inválido: deve ter 11 dígitos', false);
      return;
    }
    const id=$('#funcId').value;
    if(id){
      const existing = funcionarios.find(f=>f.id==id);
      if(!payload.face_descriptor && existing?.face_descriptor) payload.face_descriptor = existing.face_descriptor;
      if(!payload.foto && existing?.foto) payload.foto = existing.foto;
      await api(`/api/funcionarios/${id}`, {method:'PUT', body:payload});
      toast('Funcionário atualizado!');
    }else{
      if(!payload.face_descriptor){
        if(!confirm('Salvar SEM biometria facial? O funcionário não poderá fazer assinatura facial até cadastrar o rosto. Continuar?')) return;
      }
      await api('/api/funcionarios', {method:'POST', body:payload});
      toast('Funcionário cadastrado!');
    }
    closeFuncModal();
    await loadFuncionarios();
    await loadDashboard();
  }catch(err){
    console.error('Erro salvar funcionario:', err, payload);
    toast(err.message || 'Erro ao salvar',false);
  } finally {
    if(btn){ btn.disabled=false; btn.textContent=origText; }
  }
});

window.editFunc = (id)=>{
  const f=funcionarios.find(x=>x.id===id);
  if(!f) return;
  openFuncModal(f);
  $('#modalFuncTitle').textContent='Editar funcionário';
  $('#funcId').value=f.id;
  $('#funcNome').value=f.nome;
  $('#funcCpf').value=cpfMask(f.cpf);
  $('#funcMatricula').value=f.matricula;
  $('#funcCargo').value=f.cargo;
  $('#funcSetor').value=f.setor;
  if(f.face_descriptor){
    funcCapturedDescriptor=f.face_descriptor;
    funcCapturedFoto=f.foto;
    $('#funcDescriptor').value=JSON.stringify(f.face_descriptor);
    $('#funcFoto').value=f.foto||'';
    $('#funcPreviewImg').src=f.foto||'';
    $('#funcPreview').classList.remove('hidden');
    $('#funcDescriptorInfo').textContent='Biometria já cadastrada • recapture para atualizar';
    $('#funcFaceStatus').textContent='✓ Este funcionário já possui biometria.';
    $('#funcFaceStatus').className='text-xs mt-2 text-emerald-600';
  } else clearFaceCapture();
};
window.deleteFunc = async (id)=>{
  if(!confirm('Excluir funcionário? Entregas vinculadas também serão removidas.')) return;
  await api(`/api/funcionarios/${id}`,{method:'DELETE'});
  toast('Excluído');
  await loadFuncionarios();
  await loadDashboard();
};

// ===== EPIs =====
async function loadEpis(){
  epis = await api('/api/epis');
  renderEpis();
  populateEntregaSelects();
}
function renderEpis(){
  const grid=$('#gridEpis');
  if(epis.length===0) { grid.innerHTML='<p class="text-slate-400 col-span-3 text-center py-8">Nenhum EPI cadastrado.</p>'; return; }
  grid.innerHTML = epis.map(e=>`
    <div class="bg-white rounded-xl border shadow-sm p-4 flex flex-col">
      <div class="flex items-start justify-between">
        <div class="w-10 h-10 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center"><i class="fa-solid fa-helmet-safety"></i></div>
        <span class="text-xs px-2 py-1 rounded-full ${e.quantidade<10?'bg-red-100 text-red-700':'bg-slate-100 text-slate-600'}">${e.quantidade} em estoque</span>
      </div>
      <h3 class="font-semibold text-slate-800 mt-3">${e.nome}</h3>
      <p class="text-xs text-slate-500">CA: ${e.ca} • Tam: ${e.tamanho||'-'}</p>
      ${e.validade?`<p class="text-xs text-slate-500">Validade: ${new Date(e.validade).toLocaleDateString('pt-BR')}</p>`:''}
      ${e.descricao?`<p class="text-xs text-slate-600 mt-2">${e.descricao}</p>`:''}
      <div class="flex gap-2 mt-4">
        <button onclick="editEpi(${e.id})" class="flex-1 border py-1.5 rounded-lg text-sm hover:bg-slate-50"><i class="fa-solid fa-pen mr-1"></i> Editar</button>
        <button onclick="deleteEpi(${e.id})" class="px-3 py-1.5 rounded-lg text-sm bg-red-50 text-red-600 hover:bg-red-100"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>
  `).join('');
}
function openEpiModal(){
  $('#modalEpi').classList.remove('hidden'); $('#modalEpi').classList.add('flex');
  $('#formEpi').reset(); $('#epiId').value='';
}
function closeEpiModal(){ $('#modalEpi').classList.add('hidden'); $('#modalEpi').classList.remove('flex'); }
window.openEpiModal=openEpiModal; window.closeEpiModal=closeEpiModal;

$('#formEpi').addEventListener('submit', async e=>{
  e.preventDefault();
  const payload={
    nome:$('#epiNome').value.trim(),
    ca:$('#epiCa').value.trim(),
    validade:$('#epiValidade').value||null,
    tamanho:$('#epiTamanho').value.trim()||null,
    quantidade: parseInt($('#epiQtd').value)||0,
    descricao:$('#epiDesc').value.trim()||null
  };
  const id=$('#epiId').value;
  try{
    if(id) await api(`/api/epis/${id}`,{method:'PUT', body:payload});
    else await api('/api/epis',{method:'POST', body:payload});
    toast(id?'EPI atualizado':'EPI cadastrado');
    closeEpiModal();
    await loadEpis();
    await loadDashboard();
  }catch(err){ toast(err.message,false); }
});
window.editEpi=(id)=>{
  const e=epis.find(x=>x.id==id); if(!e) return;
  openEpiModal();
  $('#epiId').value=e.id;
  $('#epiNome').value=e.nome;
  $('#epiCa').value=e.ca;
  $('#epiValidade').value=e.validade||'';
  $('#epiTamanho').value=e.tamanho||'';
  $('#epiQtd').value=e.quantidade;
  $('#epiDesc').value=e.descricao||'';
};
window.deleteEpi=async(id)=>{
  if(!confirm('Excluir EPI?')) return;
  await api(`/api/epis/${id}`,{method:'DELETE'});
  toast('EPI excluído');
  await loadEpis();
};

// ===== ENTREGAS =====
function populateEntregaSelects(){
  const selF=$('#entregaFuncionario');
  const selE=$('#entregaEpi');
  selF.innerHTML='<option value="">-- Selecione funcionário --</option>' + funcionarios.map(f=>`<option value="${f.id}" data-hasface="${!!f.face_descriptor}">${f.nome} — ${f.matricula} ${f.face_descriptor?'✓':'⚠️ sem rosto'}</option>`).join('');
  selE.innerHTML='<option value="">-- Selecione EPI --</option>' + epis.map(e=>`<option value="${e.id}">${e.nome} (CA ${e.ca}) — ${e.quantidade} un</option>`).join('');
  updateFaceVerifyState();
}
function updateFaceVerifyState(){
  const sel=$('#entregaFuncionario');
  const opt=sel.options[sel.selectedIndex];
  const hasFace = opt?.dataset.hasface==='true';
  const info=$('#funcFaceInfo');
  const btnStart=$('#btnStartVerify');
  const status=$('#verifyStatus');
  const box=$('#faceVerifyBox');
  if(!sel.value){ info.textContent=''; status.textContent='Selecione um funcionário com rosto cadastrado para habilitar.'; btnStart.disabled=true; btnStart.className='bg-slate-200 text-slate-500 px-4 py-2 rounded-lg text-sm font-medium cursor-not-allowed'; box.className='rounded-lg border-2 border-dashed p-4 text-center'; return; }
  if(!hasFace){
    info.innerHTML='<span class="text-amber-600"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Este funcionário NÃO possui biometria. Cadastre o rosto em Funcionários primeiro.</span>';
    status.textContent='Validação bloqueada: sem biometria cadastrada.';
    btnStart.disabled=true;
    box.className='rounded-lg border-2 border-amber-200 bg-amber-50 p-4 text-center';
  } else {
    info.innerHTML='<span class="text-emerald-600"><i class="fa-solid fa-check-circle mr-1"></i>Biometria cadastrada — pronto para validar.</span>';
    status.textContent='Clique em "Abrir câmera" e depois "Verificar e registrar".';
    btnStart.disabled=false;
    btnStart.className='bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700';
    box.className='rounded-lg border-2 border-emerald-200 bg-emerald-50 p-4 text-center';
  }
  $('#btnDoVerify').disabled=true;
}
$('#entregaFuncionario').addEventListener('change', updateFaceVerifyState);

// Camera entrega
async function startEntregaCamera(){
  try{
    entregaStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'user', width:640, height:480 } });
    const v=$('#videoEntrega');
    v.srcObject=entregaStream;
    v.classList.remove('hidden');
    $('#videoPlaceholder').classList.add('hidden');
    $('#canvasEntrega').classList.add('hidden');
    $('#btnStopCamera').classList.remove('hidden');
    $('#btnDoVerify').disabled=false;
    $('#verifyStatus').textContent='Câmera ativa — centralize o rosto e clique em Verificar.';
    // loop de detecção visual
    startFaceLoop();
  }catch(e){ toast('Erro câmera: '+e.message,false); }
}
function stopEntregaCamera(){
  if(entregaStream){ entregaStream.getTracks().forEach(t=>t.stop()); entregaStream=null; }
  $('#videoEntrega').classList.add('hidden');
  $('#videoPlaceholder').classList.remove('hidden');
  $('#btnStopCamera').classList.add('hidden');
  stopFaceLoop();
}
let faceLoopInterval=null;
function startFaceLoop(){
  const video=$('#videoEntrega');
  const canvas=$('#canvasEntrega');
  const displaySize={width: video.clientWidth, height: video.clientHeight };
  // não precisa loop pesado, só indicativo
  faceLoopInterval=setInterval(async()=>{
    if(!modelsLoaded || video.paused || video.ended) return;
    const det = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({inputSize:224, scoreThreshold:0.5}));
    const overlay=$('#faceOverlay');
    overlay.innerHTML='';
    if(det){
      const box=det.box;
      // mapeia para display size simplificado
      const scaleX = video.clientWidth / video.videoWidth;
      const scaleY = video.clientHeight / video.videoHeight;
      const div=document.createElement('div');
      div.className='face-box';
      div.style.left=(box.x*scaleX)+'px';
      div.style.top=(box.y*scaleY)+'px';
      div.style.width=(box.width*scaleX)+'px';
      div.style.height=(box.height*scaleY)+'px';
      overlay.appendChild(div);
    }
  },200);
}
function stopFaceLoop(){ clearInterval(faceLoopInterval); $('#faceOverlay').innerHTML=''; }

$('#btnStartVerify').addEventListener('click', startEntregaCamera);
$('#btnStopCamera').addEventListener('click', stopEntregaCamera);

$('#btnDoVerify').addEventListener('click', async()=>{
  if(!modelsLoaded){ toast('IA ainda carregando',false); return; }
  const funcId=$('#entregaFuncionario').value;
  const epiId=$('#entregaEpi').value;
  if(!funcId||!epiId){ toast('Selecione funcionário e EPI',false); return; }
  const func = funcionarios.find(f=>f.id==funcId);
  if(!func?.face_descriptor){ toast('Funcionário sem biometria',false); return; }
  const video=$('#videoEntrega');
  if(!entregaStream){ toast('Abra a câmera primeiro',false); return; }

  $('#verifyResult').textContent='🔍 Verificando rosto...';
  $('#verifyResult').className='text-sm font-semibold mt-3 text-blue-600';

  try{
    const detection = await getDescriptorFromVideo(video);
    if(!detection){
      $('#verifyResult').textContent='❌ Nenhum rosto detectado. Tente novamente com melhor luz.';
      $('#verifyResult').className='text-sm font-semibold mt-3 text-red-600';
      return;
    }
    const liveDesc = descriptorToArray(detection.descriptor);
    const storedDesc = func.face_descriptor; // já é array
    const distance = euclideanDistance(liveDesc, storedDesc);
    const threshold = 0.6;
    const isMatch = distance < threshold;
    const confidence = (1 - distance).toFixed(3);

    if(isMatch){
      $('#verifyResult').innerHTML=`✓ <span class="text-emerald-700">Rosto CONFIRMADO!</span> <span class="text-xs font-normal text-slate-600">dist=${distance.toFixed(3)} (limite ${threshold})</span>`;
      $('#verifyResult').className='text-sm font-semibold mt-3 text-emerald-700';
      // registra entrega
      const payload={
        funcionario_id: parseInt(funcId),
        epi_id: parseInt(epiId),
        quantidade: parseInt($('#entregaQtd').value)||1,
        observacao: $('#entregaObs').value.trim()||null,
        face_match_score: distance
      };
      const created = await api('/api/entregas',{method:'POST', body:payload});
      toast(`Entrega registrada! Assinatura facial validada (${(distance*100).toFixed(1)}% confiança)`);
      stopEntregaCamera();
      $('#verifyResult').textContent='';
      await loadEntregas();
      await loadEpis();
      await loadDashboard();
    } else {
      $('#verifyResult').innerHTML=`❌ <span class="text-red-700">Rosto NÃO confere!</span> <span class="text-xs font-normal">dist=${distance.toFixed(3)} > ${threshold} — Não é ${func.nome}</span>`;
      $('#verifyResult').className='text-sm font-semibold mt-3 text-red-600';
      toast('Falha na verificação facial — entrega NÃO registrada',false);
    }
  }catch(e){
    $('#verifyResult').textContent='Erro: '+e.message;
  }
});

async function loadEntregas(){
  entregas = await api('/api/entregas');
  renderEntregas();
  renderRelatorio();
}
function renderEntregas(){
  const q=($('#searchEntrega').value||'').toLowerCase();
  const tbody=$('#tbodyEntregas');
  const filtered = entregas.filter(e=> !q || `${e.funcionario_nome} ${e.epi_nome} ${e.matricula}`.toLowerCase().includes(q));
  if(filtered.length===0){ tbody.innerHTML='<tr><td colspan="6" class="p-6 text-center text-slate-400">Nenhuma entrega.</td></tr>'; return; }
  tbody.innerHTML=filtered.map(e=>`
    <tr class="hover:bg-slate-50">
      <td class="p-3 text-xs">${fmtDate(e.data_entrega)}</td>
      <td class="p-3"><p class="font-medium">${e.funcionario_nome}</p><p class="text-xs text-slate-500">${e.matricula} • ${e.setor||''}</p></td>
      <td class="p-3">${e.epi_nome}<p class="text-xs text-slate-500">CA ${e.epi_ca}</p></td>
      <td class="p-3">${e.quantidade}</td>
      <td class="p-3"><span class="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs"><i class="fa-solid fa-face-smile mr-1"></i>facial • score ${e.face_match_score!==null?e.face_match_score.toFixed(3):'-'}</span></td>
      <td class="p-3 text-right"><button onclick="deleteEntrega(${e.id})" class="text-red-600 hover:bg-red-50 w-8 h-8 rounded-lg"><i class="fa-solid fa-trash"></i></button></td>
    </tr>
  `).join('');
}
$('#searchEntrega')?.addEventListener('input', renderEntregas);
window.deleteEntrega=async(id)=>{
  if(!confirm('Excluir entrega? Estoque será estornado.'))return;
  await api(`/api/entregas/${id}`,{method:'DELETE'});
  toast('Entrega excluída');
  await loadEntregas(); await loadEpis(); await loadDashboard();
};

function renderRelatorio(){
  const tbody=$('#tbodyRelatorio');
  if(!tbody) return;
  if(entregas.length===0){ tbody.innerHTML='<tr><td colspan="5" class="p-4 text-center text-slate-400">Sem dados</td></tr>'; return; }
  tbody.innerHTML=entregas.map(e=>`<tr><td class="p-2">${e.funcionario_nome} (${e.matricula})</td><td class="p-2">${e.epi_nome}</td><td class="p-2">${e.epi_ca}</td><td class="p-2 text-xs">${fmtDate(e.data_entrega)}</td><td class="p-2">${e.face_match_score!==null?e.face_match_score.toFixed(3):'-'}</td></tr>`).join('');
}
window.exportCSV=()=>{
  const header='Funcionario,Matricula,EPI,CA,Data,Score\n';
  const rows=entregas.map(e=>`"${e.funcionario_nome}","${e.matricula}","${e.epi_nome}","${e.epi_ca}","${e.data_entrega}","${e.face_match_score||''}"`).join('\n');
  const blob=new Blob([header+rows],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='relatorio-entregas-epi.csv'; a.click(); URL.revokeObjectURL(url);
};

// ===== EPI - MODELO EXCEL / IMPORTAÇÃO EM MASSA =====
let _epiImportData = null;

// Gera e baixa ficha/modelo Excel para cadastro em massa
window.downloadModeloEPI = () => {
  // Se XLSX disponível, gera .xlsx com 2 abas formatadas
  if (typeof XLSX !== 'undefined') {
    const wb = XLSX.utils.book_new();

    // Aba 1: MODELO
    const header = ['nome*','ca*','validade','tamanho','quantidade','descricao'];
    const exemplos = [
      ['Capacete de Segurança','12345','2027-12-31','Único',50,'Capacete classe A - EXEMPLO (apague ou edite)'],
      ['Luva Nitrílica','67890','2026-10-15','M',100,'Luva nitrílica descartável - EXEMPLO'],
      ['Óculos de Proteção','54321','2027-06-30','Único',80,'Óculos incolor anti-risco - EXEMPLO'],
      ['Protetor Auricular','98765','2026-12-31','Único',200,'Tipo plug silicone - EXEMPLO'],
      ['Botina de Segurança','11223','2027-03-20','42',30,'Bico de aço - EXEMPLO']
    ];
    const wsData = [header, ...exemplos];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    // larguras
    ws['!cols'] = [{wch:28},{wch:12},{wch:14},{wch:10},{wch:12},{wch:42}];
    // congela cabeçalho
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    // filtro
    ws['!autofilter'] = { ref: `A1:F${wsData.length}` };
    // validação visual: cabeçalho em negrito (style só funciona em alguns viewers, mas mantemos)
    XLSX.utils.book_append_sheet(wb, ws, 'MODELO_EPI');

    // Aba 2: INSTRUÇÕES
    const instru = [
      ['INSTRUÇÕES - CADASTRO EM MASSA DE EPI'],
      [''],
      ['1. Preencha UMA LINHA por EPI na aba MODELO_EPI, abaixo do cabeçalho.'],
      ['2. Colunas com * são OBRIGATÓRIAS: nome, ca'],
      ['3. validade: formato AAAA-MM-DD (ex: 2027-12-31) ou DD/MM/AAAA. Deixe vazio se não houver.'],
      ['4. tamanho: ex: P, M, G, GG, 42, Único'],
      ['5. quantidade: número inteiro (ex: 50). Se vazio, assume 0.'],
      ['6. descricao: texto livre opcional.'],
      ['7. NÃO altere o nome das colunas do cabeçalho.'],
      ['8. Apague as linhas de EXEMPLO antes de importar (ou edite-as com dados reais).'],
      ['9. Salve o arquivo e importe em: EPIs > Importar planilha (aceita .xlsx e .csv)'],
      ['10. Limite: 500 EPIs por importação.'],
      [''],
      ['Exemplo de preenchimento:'],
      ['nome | ca | validade | tamanho | quantidade | descricao'],
      ['Capacete de Segurança | 12345 | 2027-12-31 | Único | 50 | Capacete classe A'],
      [''],
      ['Dúvidas? O sistema valida e mostra erros linha a linha na importação.']
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(instru);
    ws2['!cols'] = [{wch:90}];
    XLSX.utils.book_append_sheet(wb, ws2, 'INSTRUCOES');

    // Aba 3: LISTA ATUAL (se houver EPIs cadastrados, exporta ficha atual)
    if (epis && epis.length) {
      const h2 = ['nome','ca','validade','tamanho','quantidade','descricao'];
      const rows = epis.map(e=>[e.nome, e.ca, e.validade||'', e.tamanho||'', e.quantidade, e.descricao||'']);
      const ws3 = XLSX.utils.aoa_to_sheet([h2, ...rows]);
      ws3['!cols'] = [{wch:28},{wch:12},{wch:14},{wch:10},{wch:12},{wch:42}];
      ws3['!freeze'] = { xSplit: 0, ySplit: 1 };
      XLSX.utils.book_append_sheet(wb, ws3, 'LISTA_ATUAL');
    }

    XLSX.writeFile(wb, 'modelo_cadastro_epi_em_massa.xlsx');
    toast('Modelo Excel baixado! Preencha e importe em EPIs > Importar planilha');
  } else {
    // Fallback CSV puro (sem lib)
    const header = 'nome,ca,validade,tamanho,quantidade,descricao';
    const linhas = [
      'Capacete de Segurança,12345,2027-12-31,Único,50,Capacete classe A - EXEMPLO',
      'Luva Nitrílica,67890,2026-10-15,M,100,Luva nitrílica - EXEMPLO',
      'Óculos de Proteção,54321,2027-06-30,Único,80,Óculos incolor - EXEMPLO'
    ];
    const csv = '\uFEFF' + header + '\n' + linhas.join('\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='modelo_cadastro_epi_em_massa.csv'; a.click(); URL.revokeObjectURL(url);
    toast('Modelo CSV baixado!');
  }
};

// Também permite baixar via servidor (CSV) - útil se XLSX bloqueado
window.downloadModeloCSVServidor = () => {
  window.location.href = '/api/epis/template';
};

function parseCSV(text){
  // Detecta separador ; ou , (se contém ; e cabeçalho tem ;) usa ;
  const firstLine = text.split(/\r?\n/).find(l=>l.trim()!=='"');
  const sep = (firstLine && firstLine.includes(';') && !firstLine.includes(',')) ? ';' : (firstLine && firstLine.includes(';') && firstLine.split(';').length > firstLine.split(',').length ? ';' : ',');
  const lines = text.split(/\r?\n/).filter(l=>l.trim()!=='' && !l.trim().startsWith('#'));
  if(!lines.length) return [];
  const headers = lines[0].split(sep).map(h=>h.trim().replace(/^"|"$/g,'').toLowerCase());
  const rows=[];
  for(let i=1;i<lines.length;i++){
    const line=lines[i];
    if(!line.trim()) continue;
    // parser simples com aspas
    const cols=[]; let cur=''; let inQ=false;
    for(let c=0;c<line.length;c++){
      const ch=line[c];
      if(ch==='"'){ inQ=!inQ; continue; }
      if(ch===sep && !inQ){ cols.push(cur.trim()); cur=''; }
      else cur+=ch;
    }
    cols.push(cur.trim());
    const obj={};
    headers.forEach((h,idx)=> obj[h]= (cols[idx]||'').replace(/^"|"$/g,'').trim());
    // ignora linha totalmente vazia
    if(Object.values(obj).every(v=>!v)) continue;
    rows.push(obj);
  }
  return rows;
}

function excelSerialToISO(serial){
  // Excel serial 1 = 1900-01-01, 25569 = 1970-01-01 (Unix epoch). Corrige bug 1900 (serial 60)
  const num = Number(serial);
  if (isNaN(num) || num < 3000 || num > 60000) return null;
  // Ajuste Vercel/Excel: se serial > 60, subtrai 1 dia do bug 1900, mas a fórmula com 25569 já considera
  const utc = Math.round((num - 25569) * 86400 * 1000);
  const d = new Date(utc);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0,10);
}
function normalizaValidade(v){
  if (v === null || v === undefined || String(v).trim() === '') return '';
  // Se já é Date
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10);
  let s = String(v).trim();
  // Se for número ou string numérica pura (serial Excel)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const iso = excelSerialToISO(s);
    if (iso) return iso;
  }
  // Tenta DD/MM/AAAA
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Já está AAAA-MM-DD (corta para 10)
  s = s.slice(0,10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Tenta parse Date genérico (ex: "Dec 31 2027")
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
  return s;
}
function normalizaListaBruta(rawList){
  // Converte chaves variadas para padrão { nome, ca, validade, tamanho, quantidade, descricao }
  return rawList.map(r=>{
    const n={};
    Object.keys(r).forEach(k=>{
      const nk=k.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
      n[nk]=r[k];
    });
    const get=(...keys)=>{
      for(const k of keys){
        const nk=k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
        if(n[nk]!==undefined && String(n[nk]).trim()!=='') return n[nk];
      }
      return '';
    };
    return {
      nome: String(get('nome','nome do epi','nomeepi','produto','equipamento')||'').trim(),
      ca: String(get('ca','certificado','numca','nca')||'').trim(),
      validade: normalizaValidade(get('validade','val','data validade','vencimento')||''),
      tamanho: String(get('tamanho','tam','medida')||'').trim(),
      quantidade: String(get('quantidade','qtd','quant','estoque')||'').trim(),
      descricao: String(get('descricao','desc','observacao','obs','detalhes')||'').trim(),
      _raw: r
    };
  });
}

window.importarPlanilhaEPI = async (event) => {
  const file = event.target.files && event.target.files[0];
  if(!file) return;
  const preview = document.getElementById('importPreview');
  preview.classList.remove('hidden');
  preview.innerHTML = `<div class="p-4 text-sm text-slate-600"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Lendo planilha "${file.name}"...</div>`;
  try{
    let rawList=[];
    if(file.name.toLowerCase().endsWith('.csv')){
      const text = await file.text();
      rawList = parseCSV(text);
    } else {
      if(typeof XLSX==='undefined'){
        throw new Error('Biblioteca XLSX não carregada. Use arquivo .csv ou recarregue a página.');
      }
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, {type:'array'});
      // procura aba MODELO_EPI, senão primeira aba
      let sheetName = wb.SheetNames.includes('MODELO_EPI') ? 'MODELO_EPI' : wb.SheetNames[0];
      // se usuário dejó instrucoes como primeira, tenta achar alguma com dados
      // se a primeira tiver <2 linhas e houver segunda, usa segunda
      let ws = wb.Sheets[sheetName];
      let json = XLSX.utils.sheet_to_json(ws, {defval:'', raw:false});
      // filtra json vazio e tenta fallback se header não tem nome/ca
      const hasHeader = json.length && Object.keys(json[0]).some(k=>k.toLowerCase().includes('nome')||k.toLowerCase().includes('ca'));
      if(!hasHeader && wb.SheetNames.length>1){
        for(const n of wb.SheetNames){
          const j = XLSX.utils.sheet_to_json(wb.Sheets[n], {defval:'', raw:false});
          if(j.length && Object.keys(j[0]).some(k=>k.toLowerCase().includes('nome'))){ json=j; sheetName=n; break; }
        }
      }
      rawList = json;
      // se ainda vazio, tenta ler como array (cabeçalho na primeira linha)
      if(!rawList.length){
        const aoa = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
        if(aoa.length>=2){
          const hdr=aoa[0].map(h=>String(h).trim());
          rawList = aoa.slice(1).map(row=>{
            const o={}; hdr.forEach((h,i)=> o[h]=row[i]||'');
            return o;
          });
        }
      }
    }
    if(!rawList.length){
      preview.innerHTML = `<div class="p-4 text-amber-700 bg-amber-50"><i class="fa-solid fa-triangle-exclamation mr-2"></i>Nenhum dado encontrado na planilha. Verifique se a aba MODELO_EPI contém dados abaixo do cabeçalho.</div>`;
      event.target.value='';
      return;
    }
    const lista = normalizaListaBruta(rawList);
    // valida prévia
    const validos = lista.filter(x=>x.nome && x.ca);
    const invalidos = lista.filter(x=>!x.nome || !x.ca);

    _epiImportData = lista;

    // render preview
    const maxPreview = 8;
    const headHtml = `<tr class="bg-slate-50 text-slate-600"><th class="p-2 text-left">#</th><th class="p-2 text-left">Nome*</th><th class="p-2 text-left">CA*</th><th class="p-2 text-left">Validade</th><th class="p-2 text-left">Tamanho</th><th class="p-2 text-left">Qtd</th><th class="p-2 text-left">Descrição</th><th class="p-2 text-left">Status</th></tr>`;
    const rowsHtml = lista.slice(0,maxPreview).map((r,i)=>{
      const ok = r.nome && r.ca;
      return `<tr class="${ok?'':'bg-red-50'} border-t"><td class="p-2 text-xs">${i+1}</td><td class="p-2 text-sm">${r.nome||'<span class="text-red-600">— faltando</span>'}</td><td class="p-2 text-sm">${r.ca||'<span class="text-red-600">— faltando</span>'}</td><td class="p-2 text-xs">${r.validade||'-'}</td><td class="p-2 text-xs">${r.tamanho||'-'}</td><td class="p-2 text-xs">${r.quantidade||'0'}</td><td class="p-2 text-xs truncate max-w-[180px]">${r.descricao||'-'}</td><td class="p-2 text-xs">${ok?'<span class="text-emerald-700">✓ ok</span>':'<span class="text-red-600">✗ inválido</span>'}</td></tr>`;
    }).join('');
    const mais = lista.length > maxPreview ? `<p class="text-xs text-slate-500 mt-2">... e mais ${lista.length-maxPreview} linha(s). Role a planilha completa no Excel.</p>` : '';
    preview.innerHTML = `
      <div class="p-4 border-b bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 class="font-semibold text-slate-800"><i class="fa-solid fa-table mr-2 text-blue-600"></i>Prévia da importação — ${file.name}</h3>
          <p class="text-xs text-slate-600 mt-1">Total: <b>${lista.length}</b> linha(s) • <span class="text-emerald-700">${validos.length} válida(s)</span> • ${invalidos.length?`<span class="text-red-600">${invalidos.length} inválida(s) (nome/ca faltando)</span>`:'<span class="text-emerald-600">nenhum erro</span>'} • Aba detectada: <b>${file.name.endsWith('.csv')?'CSV': 'xlsx'}</b></p>
        </div>
        <div class="flex gap-2 shrink-0">
          <button onclick="cancelarImportacaoEPI()" class="border px-4 py-2 rounded-lg text-sm hover:bg-slate-50">Cancelar</button>
          <button onclick="confirmarImportacaoEPI()" class="bg-emerald-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed" ${validos.length===0?'disabled':''}><i class="fa-solid fa-check mr-1"></i>Confirmar importação (${validos.length})</button>
        </div>
      </div>
      <div class="p-4">
        <div class="overflow-x-auto border rounded-lg">
          <table class="w-full text-sm">${headHtml}${rowsHtml}</table>
        </div>
        ${mais}
        ${invalidos.length?`<div class="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900"><i class="fa-solid fa-triangle-exclamation mr-1"></i><b>Atenção:</b> ${invalidos.length} linha(s) sem nome ou CA serão ignoradas. Corrija a planilha se necessário.</div>`:''}
        <p class="text-xs text-slate-500 mt-3"><i class="fa-solid fa-circle-info mr-1"></i>Dica: a importação ignora maiúsculas/acentos no cabeçalho. Cabeçalhos aceitos: <code>nome, ca, validade, tamanho, quantidade, descricao</code></p>
      </div>
    `;
    // rola até preview
    preview.scrollIntoView({behavior:'smooth', block:'start'});
  }catch(e){
    preview.innerHTML = `<div class="p-4 bg-red-50 text-red-700 text-sm"><i class="fa-solid fa-circle-xmark mr-2"></i>Erro ao ler planilha: ${e.message}</div>`;
  } finally {
    event.target.value='';
  }
};

window.cancelarImportacaoEPI = () => {
  _epiImportData = null;
  const p=document.getElementById('importPreview');
  p.classList.add('hidden');
  p.innerHTML='';
};

window.confirmarImportacaoEPI = async () => {
  if(!_epiImportData || !_epiImportData.length){ toast('Nenhum dado para importar', false); return; }
  // Remove _raw e garante payload limpo para API
  const listaParaEnvio = _epiImportData.map(({ _raw, ...rest }) => rest);
  const btn = document.querySelector('#importPreview button[onclick="confirmarImportacaoEPI()"]');
  const orig = btn ? btn.innerHTML : '';
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin mr-1"></i>Importando...'; }
  const renderResultado = (res) => {
    const preview = document.getElementById('importPreview');
    preview.innerHTML = `
      <div class="p-4">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full ${res.falhas>0?'bg-amber-100 text-amber-700':'bg-emerald-100 text-emerald-700'} flex items-center justify-center"><i class="fa-solid ${res.falhas>0?'fa-triangle-exclamation':'fa-check'}"></i></div>
          <div>
            <h3 class="font-semibold text-slate-800">${res.sucesso>0?'Importação concluída!':'Importação com falhas'}</h3>
            <p class="text-sm text-slate-600">${res.sucesso} cadastrado(s) de ${res.total} linha(s)${res.falhas?` • <span class="text-amber-700">${res.falhas} falha(s)</span>`:''} ${res.fallback?'<span class="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full ml-2">modo fallback</span>':''}</p>
          </div>
          <button onclick="cancelarImportacaoEPI()" class="ml-auto border px-4 py-2 rounded-lg text-sm">Fechar</button>
        </div>
        ${res.detalhesFalhas && res.detalhesFalhas.length ? `<div class="mt-4 border rounded-lg overflow-hidden"><p class="p-2 bg-amber-50 text-xs font-medium text-amber-900">Falhas (mostrando até 20):</p><table class="w-full text-xs"><tr class="bg-slate-50"><th class="p-2 text-left">Linha</th><th class="p-2 text-left">Erro</th><th class="p-2 text-left">Dados</th></tr>${res.detalhesFalhas.map(f=>`<tr class="border-t"><td class="p-2">${f.linha}</td><td class="p-2 text-red-600">${f.erro}</td><td class="p-2 truncate max-w-[260px]">${JSON.stringify(f.dados).slice(0,120)}</td></tr>`).join('')}</table></div>`:''}
        <div class="mt-4 flex gap-2">
          <button onclick="cancelarImportacaoEPI(); loadEpis(); loadDashboard();" class="bg-blue-700 text-white px-5 py-2 rounded-lg text-sm">Atualizar lista</button>
          <button onclick="downloadModeloEPI()" class="border px-4 py-2 rounded-lg text-sm">Baixar modelo novamente</button>
        </div>
      </div>
    `;
  };
  try{
    let res;
    try{
      res = await api('/api/epis/import', {method:'POST', body: { epis: listaParaEnvio }});
    }catch(errBulk){
      const isNotFound = /404|NOT_FOUND|não encontrado|The page could not be found|Failed to fetch|Backend não encontrado/i.test(errBulk.message||'');
      console.warn('[IMPORT] bulk falhou, isNotFound=', isNotFound, errBulk.message);
      if(isNotFound){
        // FALLBACK: insere um a um via POST /api/epis (endpoint antigo que existe no Vercel mesmo sem redeploy)
        toast('Servidor sem rota bulk (404) — usando fallback linha a linha...', true);
        let sucesso=0; const falhas=[];
        for(let i=0;i<listaParaEnvio.length;i++){
          const r = listaParaEnvio[i];
          const linha=i+2;
          if(!r.nome || !r.ca){ falhas.push({linha, erro:'Nome e CA são obrigatórios', dados:r}); continue; }
          const payload = { nome:r.nome, ca:r.ca, validade: r.validade||null, tamanho: r.tamanho||null, quantidade: parseInt(r.quantidade)||0, descricao: r.descricao||null };
          try{
            await api('/api/epis', {method:'POST', body: payload});
            sucesso++;
          }catch(e2){
            falhas.push({linha, erro:e2.message, dados:r});
          }
        }
        res = { total: listaParaEnvio.length, sucesso, falhas: falhas.length, detalhesFalhas: falhas.slice(0,20), fallback:true, message: `${sucesso} EPI(s) cadastrado(s) via fallback${falhas.length?` , ${falhas.length} falha(s)`:''}` };
        if(sucesso===0 && falhas.length>0 && falhas.every(f=>/404|NOT_FOUND/i.test(f.erro))){
          // Se até POST /api/epis dá 404, é deployment estático sem API - avisa
          throw new Error('API offline no Vercel (404). O backend não foi deployado. No local use http://localhost:3000 (npm start). No Vercel, é preciso publicar o código do servidor (server/server.js). Detalhe: '+falhas[0].erro);
        }
      }else{
        throw errBulk;
      }
    }
    toast(res.message || `${res.sucesso} EPIs importados!`);
    renderResultado(res);
    await loadEpis();
    await loadDashboard();
  }catch(e){
    console.error('[IMPORT] erro final', e);
    toast('Erro na importação: '+e.message, false);
    if(btn){ btn.disabled=false; btn.innerHTML=orig; }
    // Mostra erro detalhado no preview para debug no Vercel
    const preview = document.getElementById('importPreview');
    if(preview){
      preview.innerHTML += `<div class="m-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800"><b>Detalhe erro:</b> ${e.message}<br><span class="text-slate-600">Dica: No Vercel, abra o Console (F12) > Network e veja a resposta de /api/epis/import. Se 404, faça push do server/server.js para o GitHub. Fallback tenta POST /api/epis.</span><br><button onclick="cancelarImportacaoEPI()" class="mt-2 border px-3 py-1 rounded bg-white">Fechar</button></div>`;
    }
  }
};

// Init
(async()=>{
  await loadFuncionarios();
  await loadEpis();
  await loadEntregas();
  await loadDashboard();
})();
