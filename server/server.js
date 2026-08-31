import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
// Detecta diretório public: funciona tanto quando server está em /server (root) quanto em /public/server (deploy Vercel com RootDirectory=public)
let publicDir = path.join(rootDir, 'public');
if (!fs.existsSync(path.join(publicDir, 'index.html'))) {
  // fallback: se estamos em public/server, o public é o próprio rootDir
  if (fs.existsSync(path.join(rootDir, 'index.html'))) publicDir = rootDir;
}

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Log de diagnóstico (antes do static para pegar tudo)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} Origin:${req.headers.origin||'-'} Referer:${req.headers.referer||'-'}`);
  next();
});
app.use(express.static(publicDir, { etag: false, maxAge: 0, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));

// ========== FUNCIONARIOS ==========
app.get('/api/funcionarios', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM funcionarios ORDER BY id DESC').all();
    const mapped = rows.map(r => {
      let parsed = null;
      if (r.face_descriptor) {
        try { parsed = JSON.parse(r.face_descriptor); } catch { parsed = null; }
      }
      return { ...r, hasFace: !!r.face_descriptor, face_descriptor: parsed };
    });
    res.json(mapped);
  } catch(e){ console.error(e); res.status(500).json({error:e.message}); }
});

app.get('/api/funcionarios/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM funcionarios WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Funcionário não encontrado' });
  row.hasFace = !!row.face_descriptor;
  try { row.face_descriptor = row.face_descriptor ? JSON.parse(row.face_descriptor) : null; } catch { row.face_descriptor = null; }
  res.json(row);
});

app.post('/api/funcionarios', (req, res) => {
  const { nome, cpf, matricula, cargo, setor, face_descriptor, foto } = req.body;
  if (!nome || !cpf || !matricula || !cargo || !setor) {
    return res.status(400).json({ error: 'Campos obrigatórios: nome, cpf, matricula, cargo, setor' });
  }
  try {
    // face_descriptor pode vir como array (128 floats) ou já string - normaliza
    let descriptorStr = null;
    if (face_descriptor) {
      if (typeof face_descriptor === 'string') {
        // já é JSON string? tenta validar
        try { JSON.parse(face_descriptor); descriptorStr = face_descriptor; } catch { descriptorStr = JSON.stringify(face_descriptor); }
      } else if (Array.isArray(face_descriptor)) {
        descriptorStr = JSON.stringify(face_descriptor);
      } else {
        descriptorStr = JSON.stringify(face_descriptor);
      }
    }
    const cpfLimpo = String(cpf).replace(/\D/g,'');
    if (cpfLimpo.length !== 11) return res.status(400).json({ error: 'CPF deve ter 11 dígitos' });
    const stmt = db.prepare(`INSERT INTO funcionarios (nome, cpf, matricula, cargo, setor, face_descriptor, foto) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const info = stmt.run(nome.trim(), cpfLimpo, String(matricula).trim(), cargo.trim(), setor.trim(), descriptorStr, foto || null);
    const created = db.prepare('SELECT * FROM funcionarios WHERE id = ?').get(info.lastInsertRowid);
    // retorna no mesmo formato do GET (parseado) para consistência
    if (created) {
      created.hasFace = !!created.face_descriptor;
      try { created.face_descriptor = created.face_descriptor ? JSON.parse(created.face_descriptor) : null; } catch {}
    }
    res.status(201).json(created);
  } catch (e) {
    console.error('POST /api/funcionarios erro:', e);
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'CPF ou matrícula já cadastrados. Use outro CPF/matrícula.' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/funcionarios/:id', (req, res) => {
  const { nome, cpf, matricula, cargo, setor, face_descriptor, foto } = req.body;
  const existing = db.prepare('SELECT * FROM funcionarios WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Não encontrado' });
  try {
    let descriptorStr = existing.face_descriptor;
    if (face_descriptor !== undefined && face_descriptor !== null) {
      if (typeof face_descriptor === 'string') {
        try { JSON.parse(face_descriptor); descriptorStr = face_descriptor; } catch { descriptorStr = JSON.stringify(face_descriptor); }
      } else {
        descriptorStr = JSON.stringify(face_descriptor);
      }
    } else if (face_descriptor === null) {
      descriptorStr = null;
    }
    const fotoVal = foto !== undefined ? foto : existing.foto;
    const cpfVal = cpf ? String(cpf).replace(/\D/g,'') : existing.cpf;
    db.prepare(`UPDATE funcionarios SET nome=?, cpf=?, matricula=?, cargo=?, setor=?, face_descriptor=?, foto=? WHERE id=?`)
      .run(nome || existing.nome, cpfVal, matricula || existing.matricula, cargo || existing.cargo, setor || existing.setor, descriptorStr, fotoVal, req.params.id);
    const updated = db.prepare('SELECT * FROM funcionarios WHERE id=?').get(req.params.id);
    if (updated) {
      updated.hasFace = !!updated.face_descriptor;
      try { updated.face_descriptor = updated.face_descriptor ? JSON.parse(updated.face_descriptor) : null; } catch {}
    }
    res.json(updated);
  } catch (e) {
    console.error('PUT /api/funcionarios erro:', e);
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'CPF ou matrícula já cadastrados' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/funcionarios/:id', (req, res) => {
  const info = db.prepare('DELETE FROM funcionarios WHERE id=?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Não encontrado' });
  res.json({ success: true });
});

