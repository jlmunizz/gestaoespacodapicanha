'use strict';
function gerarIdProduto() {
  return crypto.randomUUID();
}
const money = n => Number(n || 0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
const defaultProducts = [
  {name:'Self-service', price:59.90, unit:'kg'},
  {name:'Carne', price:39.90, unit:'kg'},
  {name:'Salada', price:29.90, unit:'kg'},
  {name:'Refrigerante', price:6.00, unit:'un'},
  {name:'Água', price:3.00, unit:'un'}
];
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
let products = load('restaurante_products', defaultProducts);
let productCategories = load('restaurante_product_categories', ['Principal']);
let activeOrderCategory = 'Principal';
let activeCatalogCategory = 'Todas';
let tables = load('restaurante_tables', Array.from({length:100}, (_,i)=>({id:i+1,items:[]})));
let sales = load('restaurante_sales', []);
let cashSessions = load('restaurante_cash_sessions', []);
let activeCash = load('restaurante_active_cash', null);
// Se já havia uma versão com menos mesas, amplia automaticamente para 100.
for (let i=1;i<=100;i++) if (!tables.some(t=>t.id===i)) tables.push({id:i,items:[]});
tables.sort((a,b)=>a.id-b.id);
let selectedTableId = null;
let serialPort = null, serialReader = null, serialActive = false, latestWeightGrams = null;
const $ = id => document.getElementById(id);
const table = () => tables.find(t=>t.id===selectedTableId);
const tableTotal = t => t.items.reduce((sum,item)=>sum+item.total,0);
const pad = n => String(n).padStart(2,'0');
let cloudUser = null;
let cloudReady = false;
let cloudSaveTimer = null;
const save = () => {
  localStorage.setItem('restaurante_products', JSON.stringify(products));
  localStorage.setItem('restaurante_product_categories', JSON.stringify(productCategories));
  localStorage.setItem('restaurante_tables', JSON.stringify(tables));
  localStorage.setItem('restaurante_sales', JSON.stringify(sales));
  localStorage.setItem('restaurante_cash_sessions', JSON.stringify(cashSessions));
  localStorage.setItem('restaurante_active_cash', JSON.stringify(activeCash));
  if (cloudReady && cloudUser) {
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(() => { cloudSaveTimer=null; syncCloudState(); }, 700);
  }
};
const firebaseConfig = window.FIREBASE_CONFIG || {};
let cloudClient = null;
let cloudDocRef = null;
let cloudUnsubscribe = null;
let cloudWriting = false;
let cloudPending = false;
function cloudMessage(message, isError=false) {
  const el=$('cloudLoginMessage'); if(el){el.textContent=message;el.style.color=isError?'#ff7777':'#ffd166';}
}
function cloudStatus(message, online=false) {
  const el=$('cloudStatus'); if(el){el.textContent=message;el.classList.toggle('online',online);}
}
function localSnapshot(){return {products,productCategories,tables,sales,cashSessions,activeCash};}
function applySnapshot(data){
  products=Array.isArray(data?.products)?data.products:defaultProducts;
  productCategories=Array.isArray(data?.productCategories)&&data.productCategories.length?data.productCategories:['Principal'];
  productCategories=[...new Set(['Principal',...productCategories.filter(x=>typeof x==='string'&&x.trim())])];
  tables=Array.isArray(data?.tables)?data.tables:Array.from({length:100},(_,i)=>({id:i+1,items:[]}));
  for(let i=1;i<=100;i++)if(!tables.some(t=>Number(t.id)===i))tables.push({id:i,items:[]});
  tables.sort((a,b)=>a.id-b.id);
  sales=Array.isArray(data?.sales)?data.sales:[];
  cashSessions=Array.isArray(data?.cashSessions)?data.cashSessions:[];
  activeCash=data?.activeCash??null;
  for(const [key,value] of Object.entries({restaurante_products:products,restaurante_product_categories:productCategories,restaurante_tables:tables,restaurante_sales:sales,restaurante_cash_sessions:cashSessions,restaurante_active_cash:activeCash}))localStorage.setItem(key,JSON.stringify(value));
}
async function syncCloudState(){
  if(!cloudClient||!cloudUser||!cloudReady)return;
  if(cloudWriting){cloudPending=true;return;}
  cloudWriting=true;
  try{
    do{
      cloudPending=false;
      const state=JSON.parse(JSON.stringify(localSnapshot()));
      cloudStatus('Salvando na nuvem…');
      await cloudClient.setDoc(cloudDocRef,{state,updatedAt:cloudClient.serverTimestamp()},{merge:true});
    }while(cloudPending);
    cloudStatus('Sincronizado na nuvem',true);
  }catch(error){cloudStatus('Erro ao sincronizar');console.error(error);cloudMessage('Falha ao salvar: '+error.message,true);}
  finally{cloudWriting=false;}
}
async function enterCloudApp(user){
  if(cloudUnsubscribe){cloudUnsubscribe();cloudUnsubscribe=null;}
  cloudUser=user;cloudReady=false;
  $('cloudLogin').hidden=true;$('cloudSignOut').hidden=false;
  cloudStatus('Carregando dados…');
  try{
    cloudDocRef=cloudClient.doc(cloudClient.db,'restaurantes',user.uid);
    console.log('FIRESTORE: iniciando leitura');
const snapshot=await cloudClient.getDoc(cloudDocRef);
console.log('FIRESTORE: leitura concluída');

console.log('FIRESTORE: iniciando processamento');

if (snapshot.exists()) {
  applySnapshot(snapshot.data().state);
} else {
  await cloudClient.setDoc(cloudDocRef, {
    state: JSON.parse(JSON.stringify(localSnapshot())),
    updatedAt: cloudClient.serverTimestamp()
  });
}

console.log('FIRESTORE: processamento concluído');

    cloudReady=true;render();cloudStatus('Sincronizado na nuvem',true);
    cloudUnsubscribe=cloudClient.onSnapshot(cloudDocRef,doc=>{
      if(!doc.exists()||!cloudReady||cloudWriting||cloudSaveTimer)return;
      applySnapshot(doc.data().state);render();cloudStatus('Atualizado da nuvem',true);
    },error=>{cloudStatus('Erro na conexão');console.error(error);});
  }catch(error){cloudReady=false;$('cloudLogin').hidden=false;$('cloudSignOut').hidden=true;cloudMessage('Não foi possível acessar o Firestore: '+error.message,true);cloudStatus('Falha na conexão');}
}
async function initializeCloud(){
  const valid=firebaseConfig.apiKey&&firebaseConfig.authDomain&&firebaseConfig.projectId&&!firebaseConfig.apiKey.includes('SUA_')&&!firebaseConfig.projectId.includes('SEU_');
  if(!valid||!window.firebaseModules){
    $('cloudLogin').hidden=false;cloudMessage('Configure firebase-config.js com os dados do seu projeto Firebase.',true);cloudStatus('Configure o Firebase');
    $('cloudSignIn').disabled=true;$('cloudSignUp').disabled=true;return;
  }
  try{
    const f=window.firebaseModules;
    const app=f.initializeApp(firebaseConfig),auth=f.getAuth(app),db=f.getFirestore(app);
    cloudClient={...f,auth,db};
    $('cloudSignIn').addEventListener('click',async()=>{
      const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;
      if(!email||!password){cloudMessage('Informe e-mail e senha.',true);return;}
      $('cloudSignIn').disabled=true;cloudMessage('Entrando…');
      try{await f.signInWithEmailAndPassword(auth,email,password);}catch(error){cloudMessage('Não foi possível entrar: '+error.message,true);}finally{$('cloudSignIn').disabled=false;}
    });
    $('cloudSignUp').addEventListener('click',async()=>{
      const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;
      if(!email||password.length<6){cloudMessage('Informe e-mail e senha de pelo menos 6 caracteres.',true);return;}
      $('cloudSignUp').disabled=true;cloudMessage('Criando conta…');
      try{await f.createUserWithEmailAndPassword(auth,email,password);}catch(error){cloudMessage('Não foi possível criar conta: '+error.message,true);}finally{$('cloudSignUp').disabled=false;}
    });
    $('cloudSignOut').addEventListener('click',async()=>{
      cloudReady=false;clearTimeout(cloudSaveTimer);cloudSaveTimer=null;
      if(cloudUnsubscribe){cloudUnsubscribe();cloudUnsubscribe=null;}
      await f.signOut(auth);
      for(const key of ['restaurante_products','restaurante_tables','restaurante_sales','restaurante_cash_sessions','restaurante_active_cash'])localStorage.removeItem(key);
      cloudUser=null;$('cloudLogin').hidden=false;$('cloudSignOut').hidden=true;cloudStatus('Sessão encerrada');
    });
    f.onAuthStateChanged(auth,async user=>{
      if(user)await enterCloudApp(user);
      else{cloudReady=false;cloudUser=null;$('cloudLogin').hidden=false;$('cloudSignOut').hidden=true;cloudStatus('Entre para sincronizar');}
    });
  }catch(error){cloudMessage('Falha ao iniciar Firebase: '+error.message,true);cloudStatus('Falha na configuração');}
}

async function consultarNumeracaoFiscal() {




  if (!cloudUser) {
    throw new Error('Faça login antes de consultar.');
  }

  const token = await cloudUser.getIdToken();

  const resposta = await fetch(
    'http://localhost:3001/api/fiscal/numeracao-teste',
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!resposta.ok) {
    throw new Error(
      `Falha na consulta fiscal: HTTP ${resposta.status}`
    );
  }

  return await resposta.json();
} 
const botaoFiscal = document.getElementById('btnTesteFiscal');

console.log('Botão fiscal encontrado:', !!botaoFiscal);

botaoFiscal?.addEventListener('click', async () => {
  const resultado = document.getElementById('resultadoTesteFiscal');

  if (!resultado) return;

  resultado.textContent = 'Consultando Firebase...';

  try {
    const dados = await consultarNumeracaoFiscal();

    resultado.textContent =
      'Consulta realizada: ' + JSON.stringify(dados);

  } catch (erro) {
    resultado.textContent =
      'Erro na consulta: ' + erro.message;
  }
});
 

const esc = value => String(value).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function renderTables(){
  $('tables').innerHTML = tables.map(t=>`<button class="table-button ${t.items.length?'busy':''} ${t.id===selectedTableId?'active':''}" data-table="${t.id}">Mesa ${pad(t.id)}<small>${t.items.length?money(tableTotal(t)):'Livre'}</small></button>`).join('');
  document.querySelectorAll('[data-table]').forEach(button=>button.addEventListener('click',()=>{
    selectedTableId=Number(button.dataset.table);resetAutoCycle();
    render();resetToLunchKg();
  }));
  $('tablesPanel').hidden = selectedTableId !== null;
  $('orderPanel').hidden = selectedTableId === null;
  $('operation').classList.toggle('order-open', selectedTableId !== null);
  $('busyCount').textContent=tables.filter(t=>t.items.length).length;
  $('openTotal').textContent=money(tables.reduce((sum,t)=>sum+tableTotal(t),0));
}
function renderProducts(){
  const select=$('product');
  const prior=select.value;
  const query=$('productSearch').value.trim().toLocaleLowerCase('pt-BR');
  renderCategoryTabs();
  const visible=products.map((p,index)=>({...p,index})).filter(p=>{
    if((p.category||'Principal')!==activeOrderCategory)return false;
    const searchable=`${p.name} ${p.code||''}`.toLocaleLowerCase('pt-BR');
    return searchable.includes(query);
  });
  const quickProducts=$('quickProducts');
  if(quickProducts){
    quickProducts.innerHTML=visible.length?visible.map(p=>`<button type="button" class="quick-product" data-quick-product="${p.index}" title="Clique para lançar ${esc(p.name)} com quantidade 1"><span><span class="quick-name">${esc(p.name)}</span><span class="quick-price">${money(p.price)}${p.unit==='kg'?' / kg':' / un.'}</span></span><span class="quick-plus" aria-hidden="true">+</span></button>`).join(''):'<div class="quick-empty">Nenhum produto encontrado. Cadastre o produto na aba Produtos cadastrados.</div>';
    


quickProducts.querySelectorAll('[data-quick-product]').forEach(button => {
  button.addEventListener('click', () => {
    const indice = Number(button.dataset.quickProduct);
    const produto = products[indice];

    if (!produto) return;

    if (selectedTableId === null || !table()) {
      alert('Abra uma mesa primeiro.');
      return;
    }

    // Produtos por quilo continuam como antes.
    if (produto.unit === 'kg') {
      addProductDirect(indice);
      return;
    }

    // Remove eventual janela anterior.
    document.getElementById('modalQuantidadeProduto')?.remove();

    let quantidade = 1;
    const preco = Number(produto.price) || 0;

    const fundo = document.createElement('div');
    fundo.id = 'modalQuantidadeProduto';
    fundo.style.cssText = `
      position:fixed;
      inset:0;
      background:rgba(0,0,0,.8);
      z-index:99999;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:16px;
    `;

    fundo.innerHTML = `
      <div style="
        background:#181818;
        color:white;
        width:100%;
        max-width:390px;
        padding:25px;
        border:1px solid #e50920;
        border-radius:15px;
        box-sizing:border-box;
      ">
        <h2 style="margin:0 0 18px;color:#ff404a">
          Adicionar produto
        </h2>

        <h3 id="modalQtdNome"></h3>

        <p id="modalQtdPreco" style="color:#aaa"></p>

        <div style="
          display:flex;
          justify-content:center;
          align-items:center;
          gap:25px;
          margin:25px 0;
        ">
          <button id="qtdMenos" type="button"
            style="padding:12px 20px;font-size:24px">
            −
          </button>

          <strong id="qtdNumero"
            style="font-size:32px;min-width:45px;text-align:center">
            1
          </strong>

          <button id="qtdMais" type="button"
            style="padding:12px 20px;font-size:24px">
            +
          </button>
        </div>

        <p style="display:flex;justify-content:space-between">
          <strong>Total:</strong>
          <strong id="qtdTotal" style="color:#ff404a"></strong>
        </p>

        <div style="display:flex;gap:10px;margin-top:25px">
          <button id="qtdCancelar" type="button"
            style="flex:1;padding:12px">
            Cancelar
          </button>

          <button id="qtdConfirmar" type="button"
            style="
              flex:1;
              padding:12px;
              background:#c81020;
              color:white;
              border:0;
              border-radius:7px;
              font-weight:bold;
              cursor:pointer;
            ">
            Adicionar à mesa
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(fundo);

    const campo = id => fundo.querySelector('#' + id);

    campo('modalQtdNome').textContent = produto.name;

    campo('modalQtdPreco').textContent =
      money(preco) + ' por unidade';

    function atualizarQuantidade() {
      campo('qtdNumero').textContent = quantidade;
      campo('qtdTotal').textContent = money(preco * quantidade);
      campo('qtdMenos').disabled = quantidade <= 1;
    }

    campo('qtdMenos').onclick = () => {
      quantidade = Math.max(1, quantidade - 1);
      atualizarQuantidade();
    };

    campo('qtdMais').onclick = () => {
      quantidade++;
      atualizarQuantidade();
    };

    campo('qtdCancelar').onclick = () => fundo.remove();

    campo('qtdConfirmar').onclick = () => {
      addProductDirect(indice, quantidade);
      fundo.remove();
    };

    fundo.addEventListener('click', evento => {
      if (evento.target === fundo) fundo.remove();
    });

    atualizarQuantidade();
  });
});


  }
  if(!visible.length){
    select.innerHTML='<option value="">Nenhum produto encontrado</option>';
    $('price').value='';$('itemValue').textContent=money(0);return;
  }
  select.innerHTML=visible.map(p=>`<option value="${p.index}">${esc(p.name)} — ${p.unit==='kg'?'por kg':'por unidade'}</option>`).join('');
  const priorStillVisible=visible.some(p=>String(p.index)===prior);
  select.value=priorStillVisible?prior:String(visible[0].index);
  updateProductFields();
}
// Produto padrão da balança: sempre retornar a ele após cada lançamento.
function resetToLunchKg(){
  const index=products.findIndex(p=>p.unit==='kg' && p.name.trim().toLocaleLowerCase('pt-BR')==='almoço no kg');
  if(index<0)return; // Não alterar a seleção caso o produto não esteja cadastrado.
  $('productSearch').value='';
  activeOrderCategory=products[index].category||'Principal';
  renderProducts();
  $('product').value=String(index);
  updateProductFields();
}
function updateProductFields(){
  const p=products[Number($('product').value)]; if(!p)return;
  $('price').value=p.price;$('unit').value=p.unit;$('quantity').value='1';updateUnit();
}
function updateUnit(){
  const byWeight=$('unit').value==='kg';
  $('quantityLabel').textContent=byWeight?'Quantidade (kg)':'Quantidade (unidades)';
  $('quantity').placeholder='Ex.: 1';
  const current=Number($('quantity').value);
  if(!Number.isFinite(current)||current<=0) $('quantity').value='1';
  updateCalculation();
}
function quantityForCalculation(){
  return Number($('quantity').value)||0;
}
function updateCalculation(){
  const price=Number($('price').value)||0;
  $('itemValue').textContent=money(price*quantityForCalculation());
}
function renderOrder(){
  const hasSelection=selectedTableId!==null;
  $('orderPrompt').hidden=hasSelection;
  $('orderContent').hidden=!hasSelection;
  $('selectedTable').textContent=hasSelection?'Mesa '+pad(selectedTableId):'Nenhuma mesa';
  if(!hasSelection){$('orderItems').innerHTML='';$('tableTotal').textContent=money(0);return;}
  const t=table();
  $('orderItems').innerHTML=t.items.length?t.items.map((item,index)=>`<div class="order-item"><div><strong>${esc(item.name)}</strong><small>Qtd.: ${item.unit==='kg'?Number(item.quantity).toLocaleString('pt-BR',{maximumFractionDigits:3})+' kg':item.quantity+' un.'} × ${money(item.price)}${item.unit==='kg'?' / kg':' / un.'}</small></div><div class="item-right"><strong>${money(item.total)}</strong><button class="button danger" data-remove="${index}">Remover</button></div></div>`).join(''):'<div class="empty">Nenhum produto lançado nesta mesa.</div>';
  document.querySelectorAll('[data-remove]').forEach(button=>button.addEventListener('click',()=>{
    t.items.splice(Number(button.dataset.remove),1);save();render();
  }));
  $('tableTotal').textContent=money(tableTotal(t));
  if(pendingPaymentTable!==selectedTableId){pendingPayments=[];pendingPaymentTable=selectedTableId;$('amountPaid').value='';}
  renderPendingPayments();
}
function renderCategoryTabs(){
  productCategories=[...new Set(['Principal',...productCategories.filter(x=>typeof x==='string'&&x.trim()&&x!=='Principal')])];
  if(!productCategories.includes(activeOrderCategory))activeOrderCategory='Principal';
  if(activeCatalogCategory!=='Todas'&&!productCategories.includes(activeCatalogCategory))activeCatalogCategory='Todas';
  for(const id of ['newProductCategory','editProductCategory']){
    const select=$(id);if(!select)continue;
    const prior=select.value;
    select.innerHTML=productCategories.map(cat=>`<option value="${esc(cat)}">${esc(cat)}</option>`).join('');
    if(productCategories.includes(prior))select.value=prior;
  }
  const order=$('orderCategoryTabs');
  if(order){order.innerHTML=productCategories.map(cat=>`<button type="button" class="category-tab ${cat===activeOrderCategory?'active':''}" data-order-category="${esc(cat)}">${esc(cat)}</button>`).join('');}
  const catalog=$('catalogCategoryTabs');
  if(catalog){catalog.innerHTML=['Todas',...productCategories].map(cat=>`<button type="button" class="category-tab ${cat===activeCatalogCategory?'active':''}" data-catalog-category="${esc(cat)}">${esc(cat)}</button>`).join('');}
}
$('orderCategoryTabs').addEventListener('click',e=>{
  const button=e.target.closest('[data-order-category]');if(!button)return;
  activeOrderCategory=button.dataset.orderCategory;$('productSearch').value='';renderProducts();
});
$('catalogCategoryTabs').addEventListener('click',e=>{
  const button=e.target.closest('[data-catalog-category]');if(!button)return;
  activeCatalogCategory=button.dataset.catalogCategory;renderProductCatalog();
});
$('addCategory').addEventListener('click',()=>{
  const name=$('newCategoryName').value.trim();
  if(!name){alert('Digite o nome da nova aba.');return;}
  if(productCategories.some(c=>c.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR'))){alert('Essa aba já existe.');return;}
  productCategories.push(name);activeCatalogCategory=name;activeOrderCategory=name;
  $('newCategoryName').value='';save();render();
  $('newProductCategory').value=name;
});
// Cadastro tributário: nenhuma classificação fiscal é presumida pelo sistema.
const FISCAL_KEYS = ["ncm", "cfop", "csosn", "cest", "origem", "uTrib", "cstPis", "cstCofins", "cClassTrib"];
const FISCAL_REQUIRED = ['ncm','cfop','csosn','origem','uTrib','cstPis','cstCofins'];
function fiscalFieldId(prefix,key){return prefix+key[0].toUpperCase()+key.slice(1);}
function readFiscalFields(prefix){const data={};for(const key of FISCAL_KEYS){const input=$(fiscalFieldId(prefix,key));data[key]=input?input.value.trim().toUpperCase():'';}return data;}
function writeFiscalFields(prefix,data={}){for(const key of FISCAL_KEYS){const input=$(fiscalFieldId(prefix,key));if(input)input.value=data[key]||'';}}
function fiscalIssues(data){
 const errors=[];
 for(const key of FISCAL_REQUIRED)if(!String(data[key]||'').trim())errors.push(key);
 for(const [key,re] of Object.entries({ncm:/^\d{8}$/,cfop:/^\d{4}$/,csosn:/^\d{3}$/,cest:/^\d{7}$/,origem:/^[0-8]$/,uTrib:/^[A-Z]{1,6}$/,cstPis:/^\d{2}$/,cstCofins:/^\d{2}$/}))if(data[key]&&!re.test(data[key]))errors.push(key+' inválido');
 return errors;
}

// Grupos operacionais, sem preenchimento automático de códigos tributários.
const FISCAL_GROUPS=[
 ['Produção própria — refeições',['Almoço no kg','Quentinha','Refeição','Quentinha 1']],
 ['Produção própria — carnes e adicionais',['Carne Assada','Acrescimo de carne']],
 ['Produção própria — sobremesas',['Doce','Brownie','Sobremesa','Sorvete Brigadeiro']],
 ['Revenda — bebidas industrializadas lacradas',['Refrigerante Lata','Agua 500ml','Agua de Coco','Suco 300ml','Refrigerante 1L','H2oh 500ml','Amstel Ultra 600ml']],
 ['Outras mercadorias',['Chaveiro']]
];
const normalizeFiscalName=n=>String(n||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function fiscalGroupFor(name){return FISCAL_GROUPS.find(([g,names])=>names.some(n=>normalizeFiscalName(n)===normalizeFiscalName(name)))?.[0]||null;}
function fiscalPrepSummary(){const el=$('fiscalPrepSummary');if(el)el.textContent=`${products.filter(p=>fiscalGroupFor(p.name)).length} de ${products.length} produtos reconhecidos; códigos fiscais permanecem pendentes de validação.`;}
function prepareFiscalProducts(){
 if(!cloudReady||!cloudUser){alert('Entre no Firebase e aguarde carregar os dados antes de continuar.');return;}
 const matches=products.map((p,i)=>({i,group:fiscalGroupFor(p.name)})).filter(x=>x.group);
 const others=products.filter(p=>!fiscalGroupFor(p.name)).map(p=>p.name);
 if(!matches.length){alert('Nenhum produto reconhecido. Confira os nomes.');return;}
 const detail=matches.map(x=>products[x.i].name+' → '+x.group).join('\n');
 if(!confirm(`Preparar ${matches.length} produtos?\n\n${detail}${others.length?'\n\nNão reconhecidos (inalterados): '+others.join(', '):''}\n\nSomente o grupo operacional será incluído. Preços, unidades, categorias, campos fiscais existentes, mesas e vendas serão preservados.`))return;
 const backup=products.map(p=>({...p}));
 for(const {i,group} of matches)products[i]={...products[i],fiscalPrep:{...products[i].fiscalPrep,group,validation:'Pendente de validação pelo contador'}};
 try{save();}catch(e){products=backup;alert('Erro ao salvar: '+e.message);return;}
 render();alert(`${matches.length} produtos preparados localmente. Aguarde o status Sincronizado na nuvem. Nenhum código fiscal foi atribuído.`);
}
$('prepareFiscalProducts')?.addEventListener('click',prepareFiscalProducts);

// Sugestões preliminares: NÃO são dados fiscais aprovados para transmissão.
const FISCAL_SUGGESTIONS = [
 ['Almoço no kg','5101','102','KG','Refeição preparada; NCM depende da classificação do preparo'],
 ['Refrigerante Lata','5102','102','UN','Verificar NCM/CEST e se há ICMS-ST; se confirmado, avaliar 5405/500'],
 ['Água 500ml','5102','102','UN','Confirmar água mineral/natural, com ou sem gás; avaliar ICMS-ST'],
 ['Água de Coco','5102','102','UN','Verificar composição e NCM do rótulo; avaliar ICMS-ST'],
 ['Suco 300ml','5102','102','UN','Verificar composição, percentual de fruta e NCM do rótulo'],
 ['Quentinha','5101','102','UN','Refeição preparada para viagem'],
 ['Refeição','5101','102','UN','Refeição preparada no estabelecimento'],
 ['Doce','5101','102','UN','Identificar tipo e ingredientes do doce para NCM'],
 ['Brownie','5101','102','UN','Verificar classificação de produto de confeitaria'],
 ['Sobremesa','5101','102','UN','Identificar a sobremesa específica para NCM'],
 ['Carne Assada','5101','102','KG','Confirmar preparação e tratamento fiscal de carne pronta'],
 ['Acréscimo de carne','5101','102','UN','Confirmar natureza do adicional de refeição'],
 ['Refrigerante 1L','5102','102','UN','Verificar NCM/CEST e ICMS-ST; alternativa 5405/500 se comprovada'],
 ['Quentinha 1','5101','102','UN','Refeição preparada para viagem'],
 ['H2OH 500ml','5102','102','UN','Verificar composição/rótulo e ICMS-ST'],
 ['Chaveiro','5102','102','UN','Confirmar material e se foi comprado para revenda'],
 ['Sorvete Brigadeiro','5101','102','UN','Confirmar sorvete fabricado no estabelecimento e NCM'],
 ['Amstel Ultra 600ml','5102','102','UN','Cerveja: verificar NCM/CEST, ICMS-ST e PIS/COFINS monofásicos']
];
const FISCAL_SUGGESTION_MAP=new Map(FISCAL_SUGGESTIONS.map(([name,cfop,csosn,uTrib,note])=>[normalizeFiscalName(name),{cfop,csosn,uTrib,note}]));
function previewFiscalSuggestions(){
 const rows=products.map(p=>({p,proposal:FISCAL_SUGGESTION_MAP.get(normalizeFiscalName(p.name))}));
 const found=rows.filter(x=>x.proposal);
 const missing=rows.filter(x=>!x.proposal).map(x=>x.p.name);
 const summary=found.map(({p,proposal})=>`${p.name}: CFOP ${proposal.cfop}, CSOSN ${proposal.csosn} (HIPÓTESE)`).join('\n');
 alert(`${found.length} de ${products.length} produtos reconhecidos.\n\n${summary}\n\nNCM, CEST, origem, PIS/COFINS e demais campos permanecem indefinidos.\n${missing.length?'\nNão reconhecidos: '+missing.join(', '):''}\n\nEsses códigos são apenas para análise e NÃO habilitam emissão.`);
}
function applyFiscalSuggestions(){
 if(!cloudReady||!cloudUser){alert('Entre no Firebase e aguarde sincronizar antes de aplicar.');return;}
 const matches=products.map((p,i)=>({i,proposal:FISCAL_SUGGESTION_MAP.get(normalizeFiscalName(p.name))})).filter(x=>x.proposal);
 if(!matches.length){alert('Nenhum produto reconhecido. Confira os nomes.');return;}
 if(!confirm(`Registrar propostas fiscais NÃO VALIDADAS para ${matches.length} de ${products.length} produtos?\n\nCFOP e CSOSN sugeridos serão guardados separadamente dos campos fiscais oficiais. Nenhum código tributário já cadastrado será substituído. Os dados não podem ser usados para emitir NFC-e sem validação.\n\nContinuar?`))return;
 const backup=products.map(p=>({...p}));
 for(const {i,proposal} of matches){
  products[i]={...products[i],fiscalProposal:{cfop:proposal.cfop,csosn:proposal.csosn,uTrib:proposal.uTrib,ncm:null,cest:null,origem:null,cstPis:null,cstCofins:null,note:proposal.note,status:'PROPOSTA NÃO VALIDADA — NÃO USAR NA EMISSÃO'},fiscalPrep:{...products[i].fiscalPrep,group:fiscalGroupFor(products[i].name),validation:'Pendente de validação pelo contador'}};
 }
 try{save();}catch(e){products=backup;alert('Erro ao salvar: '+e.message);return;}
 render();alert(`${matches.length} propostas registradas localmente. Aguarde "Sincronizado na nuvem". Nenhum campo fiscal oficial foi alterado.`);
}
$('previewFiscalSuggestions')?.addEventListener('click',previewFiscalSuggestions);
$('applyFiscalSuggestions')?.addEventListener('click',applyFiscalSuggestions);


let editingProductIndex = null;
function renderProductCatalog(){
  const query=($('catalogSearch')?.value||'').trim().toLocaleLowerCase('pt-BR');
  renderCategoryTabs();
  const visible=products.map((p,index)=>({...p,index})).filter(p=>(activeCatalogCategory==='Todas'||(p.category||'Principal')===activeCatalogCategory)&&p.name.toLocaleLowerCase('pt-BR').includes(query));
  $('productCount').textContent=`${products.length} produto${products.length===1?'':'s'}`;
  fiscalPrepSummary();
  $('productCatalog').innerHTML=visible.length?visible.map(p=>`<div class="catalog-item"><div class="catalog-info"><strong>${esc(p.name)}</strong><small>${p.unit==='kg'?'Venda por quilo':'Venda por unidade'}</small><strong class="catalog-price">${money(p.price)}${p.unit==='kg'?' / kg':' / un.'}</strong><small class="fiscal-status">${p.fiscalPrep?.group?esc(p.fiscalPrep.group)+" · ":""}${p.fiscalProposal?.status?"Proposta CFOP "+esc(p.fiscalProposal.cfop)+" / CSOSN "+esc(p.fiscalProposal.csosn)+" (não validada) · ":""}${fiscalIssues(p.fiscal||{}).length?'Fiscal pendente de validação':'Campos fiscais preenchidos — conferir com contador'}</small></div><div class="catalog-actions"><button type="button" class="button secondary" data-edit-product="${p.index}" aria-label="Editar ${esc(p.name)}">Editar</button><button type="button" class="button danger catalog-delete" data-delete-product="${p.index}" aria-label="Excluir ${esc(p.name)}">Excluir</button></div></div>`).join(''):'<div class="empty">Nenhum produto cadastrado corresponde à pesquisa.</div>';
  document.querySelectorAll('[data-edit-product]').forEach(button=>button.addEventListener('click',()=>startEditProduct(Number(button.dataset.editProduct))));
  document.querySelectorAll('[data-delete-product]').forEach(button=>button.addEventListener('click',()=>deleteProduct(Number(button.dataset.deleteProduct))));
}
function closeEditProduct(){
  editingProductIndex=null;
  $('editProductPanel').hidden=true;
}
function startEditProduct(index){
  const product=products[index];
  if(!product)return;
  editingProductIndex=index;
  $('editProductName').value=product.name;
  $('editProductPrice').value=String(product.price);
  $('editProductUnit').value=product.unit;
  $('editProductCategory').value=product.category||'Principal';
  writeFiscalFields('editFiscal',product.fiscal);
  $('editProductPanel').hidden=false;
  $('editProductPanel').scrollIntoView({behavior:'smooth',block:'nearest'});
  $('editProductName').focus();
}
$('cancelEditProduct').addEventListener('click',closeEditProduct);
$('confirmEditProduct').addEventListener('click',()=>{
  const index=editingProductIndex;
  if(index===null||!products[index]){closeEditProduct();alert('Produto não encontrado.');return;}
  const name=$('editProductName').value.trim();
  const priceText=$('editProductPrice').value;
  const price=Number(String(priceText).replace(',','.'));
  const unit=$('editProductUnit').value;
  if(!name){alert('Informe o nome do produto.');$('editProductName').focus();return;}
  if(priceText.trim()===''||!Number.isFinite(price)||price<0){alert('Informe um preço válido.');$('editProductPrice').focus();return;}
  if(!['kg','un'].includes(unit)){alert('Selecione a unidade de venda.');return;}
  if(products.some((p,i)=>i!==index&&p.name.trim().toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR'))){alert('Já existe outro produto com esse nome.');return;}
  const fiscal=readFiscalFields('editFiscal');
  const invalid=fiscalIssues(fiscal).filter(x=>x.includes('inválido'));
  if(invalid.length){alert('Revise os campos fiscais: '+invalid.join(', '));return;}
  products[index]={...products[index],name,price,unit,category:$('editProductCategory').value,fiscal};
  closeEditProduct();
  save();
  render();
  alert('Produto atualizado com sucesso. Os itens já lançados nas mesas e vendas anteriores não foram alterados.');
});
function deleteProduct(index){
  const product=products[index];
  if(!product)return;
  if(!confirm(`Deseja realmente excluir o produto "${product.name}" do cadastro? Essa ação não remove itens já lançados em mesas nem vendas anteriores.`))return;
  if(editingProductIndex===index)closeEditProduct();
  else if(editingProductIndex!==null&&editingProductIndex>index)editingProductIndex--;
  products.splice(index,1);
  save();
  render();
  alert(`Produto "${product.name}" excluído do cadastro.`);
}
let pendingPayments=[],pendingPaymentTable=null;
const cents=v=>Math.round((Number(v)||0)*100);
const paymentEntries=s=>Array.isArray(s.payments)&&s.payments.length?s.payments:[{method:s.payment||'Dinheiro',amount:Number(s.paidAmount??s.total)||0}];
const paidByMethod=(s,m)=>paymentEntries(s).filter(p=>m==='Cartão'?['Cartão','Cartão de Crédito','Cartão de Débito'].includes(p.method):p.method===m).reduce((n,p)=>n+cents(p.amount),0)/100;
function renderPendingPayments(){
 const t=table(),total=t?cents(tableTotal(t)):0,paid=pendingPayments.reduce((n,p)=>n+cents(p.amount),0),remaining=Math.max(0,total-paid);
 $('paymentParts').innerHTML=pendingPayments.map((p,i)=>`<div class="payment-part"><span>${esc(p.method)} — ${money(p.amount)}</span><button type="button" class="button secondary" data-remove-payment="${i}">Remover</button></div>`).join('')||'<p class="help">Nenhum pagamento adicionado.</p>';
 $('paymentAdded').textContent=money(paid/100);$('paymentRemaining').textContent=money(remaining/100);$('paymentChangeWrap').hidden=paid<=total;$('paymentChange').textContent=money(Math.max(0,paid-total)/100);$('amountPaid').placeholder=money(remaining/100);updateCashPreview();
}

/* ATUALIZAR RESUMO DA JANELA DE PAGAMENTO */
function atualizarResumoJanelaPagamento() {
  const janela = document.getElementById('janelaPagamento');
  if (!janela) return;

  const t = table();
  const total = t ? cents(tableTotal(t)) : 0;

  const pago = pendingPayments.reduce(
    (soma, p) => soma + cents(p.amount), 0
  );

  const restante = Math.max(0, total - pago);

  document.getElementById('modalTotal').textContent =
    money(total / 100);

  document.getElementById('modalPago').textContent =
    money(pago / 100);

  document.getElementById('modalRestante').textContent =
    money(restante / 100);

  const lista = document.getElementById('modalPagamentosAdicionados');

  lista.innerHTML = pendingPayments.map((p, i) =>
    '<div class="payment-part">' +
      '<span>' + esc(p.method) + ' — ' + money(p.amount) + '</span>' +
      '<button type="button" class="button secondary" ' +
      'data-remove-payment="' + i + '">Remover</button>' +
    '</div>'
  ).join('') || '<p class="help">Nenhum pagamento adicionado.</p>';
}

/* REMOVER PAGAMENTO DA NOVA JANELA */
document.getElementById('modalPagamentosAdicionados')
  ?.addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-remove-payment]');
    if (!botao) return;

    const indice = Number(botao.dataset.removePayment);

    if (!Number.isInteger(indice) ||
        indice < 0 ||
        indice >= pendingPayments.length) return;

    pendingPayments.splice(indice, 1);

    renderPendingPayments();
    atualizarResumoJanelaPagamento();
  });

function updateCashPreview(){
 const t=table(),total=t?cents(tableTotal(t)):0;
 const added=pendingPayments.reduce((n,p)=>n+cents(p.amount),0);
 const entered=cents($('amountPaid').value);
 const cash=$('paymentMethod').value==='Dinheiro';
 const change=Math.max(0,added+entered-total);
 $('cashPreview').hidden=!cash;
 $('cashPreviewValue').textContent=money(change/100);
}
function fillRemainingPayment(){
 const t=table();if(!t||!t.items.length)return;
 const paid=pendingPayments.reduce((n,p)=>n+cents(p.amount),0);
 $('amountPaid').value=(Math.max(0,cents(tableTotal(t))-paid)/100).toFixed(2);
 updateCashPreview();
atualizarResumoJanelaPagamento();$('amountPaid').focus();$('amountPaid').select();
}
$('fillRemaining').addEventListener('click',fillRemainingPayment);
$('amountPaid').addEventListener('input',updateCashPreview);
$('paymentMethod').addEventListener('change',updateCashPreview);
document.addEventListener('keydown',e=>{
 if(e.key==='F2'&&!e.repeat&&!e.altKey&&!e.ctrlKey&&!e.metaKey){
  const v=$('orderView');if(!v||v.hidden)return;
  e.preventDefault();fillRemainingPayment();
 }
});
function resetPendingPayments(){pendingPayments=[];pendingPaymentTable=selectedTableId;$('amountPaid').value='';renderPendingPayments();}
$('addPayment').addEventListener('click',()=>{
 const t=table();if(!t||!t.items.length){alert('Abra uma mesa com itens.');return;}
 if(pendingPaymentTable!==selectedTableId)resetPendingPayments();
 const amount=Number($('amountPaid').value),method=$('paymentMethod').value,total=cents(tableTotal(t)),paid=pendingPayments.reduce((n,p)=>n+cents(p.amount),0);
 if(!Number.isFinite(amount)||cents(amount)<=0){alert('Informe um valor maior que zero.');return;}
 if(paid>=total){alert('A conta já está coberta.');return;}
 if(method!=='Dinheiro'&&paid+cents(amount)>total){alert('Pix e Cartão não podem ultrapassar o valor restante.');return;}
 pendingPayments.push({method,amount:cents(amount)/100});$('amountPaid').value='';renderPendingPayments();
});
$('clearPayments').addEventListener('click',resetPendingPayments);
$('paymentParts').addEventListener('click',e=>{const btn=e.target.closest('[data-remove-payment]');if(btn){pendingPayments.splice(Number(btn.dataset.removePayment),1);renderPendingPayments();}});
function renderReports(){
  const today=new Date().toDateString();
  const daySales=sales.filter(s=>new Date(s.closedAt).toDateString()===today);
  const sum=method=>daySales.reduce((n,s)=>n+paidByMethod(s,method),0);
  $('cashTotal').textContent=money(sum('Dinheiro'));
  $('pixTotal').textContent=money(sum('Pix'));
  $('cardTotal').textContent=money(sum('Cartão'));
  $('salesCount').textContent=daySales.length;
  renderCloudCashReports();
  renderFiscalSales();
}
// Consulta visual do histórico de caixas (mesma fonte sincronizada no Firestore).
let expandedCloudCashId=null;
function renderCloudCashReports(){
  const list=$('cloudCashReportList'),detail=$('cloudCashReportDetail');
  if(!list||!detail)return;
  const query=($('cashReportSearch').value||'').trim().toLocaleLowerCase('pt-BR');
  const status=$('cashReportFilter').value;
  const sessions=cashSessions.filter(session=>{
    if(status==='closed'&&!session.closedAt)return false;
    if(status==='open'&&session.closedAt)return false;
    const opened=session.openedAt?new Date(session.openedAt).toLocaleString('pt-BR'):'';
    const closed=session.closedAt?new Date(session.closedAt).toLocaleString('pt-BR'):'';
    return !query||[session.operator||'',opened,closed,session.id||''].join(' ').toLocaleLowerCase('pt-BR').includes(query);
  }).sort((a,b)=>new Date(b.openedAt||0)-new Date(a.openedAt||0));
  $('cloudCashReportStatus').textContent=cloudReady&&cloudUser?'Histórico sincronizado pelo Firebase.':'Exibindo registros disponíveis neste navegador; entre no Firebase para consultar os dados da nuvem.';
  list.innerHTML=sessions.map(session=>{
    const d=cashReportData(session);
    const opened=session.openedAt?new Date(session.openedAt).toLocaleString('pt-BR'):'—';
    const closed=session.closedAt?new Date(session.closedAt).toLocaleString('pt-BR'):'Em aberto';
    return `<article class="cloud-cash-entry"><div><strong>${esc(session.operator||'Operador não informado')}</strong><small>Abertura: ${esc(opened)} · Fechamento: ${esc(closed)}</small><small>${d.sessionSales.length} vendas · Total ${money(d.gross)} · Dinheiro ${money(d.cash)} · Pix ${money(d.pix)} · Cartão ${money(d.card)}</small></div><button type="button" class="button secondary" data-view-cash="${esc(session.id)}">${expandedCloudCashId===session.id?'Ocultar detalhes':'Ver detalhes'}</button></article>`;
  }).join('')||'<p class="muted">Nenhum caixa encontrado para este filtro.</p>';
  const selected=sessions.find(session=>session.id===expandedCloudCashId);
  detail.hidden=!selected;
  detail.innerHTML=selected?`<h3>Detalhamento do caixa</h3>${cashReportRows(selected)}`:'';
}
$('cashReportSearch').addEventListener('input',renderCloudCashReports);
$('cashReportFilter').addEventListener('change',renderCloudCashReports);
$('cloudCashReportList').addEventListener('click',event=>{
 const button=event.target.closest('[data-view-cash]');if(!button)return;
 expandedCloudCashId=expandedCloudCashId===button.dataset.viewCash?null:button.dataset.viewCash;
 renderCloudCashReports();
});
function cashSalesForSession(sessionId){
  return sales.filter(s=>s.cashSessionId===sessionId).reduce((sum,s)=>sum+paidByMethod(s,'Dinheiro'),0);
}
function cashMovementNet(session){
  return (session.movements||[]).reduce((sum,m)=>sum+(m.type==='in'?Number(m.amount):-Number(m.amount)),0);
}
function activeCashExpected(){
  if(!activeCash)return 0;
  return Number(activeCash.openingAmount||0)+cashSalesForSession(activeCash.id)+cashMovementNet(activeCash);
}
function cashReportData(session){
  const sessionSales=sales.filter(s=>s.cashSessionId===session.id);
  const movements=session.movements||[];
  const methodSum=method=>sessionSales.reduce((sum,s)=>sum+Math.round(paidByMethod(s,method)*100),0)/100;
  const movementSum=type=>movements.filter(m=>m.type===type).reduce((sum,m)=>sum+Math.round(Number(m.amount||0)*100),0)/100;
  const opening=Number(session.openingAmount)||0;
  const cash=methodSum('Dinheiro'),pix=methodSum('Pix'),card=methodSum('Cartão')+methodSum('Cartão de Crédito')+methodSum('Cartão de Débito');
  const entries=movementSum('in'),withdrawals=movementSum('out');
  const expected=Math.round((opening+cash+entries-withdrawals)*100)/100;
  const counted=session.countedAmount==null?null:Number(session.countedAmount);
  const difference=counted==null?null:Math.round((counted-expected)*100)/100;
  return {sessionSales,movements,opening,cash,pix,card,entries,withdrawals,expected,counted,difference,
    gross:sessionSales.reduce((sum,s)=>sum+Math.round(Number(s.total||0)*100),0)/100};
}
function cashReportRows(session){
 const d=cashReportData(session);
 const line=(label,value)=>`<div class="cash-report-line"><span>${label}</span><strong>${money(value)}</strong></div>`;
 return `<div class="cash-report-title">Resumo ${session.closedAt?'do fechamento':'parcial do caixa'}</div>
 <div class="cash-report-meta">Operador: ${esc(session.operator||'Não informado')}<br>Abertura: ${new Date(session.openedAt).toLocaleString('pt-BR')}<br>${session.closedAt?'Fechamento: '+new Date(session.closedAt).toLocaleString('pt-BR'):'Caixa em andamento'}</div>
 <div class="cash-report-sub">Vendas (${d.sessionSales.length} contas)</div>
 ${line('Total vendido',d.gross)}${line('Dinheiro',d.cash)}${line('Pix',d.pix)}${line('Cartão',d.card)}
 <div class="cash-report-sub">Conferência do dinheiro físico</div>
 ${line('Fundo inicial',d.opening)}${line('Vendas em dinheiro',d.cash)}${line('Suprimentos / entradas',d.entries)}${line('Sangrias / retiradas',d.withdrawals)}${line('Dinheiro esperado',d.expected)}
 ${d.counted===null?'<div class="cash-report-line"><span>Dinheiro contado</span><strong>A informar</strong></div>':line('Dinheiro contado',d.counted)}
 ${d.difference===null?'':line('Diferença ('+(d.difference<0?'falta':d.difference>0?'sobra':'confere')+')',d.difference)}
 <div class="cash-report-sub">Movimentações (${d.movements.length})</div>
 ${d.movements.length?d.movements.map(m=>`<div class="cash-report-movement">${esc(m.type==='in'?'Entrada':'Retirada')}: ${money(m.amount)} — ${esc(m.note||'Sem motivo')}<br><small>${new Date(m.date).toLocaleString('pt-BR')}</small></div>`).join(''):'<div class="cash-report-meta">Nenhuma movimentação</div>'}
 ${session.note?`<div class="cash-report-sub">Observações</div><div>${esc(session.note)}</div>`:''}`;
}
function printCashReport(session){
 const logoUrl=new URL(RECEIPT_COMPANY.logoFile,window.location.href).href;
 const win=window.open('','_blank','width=420,height=720');
 if(!win){alert('Permita janelas pop-up para imprimir o resumo.');return;}
 win.document.open();
 win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Fechamento de caixa</title><style>
 @page{size:80mm auto;margin:3mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#000;width:74mm;margin:0 auto;padding:6px 1px}img{display:block;max-width:34mm;max-height:23mm;object-fit:contain;margin:0 auto 4px}h1{text-align:center;font-size:15px;margin:3px 0}p{text-align:center;margin:4px 0}.cash-report-title{text-align:center;font-size:14px;font-weight:bold;border-top:1px dashed #000;border-bottom:1px dashed #000;padding:7px 0;margin:10px 0}.cash-report-meta{font-size:10px;line-height:1.6}.cash-report-sub{font-weight:bold;border-top:1px dashed #000;padding-top:8px;margin-top:10px}.cash-report-line{display:flex;justify-content:space-between;gap:8px;padding:3px 0}.cash-report-line strong{white-space:nowrap}.cash-report-movement{font-size:10px;padding:5px 0;border-bottom:1px dotted #777}footer{text-align:center;font-size:9px;margin-top:15px;border-top:1px dashed #000;padding-top:8px}@media print{body{padding:0;width:auto}}
 </style></head><body><img src="${esc(logoUrl)}" alt="Logo"><h1>${esc(RECEIPT_COMPANY.name)}</h1><p>CNPJ: ${esc(RECEIPT_COMPANY.cnpj)}</p>${cashReportRows(session)}<footer>RESUMO DE CAIXA — DOCUMENTO NÃO FISCAL<br>Emitido em ${new Date().toLocaleString('pt-BR')}</footer><script>window.addEventListener('load',()=>{const img=document.querySelector('img');const ready=img&&img.complete?Promise.resolve():new Promise(resolve=>{img?.addEventListener('load',resolve,{once:true});img?.addEventListener('error',resolve,{once:true});setTimeout(resolve,1500)});ready.then(()=>setTimeout(()=>window.print(),250))});<\/script></body></html>`);
 win.document.close();
}
function updateCashClosingPreview(){
 if(!activeCash)return;
 const raw=$('cashCountedAmount').value;
 const counted=raw.trim()===''?null:Number(raw);
 const preview={...activeCash,countedAmount:counted!==null&&Number.isFinite(counted)&&counted>=0?counted:null,note:$('cashClosingNote').value.trim()};
 $('cashClosingPreview').innerHTML=cashReportRows(preview);
}
$('cashCountedAmount').addEventListener('input',updateCashClosingPreview);
$('cashClosingNote').addEventListener('input',updateCashClosingPreview);
$('printCashPreview').addEventListener('click',()=>{if(activeCash){const raw=$('cashCountedAmount').value;printCashReport({...activeCash,countedAmount:raw.trim()===''?null:Number(raw),note:$('cashClosingNote').value.trim()});}});
function renderCash(){
  const isOpen=!!activeCash;
  $('cashStatus').textContent=isOpen?'Caixa aberto':'Caixa fechado';
  $('cashStatus').classList.toggle('cash-open',isOpen);
  $('cashOpenArea').hidden=isOpen;
  $('cashActiveArea').hidden=!isOpen;
  if(isOpen){
    $('cashOpeningDisplay').textContent=money(activeCash.openingAmount);
    $('cashCashSales').textContent=money(cashSalesForSession(activeCash.id));
    $('cashMovementsTotal').textContent=money(cashMovementNet(activeCash));
    $('cashExpected').textContent=money(activeCashExpected());
    updateCashClosingPreview();
    $('cashMovementsList').innerHTML=(activeCash.movements||[]).length?activeCash.movements.map(m=>`<div class="cash-movement"><span><strong>${m.type==='in'?'Entrada':'Retirada'} — ${esc(m.note||'Sem descrição')}</strong><small>${new Date(m.date).toLocaleString('pt-BR')}</small></span><strong class="${m.type==='in'?'movement-in':'movement-out'}">${m.type==='in'?'+':'−'} ${money(m.amount)}</strong></div>`).join(''):'<p class="muted">Nenhuma movimentação registrada neste caixa.</p>';
  }
  $('cashHistory').innerHTML=cashSessions.slice().reverse().map(session=>`<div class="cash-history-item"><div><strong>${esc(session.operator||'Operador não informado')} • ${new Date(session.openedAt).toLocaleString('pt-BR')}</strong><small>Fechado: ${session.closedAt?new Date(session.closedAt).toLocaleString('pt-BR'):'Ainda aberto'}</small><small>Inicial: ${money(session.openingAmount)} · Esperado: ${money(session.expectedAmount??(Number(session.openingAmount||0)+Number(session.cashSales||0)+Number(session.movementNet||0))) } · Contado: ${session.countedAmount==null?'—':money(session.countedAmount)}</small>${session.note?`<small>Obs.: ${esc(session.note)}</small>`:''}<button class="button secondary cash-print-history" data-cash-print="${esc(session.id)}" type="button">Imprimir resumo</button></div><strong class="${Number(session.difference||0)<0?'movement-out':'movement-in'}">${session.difference==null?'Em aberto':`Diferença: ${money(session.difference)}`}</strong></div>`).join('')||'<p class="muted">Nenhum fechamento registrado ainda.</p>';
}
function render(){
  renderTables();renderProducts();renderProductCatalog();renderOrder();renderReports();renderCash();
  $('currentDate').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'long',year:'numeric'});
}
$('productSearch').addEventListener('input',renderProducts);
$('productSearch').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('quantity').focus();}});
$('product').addEventListener('change',updateProductFields);
$('unit').addEventListener('change',updateUnit);
$('quantity').addEventListener('input',updateCalculation);
$('price').addEventListener('input',updateCalculation);

