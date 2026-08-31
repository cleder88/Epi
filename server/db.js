import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Vercel: sistema de arquivos é read-only, gravação só em /tmp (efêmero)
const isVercel = !!process.env.VERCEL;
const dbPath = isVercel ? path.join('/tmp', 'database.json') : path.join(__dirname, 'database.json');
if (isVercel) console.log(`[DB] Modo Vercel detectado, usando ${dbPath}`);

function load() {
  if (!fs.existsSync(dbPath)) {
    // Em Vercel, tenta copiar seed do bundle se existir, senão cria novo
    const originalPath = path.join(__dirname, 'database.json');
    if (isVercel && fs.existsSync(originalPath)) {
      try {
        fs.copyFileSync(originalPath, dbPath);
        console.log(`[DB] Copiado ${originalPath} -> ${dbPath}`);
        return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      } catch (e) {
        console.warn('[DB] Falha ao copiar original, criando seed:', e.message);
      }
    }
    const seed = {
      funcionarios: [],
      epis: [
        { id: 1, nome: 'Capacete de Segurança', ca: '12345', validade: '2027-12-31', tamanho: 'Único', quantidade: 50, descricao: 'Capacete classe A', criado_em: new Date().toISOString() },
        { id: 2, nome: 'Luva de Proteção', ca: '67890', validade: '2026-10-15', tamanho: 'M', quantidade: 100, descricao: 'Luva nitrílica', criado_em: new Date().toISOString() },
        { id: 3, nome: 'Óculos de Proteção', ca: '54321', validade: '2027-06-30', tamanho: 'Único', quantidade: 80, descricao: 'Óculos incolor anti-risco', criado_em: new Date().toISOString() },
        { id: 4, nome: 'Protetor Auricular', ca: '98765', validade: '2026-12-31', tamanho: 'Único', quantidade: 200, descricao: 'Tipo plug silicone', criado_em: new Date().toISOString() },
        { id: 5, nome: 'Botina de Segurança', ca: '11223', validade: '2027-03-20', tamanho: '42', quantidade: 30, descricao: 'Bico de aço', criado_em: new Date().toISOString() }
      ],
      entregas: [],
      seq: { funcionarios: 1, epis: 6, entregas: 1 }
    };
    fs.writeFileSync(dbPath, JSON.stringify(seed, null, 2));
    console.log('✓ Banco JSON criado com EPIs de exemplo em', dbPath);
  }
  return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}