// ========== EPIS ==========
app.get('/api/epis', (req, res) => {
  const rows = db.prepare('SELECT * FROM epis ORDER BY id DESC').all();
  res.json(rows);
});

app.post('/api/epis', (req, res) => {
  const { nome, ca, validade, tamanho, quantidade, descricao } = req.body;
  if (!nome || !ca) return res.status(400).json({ error: 'Nome e CA são obrigatórios' });
  const info = db.prepare('INSERT INTO epis (nome, ca, validade, tamanho, quantidade, descricao) VALUES (?,?,?,?,?,?)')
    .run(nome, ca, validade || null, tamanho || null, parseInt(quantidade) || 0, descricao || null);
  const created = db.prepare('SELECT * FROM epis WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json(created);
});

app.put('/api/epis/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM epis WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Não encontrado' });
  const { nome, ca, validade, tamanho, quantidade, descricao } = req.body;
  db.prepare('UPDATE epis SET nome=?, ca=?, validade=?, tamanho=?, quantidade=?, descricao=? WHERE id=?')
    .run(nome || existing.nome, ca || existing.ca, validade || existing.validade, tamanho || existing.tamanho, quantidade !== undefined ? parseInt(quantidade) : existing.quantidade, descricao || existing.descricao, req.params.id);
  res.json(db.prepare('SELECT * FROM epis WHERE id=?').get(req.params.id));
});

app.delete('/api/epis/:id', (req, res) => {
  const info = db.prepare('DELETE FROM epis WHERE id=?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Não encontrado' });
  res.json({ success: true });
});

// ========== EPI - MODELO EXCEL / IMPORTAÇÃO EM MASSA ==========
// Gera CSV modelo para download (Excel abre direto). Também suporta ?format=xlsx via redirect ao frontend.
// Campos: nome, ca, validade, tamanho, quantidade, descricao
app.get('/api/epis/template', (req, res) => {
  const csvHeader = 'nome,ca,validade,tamanho,quantidade,descricao';
  const exemplos = [
    'Capacete de Segurança,12345,2027-12-31,Único,50,Capacete classe A - exemplo - APAGUE ou EDITE esta linha',
    'Luva Nitrílica,67890,2026-10-15,M,100,Luva nitrílica descartável - exemplo',
    'Óculos de Proteção,54321,2027-06-30,Único,80,Óculos incolor anti-risco - exemplo'
  ];
  const instrucoes = [
    '# INSTRUÇÕES - MODELO DE CADASTRO EM MASSA DE EPI',
    '# 1. Preencha uma linha por EPI abaixo do cabeçalho. Não altere o cabeçalho.',
    '# 2. Colunas obrigatórias: nome, ca',
    '# 3. validade: formato AAAA-MM-DD (ex: 2027-12-31) ou deixe vazio',
    '# 4. tamanho: ex: P, M, G, GG, 42, Único',
    '# 5. quantidade: número inteiro (ex: 50)',
    '# 6. descricao: texto livre opcional',
    '# 7. Salve como .csv (UTF-8) ou .xlsx e importe em EPIs > Importar planilha',
    '# 8. Você também pode usar EPIs > Baixar modelo Excel no sistema para gerar .xlsx com abas de instrução.'
  ];
  const csv = [csvHeader, ...exemplos].join('\n');
  const comInstrucoes = instrucoes.join('\n') + '\n' + csv;
  // Se cliente pedir download direto, retorna CSV com BOM para Excel PT-BR
  const bom = '\uFEFF';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="modelo_cadastro_epi_em_massa.csv"');
  res.send(bom + comInstrucoes);
});