function addProductDirect(productIndex, quantidadeEscolhida = 1) {
  if (selectedTableId === null || !table()) {
    alert('Clique em uma mesa antes de lançar produtos.');
    return;
  }

  const p = products[productIndex];
  if (!p) {
    alert('Produto não encontrado.');
    return;
  }

  const price = Number(p.price) || 0;
  const unit = p.unit === 'kg' ? 'kg' : 'un';

  let quantity = 1;

if (unit === 'un') {
  quantity = Number(quantidadeEscolhida);

  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    alert('Quantidade inválida.');
    return;
  }
}
table().items.push({
    productId: p.id || null,
    name: p.name,
    price,
    unit,
    quantity,
    total: Math.round(price * quantity * 100) / 100,
    createdAt: new Date().toISOString()
  });

  save();
  render();
  resetToLunchKg();
  updateCalculation();
}

function launchManualProduct(){
  if(selectedTableId===null||!table()){alert('Clique em uma mesa antes de lançar produtos.');return;}
  const p=products[Number($('product').value)];
  const quantity=Number($('quantity').value),price=Number($('price').value),unit=$('unit').value;
  if(!p){alert('Cadastre um produto primeiro.');return;}
  if(!Number.isFinite(quantity)||quantity<=0){alert('Informe peso ou quantidade maior que zero.');return;}
  if(!Number.isFinite(price)||price<0){alert('Informe um preço válido.');return;}
  const normalizedQuantity=quantity;
  table().items.push({
  productId: p.id || null,
  name: p.name,
  price,
  unit,
  quantity: normalizedQuantity,
  total: Math.round(price * normalizedQuantity * 100) / 100,
  createdAt: new Date().toISOString()
});
  save();render();resetToLunchKg();updateCalculation();
}
$('quantity').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();launchManualProduct();}});