function save(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

let data = load();

// API compatível com código anterior (simula better-sqlite3 minimal)
const db = {
  prepare(sql) {
    sql = sql.trim();
    // SELECT COUNT(*) as c FROM epis
    if (sql.startsWith('SELECT COUNT(*) as c FROM funcionarios')) {
      return { get: () => ({ c: data.funcionarios.length }) };
    }
    if (sql.startsWith('SELECT COUNT(*) as c FROM epis WHERE quantidade < 10')) {
      return { get: () => ({ c: data.epis.filter(e => e.quantidade < 10).length }) };
    }
    if (sql.startsWith('SELECT COUNT(*) as c FROM epis')) {
      return { get: () => ({ c: data.epis.length }) };
    }
    if (sql.startsWith("SELECT COUNT(*) as c FROM entregas WHERE strftime")) {
      return { get: () => {
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        const c = data.entregas.filter(e => e.data_entrega.slice(0,7) === ym).length;
        return { c };
      }};
    }
    if (sql.startsWith('SELECT COUNT(*) as c FROM entregas')) {
      return { get: () => ({ c: data.entregas.length }) };
    }
    if (sql === 'SELECT * FROM funcionarios ORDER BY id DESC') {
      return { all: () => [...data.funcionarios].sort((a,b)=>b.id-a.id) };
    }
    if (sql === 'SELECT * FROM funcionarios WHERE id = ?' || sql === 'SELECT * FROM funcionarios WHERE id=?') {
      return { get: (id) => data.funcionarios.find(f=>f.id==id) || null };
    }
    if (sql.startsWith('INSERT INTO funcionarios')) {
      return { run: (nome, cpf, matricula, cargo, setor, face_descriptor, foto) => {
        if (data.funcionarios.some(f=>f.cpf===cpf)) throw new Error('UNIQUE constraint failed: funcionarios.cpf');
        if (data.funcionarios.some(f=>f.matricula===matricula)) throw new Error('UNIQUE constraint failed: funcionarios.matricula');
        const id = data.seq.funcionarios++;
        const row = { id, nome, cpf, matricula, cargo, setor, face_descriptor, foto, criado_em: new Date().toISOString() };
        data.funcionarios.push(row);
        save(data);
        return { lastInsertRowid: id };
      }};
    }
    if (sql.startsWith('UPDATE funcionarios SET')) {
      return { run: (nome, cpf, matricula, cargo, setor, face_descriptor, foto, id) => {
        const f = data.funcionarios.find(x=>x.id==id);
        if (f) { f.nome=nome; f.cpf=cpf; f.matricula=matricula; f.cargo=cargo; f.setor=setor; f.face_descriptor=face_descriptor; f.foto=foto; save(data); }
        return { changes: f?1:0 };
      }};
    }
    if (sql.startsWith('DELETE FROM funcionarios WHERE id=?')) {
      return { run: (id) => {
        const lenBefore = data.funcionarios.length;
        data.funcionarios = data.funcionarios.filter(f=>f.id!=id);
        // cascade
        data.entregas = data.entregas.filter(e=>e.funcionario_id!=id);
        save(data);
        return { changes: lenBefore - data.funcionarios.length };
      }};
    }
    if (sql === 'SELECT * FROM epis ORDER BY id DESC') {
      return { all: () => [...data.epis].sort((a,b)=>b.id-a.id) };
    }
    if (sql === 'SELECT * FROM epis WHERE id=?' || sql === 'SELECT * FROM epis WHERE id = ?') {
      return { get: (id) => data.epis.find(e=>e.id==id) || null };
    }
    if (sql.startsWith('INSERT INTO epis')) {
      return { run: (nome, ca, validade, tamanho, quantidade, descricao) => {
        const id=data.seq.epis++;
        const row={ id, nome, ca, validade, tamanho, quantidade, descricao, criado_em:new Date().toISOString() };
        data.epis.push(row); save(data); return { lastInsertRowid:id };
      }};
    }
    if (sql.startsWith('UPDATE epis SET nome=')) {
      return { run: (nome, ca, validade, tamanho, quantidade, descricao, id) => {
        const e=data.epis.find(x=>x.id==id);
        if(e){ e.nome=nome; e.ca=ca; e.validade=validade; e.tamanho=tamanho; e.quantidade=quantidade; e.descricao=descricao; save(data); }
        return {};
      }};
    }
    if (sql.startsWith('UPDATE epis SET quantidade = quantidade -')) {
      return { run: (qtd, id) => {
        const e=data.epis.find(x=>x.id==id);
        if(e) e.quantidade-=qtd;
        save(data); return {};
      }};
    }
    if (sql.startsWith('UPDATE epis SET quantidade = quantidade +')) {
      return { run: (qtd, id) => {
        const e=data.epis.find(x=>x.id==id);
        if(e) e.quantidade+=qtd;
        save(data); return {};
      }};
    }
    if (sql.startsWith('DELETE FROM epis WHERE id=?')) {
      return { run: (id) => {
        const before=data.epis.length;
        data.epis=data.epis.filter(e=>e.id!=id);
        data.entregas=data.entregas.filter(e=>e.epi_id!=id);
        save(data);
        return { changes: before-data.epis.length };
      }};
    }
    if (sql.startsWith('SELECT e.*, f.nome as funcionario_nome')) {
      // both for GET entregas and GET single entrega (with WHERE e.id=?)
      if (sql.includes('WHERE e.id=?')) {
        return { get: (id) => {
          const e=data.entregas.find(x=>x.id==id);
          if(!e) return null;
          const f=data.funcionarios.find(x=>x.id==e.funcionario_id);
          const ep=data.epis.find(x=>x.id==e.epi_id);
          return { ...e, funcionario_nome:f?.nome||'?', epi_nome:ep?.nome||'?' };
        }};
      }
      return { all: () => data.entregas.map(e=>{
        const f=data.funcionarios.find(x=>x.id==e.funcionario_id);
        const ep=data.epis.find(x=>x.id==e.epi_id);
        return { ...e, funcionario_nome:f?.nome||'[removido]', matricula:f?.matricula||'-', cpf:f?.cpf||'-', setor:f?.setor||'-', epi_nome:ep?.nome||'[removido]', epi_ca: ep?.ca||'-' };
      }).sort((a,b)=> new Date(b.data_entrega)-new Date(a.data_entrega) || b.id-a.id) };
    }
    if (sql.startsWith('SELECT * FROM entregas WHERE id=?')) {
      return { get: (id)=> data.entregas.find(e=>e.id==id)||null };
    }
    if (sql.startsWith('INSERT INTO entregas')) {
      return { run: (funcionario_id, epi_id, data_entrega, quantidade, assinatura_tipo, face_match_score, observacao) => {
        const id=data.seq.entregas++;
        const row={ id, funcionario_id, epi_id, data_entrega, quantidade, assinatura_tipo, face_match_score, observacao, criado_em:new Date().toISOString() };
        data.entregas.push(row); save(data); return { lastInsertRowid:id };
      }};
    }
    if (sql.startsWith('DELETE FROM entregas WHERE id=?')) {
      return { run: (id)=> {
        const before=data.entregas.length;
        data.entregas=data.entregas.filter(e=>e.id!=id);
        save(data);
        return { changes: before-data.entregas.length };
      }};
    }
    if (sql.startsWith('SELECT * FROM funcionarios WHERE id=?') || sql.startsWith('SELECT * FROM funcionarios WHERE id = ?')) {
      return { get: (id)=> data.funcionarios.find(f=>f.id==id)||null };
    }
    console.warn('SQL não mapeado:', sql);
    return { get:()=>null, all:()=>[], run:()=>({}) };
  },
  exec: ()=>{},
  pragma: ()=>{}
};

export default db;