// Importação em massa: recebe { epis: [...] } ou array direto
app.post('/api/epis/import', (req, res) => {
  let lista = req.body.epis || req.body;
  // permite também { data: [...] }
  if (req.body.data && Array.isArray(req.body.data)) lista = req.body.data;
  if (!Array.isArray(lista)) {
    return res.status(400).json({ error: 'Envie um array de EPIs em { epis: [...] } ou diretamente [...]' });
  }
  if (lista.length === 0) return res.status(400).json({ error: 'Planilha vazia' });
  if (lista.length > 500) return res.status(400).json({ error: 'Limite de 500 EPIs por importação' });

  let sucesso = 0;
  const falhas = [];
  const criados = [];

  lista.forEach((raw, idx) => {
    const linha = idx + 2; // +1 header +1 index base 1
    // normaliza chaves: aceita variações de cabeçalho
    const norm = {};
    Object.keys(raw).forEach(k => {
      const nk = String(k).trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/[^a-z0-9]/g,'');
      norm[nk] = raw[k];
    });
    const get = (...keys) => {
      for (const k of keys) {
        const nk = k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
        if (norm[nk] !== undefined && norm[nk] !== null && String(norm[nk]).trim() !== '') return norm[nk];
      }
      return null;
    };
    const nome = String(get('nome','nome do epi','nomeepi','produto','equipamento') || '').trim();
    const ca = String(get('ca','certificado','numca','nca') || '').trim();
    let validade = get('validade','val','data validade','vencimento');
    let tamanho = get('tamanho','tam','medida');
    let quantidade = get('quantidade','qtd','quant','estoque');
    let descricao = get('descricao','desc','observacao','obs','detalhes');

    if (!nome || !ca) {
      falhas.push({ linha, erro: 'Nome e CA são obrigatórios', dados: raw });
      return;
    }
    // valida validade - aceita AAAA-MM-DD, DD/MM/AAAA, AAAA/MM/DD, serial Excel e Date
    const excelSerialToISO = (serial) => {
      const num = Number(serial);
      if (isNaN(num) || num < 3000 || num > 80000) return null;
      const utc = Math.round((num - 25569) * 86400 * 1000);
      const d = new Date(utc);
      if (isNaN(d.getTime())) return null;
      return d.toISOString().slice(0,10);
    };
    const normalizaVal = (v) => {
      if (v === null || v === undefined || String(v).trim() === '') return null;
      if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10);
      let s = String(v).trim();
      if (/^\d+(\.\d+)?$/.test(s)) {
        const iso = excelSerialToISO(s);
        if (iso) return iso;
      }
      let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      s = s.slice(0,10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
      return s;
    };
    if (validade !== null && validade !== undefined && String(validade).trim() !== '') {
      const normVal = normalizaVal(validade);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normVal||'')) {
        falhas.push({ linha, erro: `Validade inválida "${validade}" use AAAA-MM-DD ou DD/MM/AAAA`, dados: raw });
        return;
      }
      validade = normVal;
    } else validade = null;

    if (tamanho) tamanho = String(tamanho).trim(); else tamanho = null;
    if (descricao) descricao = String(descricao).trim(); else descricao = null;
    const qtdInt = parseInt(quantidade);
    const qtdFinal = isNaN(qtdInt) ? 0 : qtdInt;
    if (qtdFinal < 0) {
      falhas.push({ linha, erro: 'Quantidade não pode ser negativa', dados: raw });
      return;
    }
    try {
      const info = db.prepare('INSERT INTO epis (nome, ca, validade, tamanho, quantidade, descricao) VALUES (?,?,?,?,?,?)')
        .run(nome, ca, validade, tamanho, qtdFinal, descricao);
      const created = db.prepare('SELECT * FROM epis WHERE id=?').get(info.lastInsertRowid);
      criados.push(created);
      sucesso++;
    } catch (e) {
      falhas.push({ linha, erro: e.message, dados: raw });
    }
  });

  res.json({
    total: lista.length,
    sucesso,
    falhas: falhas.length,
    detalhesFalhas: falhas.slice(0, 20),
    criados: criados.slice(0, 5),
    message: `${sucesso} EPI(s) cadastrado(s) com sucesso${falhas.length ? `, ${falhas.length} falha(s)` : ''}`
  });
});