$('saveProduct').addEventListener('click',()=>{
  const name=$('newProductName').value.trim(),priceText=$('newProductPrice').value,price=Number(String(priceText).replace(',','.')),unit=$('newProductUnit').value;
  if(!name){alert('Digite o nome do produto.');return;}
  if(priceText===''||!Number.isFinite(price)||price<0){alert('Digite um preço válido.');return;}
  if(products.some(p=>p.name.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR'))){alert('Já existe um produto com esse nome.');return;}
  const fiscal=readFiscalFields('newFiscal');
  const invalid=fiscalIssues(fiscal).filter(x=>x.includes('inválido'));
  if(invalid.length){alert('Revise os campos fiscais: '+invalid.join(', '));return;}
  products.push({
  id: gerarIdProduto(),
  name,
  price,
  unit,
  category: $('newProductCategory').value || 'Principal',
  fiscal
});try{save();}catch(error){products.pop();alert('Não foi possível salvar o produto: '+error.message);return;}$('newProductName').value='';$('newProductPrice').value='';writeFiscalFields('newFiscal');render();alert('Produto cadastrado localmente. Confira o status de sincronização do Firebase antes de fechar o sistema. Os campos fiscais podem ser preenchidos depois.');
});
// Personalização do cabeçalho e rodapé dos cupons (não fiscais).
const RECEIPT_COMPANY = {
  name: 'ESPAÇO DA PICANHA',
  cnpj: '12.994.997/0001-21',
  thanks: 'Obrigado pela preferência! Volte sempre!',
  logoFile: 'logo-espaco-da-picanha.jpeg'
};
// Cupom de conta não fiscal: impressão pelo navegador, sem serviço fiscal.
function printReceipt(data, isPaid=false){
  if(!data || !Array.isArray(data.items) || !data.items.length){alert('Não há itens para imprimir.');return;}
  const total=Number(data.total)||0;
  const date=new Date(data.closedAt||Date.now()).toLocaleString('pt-BR');
  const rows=data.items.map(item=>{
    const qty=Number(item.quantity||0).toLocaleString('pt-BR',{maximumFractionDigits:3});
    const unit=item.unit==='kg'?'kg':'un.';
    return `<tr><td>${esc(item.name)}</td><td class="right">${qty} ${unit}</td><td class="right">${money(item.total)}</td></tr><tr class="detail"><td colspan="3">${money(item.price)} / ${unit}</td></tr>`;
  }).join('');
  const payment=isPaid?paymentEntries(data).map(p=>`<div class="line"><span>${esc(p.method)}</span><strong>${money(p.amount)}</strong></div>`).join('')+`<div class="line"><span>Troco</span><strong>${money(data.change||0)}</strong></div>`:'';
  const logoUrl = new URL(RECEIPT_COMPANY.logoFile, window.location.href).href;
  const win=window.open('','_blank','width=420,height=680');
  if(!win){alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente.');return;}
  win.document.open();
  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Cupom Mesa ${pad(data.table)}</title><style>
  @page{size:80mm auto;margin:3mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:11px;color:#000;width:74mm;max-width:100%;margin:0 auto;padding:8px 2px}h1{font-size:16px;margin:2px 0;text-align:center}.receipt-logo{display:block;max-width:38mm;max-height:28mm;width:auto;height:auto;object-fit:contain;margin:0 auto 5px}.company-info{font-size:10px;font-weight:bold}.thanks{font-size:11px;font-weight:bold;margin:8px 0 4px}h2{font-size:13px;text-align:center;margin:8px 0}p{text-align:center;margin:4px 0}.rule{border-top:1px dashed #000;margin:9px 0}table{width:100%;border-collapse:collapse}th,td{padding:4px 1px;text-align:left;vertical-align:top}th{border-bottom:1px solid #000}.right{text-align:right;white-space:nowrap}.detail td{font-size:9px;color:#333;padding-top:0}.line{display:flex;justify-content:space-between;gap:8px;margin:6px 0}.total{font-size:15px;font-weight:bold}.note{font-size:10px;margin-top:14px}@media print{body{padding:0;width:auto}}
  </style></head><body><img class="receipt-logo" src="${esc(logoUrl)}" alt="Logo Espaço da Picanha"><h1>${esc(RECEIPT_COMPANY.name)}</h1><p class="company-info">CNPJ: ${esc(RECEIPT_COMPANY.cnpj)}</p><div class="rule"></div><h2>${isPaid?'COMPROVANTE DE CONTA':'CONFERÊNCIA DE CONTA'}</h2><p>Mesa ${pad(data.table)} • ${esc(date)}</p><div class="rule"></div><table><thead><tr><th>Produto</th><th class="right">Qtd.</th><th class="right">Valor</th></tr></thead><tbody>${rows}</tbody></table><div class="rule"></div><div class="line total"><span>TOTAL</span><span>${money(total)}</span></div>${payment}<div class="rule"></div><p class="thanks">${esc(RECEIPT_COMPANY.thanks)}</p><p class="note">DOCUMENTO NÃO FISCAL<br>${isPaid?'Pagamento registrado':'Conferência de consumo — pagamento pendente'}</p><script>window.addEventListener('load',()=>{const img=document.querySelector('.receipt-logo');const ready=img&&img.complete?Promise.resolve():new Promise(resolve=>{if(!img)return resolve();img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});setTimeout(resolve,1800)});ready.then(()=>setTimeout(()=>window.print(),250))});<\/script></body></html>`);
  win.document.close();
}
$('printBill').addEventListener('click',()=>{
  const t=table();if(!t)return;
  printReceipt({table:t.id,items:t.items.map(item=>({...item})),total:tableTotal(t)},false);
});
$('printLastSale').addEventListener('click',()=>{
  const last=sales[sales.length-1];
  if(!last){alert('Ainda não há vendas finalizadas para reimprimir.');return;}
  printReceipt(last,true);
});

/* ABRIR JANELA DE PAGAMENTO */
$('closeBill').addEventListener('click', () => {
  if (!activeCash) {
    alert('Abra o caixa antes de fechar contas.');
    return;
  }

  const t = table();

  if (!t || !t.items.length) {
    alert('Esta mesa não tem itens.');
    return;
  }

  const janela = $('janelaPagamento');

  $('tituloPagamento').textContent =
    'Finalizar conta — Mesa ' + pad(selectedTableId);

  janela.hidden = false;
});

/* FECHAR JANELA DE PAGAMENTO PELO X */
document.getElementById('fecharJanelaPagamento')
  ?.addEventListener('click', () => {
    document.getElementById('janelaPagamento').hidden = true;
  });



const botaoAdicionarPagamentoJanela =
  document.getElementById('adicionarPagamentoJanela');

if (botaoAdicionarPagamentoJanela) {
  botaoAdicionarPagamentoJanela.addEventListener('click', () => {
    const valor = document.getElementById('valorJanelaPagamento').value;

    document.getElementById('paymentMethod').value =
      metodoPagamentoJanela;

    document.getElementById('amountPaid').value = valor;

    document.getElementById('addPayment').click();

    atualizarResumoJanelaPagamento();

    document.getElementById('valorJanelaPagamento').value = '';
  });
}

/* FORMAS DE PAGAMENTO DA NOVA JANELA */
let metodoPagamentoJanela = 'Pix';

document.querySelectorAll(
  '#janelaPagamento [data-pagamento]'
).forEach(botao => {
  botao.addEventListener('click', () => {
    metodoPagamentoJanela = botao.dataset.pagamento;

    document.querySelectorAll(
      '#janelaPagamento [data-pagamento]'
    ).forEach(b => b.classList.remove('ativo'));

    botao.classList.add('ativo');

    $('paymentMethod').value = metodoPagamentoJanela;

    const restante = Math.max(
      0,
      cents(tableTotal(table())) -
      pendingPayments.reduce(
        (soma, p) => soma + cents(p.amount), 0
      )
    );

    $('valorJanelaPagamento').value =
      (restante / 100).toFixed(2);
  });
});



/* FECHAR JANELA SEM FINALIZAR A CONTA */
$('confirmarFechamentoMesa')?.addEventListener('click',()=>{
  $('janelaPagamento').hidden = true;
});

$('confirmarFechamentoMesa')?.addEventListener('click',()=>{
  if(!activeCash){alert('Abra o caixa antes de fechar contas. Acesse a aba Abrir / fechar caixa.');return;}
  const t=table(),total=tableTotal(t);
  if(!t.items.length){alert('Esta mesa não tem itens.');return;}
  if(pendingPaymentTable!==selectedTableId)resetPendingPayments();
  if(!pendingPayments.length){alert('Adicione os pagamentos antes de fechar a conta.');return;}
  const paid=pendingPayments.reduce((n,p)=>n+cents(p.amount),0),totalCents=cents(total);
  if(paid<totalCents){alert(`Faltam ${money((totalCents-paid)/100)}.`);return;}
  const change=(paid-totalCents)/100;
  const cash=pendingPayments.filter(p=>p.method==='Dinheiro').reduce((n,p)=>n+cents(p.amount),0);
  if(cents(change)>cash){alert('Troco somente em dinheiro.');return;}
  const payments=pendingPayments.map(p=>({...p}));
  if(change>0){const cashEntry=payments.find(p=>p.method==='Dinheiro');cashEntry.amount=(cents(cashEntry.amount)-cents(change))/100;}
  const payment=payments.length===1?payments[0].method:'Múltiplos';
  

sales.push({
  id: crypto.randomUUID(),
  table: selectedTableId,
  items: t.items.map(item => {
    const produtoCadastrado = products.find(
      p => String(p.id) === String(item.id) ||
           String(p.id) === String(item.productId)
    );

    return {
      ...item,
      fiscal: produtoCadastrado?.fiscal
        ? { ...produtoCadastrado.fiscal }
        : item.fiscal || null
    };
  }),
  total,
  paidAmount: total,
  payment,
  payments,
  change,
  cashSessionId: activeCash.id,
  closedAt: new Date().toISOString(),
  fiscalStatus: 'pendente'
});

 t.items=[];
selectedTableId=null;
resetPendingPayments();
save();
render();

// Fecha a janela após registrar a venda
const modalPagamento = document.getElementById('janelaPagamento');
if (modalPagamento) {
  modalPagamento.hidden = true;
}

  // Guarda a venda recém-finalizada.
  const vendaFinalizada = sales[sales.length - 1];

  // Abre a janela personalizada para escolher a impressão.
  mostrarJanelaImpressao(vendaFinalizada);

// Consulta automaticamente o servidor fiscal após fechar a mesa.
prepararFiscalAoFecharMesa(vendaFinalizada, sales.length - 1)
  .catch(erro => {
    console.error('Falha na consulta fiscal automática:', erro);
  });
});

$('clearTable').addEventListener('click',()=>{
  const t=table();if(!t.items.length){alert('Esta mesa já está vazia.');return;}
  if(confirm(`Apagar os itens da Mesa ${pad(selectedTableId)} sem registrar venda?`)){t.items=[];save();render();}
});
$('openCash').addEventListener('click',()=>{
  if(activeCash){alert('Já existe um caixa aberto.');return;}
  const openingText=$('cashOpeningAmount').value;
  const openingAmount=Number(openingText);
  if(openingText===''||!Number.isFinite(openingAmount)||openingAmount<0){alert('Informe um valor válido para o troco inicial.');return;}
  activeCash={id:`cash-${Date.now()}`,operator:$('cashOperator').value.trim()||'Não informado',openingAmount,openedAt:new Date().toISOString(),movements:[]};
  cashSessions.push(activeCash);save();render();alert('Caixa aberto com sucesso.');
});
$('addCashMovement').addEventListener('click',()=>{
  if(!activeCash){alert('Não há caixa aberto.');return;}
  const amountText=$('cashMovementAmount').value,amount=Number(amountText),type=$('cashMovementType').value,note=$('cashMovementNote').value.trim();
  if(amountText===''||!Number.isFinite(amount)||amount<=0){alert('Informe um valor maior que zero.');return;}
  if(!note){alert('Informe o motivo da movimentação.');return;}
  if(type==='out'&&amount>activeCashExpected()){if(!confirm('A retirada é maior que o dinheiro esperado no caixa. Deseja registrar mesmo assim?'))return;}
  activeCash.movements.push({type,amount,note,date:new Date().toISOString()});
  $('cashMovementAmount').value='';$('cashMovementNote').value='';save();render();
});
$('cashHistory').addEventListener('click',event=>{const button=event.target.closest('[data-cash-print]');if(!button)return;const session=cashSessions.find(s=>s.id===button.dataset.cashPrint);if(session)printCashReport(session);});
$('closeCash').addEventListener('click',()=>{
  if(!activeCash){alert('Não há caixa aberto.');return;}
  const countedText=$('cashCountedAmount').value,counted=Number(countedText);
  if(countedText===''||!Number.isFinite(counted)||counted<0){alert('Informe o valor contado, mesmo que seja R$ 0,00.');return;}
  const expected=activeCashExpected(),difference=Math.round((counted-expected)*100)/100;
  const message=`Fechar o caixa?\n\nDinheiro esperado: ${money(expected)}\nDinheiro contado: ${money(counted)}\nDiferença: ${money(difference)}\n\nEssa ação encerra o caixa atual.`;
  if(!confirm(message))return;
  activeCash.closedAt=new Date().toISOString();activeCash.cashSales=cashSalesForSession(activeCash.id);activeCash.movementNet=cashMovementNet(activeCash);activeCash.expectedAmount=expected;activeCash.countedAmount=counted;activeCash.difference=difference;activeCash.note=$('cashClosingNote').value.trim();
  const idx=cashSessions.findIndex(s=>s.id===activeCash.id);if(idx>=0)cashSessions[idx]={...activeCash};
  const closedSession={...activeCash};
  activeCash=null;$('cashCountedAmount').value='';$('cashClosingNote').value='';save();render();printCashReport(closedSession);alert(`Caixa fechado. Diferença: ${money(difference)}. Se a impressão não abriu, use Imprimir resumo no histórico.`);
});
$('exportCashCsv').addEventListener('click',()=>{
  if(!cashSessions.length){alert('Ainda não há caixas registrados.');return;}
  const rows=[['Operador','Abertura','Fechamento','Troco inicial','Vendas dinheiro','Entradas menos retiradas','Esperado','Contado','Diferença','Observações']];
  cashSessions.forEach(s=>rows.push([s.operator||'',new Date(s.openedAt).toLocaleString('pt-BR'),s.closedAt?new Date(s.closedAt).toLocaleString('pt-BR'):'Em aberto',Number(s.openingAmount||0).toFixed(2),Number(s.cashSales||cashSalesForSession(s.id)).toFixed(2),Number(s.movementNet??cashMovementNet(s)).toFixed(2),s.expectedAmount==null?'':Number(s.expectedAmount).toFixed(2),s.countedAmount==null?'':Number(s.countedAmount).toFixed(2),s.difference==null?'':Number(s.difference).toFixed(2),s.note||'']));
  const csv='\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='fechamentos_caixa.csv';a.click();URL.revokeObjectURL(url);
});

$('showHistory').addEventListener('click',()=>{
  if(!sales.length){alert('Ainda não há vendas encerradas.');return;}
  const total=sales.reduce((sum,s)=>sum+Number(s.total||0),0);
  const methods=['Dinheiro','Pix','Cartão'].map(m=>`${m}: ${money(sales.reduce((sum,s)=>sum+paidByMethod(s,m),0))}`).join('\n');
  alert(`Contas fechadas: ${sales.length}\nTotal das contas: ${money(total)}\n\nRecebimentos lançados:\n${methods}`);
});
$('exportCsv').addEventListener('click',()=>{
  if(!sales.length){alert('Não há vendas para exportar.');return;}
  const rows=[['Data','Mesa','Total da conta','Valor recebido lançado','Pagamento','Itens']];
  sales.forEach(s=>rows.push([new Date(s.closedAt).toLocaleString('pt-BR'),pad(s.table),Number(s.total).toFixed(2),Number(s.paidAmount??s.total).toFixed(2),paymentEntries(s).map(p=>`${p.method}: ${money(p.amount)}`).join(' + '),s.items.map(i=>`${i.name} (${i.unit==='kg'?i.quantity+' kg':i.quantity+' un.'})`).join(', ')]));
  const csv='\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='vendas_restaurante.csv';a.click();URL.revokeObjectURL(url);
});

// Toledo Prix 3 Fit — Prt5, 2400 baud, 8N1, solicitação ENQ (0x05).
// A porta é escolhida no navegador: funciona com COM3, COM4 etc. sem alterar o código.
let scalePollTimer=null, scaleWriter=null, scaleReadTask=null, scaleRx=[], scaleLastReadingAt=0;
const SCALE_POLL_MS=650, SCALE_STALE_MS=2500;
// Ciclo automático com tara: o valor transmitido é tratado como PESO LÍQUIDO.
// Quando o prato é tarado na balança, o valor líquido deve voltar a zero.
// Para balanças que enviam um valor residual positivo, é possível marcar a base vazia.
const AUTO_TOLERANCE_G=2, AUTO_MIN_DELTA_G=5;
let autoArmed=false, autoLastGrams=null, autoStableCount=0, autoLocked=false, autoTableId=null;
let autoBaseGrams=0, autoZeroCount=0, autoNegativeCount=0;
function resetAutoCycle(){autoArmed=false;autoLastGrams=null;autoStableCount=0;autoLocked=false;autoTableId=selectedTableId;autoBaseGrams=0;autoZeroCount=0;autoNegativeCount=0;}
$('autoScale').addEventListener('change',()=>{resetAutoCycle();scaleStatus($('autoScale').checked?'Automático ativado: aguarde 3 leituras de zero ou de tara negativa (prato retirado) para armar. A tara negativa nunca será lançada.':'Lançamento automático desativado.');});
$('prepareTare').addEventListener('click',()=>{
  if(!serialActive||!$('autoScale').checked||selectedTableId===null||!table()){
    scaleStatus('Abra uma mesa, conecte a balança e ative o lançamento automático antes de preparar a tara.');return;
  }
  if(latestWeightGrams===null||Date.now()-scaleLastReadingAt>SCALE_STALE_MS){scaleStatus('Aguarde uma leitura estável com a plataforma sem produto para preparar a tara.');return;}
  // Só use com prato/recipiente vazio; o peso de base NÃO será lançado.
  autoBaseGrams=latestWeightGrams;autoArmed=true;autoLocked=false;autoLastGrams=null;autoStableCount=0;autoZeroCount=0;autoNegativeCount=0;autoTableId=selectedTableId;
  scaleStatus('Base vazia registrada: '+(autoBaseGrams/1000).toFixed(3)+' kg. Agora coloque o alimento. Será lançado apenas o peso adicional.');
});
// Prt5 pode responder NNNNN para peso negativo, sem informar o valor numérico.
// Três respostas negativas consecutivas significam prato retirado; rearmam
// o ciclo, mas NUNCA são convertidas em peso nem geram venda.
function autoScaleNegative(){
  latestWeightGrams=null;scaleLastReadingAt=0;
  $('weightDisplay').textContent='Peso negativo (tara)';$('useWeight').disabled=true;
  if(!$('autoScale').checked||!serialActive||selectedTableId===null||!table()||document.hidden)return;
  if(autoTableId!==selectedTableId){resetAutoCycle();return;}
  autoNegativeCount++;
  if(autoNegativeCount>=3){
    autoArmed=true;autoLocked=false;autoLastGrams=null;autoStableCount=0;autoZeroCount=0;
    if(autoNegativeCount===3)scaleStatus('Prato retirado: tara negativa detectada. Pronto para receber o próximo peso líquido positivo.');
  }
}
function autoScaleReading(grams){
  autoNegativeCount=0;
  if(!$('autoScale').checked||!serialActive)return;
  if(selectedTableId===null||!table()||document.hidden){resetAutoCycle();return;}
  if(autoTableId!==selectedTableId){resetAutoCycle();return;}
  const delta=grams-autoBaseGrams;
  if(Math.abs(delta)<=AUTO_TOLERANCE_G){
    autoZeroCount++;
    if(autoZeroCount>=3){autoArmed=true;autoLocked=false;autoLastGrams=null;autoStableCount=0;}
    if(autoZeroCount===3)scaleStatus('Peso líquido/base estabilizado. Pronto para a próxima pesagem, inclusive com tara.');
    return;
  }
  autoZeroCount=0;
  if(!autoArmed||autoLocked||delta<AUTO_MIN_DELTA_G)return;
  if(grams!==autoLastGrams){autoLastGrams=grams;autoStableCount=1;return;}
  autoStableCount++;
  if(autoStableCount<3)return;
  const index=Number($('product').value),product=products[index];
  const price=Number($('price').value);
  if(!product||product.unit!=='kg'||$('unit').value!=='kg'||!Number.isFinite(price)||price<0){
    autoLocked=true;autoArmed=false;
    scaleStatus('Automático bloqueado: selecione um produto por kg com preço válido. Retire o alimento e volte à base vazia.');return;
  }
  const destination=table();if(!destination)return;
  autoLocked=true;autoArmed=false;
  const quantity=delta/1000;
  destination.items.push({name:product.name,price,unit:'kg',quantity,total:Math.round(price*quantity*100)/100,createdAt:new Date().toISOString()});
  save();render();resetToLunchKg();
  scaleStatus('Lançado automaticamente: '+quantity.toFixed(3)+' kg de '+product.name+' na mesa '+selectedTableId+'. Retire o alimento e aguarde voltar à base para nova pesagem.');
}
function scaleStatus(message){$('scaleMessage').textContent=message;}
function scaleConnectionState(connected){
  const badge=$('scaleConnectionStatus');
  badge.textContent=connected?'● Balança conectada':'● Balança desconectada';
  badge.style.color=connected?'#188b42':'#bd2525';
}
function resetScaleWeight(message){
  latestWeightGrams=null;scaleLastReadingAt=0;$('weightDisplay').textContent='— g';$('useWeight').disabled=true;autoStableCount=0;autoLastGrams=null;
  if(message)scaleStatus(message);
}
function handleScaleBytes(chunk){
  for(const byte of chunk){
    if(byte===2){scaleRx=[2];continue;}
    if(!scaleRx.length)continue;
    scaleRx.push(byte);
    if(scaleRx.length>24){scaleRx=[];continue;}
    if(byte!==3)continue;
    const frame=scaleRx.slice();scaleRx=[];
    if(frame.length!==7)continue; // STX + 5 caracteres ASCII + ETX
    const payload=String.fromCharCode(...frame.slice(1,6));
    if(payload==='IIIII'){resetScaleWeight('Peso instável. Aguarde estabilizar.');continue;}
    if(payload==='NNNNN'){autoScaleNegative();continue;}
    if(payload==='SSSSS'){resetScaleWeight('Sobrecarga na balança.');continue;}
    if(!/^\d{5}$/.test(payload))continue;
    const grams=Number(payload); // 00570 = 0,570 kg = 570 g
    if(grams===0){autoScaleReading(0);latestWeightGrams=0;scaleLastReadingAt=Date.now();$('weightDisplay').textContent='0,000 kg';$('useWeight').disabled=true;continue;}
    latestWeightGrams=grams;scaleLastReadingAt=Date.now();
    $('weightDisplay').textContent=(grams/1000).toLocaleString('pt-BR',{minimumFractionDigits:3,maximumFractionDigits:3})+' kg';
    $('useWeight').disabled=false;
    if(!$('autoScale').checked)scaleStatus('Peso estável recebido. Confira e clique em “Usar peso lido”.');
    autoScaleReading(grams);
  }
}
async function disconnectScale(showMessage=true){
  serialActive=false;resetAutoCycle();
  if(scalePollTimer){clearInterval(scalePollTimer);scalePollTimer=null;}
  try{if(serialReader)await serialReader.cancel();}catch{}
  try{if(scaleReadTask)await scaleReadTask;}catch{}
  try{if(scaleWriter){scaleWriter.releaseLock();scaleWriter=null;}}catch{}
  try{if(serialPort)await serialPort.close();}catch{}
  serialPort=null;serialReader=null;scaleReadTask=null;scaleRx=[];
  $('connectScale').textContent='Conectar balança';$('connectScale').disabled=false;scaleConnectionState(false);
  resetScaleWeight(showMessage?'Balança desconectada.':null);
}
$('connectScale').addEventListener('click',async()=>{
  if(serialActive){await disconnectScale();return;}
  if(!('serial' in navigator)){scaleStatus('Use Chrome ou Edge com Live Server (localhost) ou HTTPS. Web Serial não está disponível neste navegador.');return;}
  try{
    // Sempre mostra as portas disponíveis: a numeração COM pode mudar de computador.
    serialPort=await navigator.serial.requestPort();
    await serialPort.open({baudRate:2400,dataBits:8,stopBits:1,parity:'none',flowControl:'none'});
    serialActive=true;scaleRx=[];resetAutoCycle();resetScaleWeight();
    $('connectScale').textContent='Desconectar balança';scaleConnectionState(true);
    scaleStatus('Porta selecionada conectada em 2400 baud (8N1). Solicitando peso via ENQ…');
    scaleWriter=serialPort.writable.getWriter();
    serialReader=serialPort.readable.getReader();
    scaleReadTask=(async()=>{
      try{while(serialActive){const {value,done}=await serialReader.read();if(done)break;if(value)handleScaleBytes(value);}}
      catch(e){if(serialActive){scaleStatus('Erro na leitura serial: '+e.message);queueMicrotask(()=>disconnectScale(false));}}
      finally{try{serialReader.releaseLock();}catch{}serialReader=null;}
    })();
    let busy=false;
    const poll=async()=>{
      if(!serialActive||busy)return;
      busy=true;
      try{
        await scaleWriter.write(new Uint8Array([0x05])); // ENQ: Prt5
        if(scaleLastReadingAt&&Date.now()-scaleLastReadingAt>SCALE_STALE_MS){resetScaleWeight('Leitura antiga descartada. Aguardando novo peso estável…');}
      }catch(e){scaleStatus('Falha ao solicitar peso: '+e.message);}
      finally{busy=false;}
    };
    scalePollTimer=setInterval(poll,SCALE_POLL_MS);await poll();
  }catch(error){
    await disconnectScale(false);
    if(error.name==='NotFoundError')scaleStatus('Nenhuma porta selecionada. Clique em Conectar balança e escolha a porta do adaptador.');
    else scaleStatus('Falha ao conectar: '+error.message+'. Confira a porta do adaptador, cabo, C13 SERIAL, C14 Prt5 e C15 2400.');
  }
});
$('useWeight').addEventListener('click',()=>{
  if(latestWeightGrams===null||Date.now()-scaleLastReadingAt>SCALE_STALE_MS){resetScaleWeight('Leitura expirada. Aguarde novo peso estável.');return;}
  $('unit').value='kg';$('quantity').value=(latestWeightGrams/1000).toFixed(3);updateUnit();updateCalculation();
  scaleStatus('Peso aplicado ao produto. Confira o preço e clique em “Lançar produto na mesa”.');
});
scaleConnectionState(false);
if('serial' in navigator){
  navigator.serial.addEventListener('disconnect',event=>{
    if(serialPort && (event.port===serialPort || event.target===serialPort)) {
      scaleStatus('Cabo ou adaptador desconectado. Reconecte e clique em Conectar balança.');
      disconnectScale(false);
    }
  });
}
if(!('serial' in navigator))scaleStatus('Para leitura automática, abra no Chrome/Edge pelo Live Server. Pesagem manual disponível.');
$('closeOrderPanel').addEventListener('click',()=>{selectedTableId=null;resetAutoCycle();render();});

// Atalhos: número + Enter abre a mesa; Escape volta à grade.
// Não captura digitação em campos de texto nem durante o login Firebase.
let shortcutDigits='';
function updateTableShortcut(){
  const display=$('tableShortcutDisplay');
  if(display)display.textContent=shortcutDigits?'Mesa digitada: '+shortcutDigits:'';
}
function clearTableShortcut(){shortcutDigits='';updateTableShortcut();}
function operationVisible(){return !$('operation').hidden;}
function typingInField(element){
  return !!element && (element.matches('input,textarea,select,[contenteditable="true"]') || !!element.closest('[contenteditable="true"]'));
}
document.addEventListener('keydown',event=>{
  if(event.defaultPrevented||event.ctrlKey||event.altKey||event.metaKey||event.isComposing)return;
  if(!$('cloudLogin').hidden || !operationVisible())return;
  if(event.key==='Escape' && selectedTableId!==null){
    event.preventDefault();
    if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
    selectedTableId=null;resetAutoCycle();clearTableShortcut();render();return;
  }
  if(typingInField(event.target)||selectedTableId!==null)return;
  if(/^\d$/.test(event.key)){
    event.preventDefault();
    // São 100 mesas: a entrada aceita até três dígitos.
    if(shortcutDigits.length>=3)shortcutDigits='';
    shortcutDigits+=event.key;
    updateTableShortcut();return;
  }
  if(event.key==='Backspace' && shortcutDigits){
    event.preventDefault();shortcutDigits=shortcutDigits.slice(0,-1);updateTableShortcut();return;
  }
  if(event.key==='Escape' && shortcutDigits){event.preventDefault();clearTableShortcut();return;}
  if(event.key==='Enter' && shortcutDigits){
    event.preventDefault();
    const id=Number(shortcutDigits);clearTableShortcut();
    if(!tables.some(t=>Number(t.id)===id)){
      alert('Mesa inválida. Digite um número de 1 a 100.');return;
    }
    selectedTableId=id;resetAutoCycle();render();
  }
});

$('catalogSearch').addEventListener('input',renderProductCatalog);
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b===button));
  document.querySelectorAll('.tab-view').forEach(view=>{const active=view.id===button.dataset.tab;view.hidden=!active;view.classList.toggle('active',active);});
}));
// A interface só libera o sistema depois de autenticar e carregar o estado da nuvem.
if (window.firebaseModules) {
  initializeCloud();
} else {
  window.addEventListener('firebase-modules-ready', initializeCloud, {once:true});
}

// Mantém as abas abertas sincronizadas quando uma mesa, produto ou venda muda em outra aba.
window.addEventListener('storage', event => {
  if (!['restaurante_products','restaurante_tables','restaurante_sales','restaurante_cash_sessions','restaurante_active_cash'].includes(event.key)) return;
  products = load('restaurante_products', defaultProducts);
  productCategories=load('restaurante_product_categories',['Principal']);
  tables = load('restaurante_tables', Array.from({length:100}, (_,i)=>({id:i+1,items:[]})));
  for (let i=1;i<=100;i++) if (!tables.some(t=>t.id===i)) tables.push({id:i,items:[]});
  tables.sort((a,b)=>a.id-b.id);
  sales = load('restaurante_sales', []);
  cashSessions = load('restaurante_cash_sessions', []);
  activeCash = load('restaurante_active_cash', null);
  render();
});

// NFC-e: emissão manual em homologação; credenciais ficam SOMENTE no backend.
function fiscalRef(s,i){
  const date=String(s.closedAt||'').replace(/[^0-9]/g,'').slice(0,14);
  return 'VENDA'+date+'M'+String(s.table||0)+'I'+i;
}


function preencherDocumentoFiscalDaVenda() {
  const seletor = document.getElementById('fiscalSale');
  const campo = document.getElementById('fiscalCpf');

  if (!seletor || !campo) {
    console.warn('Campo fiscal não encontrado.');
    return;
  }

  const indice = seletor.value;

  if (indice === '') {
    campo.value = '';
    return;
  }

  const venda = sales[Number(indice)];

  if (!venda) {
    campo.value = '';
    return;
  }

  // Recupera o CPF/CNPJ informado no fechamento.
  const documento = String(venda.documentoCliente || '')
    .replace(/\D/g, '');

  // Preenche automaticamente a área fiscal.
  campo.value = documento;
}

// Também atualiza quando uma venda é selecionada manualmente.
document.getElementById('fiscalSale')
  ?.addEventListener('change', preencherDocumentoFiscalDaVenda);

function renderFiscalSales(){
 const select=$('fiscalSale');if(!select)return;
 const prev=select.value;
 select.innerHTML='<option value="">Selecione uma venda fechada</option>'+sales.map((s,i)=>`<option value="${i}">Mesa ${pad(s.table)} · ${new Date(s.closedAt).toLocaleString('pt-BR')} · ${money(s.total)}</option>`).join('');
 if([...select.options].some(o=>o.value===prev))select.value=prev;
}



function fiscalUrl() {
  return 'http://localhost:3001';
}

function prepararItensFiscaisAutomaticos(sale) {
  if (!sale || !Array.isArray(sale.items) || !sale.items.length) {
    throw new Error('Venda sem itens.');
  }

  return sale.items.map((item, index) => {
    if (!item.productId) {
      throw new Error(
        `Item ${index + 1} sem identificação do produto. Revisão manual necessária.`
      );
    }

    const produto = products.find(
  p => String(p.id) === String(item.productId)
);

if (!produto) {
  throw new Error(
    `Produto do item ${index + 1} não encontrado no cadastro.`
  );
}

// Cria e salva um código interno estável para o produto.
if (!produto.code) {
  const codigosUsados = new Set(
    products
      .filter(p => p !== produto)
      .map(p => String(p.code || ''))
  );

  let numero = 1;

  while (
    numero <= 999 &&
    codigosUsados.has(String(numero).padStart(3, '0'))
  ) {
    numero++;
  }

  if (numero > 999) {
    throw new Error('Não há códigos internos disponíveis.');
  }

  produto.code = String(numero).padStart(3, '0');
  save();
}

if (!/^\d{3}$/.test(String(produto.code))) {
  throw new Error(
    `Produto do item ${index + 1} sem código interno válido.`
  );
}

    const quantidade = Number(item.quantity);
    const unitario = Number(item.price);
    const total = Number(item.total);

    if (
      !Number.isFinite(quantidade) || quantidade <= 0 ||
      !Number.isFinite(unitario) || unitario < 0 ||
      !Number.isFinite(total) || total < 0 ||
      Math.abs(Math.round(quantidade * unitario * 100) -
               Math.round(total * 100)) > 1
    ) {
      throw new Error(`Valores inválidos no item ${index + 1}.`);
    }

       return {
      codigo: produto.code,
      descricao: produto.name,
      unidade_comercial: item.unit,
      quantidade_comercial: quantidade,
      valor_unitario_comercial: unitario,
      valor_bruto: total,
      fiscal: { ...(produto.fiscal || {}) }
    };
  });
}

async function fiscalRequest(action) {
 if(!cloudUser||!cloudClient){alert('Entre no Firebase antes de acessar a emissão fiscal.');return;}
 const index=Number($('fiscalSale').value),sale=sales[index];
 if($('fiscalSale').value===''||!sale){alert('Selecione uma venda fechada.');return;}
 const ref=fiscalRef(sale,index),status=$('fiscalStatus'),result=$('fiscalResult');
 let body;
 if(action==='issue'){
   try {
  body = JSON.parse($('fiscalPayload').value);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('JSON fiscal inválido.');
  }

  // Identifica os produtos da venda automaticamente.
  const itensAutomaticos = prepararItensFiscaisAutomaticos(sale);

  // Preserva os campos tributários informados para revisão.
  const itensInformados = Array.isArray(body.itens) ? body.itens : [];

  if (itensInformados.length !== itensAutomaticos.length) {
    throw new Error(
      'A quantidade de itens fiscais deve corresponder à venda.'
    );
  }

  body.itens = itensAutomaticos.map((item, indice) => ({
    ...itensInformados[indice],
    ...item
  }));

  // Mostra os itens preparados para conferência antes de salvar.
// Prepara os pagamentos fiscais a partir da venda registrada.
const codigosPagamentoFiscal = {
  'Dinheiro': '01',
  'Pix': '17',
  'Crédito': '03',
  'Débito': '04',
  'Cartão de crédito': '03',
  'Cartão de débito': '04'
};

if (!Array.isArray(sale.payments) || !sale.payments.length) {
  throw new Error('Venda sem pagamentos registrados.');
}

body.formas_pagamento = sale.payments.map(pagamento => {
  const codigo = codigosPagamentoFiscal[pagamento.method];

  if (!codigo) {
    throw new Error(
      'Forma de pagamento não reconhecida: ' + pagamento.method
    );
  }

  const valor = Number(pagamento.amount);

  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error('Valor de pagamento inválido.');
  }

  return {
    tPag: codigo,
    vPag: valor.toFixed(2)
  };
});

const totalPagoFiscal = body.formas_pagamento.reduce(
  (total, pagamento) => total + Math.round(Number(pagamento.vPag) * 100),
  0
);

if (totalPagoFiscal !== Math.round(Number(sale.total) * 100)) {
  throw new Error('Pagamentos não correspondem ao total da venda.');
}
  $('fiscalPayload').value = JSON.stringify(body, null, 2);

} catch (error) {
  alert(error.message);
  return;
}
   if(!body||!Array.isArray(body.itens)||!body.itens.length){alert('Informe os itens e os códigos tributários validados pelo contador.');return;}
   const cpf=$('fiscalCpf').value.replace(/\D/g,'');
   if(cpf&&![11,14].includes(cpf.length)){alert('CPF/CNPJ deve ter 11 ou 14 dígitos.');return;}
   if(cpf)body[cpf.length===11?'cpf_destinatario':'cnpj_destinatario']=cpf;
   if(!confirm('Salvar RASCUNHO fiscal para revisão? Nenhuma NFC-e será transmitida à SEFAZ.'))return;
 }
 status.textContent='Consultando servidor fiscal…';
 try{
   const token=await cloudClient.auth.currentUser.getIdToken();
   const url=fiscalUrl()+'/api/nfce/'+encodeURIComponent(ref)+(action==='issue'?'/rascunho':'');
   const response=await fetch(url,{method:action==='issue'?'POST':'GET',headers:{Authorization:'Bearer '+token,...(action==='issue'?{'Content-Type':'application/json'}:{})},...(action==='issue'?{body:JSON.stringify({sale,payload:body})}:{})});
   const data=await response.json();result.textContent=JSON.stringify(data,null,2);
   status.textContent=data.status||data.error||(response.ok?'Consulta concluída':'Erro na consulta');
 }catch(error){status.textContent='Falha na conexão';result.textContent=error.message;}
}
$('fiscalIssue').addEventListener('click',()=>fiscalRequest('issue'));
$('fiscalConsult').addEventListener('click',()=>fiscalRequest('consult'));
// Visualização da prévia XML — não emite nem transmite NFC-e.
$('fiscalXmlPreview')?.addEventListener('click', async () => {
  const botao = $('fiscalXmlPreview');
  const resultado = $('fiscalResult');
  const status = $('fiscalStatus');

  if (!cloudClient?.auth?.currentUser) {
    alert('Entre no Firebase antes de visualizar o XML.');
    return;
  }

  const indice = Number($('fiscalSale').value);
  const venda = sales[indice];

  if ($('fiscalSale').value === '' || !venda) {
    alert('Selecione uma venda fechada.');
    return;
  }

  const referencia = fiscalRef(venda, indice);

  botao.disabled = true;
  status.textContent = 'Buscando prévia XML...';

  try {
    const token = await cloudClient.auth.currentUser.getIdToken();

    const resposta = await fetch(
      fiscalUrl() + '/api/nfce/' +
      encodeURIComponent(referencia) + '/xml-teste',
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + token
        }
      }
    );

    const dados = await resposta.json();

    if (!resposta.ok) {
      throw new Error(dados.error || 'Erro ao consultar XML.');
    }

    if (dados.tipo !== 'PREVIA_ESTRUTURAL_NAO_FISCAL' ||
        typeof dados.xml !== 'string') {
      throw new Error('O servidor não retornou uma prévia XML válida.');
    }

    resultado.textContent = dados.xml;
    status.textContent = 'Prévia XML de teste — NÃO é NFC-e emitida';

  } catch (erro) {
    status.textContent = 'Erro ao visualizar XML';
    resultado.textContent = erro.message;
  } finally {
    botao.disabled = false;
  }
});



function mostrarJanelaImpressao(venda) {
  document.getElementById('janelaImpressaoConta')?.remove();

  const fundo = document.createElement('div');
  fundo.id = 'janelaImpressaoConta';

  fundo.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    padding: 20px;
  `;

  const janela = document.createElement('div');

  janela.style.cssText = `
    background: white;
    color: #222;
    border-radius: 18px;
    padding: 30px 24px;
    width: 100%;
    max-width: 420px;
    text-align: center;
    box-shadow: 0 15px 50px rgba(0,0,0,0.4);
    font-family: Arial, sans-serif;
  `;

  janela.innerHTML = `
    <div style="font-size:46px;color:#198754;">✓</div>

    <h2>Conta finalizada!</h2>

    <p style="color:#555;">
      Venda registrada com sucesso.<br>
      Mesa liberada.
    </p>

    <div style="
      background:#f5f5f5;
      border-radius:10px;
      padding:14px;
      margin:18px 0;
    ">
      <div>Total da venda</div>
      <strong style="font-size:26px;">
        ${money(venda.total)}
      </strong>
    </div>

    <h3>Deseja emitir nota fiscal?</h3>

    <div style="text-align:left;margin-top:18px;">
      <label for="cpfCnpjNota"
        style="font-weight:bold;font-size:14px;">
        CPF ou CNPJ do cliente (opcional)
      </label>

      <input
        id="cpfCnpjNota"
        type="text"
        inputmode="numeric"
        maxlength="18"
        placeholder="Digite o CPF ou CNPJ"
        autocomplete="off"
        style="
          width:100%;
          box-sizing:border-box;
          padding:13px;
          margin-top:8px;
          border:1px solid #ccc;
          border-radius:10px;
          font-size:16px;
        "
      >

      <small style="color:#777;display:block;margin-top:7px;">
        Deixe em branco caso o cliente não queira
        informar CPF ou CNPJ.
      </small>
    </div>

    <div style="display:flex;gap:10px;margin-top:22px;">
      <button id="naoEmitirNota" type="button"
        style="
          flex:1;
          padding:14px 8px;
          background:#e5e7eb;
          color:#222;
          border:0;
          border-radius:10px;
          font-size:14px;
          font-weight:bold;
          cursor:pointer;
        ">
        Não emitir
      </button>

      <button id="emitirNotaFiscal" type="button"
        style="
          flex:1;
          padding:14px 8px;
          background:#198754;
          color:white;
          border:0;
          border-radius:10px;
          font-size:14px;
          font-weight:bold;
          cursor:pointer;
        ">
        Emitir nota fiscal
      </button>
    </div>
  `;

  fundo.appendChild(janela);
  document.body.appendChild(fundo);

  const campoDocumento =
    janela.querySelector('#cpfCnpjNota');

  // Permite somente números e formata CPF/CNPJ.
  campoDocumento.addEventListener('input', () => {
    let numeros = campoDocumento.value
      .replace(/\D/g, '')
      .slice(0, 14);

    if (numeros.length <= 11) {
      numeros = numeros
        .replace(/^(\d{3})(\d)/, '$1.$2')
        .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/\.(\d{3})(\d)/, '.$1-$2');
    } else {
      numeros = numeros
        .replace(/^(\d{2})(\d)/, '$1.$2')
        .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/\.(\d{3})(\d)/, '.$1/$2')
        .replace(/(\d{4})(\d)/, '$1-$2');
    }

    campoDocumento.value = numeros;
  });

  janela.querySelector('#naoEmitirNota')
    .addEventListener('click', () => {
      fundo.remove();
    });


  janela.querySelector('#emitirNotaFiscal')
    .addEventListener('click', () => {

      const documento = campoDocumento.value
        .replace(/\D/g, '');

      // Verifica se o CPF/CNPJ possui a quantidade correta de dígitos.
      if (
        documento &&
        documento.length !== 11 &&
        documento.length !== 14
      ) {
        alert(
          'Informe um CPF com 11 dígitos ou um CNPJ com 14 dígitos.'
        );
        campoDocumento.focus();
        return;
      }

      // Procura a venda pela data, mesa e caixa.
      // Isso evita o erro causado pela sincronização do Firebase.
      const indiceVenda = sales.findIndex(s =>
        s.closedAt === venda.closedAt &&
        Number(s.table) === Number(venda.table) &&
        s.cashSessionId === venda.cashSessionId
      );

      if (indiceVenda === -1) {
        alert(
          'Não foi possível localizar esta venda. ' +
          'Atualize a página e tente novamente.'
        );
        return;
      }

      // Salva o CPF/CNPJ na venda encontrada.
      if (documento) {
        sales[indiceVenda].documentoCliente = documento;
      } else {
        delete sales[indiceVenda].documentoCliente;
      }

      // Salva no navegador e solicita sincronização com Firebase.
      save();

      console.log('Documento salvo na venda:', {
        indiceVenda,
        documentoSalvo:
          !!sales[indiceVenda].documentoCliente
      });

      // Atualiza as vendas disponíveis na área fiscal.
      renderFiscalSales();

      const seletorFiscal =
        document.getElementById('fiscalSale');

      if (seletorFiscal) {

        // Seleciona a venda que acabou de ser fechada.
        seletorFiscal.value = String(indiceVenda);

        // Atualiza o campo de CPF/CNPJ automaticamente.
        seletorFiscal.dispatchEvent(
          new Event('change')
        );

        preencherDocumentoFiscalDaVenda();
      }

      // Fecha a janela de impressão.
      fundo.remove();

      if (seletorFiscal) {

        seletorFiscal.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });

        alert(
          'Venda selecionada para preparação fiscal.' +
          (documento
            ? '\nCPF/CNPJ salvo com sucesso.'
            : '\nVenda sem CPF/CNPJ informado.')
        );

      } else {

        alert(
          'Documento salvo, mas a área fiscal não foi encontrada.'
        );

      }
    });

}


