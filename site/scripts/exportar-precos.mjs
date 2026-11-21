// Gera a mesma planilha de preços do site (preços, descontos, copart., carência, área, aba Conferir).
// Uso (via GitHub Actions): GRUPO=Amil ADMIN= node exp.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { planilhaPrecos } from '../lib/excel.js';

const grupo = process.env.GRUPO || null;
const admin = process.env.ADMIN || null; // '', 'direto' ou '__administradoras__'
const { buffer, nome } = await planilhaPrecos({ grupo, cidade: null, tipo: null, admin });
const dir = process.env.SAIDA || '../saida';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/${nome}`, Buffer.from(buffer));
console.log(`Gravado ${dir}/${nome}`);
