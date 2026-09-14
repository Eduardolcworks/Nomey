// Solo lectura: para cada migracion, que objetos crea (tablas, vistas,
// funciones, columnas añadidas) y si existen en la base LOCAL
// (supabase_db_Nomey). Lo que una migracion posterior borra a proposito no
// cuenta como ausente. Uso: node scripts/migration-audit.mjs (desde la raiz).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.cwd(), 'supabase/migrations');
const q = (sql) =>
  execSync(
    `docker exec supabase_db_Nomey psql -U postgres -d postgres -Atc "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' },
  ).trim();

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const strip = (src) => src.replace(/--[^\n]*/g, '');

const dropped = new Set();
for (const f of files) {
  const src = strip(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  for (const m of src.matchAll(
    /drop\s+(table|view|function)\s+(?:if exists\s+)?([a-z_]+)\.([a-z_]+)/gi,
  )) {
    dropped.add(`${m[1].toLowerCase()}:${m[2]}.${m[3]}`);
  }
}

const registered = new Set(
  q('select version from supabase_migrations.schema_migrations').split('\n'),
);
let allOk = true;
for (const f of files) {
  const version = f.slice(0, 14);
  const reg = registered.has(version);
  const src = strip(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  const objects = [];
  for (const m of src.matchAll(
    /create\s+(?:or replace\s+)?(table|view|function)\s+(?:if not exists\s+)?([a-z_]+)\.([a-z_]+)/gi,
  )) {
    objects.push({ kind: m[1].toLowerCase(), schema: m[2], name: m[3] });
  }
  for (const m of src.matchAll(
    /alter\s+table\s+([a-z_]+)\.([a-z_]+)\s+add\s+(?:column\s+)?(?:if not exists\s+)?([a-z_]+)/gi,
  )) {
    if (m[3].toLowerCase() !== 'constraint') {
      objects.push({ kind: 'column', schema: m[1], name: `${m[2]}.${m[3]}` });
    }
  }
  const seen = new Set();
  const uniq = objects
    .filter((o) => !dropped.has(`${o.kind}:${o.schema}.${o.name}`))
    .filter((o) => {
      const k = `${o.kind}:${o.schema}.${o.name}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const missing = [];
  for (const o of uniq) {
    let exists;
    if (o.kind === 'table' || o.kind === 'view') {
      exists =
        q(
          `select count(*) from information_schema.tables where table_schema='${o.schema}' and table_name='${o.name}'`,
        ) === '1';
    } else if (o.kind === 'function') {
      exists =
        Number(
          q(
            `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='${o.schema}' and p.proname='${o.name}'`,
          ),
        ) > 0;
    } else {
      const [t, c] = o.name.split('.');
      exists =
        q(
          `select count(*) from information_schema.columns where table_schema='${o.schema}' and table_name='${t}' and column_name='${c}'`,
        ) === '1';
    }
    if (!exists) missing.push(`${o.kind} ${o.schema}.${o.name}`);
  }
  if (missing.length > 0) allOk = false;
  console.log(
    `${version} ${reg ? 'REGISTRADA ' : 'no reg.    '} objetos=${uniq.length} ${
      missing.length === 0 ? 'todos en vivo' : 'FALTAN: ' + missing.join(', ')
    }`,
  );
}
console.log(
  allOk
    ? 'RESULTADO: todo lo que crean las migraciones (y no borra otra posterior) existe en la base viva'
    : 'RESULTADO: hay objetos que faltan',
);