/* ===== ABA NOTAS FISCAIS ===== */

function criarAbaNotasFiscais() {
  if (document.getElementById('abaNotasFiscais')) return;

  const primeiraAba = document.querySelector('[data-tab]');
  if (!primeiraAba) return;

  // Cria o botão da nova aba.
  const botao = document.createElement('button');
  botao.id = 'abaNotasFiscais';
  botao.type = 'button';
  botao.className = primeiraAba.className;
  botao.classList.remove('active');
  botao.textContent = 'Notas Fiscais';

  primeiraAba.parentElement.appendChild(botao);

  // Cria a tela das notas fiscais.
  const tela = document.createElement('section');
  tela.id = 'telaNotasFiscais';
  tela.className = 'tab-view';
  tela.hidden = true;

  tela.innerHTML = `
    <div style="padding:24px;">
      <h2>Notas Fiscais</h2>

      <p style="color:#777;">
        Consulte as vendas e acompanhe
        a preparação das notas fiscais.
      </p>

      <input
        id="pesquisaNotasFiscais"
        type="search"
        placeholder="Pesquisar por mesa..."
        style="
          width:100%;
          padding:13px;
          margin:16px 0;
          border:1px solid #ccc;
          border-radius:10px;
        "
      >

      <div id="listaNotasFiscais"></div>
    </div>
  `;

  const primeiraTela = document.querySelector('.tab-view');

  if (!primeiraTela) return;

  primeiraTela.parentElement.appendChild(tela);

  // Abre a aba Notas Fiscais.
  botao.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]')
      .forEach(b => b.classList.remove('active'));

    document.querySelectorAll('.tab-view')
      .forEach(v => {
        v.hidden = true;
        v.classList.remove('active');
      });

    botao.classList.add('active');
    tela.hidden = false;
    tela.classList.add('active');

    atualizarListaNotasFiscais();
  });

  // Fecha a aba quando outra é selecionada.
  document.querySelectorAll('[data-tab]')
    .forEach(b => {
      b.addEventListener('click', () => {
        botao.classList.remove('active');
        tela.hidden = true;
        tela.classList.remove('active');
      });
    });

  document.getElementById('pesquisaNotasFiscais')
    .addEventListener('input', atualizarListaNotasFiscais);

  atualizarListaNotasFiscais();
}