// ========== ENTREGAS ==========
app.get('/api/entregas', (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, f.nome as funcionario_nome, f.matricula, f.cpf, f.setor,
           ep.nome as epi_nome, ep.ca as epi_ca
    FROM entregas e
    JOIN funcionarios f ON f.id = e.funcionario_id
    JOIN epis ep ON ep.id = e.epi_id
    ORDER BY e.data_entrega DESC, e.id DESC
  `).all();
  res.json(rows);
});

app.post('/api/entregas', (req, res) => {
  const { funcionario_id, epi_id, quantidade, observacao, face_match_score } = req.body;
  if (!funcionario_id || !epi_id) return res.status(400).json({ error: 'funcionario_id e epi_id obrigatórios' });

  const func = db.prepare('SELECT * FROM funcionarios WHERE id=?').get(funcionario_id);
  if (!func) return res.status(404).json({ error: 'Funcionário não encontrado' });
  const epi = db.prepare('SELECT * FROM epis WHERE id=?').get(epi_id);
  if (!epi) return res.status(404).json({ error: 'EPI não encontrado' });
  if (epi.quantidade !== null && epi.quantidade < (quantidade || 1)) {
    return res.status(400).json({ error: `Estoque insuficiente. Disponível: ${epi.quantidade}` });
  }

  const data_entrega = new Date().toISOString();
  const info = db.prepare(`INSERT INTO entregas (funcionario_id, epi_id, data_entrega, quantidade, assinatura_tipo, face_match_score, observacao) VALUES (?,?,?,?,?,?,?)`)
    .run(funcionario_id, epi_id, data_entrega, quantidade || 1, 'facial', face_match_score || null, observacao || null);

  // baixa estoque
  if (epi.quantidade !== null) {
    db.prepare('UPDATE epis SET quantidade = quantidade - ? WHERE id=?').run(quantidade || 1, epi_id);
  }

  const created = db.prepare(`
    SELECT e.*, f.nome as funcionario_nome, ep.nome as epi_nome
    FROM entregas e
    JOIN funcionarios f ON f.id=e.funcionario_id
    JOIN epis ep ON ep.id=e.epi_id
    WHERE e.id=?
  `).get(info.lastInsertRowid);

  res.status(201).json(created);
});

app.delete('/api/entregas/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM entregas WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Não encontrado' });
  // estorna estoque
  db.prepare('UPDATE epis SET quantidade = quantidade + ? WHERE id=?').run(row.quantidade, row.epi_id);
  db.prepare('DELETE FROM entregas WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ========== DASHBOARD STATS ==========
app.get('/api/stats', (req, res) => {
  const totalFuncionarios = db.prepare('SELECT COUNT(*) as c FROM funcionarios').get().c;
  const totalEpis = db.prepare('SELECT COUNT(*) as c FROM epis').get().c;
  const totalEntregas = db.prepare('SELECT COUNT(*) as c FROM entregas').get().c;
  const estoqueBaixo = db.prepare('SELECT COUNT(*) as c FROM epis WHERE quantidade < 10').get().c;
  const entregasMes = db.prepare(`SELECT COUNT(*) as c FROM entregas WHERE strftime('%Y-%m', data_entrega) = strftime('%Y-%m', 'now')`).get().c;
  res.json({ totalFuncionarios, totalEpis, totalEntregas, estoqueBaixo, entregasMes });
});

// Fallback para SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Vercel: exporta app como serverless function, não faz listen
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`✓ Sistema EPI rodando em http://localhost:${PORT}`);
  });
}

export default app;