function atualizarListaNotasFiscais() {
  const lista = document.getElementById('listaNotasFiscais');
  if (!lista) return;

  const pesquisa = (
    document.getElementById('pesquisaNotasFiscais')?.value || ''
  ).toLowerCase().trim();

  const vendas = sales.map((venda, indice) => ({
    venda,
    indice
  })).filter(({ venda }) => {
    return String(venda.table).includes(pesquisa) ||
      ('mesa ' + venda.table).includes(pesquisa);
  }).reverse();

  if (!vendas.length) {
    lista.innerHTML = `
      <p style="padding:20px;text-align:center;">
        Nenhuma venda encontrada.
      </p>
    `;
    return;
  }

  lista.innerHTML = vendas.map(({ venda, indice }) => `
    <div style="
      background:white;
      color:#222;
      border:1px solid #ddd;
      border-radius:12px;
      padding:18px;
      margin-bottom:12px;
    ">
      <div style="
        display:flex;
        justify-content:space-between;
        gap:12px;
        flex-wrap:wrap;
      ">
        <div>
          <strong>Mesa ${pad(venda.table)}</strong>

          <p style="margin:7px 0;color:#666;">
            ${new Date(venda.closedAt).toLocaleString('pt-BR')}
          </p>

          <strong>${money(venda.total)}</strong>
        </div>

        <div>
          <span style="
            background:#fff3cd;
            color:#856404;
            padding:8px 12px;
            border-radius:8px;
            display:inline-block;
          ">
            Situação fiscal não consultada
          </span>
        </div>
      </div>

      <button
        type="button"
        data-abrir-fiscal="${indice}"
        style="
          margin-top:15px;
          background:#198754;
          color:white;
          padding:12px 18px;
          border:0;
          border-radius:9px;
          cursor:pointer;
          font-weight:bold;
        "
      >
        Abrir área fiscal
      </button>
    </div>
  `).join('');

  lista.querySelectorAll('[data-abrir-fiscal]')
    .forEach(botao => {
      botao.addEventListener('click', () => {
        const indice = botao.dataset.abrirFiscal;

        const seletor = document.getElementById('fiscalSale');

        if (!seletor) {
          alert('Área fiscal não encontrada.');
          return;
        }

        const telaFiscal = seletor.closest('.tab-view');

        const abaFiscal = [...document.querySelectorAll('[data-tab]')]
          .find(b => b.dataset.tab === telaFiscal?.id);

        if (abaFiscal) {
          abaFiscal.click();
        }

        renderFiscalSales();

        seletor.value = indice;
        seletor.dispatchEvent(new Event('change'));
        preencherDocumentoFiscalDaVenda();

        seletor.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      });
    });
}

// Inicializa a nova aba.
criarAbaNotasFiscais();

async function prepararFiscalAoFecharMesa(venda, indice) {
  if (!cloudClient || !cloudUser || !cloudReady) {
    console.warn('Consulta fiscal pendente: Firebase desconectado.');
    return;
  }

  // A referência deve continuar compatível com o servidor.
  const referencia = fiscalRef(venda, indice);

  // Aguarda a sincronização agendada da venda.
  // A função atual não confirma erros de gravação,
  // então o servidor ainda fará a validação.
  if (cloudSaveTimer) {
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = null;
  }

  await syncCloudState();

  const token = await cloudClient.auth.currentUser.getIdToken();

  const resposta = await fetch(
    fiscalUrl() + '/api/nfce/' + encodeURIComponent(referencia),
    {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token
      }
    }
  );

  const resultado = await resposta.json();

  if (!resposta.ok) {
    throw new Error(resultado.error || 'Erro na consulta fiscal.');
  }

  console.log(
    'VENDA LOCALIZADA PELO SERVIDOR FISCAL:',
    referencia,
    resultado
  );
}


/* ===== TRANSFERENCIA DE MESAS ===== */
(() => {
  const escapar = valor => String(valor).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;'
  }[c]));

  const arredondar = n => Math.round((n + Number.EPSILON) * 100) / 100;

  function abrirTransferencia() {
    const origem = tables.find(t => t.id === selectedTableId);

    if (!origem || !origem.items.length) {
      alert('Abra uma mesa com produtos para transferir.');
      return;
    }

    if (typeof pendingPayments !== 'undefined' &&
        pendingPayments.length > 0) {
      alert('Cancele os pagamentos parciais pendentes antes de transferir.');
      return;
    }

    document.getElementById('janelaTransferencia')?.remove();

    const fundo = document.createElement('div');
    fundo.id = 'janelaTransferencia';
    fundo.style.cssText = 'position:fixed;inset:0;background:#0009;z-index:99999;display:flex;align-items:center;justify-content:center;padding:15px';

    fundo.innerHTML = `
      <div style="background:white;color:#222;width:100%;max-width:550px;max-height:90vh;overflow:auto;border-radius:12px;padding:22px">
        <h2>⇄ Transferir mesa / itens</h2>
        <p><strong>Origem:</strong> Mesa ${origem.id}</p>

        <label><strong>Mesa de destino:</strong></label>
        <select id="transferirDestino"
          style="width:100%;padding:12px;margin:8px 0 18px">
          <option value="">Selecione a mesa</option>
          ${tables.filter(t => t.id !== origem.id).map(t =>
            `<option value="${t.id}">Mesa ${t.id} - ${t.items.length ? 'Ocupada' : 'Livre'}</option>`
          ).join('')}
        </select>

        <label style="display:block;margin-bottom:12px">
          <input type="radio" name="tipoTransferencia" value="tudo" checked>
          Transferir mesa inteira
        </label>

        <label style="display:block;margin-bottom:14px">
          <input type="radio" name="tipoTransferencia" value="itens">
          Escolher produtos e quantidades
        </label>

        <div id="transferirLista" hidden
          style="border:1px solid #ddd;border-radius:8px;padding:12px">
          ${origem.items.map((item, indice) => `
            <div style="border-bottom:1px solid #eee;padding:10px 0">
              <label>
                <input type="checkbox" class="transferirItem"
                  data-indice="${indice}">
                <strong>${escapar(item.name)}</strong>
              </label>
              <div style="margin-top:7px">
                Disponível: ${item.quantity} ${item.unit === 'kg' ? 'kg' : 'un.'}
              </div>
              <input class="transferirQuantidade"
                data-indice="${indice}"
                type="number"
                min="${item.unit === 'kg' ? '0.001' : '1'}"
                max="${item.quantity}"
                step="${item.unit === 'kg' ? '0.001' : '1'}"
                value="${item.quantity}"
                style="width:120px;padding:8px;margin-top:6px">
            </div>
          `).join('')}
        </div>

        <div style="display:flex;gap:10px;margin-top:22px;flex-wrap:wrap">
          <button id="confirmarTransferencia" type="button"
            style="background:#16803c;color:white;border:0;padding:12px;border-radius:7px;cursor:pointer">
            Confirmar transferência
          </button>
          <button id="cancelarTransferencia" type="button"
            style="padding:12px;border:1px solid #ccc;border-radius:7px;cursor:pointer">
            Cancelar
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(fundo);

    const campo = id => fundo.querySelector('#' + id);

    fundo.querySelectorAll('[name="tipoTransferencia"]').forEach(radio => {
      radio.addEventListener('change', () => {
        campo('transferirLista').hidden =
          fundo.querySelector('[name="tipoTransferencia"]:checked').value !== 'itens';
      });
    });

    campo('cancelarTransferencia').onclick = () => fundo.remove();

    campo('confirmarTransferencia').onclick = async () => {
      const destinoId = Number(campo('transferirDestino').value);
      const destino = tables.find(t => t.id === destinoId);

      if (!destino || destino.id === origem.id) {
        alert('Selecione uma mesa de destino válida.');
        return;
      }

      const modo = fundo.querySelector('[name="tipoTransferencia"]:checked').value;
      const movimentacoes = [];

      if (modo === 'tudo') {
        origem.items.forEach((item, indice) => {
          movimentacoes.push({ indice, quantidade: Number(item.quantity) });
        });
      } else {
        const marcados = fundo.querySelectorAll('.transferirItem:checked');

        if (!marcados.length) {
          alert('Selecione pelo menos um produto.');
          return;
        }

        for (const marcado of marcados) {
          const indice = Number(marcado.dataset.indice);
          const item = origem.items[indice];
          const campoQtd = fundo.querySelector(
            `.transferirQuantidade[data-indice="${indice}"]`
          );
          const qtd = Number(campoQtd.value);
          const atual = Number(item.quantity);
          const fator = item.unit === 'kg' ? 1000 : 1;

          if (!Number.isFinite(qtd) || qtd <= 0 ||
              Math.abs(qtd * fator - Math.round(qtd * fator)) > 0.000001 ||
              Math.round(qtd * fator) > Math.round(atual * fator)) {
            alert('Quantidade inválida para: ' + item.name);
            return;
          }

          movimentacoes.push({ indice, quantidade: qtd });
        }
      }

      const destinoOcupado = destino.items.length > 0;

     
const confirmado = await new Promise(resolve => {
  const janela = document.createElement('div');

  janela.style.cssText = `
    position:fixed;
    inset:0;
    z-index:100001;
    background:rgba(0,0,0,.85);
    display:flex;
    align-items:center;
    justify-content:center;
    padding:16px;
  `;

  janela.innerHTML = `
    <div style="
      width:100%;
      max-width:420px;
      background:#181818;
      color:#fff;
      border:1px solid #e50920;
      border-radius:14px;
      padding:25px;
      box-sizing:border-box;
    ">
      <h2 style="color:#ff404a;margin-top:0">
        Confirmar transferência
      </h2>

      <p>Transferir da Mesa ${origem.id}
      para a Mesa ${destino.id}?</p>

      <p>${destinoOcupado
        ? 'A mesa de destino está ocupada. Os itens serão acrescentados.'
        : 'A mesa de destino está livre.'}</p>

      <div style="display:flex;gap:10px;margin-top:24px">
        <button id="cancelarConfirmacaoTransferencia"
          type="button" style="flex:1;padding:12px">
          Cancelar
        </button>

        <button id="aceitarConfirmacaoTransferencia"
          type="button"
          style="flex:1;padding:12px;background:#c81020;color:white;border:0;border-radius:8px">
          Confirmar
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(janela);

  function finalizar(resposta) {
    janela.remove();
    resolve(resposta);
  }

  janela.querySelector('#cancelarConfirmacaoTransferencia')
    .onclick = () => finalizar(false);

  janela.querySelector('#aceitarConfirmacaoTransferencia')
    .onclick = () => finalizar(true);
});

if (!confirmado) return;


      const backupOrigem = structuredClone(origem.items);
      const backupDestino = structuredClone(destino.items);

      try {
        movimentacoes.sort((a, b) => b.indice - a.indice);

        for (const movimento of movimentacoes) {
          const item = origem.items[movimento.indice];
          const atual = Number(item.quantity);
          const fator = item.unit === 'kg' ? 1000 : 1;
          const qtdAtual = Math.round(atual * fator);
          const qtdMover = Math.round(movimento.quantidade * fator);

          if (qtdMover === qtdAtual) {
            destino.items.push({ ...item });
            origem.items.splice(movimento.indice, 1);
          } else {
            const totalCentavos = Math.round(Number(item.total) * 100);
            const moverCentavos = Math.round(
              totalCentavos * qtdMover / qtdAtual
            );

            destino.items.push({
              ...item,
              quantity: qtdMover / fator,
              total: arredondar(moverCentavos / 100)
            });

            item.quantity = (qtdAtual - qtdMover) / fator;
            item.total = arredondar(
              (totalCentavos - moverCentavos) / 100
            );
          }
        }

        save();
        fundo.remove();
        render();
        
      } catch (erro) {
        origem.items = backupOrigem;
        destino.items = backupDestino;
        console.error('Erro na transferência:', erro);
        alert('A transferência não foi concluída.');
      }
    };
  }

  document.addEventListener('click', evento => {
    if (evento.target.closest('#openTransferModal')) {
      abrirTransferencia();
    }
  });
})();
/* ===== FIM TRANSFERENCIA DE MESAS ===== */


